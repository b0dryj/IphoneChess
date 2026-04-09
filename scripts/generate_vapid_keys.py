from __future__ import annotations

import base64
import sys
from pathlib import Path

def encode_base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main() -> None:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError:
        print("cryptography is not installed. Run: pip install -r requirements.txt")
        sys.exit(1)

    repo_root = Path(__file__).resolve().parent.parent
    certs_dir = repo_root / "certs"
    certs_dir.mkdir(parents=True, exist_ok=True)

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_number = private_key.private_numbers().private_value.to_bytes(32, "big")
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )

    public_key_text = encode_base64url(public_key)
    private_key_text = encode_base64url(private_number)

    (certs_dir / "vapid_public_key.txt").write_text(public_key_text, encoding="utf-8")
    (certs_dir / "vapid_private_key.txt").write_text(private_key_text, encoding="utf-8")

    print("VAPID keys generated:")
    print(certs_dir / "vapid_public_key.txt")
    print(certs_dir / "vapid_private_key.txt")


if __name__ == "__main__":
    main()
