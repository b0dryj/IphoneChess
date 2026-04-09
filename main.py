from __future__ import annotations

import json
import os
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from typing import Iterable
from urllib.parse import urlparse


ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"
CERTS_DIR = ROOT / "certs"
ROOT_CA_FILE = CERTS_DIR / "local-root-ca.cer"
DEFAULT_SSL_CERT_FILE = CERTS_DIR / "local-server.pem"
DEFAULT_SSL_KEY_FILE = CERTS_DIR / "local-server.key"

FILES = {
    "/": STATIC_DIR / "index.html",
    "/index.html": STATIC_DIR / "index.html",
    "/styles.css": STATIC_DIR / "styles.css",
    "/app.js": STATIC_DIR / "app.js",
    "/manifest.webmanifest": STATIC_DIR / "manifest.webmanifest",
    "/sw.js": STATIC_DIR / "sw.js",
    "/apple-touch-icon.png": STATIC_DIR / "apple-touch-icon.png",
    "/icons/icon.svg": STATIC_DIR / "icons" / "icon.svg",
    "/icons/icon-maskable.svg": STATIC_DIR / "icons" / "icon-maskable.svg",
}


def square_to_coords(square: str) -> tuple[int, int]:
    file_index = ord(square[0]) - ord("a")
    rank_index = 8 - int(square[1])
    return rank_index, file_index


def coords_to_square(row: int, col: int) -> str:
    return f"{chr(ord('a') + col)}{8 - row}"


def on_board(row: int, col: int) -> bool:
    return 0 <= row < 8 and 0 <= col < 8


@dataclass
class MoveResult:
    ok: bool
    message: str


class ChessGame:
    def __init__(self) -> None:
        self.lock = Lock()
        self.reset()

    def reset(self) -> None:
        self.board = [
            ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
            ["bp"] * 8,
            [""] * 8,
            [""] * 8,
            [""] * 8,
            [""] * 8,
            ["wp"] * 8,
            ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"],
        ]
        self.turn = "w"
        self.selected: str | None = None
        self.winner: str | None = None
        self.status = "Белые ходят"
        self.last_move: dict[str, str] | None = None
        self.history: list[dict[str, str]] = []
        self.captured = {"w": [], "b": []}
        self.castling = {
            "w": {"king_side": True, "queen_side": True},
            "b": {"king_side": True, "queen_side": True},
        }
        self.en_passant_target: str | None = None

    def state(self) -> dict:
        with self.lock:
            legal_moves = []
            if self.selected:
                legal_moves = sorted(self.legal_moves_for_square(self.selected))
            return {
                "board": self.board,
                "turn": self.turn,
                "turnLabel": "Белые" if self.turn == "w" else "Черные",
                "status": self.status,
                "winner": self.winner,
                "selected": self.selected,
                "legalMoves": legal_moves,
                "lastMove": self.last_move,
                "history": self.history[-12:],
                "captured": self.captured,
                "isCheck": self.is_in_check(self.turn),
            }

    def select(self, square: str) -> MoveResult:
        with self.lock:
            if self.winner:
                return MoveResult(False, "Партия завершена, начните новую игру")
            piece = self.get_piece(square)
            if not piece:
                self.selected = None
                return MoveResult(False, "На этой клетке нет фигуры")
            if piece[0] != self.turn:
                return MoveResult(False, "Сейчас ходит другой цвет")
            legal_moves = self.legal_moves_for_square(square)
            self.selected = square if legal_moves else None
            if not legal_moves:
                return MoveResult(False, "У выбранной фигуры нет допустимых ходов")
            return MoveResult(True, f"Выбрана клетка {square}")

    def move(self, from_square: str, to_square: str) -> MoveResult:
        with self.lock:
            if self.winner:
                return MoveResult(False, "Партия завершена, начните новую игру")
            piece = self.get_piece(from_square)
            if not piece:
                return MoveResult(False, "Исходная клетка пуста")
            if piece[0] != self.turn:
                return MoveResult(False, "Сейчас ходит другой цвет")
            legal_moves = self.legal_moves_for_square(from_square)
            if to_square not in legal_moves:
                return MoveResult(False, "Этот ход запрещен правилами")

            captured_piece = self.get_piece(to_square)
            special = None
            from_row, from_col = square_to_coords(from_square)
            to_row, to_col = square_to_coords(to_square)

            if piece[1] == "p" and from_col != to_col and not captured_piece:
                special = "en_passant"
                captured_row = to_row + (1 if piece[0] == "w" else -1)
                captured_piece = self.board[captured_row][to_col]
                self.board[captured_row][to_col] = ""

            self.apply_move(from_square, to_square)

            if captured_piece:
                self.captured[piece[0]].append(captured_piece)

            if piece[1] == "p" and abs(from_row - to_row) == 2:
                middle_row = (from_row + to_row) // 2
                self.en_passant_target = coords_to_square(middle_row, from_col)
            else:
                self.en_passant_target = None

            if piece[1] == "k":
                self.castling[piece[0]]["king_side"] = False
                self.castling[piece[0]]["queen_side"] = False
                if abs(from_col - to_col) == 2:
                    special = "castling"
                    if to_col == 6:
                        rook_from = coords_to_square(from_row, 7)
                        rook_to = coords_to_square(from_row, 5)
                    else:
                        rook_from = coords_to_square(from_row, 0)
                        rook_to = coords_to_square(from_row, 3)
                    self.apply_move(rook_from, rook_to)
            elif piece[1] == "r":
                if from_square in ("a1", "a8"):
                    self.castling[piece[0]]["queen_side"] = False
                if from_square in ("h1", "h8"):
                    self.castling[piece[0]]["king_side"] = False

            if captured_piece == "wr":
                if to_square == "a1":
                    self.castling["w"]["queen_side"] = False
                if to_square == "h1":
                    self.castling["w"]["king_side"] = False
            if captured_piece == "br":
                if to_square == "a8":
                    self.castling["b"]["queen_side"] = False
                if to_square == "h8":
                    self.castling["b"]["king_side"] = False

            promoted = False
            if piece[1] == "p" and to_row in (0, 7):
                self.board[to_row][to_col] = f"{piece[0]}q"
                promoted = True
                special = "promotion"

            move_text = f"{from_square}-{to_square}"
            if promoted:
                move_text += "=Ф"
            self.history.append(
                {
                    "piece": piece,
                    "move": move_text,
                    "special": special or "",
                }
            )
            self.last_move = {"from": from_square, "to": to_square}
            self.selected = None
            self.turn = "b" if self.turn == "w" else "w"
            self.update_status_after_move()
            return MoveResult(True, "Ход выполнен")

    def update_status_after_move(self) -> None:
        current = self.turn
        moves_exist = self.has_any_legal_moves(current)
        in_check = self.is_in_check(current)
        color_label = "Белые" if current == "w" else "Черные"
        opponent_label = "Черные" if current == "w" else "Белые"

        if not moves_exist and in_check:
            self.winner = "b" if current == "w" else "w"
            self.status = f"Мат. Победили {opponent_label.lower()}"
        elif not moves_exist:
            self.winner = "draw"
            self.status = "Пат. Ничья"
        elif in_check:
            self.status = f"Шах. Ходят {color_label.lower()}"
        else:
            self.status = f"{color_label} ходят"

    def get_piece(self, square: str) -> str:
        row, col = square_to_coords(square)
        return self.board[row][col]

    def set_piece(self, square: str, piece: str) -> None:
        row, col = square_to_coords(square)
        self.board[row][col] = piece

    def apply_move(self, from_square: str, to_square: str) -> None:
        piece = self.get_piece(from_square)
        self.set_piece(from_square, "")
        self.set_piece(to_square, piece)

    def legal_moves_for_square(self, square: str) -> list[str]:
        piece = self.get_piece(square)
        if not piece:
            return []
        color = piece[0]
        candidates = self.pseudo_legal_moves(square, piece)
        legal = []
        for target in candidates:
            snapshot = self.snapshot()
            self.execute_simulated_move(square, target, piece)
            if not self.is_in_check(color):
                legal.append(target)
            self.restore(snapshot)
        return legal

    def has_any_legal_moves(self, color: str) -> bool:
        for row in range(8):
            for col in range(8):
                piece = self.board[row][col]
                if piece and piece[0] == color:
                    if self.legal_moves_for_square(coords_to_square(row, col)):
                        return True
        return False

    def snapshot(self) -> dict:
        return {
            "board": [row[:] for row in self.board],
            "en_passant_target": self.en_passant_target,
            "castling": {
                "w": self.castling["w"].copy(),
                "b": self.castling["b"].copy(),
            },
        }

    def restore(self, snapshot: dict) -> None:
        self.board = [row[:] for row in snapshot["board"]]
        self.en_passant_target = snapshot["en_passant_target"]
        self.castling = {
            "w": snapshot["castling"]["w"].copy(),
            "b": snapshot["castling"]["b"].copy(),
        }

    def execute_simulated_move(self, from_square: str, to_square: str, piece: str) -> None:
        from_row, from_col = square_to_coords(from_square)
        to_row, to_col = square_to_coords(to_square)
        captured_piece = self.board[to_row][to_col]
        self.apply_move(from_square, to_square)

        if piece[1] == "p" and from_col != to_col and not captured_piece:
            captured_row = to_row + (1 if piece[0] == "w" else -1)
            if on_board(captured_row, to_col):
                self.board[captured_row][to_col] = ""

        if piece[1] == "k" and abs(from_col - to_col) == 2:
            if to_col == 6:
                rook_from = coords_to_square(from_row, 7)
                rook_to = coords_to_square(from_row, 5)
            else:
                rook_from = coords_to_square(from_row, 0)
                rook_to = coords_to_square(from_row, 3)
            self.apply_move(rook_from, rook_to)

    def is_in_check(self, color: str) -> bool:
        king_square = self.find_king(color)
        if not king_square:
            return False
        enemy = "b" if color == "w" else "w"
        for row in range(8):
            for col in range(8):
                piece = self.board[row][col]
                if piece and piece[0] == enemy:
                    square = coords_to_square(row, col)
                    if king_square in self.attack_squares(square, piece):
                        return True
        return False

    def find_king(self, color: str) -> str | None:
        target = f"{color}k"
        for row in range(8):
            for col in range(8):
                if self.board[row][col] == target:
                    return coords_to_square(row, col)
        return None

    def pseudo_legal_moves(self, square: str, piece: str) -> list[str]:
        color, kind = piece[0], piece[1]
        row, col = square_to_coords(square)
        moves: list[str] = []

        if kind == "p":
            direction = -1 if color == "w" else 1
            start_row = 6 if color == "w" else 1
            one_step = row + direction
            if on_board(one_step, col) and not self.board[one_step][col]:
                moves.append(coords_to_square(one_step, col))
                two_step = row + 2 * direction
                if row == start_row and not self.board[two_step][col]:
                    moves.append(coords_to_square(two_step, col))
            for delta_col in (-1, 1):
                next_row = row + direction
                next_col = col + delta_col
                if not on_board(next_row, next_col):
                    continue
                target = self.board[next_row][next_col]
                if target and target[0] != color:
                    moves.append(coords_to_square(next_row, next_col))
                elif self.en_passant_target == coords_to_square(next_row, next_col):
                    adjacent = self.board[row][next_col]
                    if adjacent and adjacent[0] != color and adjacent[1] == "p":
                        moves.append(coords_to_square(next_row, next_col))

        elif kind == "n":
            for delta_row, delta_col in (
                (-2, -1),
                (-2, 1),
                (-1, -2),
                (-1, 2),
                (1, -2),
                (1, 2),
                (2, -1),
                (2, 1),
            ):
                next_row = row + delta_row
                next_col = col + delta_col
                if not on_board(next_row, next_col):
                    continue
                target = self.board[next_row][next_col]
                if not target or target[0] != color:
                    moves.append(coords_to_square(next_row, next_col))

        elif kind in {"b", "r", "q"}:
            directions = []
            if kind in {"b", "q"}:
                directions.extend([(-1, -1), (-1, 1), (1, -1), (1, 1)])
            if kind in {"r", "q"}:
                directions.extend([(-1, 0), (1, 0), (0, -1), (0, 1)])
            moves.extend(self.sliding_moves(row, col, color, directions))

        elif kind == "k":
            for delta_row in (-1, 0, 1):
                for delta_col in (-1, 0, 1):
                    if delta_row == 0 and delta_col == 0:
                        continue
                    next_row = row + delta_row
                    next_col = col + delta_col
                    if not on_board(next_row, next_col):
                        continue
                    target = self.board[next_row][next_col]
                    if not target or target[0] != color:
                        moves.append(coords_to_square(next_row, next_col))
            moves.extend(self.castling_moves(square, color))

        return moves

    def attack_squares(self, square: str, piece: str) -> Iterable[str]:
        color, kind = piece[0], piece[1]
        row, col = square_to_coords(square)

        if kind == "p":
            direction = -1 if color == "w" else 1
            for delta_col in (-1, 1):
                next_row = row + direction
                next_col = col + delta_col
                if on_board(next_row, next_col):
                    yield coords_to_square(next_row, next_col)
            return

        if kind == "n":
            for delta_row, delta_col in (
                (-2, -1),
                (-2, 1),
                (-1, -2),
                (-1, 2),
                (1, -2),
                (1, 2),
                (2, -1),
                (2, 1),
            ):
                next_row = row + delta_row
                next_col = col + delta_col
                if on_board(next_row, next_col):
                    yield coords_to_square(next_row, next_col)
            return

        if kind in {"b", "r", "q"}:
            directions = []
            if kind in {"b", "q"}:
                directions.extend([(-1, -1), (-1, 1), (1, -1), (1, 1)])
            if kind in {"r", "q"}:
                directions.extend([(-1, 0), (1, 0), (0, -1), (0, 1)])
            for delta_row, delta_col in directions:
                next_row = row + delta_row
                next_col = col + delta_col
                while on_board(next_row, next_col):
                    yield coords_to_square(next_row, next_col)
                    if self.board[next_row][next_col]:
                        break
                    next_row += delta_row
                    next_col += delta_col
            return

        if kind == "k":
            for delta_row in (-1, 0, 1):
                for delta_col in (-1, 0, 1):
                    if delta_row == 0 and delta_col == 0:
                        continue
                    next_row = row + delta_row
                    next_col = col + delta_col
                    if on_board(next_row, next_col):
                        yield coords_to_square(next_row, next_col)

    def sliding_moves(
        self,
        row: int,
        col: int,
        color: str,
        directions: Iterable[tuple[int, int]],
    ) -> list[str]:
        moves = []
        for delta_row, delta_col in directions:
            next_row = row + delta_row
            next_col = col + delta_col
            while on_board(next_row, next_col):
                target = self.board[next_row][next_col]
                if not target:
                    moves.append(coords_to_square(next_row, next_col))
                else:
                    if target[0] != color:
                        moves.append(coords_to_square(next_row, next_col))
                    break
                next_row += delta_row
                next_col += delta_col
        return moves

    def castling_moves(self, square: str, color: str) -> list[str]:
        if self.is_in_check(color):
            return []
        row, col = square_to_coords(square)
        if col != 4:
            return []
        enemy = "b" if color == "w" else "w"
        attacks = self.all_attack_squares(enemy)
        moves = []

        for side, rook_col, spaces, target_col in (
            ("king_side", 7, [5, 6], 6),
            ("queen_side", 0, [1, 2, 3], 2),
        ):
            if not self.castling[color][side]:
                continue
            rook_piece = self.board[row][rook_col]
            if rook_piece != f"{color}r":
                continue
            if any(self.board[row][space] for space in spaces):
                continue
            path_cols = [4, 5, 6] if side == "king_side" else [4, 3, 2]
            if any(coords_to_square(row, path_col) in attacks for path_col in path_cols):
                continue
            moves.append(coords_to_square(row, target_col))
        return moves

    def all_attack_squares(self, color: str) -> set[str]:
        squares = set()
        for row in range(8):
            for col in range(8):
                piece = self.board[row][col]
                if piece and piece[0] == color:
                    squares.update(self.attack_squares(coords_to_square(row, col), piece))
        return squares


GAME = ChessGame()


class ChessRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.send_json(GAME.state())
            return
        if parsed.path == "/local-root-ca.cer" and ROOT_CA_FILE.exists():
            self.serve_file(ROOT_CA_FILE)
            return
        file_path = FILES.get(parsed.path)
        if file_path and file_path.exists():
            self.serve_file(file_path)
            return
        dynamic_static_file = self.resolve_static_path(parsed.path)
        if dynamic_static_file:
            self.serve_file(dynamic_static_file)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or "{}")

        if parsed.path == "/api/select":
            result = GAME.select(payload.get("square", ""))
            self.send_json(
                {"ok": result.ok, "message": result.message, "state": GAME.state()},
                status=200 if result.ok else 400,
            )
            return

        if parsed.path == "/api/move":
            result = GAME.move(payload.get("from", ""), payload.get("to", ""))
            self.send_json(
                {"ok": result.ok, "message": result.message, "state": GAME.state()},
                status=200 if result.ok else 400,
            )
            return

        if parsed.path == "/api/reset":
            GAME.reset()
            self.send_json({"ok": True, "message": "Новая партия начата", "state": GAME.state()})
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def serve_file(self, file_path: Path) -> None:
        body = file_path.read_bytes()
        content_type = self.guess_type(str(file_path))
        if file_path.suffix == ".cer":
            content_type = "application/x-x509-ca-cert"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if file_path.name in {"manifest.webmanifest", "sw.js"}:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload: dict, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return

    def resolve_static_path(self, request_path: str) -> Path | None:
        relative_path = request_path.lstrip("/")
        if not relative_path:
            return None
        candidate = (STATIC_DIR / relative_path).resolve()
        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            return None
        if candidate.exists() and candidate.is_file():
            return candidate
        return None


def run() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    http_port = int(os.environ.get("PORT", "8000"))
    https_port = int(os.environ.get("HTTPS_PORT", "8443"))
    cert_file = Path(os.environ.get("SSL_CERT_FILE", str(DEFAULT_SSL_CERT_FILE)))
    key_file = Path(os.environ.get("SSL_KEY_FILE", str(DEFAULT_SSL_KEY_FILE)))
    lan_ip = detect_local_ip()

    servers: list[ThreadingHTTPServer] = []
    http_server = ThreadingHTTPServer((host, http_port), ChessRequestHandler)
    servers.append(http_server)
    print(f"HTTP available at http://127.0.0.1:{http_port}")
    print(f"HTTP LAN URL: http://{lan_ip}:{http_port}")

    if ROOT_CA_FILE.exists():
        print(f"Root certificate download: http://{lan_ip}:{http_port}/local-root-ca.cer")

    if cert_file.exists() and key_file.exists():
        https_server = ThreadingHTTPServer((host, https_port), ChessRequestHandler)
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=cert_file, keyfile=key_file)
        https_server.socket = ssl_context.wrap_socket(https_server.socket, server_side=True)
        servers.append(https_server)
        print(f"HTTPS available at https://127.0.0.1:{https_port}")
        print(f"HTTPS LAN URL: https://{lan_ip}:{https_port}")
    else:
        print("HTTPS disabled: certificate files not found.")
        print("Run scripts\\generate_local_certs.ps1 to enable trusted iPhone installation.")

    try:
        for server in servers:
            Thread(target=server.serve_forever, daemon=True).start()
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nStopping servers...")
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


def detect_local_ip() -> str:
    env_ip = os.environ.get("LAN_IP")
    if env_ip:
        return env_ip

    try:
        host_name = socket.gethostname()
        for info in socket.getaddrinfo(host_name, None, socket.AF_INET, socket.SOCK_STREAM):
            candidate = info[4][0]
            if is_private_ipv4(candidate):
                return candidate
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            candidate = sock.getsockname()[0]
            if is_private_ipv4(candidate):
                return candidate
            return candidate
    except OSError:
        return "127.0.0.1"


def is_private_ipv4(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_private
    except ValueError:
        return False


if __name__ == "__main__":
    run()
