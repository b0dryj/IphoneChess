from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

try:
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - optional dependency for runtime setup
    WebPushException = Exception
    webpush = None


def load_vapid_config(root: Path) -> dict[str, str]:
    file_public = os.environ.get("VAPID_PUBLIC_KEY_FILE")
    file_private = os.environ.get("VAPID_PRIVATE_KEY_FILE")

    public_key = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()

    if not public_key and file_public:
        public_key = _read_optional_text(Path(file_public))
    if not private_key and file_private:
        private_key = _read_optional_text(Path(file_private))

    subject = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")

    if not public_key:
        default_public = root / "certs" / "vapid_public_key.txt"
        public_key = _read_optional_text(default_public)
    if not private_key:
        default_private = root / "certs" / "vapid_private_key.txt"
        private_key = _read_optional_text(default_private)

    return {
        "public_key": public_key.strip(),
        "private_key": private_key.strip(),
        "subject": subject.strip(),
    }


def _read_optional_text(path: Path) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


class PushNotificationManager:
    def __init__(self, storage_path: Path, vapid_config: dict[str, str]) -> None:
        self.storage_path = storage_path
        self.vapid_public_key = vapid_config.get("public_key", "")
        self.vapid_private_key = vapid_config.get("private_key", "")
        self.vapid_subject = vapid_config.get("subject", "mailto:admin@example.com")
        self.lock = threading.Lock()
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self._load()

    def config_payload(self) -> dict[str, Any]:
        dependency_ready = webpush is not None
        keys_ready = bool(self.vapid_public_key and self.vapid_private_key)
        supported = dependency_ready and keys_ready

        reason = ""
        if not dependency_ready:
            reason = "pywebpush dependency is not installed on the server."
        elif not keys_ready:
            reason = "VAPID keys are not configured on the server."

        return {
            "supported": supported,
            "reason": reason,
            "vapidPublicKey": self.vapid_public_key,
        }

    def save_subscription(self, subscription: dict[str, Any]) -> bool:
        endpoint = subscription.get("endpoint", "")
        keys = subscription.get("keys", {})
        if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
            return False

        with self.lock:
            self.subscriptions[endpoint] = subscription
            self._persist()
        return True

    def remove_subscription(self, endpoint: str) -> bool:
        with self.lock:
            removed = self.subscriptions.pop(endpoint, None)
            if removed is not None:
                self._persist()
                return True
        return False

    def schedule_test_push(
        self,
        subscription: dict[str, Any],
        delay_seconds: int = 10,
    ) -> tuple[bool, str]:
        config = self.config_payload()
        if not config["supported"]:
            return False, config["reason"]

        endpoint = subscription.get("endpoint", "")
        if endpoint not in self.subscriptions:
            self.save_subscription(subscription)

        worker = threading.Thread(
            target=self._delayed_send,
            args=(subscription, delay_seconds),
            daemon=True,
        )
        worker.start()
        return True, ""

    def _delayed_send(self, subscription: dict[str, Any], delay_seconds: int) -> None:
        time.sleep(max(1, delay_seconds))
        payload = {
            "title": "Шахматы",
            "body": "Тестовый push из PWA",
            "url": "./",
            "tag": "local-chess-web-push",
            "icon": "./apple-touch-icon.png",
            "badge": "./apple-touch-icon.png",
        }
        self.send_web_push(subscription, payload)

    def send_web_push(self, subscription: dict[str, Any], payload: dict[str, Any]) -> None:
        if webpush is None:
            return
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=self.vapid_private_key,
                vapid_claims={"sub": self.vapid_subject},
            )
        except WebPushException:
            endpoint = subscription.get("endpoint", "")
            if endpoint:
                self.remove_subscription(endpoint)

    def _load(self) -> None:
        if not self.storage_path.exists():
            return
        try:
            items = json.loads(self.storage_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return

        if isinstance(items, list):
            for item in items:
                endpoint = item.get("endpoint")
                if endpoint:
                    self.subscriptions[endpoint] = item

    def _persist(self) -> None:
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self.storage_path.write_text(
            json.dumps(list(self.subscriptions.values()), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
