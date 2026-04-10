const PIECE_ASSETS = {
  wp: "./pieces/wp.svg",
  wr: "./pieces/wr.svg",
  wn: "./pieces/wn.svg",
  wb: "./pieces/wb.svg",
  wq: "./pieces/wq.svg",
  wk: "./pieces/wk.svg",
  bp: "./pieces/bp.svg",
  br: "./pieces/br.svg",
  bn: "./pieces/bn.svg",
  bb: "./pieces/bb.svg",
  bq: "./pieces/bq.svg",
  bk: "./pieces/bk.svg",
};

const SPECIAL_LABELS = {
  castling: "рокировка",
  en_passant: "на проходе",
  promotion: "превращение",
};

const STORAGE_KEY = "local-chess-pwa-state-v2";

const boardElement = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const turnChip = document.querySelector("#turnChip");
const checkChip = document.querySelector("#checkChip");
const historyList = document.querySelector("#historyList");
const capturedWhite = document.querySelector("#capturedWhite");
const capturedBlack = document.querySelector("#capturedBlack");
const resetButton = document.querySelector("#resetButton");
const installButton = document.querySelector("#installButton");
const notifyButton = document.querySelector("#notifyButton");

let deferredPrompt = null;
let notificationTimer = null;

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function pieceMarkup(code, compact = false) {
  if (!code || !PIECE_ASSETS[code]) {
    return "";
  }
  const className = compact ? "piece-image piece-image-compact" : "piece-image";
  return `<img class="${className}" src="${PIECE_ASSETS[code]}" alt="" draggable="false" decoding="async">`;
}

function squareToCoords(square) {
  const fileIndex = square.charCodeAt(0) - 97;
  const rankIndex = 8 - Number(square[1]);
  return [rankIndex, fileIndex];
}

function coordsToSquare(row, col) {
  return `${String.fromCharCode(97 + col)}${8 - row}`;
}

function onBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

class ChessGame {
  constructor(savedState = null) {
    if (savedState) {
      this.load(savedState);
    } else {
      this.reset();
    }
  }

  reset() {
    this.board = [
      ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
      ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
      ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"],
    ];
    this.turn = "w";
    this.selected = null;
    this.winner = null;
    this.status = "Белые ходят";
    this.lastMove = null;
    this.history = [];
    this.captured = { w: [], b: [] };
    this.castling = {
      w: { king_side: true, queen_side: true },
      b: { king_side: true, queen_side: true },
    };
    this.enPassantTarget = null;
  }

  load(savedState) {
    this.board = savedState.board;
    this.turn = savedState.turn;
    this.selected = savedState.selected;
    this.winner = savedState.winner;
    this.status = savedState.status;
    this.lastMove = savedState.lastMove;
    this.history = savedState.history;
    this.captured = savedState.captured;
    this.castling = savedState.castling;
    this.enPassantTarget = savedState.enPassantTarget;
  }

  serialize() {
    return {
      board: this.board.map((row) => row.slice()),
      turn: this.turn,
      selected: this.selected,
      winner: this.winner,
      status: this.status,
      lastMove: this.lastMove,
      history: this.history.map((item) => ({ ...item })),
      captured: {
        w: [...this.captured.w],
        b: [...this.captured.b],
      },
      castling: {
        w: { ...this.castling.w },
        b: { ...this.castling.b },
      },
      enPassantTarget: this.enPassantTarget,
    };
  }

  exportState() {
    return {
      ...this.serialize(),
      turnLabel: this.turn === "w" ? "Белые" : "Черные",
      legalMoves: this.selected ? this.legalMovesForSquare(this.selected) : [],
      isCheck: this.isInCheck(this.turn),
    };
  }

  clearSelection() {
    this.selected = null;
  }

  getPiece(square) {
    const [row, col] = squareToCoords(square);
    return this.board[row][col];
  }

  setPiece(square, piece) {
    const [row, col] = squareToCoords(square);
    this.board[row][col] = piece;
  }

  applyMove(fromSquare, toSquare) {
    const piece = this.getPiece(fromSquare);
    this.setPiece(fromSquare, "");
    this.setPiece(toSquare, piece);
  }

  select(square) {
    if (this.winner) {
      return false;
    }

    const piece = this.getPiece(square);
    if (!piece || piece[0] !== this.turn) {
      this.selected = null;
      return false;
    }

    const legalMoves = this.legalMovesForSquare(square);
    this.selected = legalMoves.length ? square : null;
    return legalMoves.length > 0;
  }

  move(fromSquare, toSquare) {
    if (this.winner) {
      return false;
    }

    const piece = this.getPiece(fromSquare);
    if (!piece || piece[0] !== this.turn) {
      return false;
    }

    const legalMoves = this.legalMovesForSquare(fromSquare);
    if (!legalMoves.includes(toSquare)) {
      return false;
    }

    let capturedPiece = this.getPiece(toSquare);
    let special = "";
    const [fromRow, fromCol] = squareToCoords(fromSquare);
    const [toRow, toCol] = squareToCoords(toSquare);

    if (piece[1] === "p" && fromCol !== toCol && !capturedPiece) {
      special = "en_passant";
      const capturedRow = toRow + (piece[0] === "w" ? 1 : -1);
      capturedPiece = this.board[capturedRow][toCol];
      this.board[capturedRow][toCol] = "";
    }

    this.applyMove(fromSquare, toSquare);

    if (capturedPiece) {
      this.captured[piece[0]].push(capturedPiece);
    }

    if (piece[1] === "p" && Math.abs(fromRow - toRow) === 2) {
      const middleRow = Math.floor((fromRow + toRow) / 2);
      this.enPassantTarget = coordsToSquare(middleRow, fromCol);
    } else {
      this.enPassantTarget = null;
    }

    if (piece[1] === "k") {
      this.castling[piece[0]].king_side = false;
      this.castling[piece[0]].queen_side = false;
      if (Math.abs(fromCol - toCol) === 2) {
        special = "castling";
        if (toCol === 6) {
          this.applyMove(coordsToSquare(fromRow, 7), coordsToSquare(fromRow, 5));
        } else {
          this.applyMove(coordsToSquare(fromRow, 0), coordsToSquare(fromRow, 3));
        }
      }
    } else if (piece[1] === "r") {
      if (fromSquare === "a1" || fromSquare === "a8") {
        this.castling[piece[0]].queen_side = false;
      }
      if (fromSquare === "h1" || fromSquare === "h8") {
        this.castling[piece[0]].king_side = false;
      }
    }

    if (capturedPiece === "wr") {
      if (toSquare === "a1") {
        this.castling.w.queen_side = false;
      }
      if (toSquare === "h1") {
        this.castling.w.king_side = false;
      }
    }

    if (capturedPiece === "br") {
      if (toSquare === "a8") {
        this.castling.b.queen_side = false;
      }
      if (toSquare === "h8") {
        this.castling.b.king_side = false;
      }
    }

    let promoted = false;
    if (piece[1] === "p" && (toRow === 0 || toRow === 7)) {
      this.board[toRow][toCol] = `${piece[0]}q`;
      promoted = true;
      special = "promotion";
    }

    let moveText = `${fromSquare}-${toSquare}`;
    if (promoted) {
      moveText += "=Ф";
    }

    this.history.push({
      piece,
      move: moveText,
      special,
    });

    this.lastMove = { from: fromSquare, to: toSquare };
    this.selected = null;
    this.turn = this.turn === "w" ? "b" : "w";
    this.updateStatusAfterMove();
    return true;
  }

  updateStatusAfterMove() {
    const current = this.turn;
    const movesExist = this.hasAnyLegalMoves(current);
    const inCheck = this.isInCheck(current);
    const colorLabel = current === "w" ? "Белые" : "Черные";
    const opponentLabel = current === "w" ? "Черные" : "Белые";

    if (!movesExist && inCheck) {
      this.winner = current === "w" ? "b" : "w";
      this.status = `Мат. Победили ${opponentLabel.toLowerCase()}`;
    } else if (!movesExist) {
      this.winner = "draw";
      this.status = "Пат. Ничья";
    } else if (inCheck) {
      this.status = `Шах. Ходят ${colorLabel.toLowerCase()}`;
    } else {
      this.status = `${colorLabel} ходят`;
    }
  }

  legalMovesForSquare(square) {
    const piece = this.getPiece(square);
    if (!piece) {
      return [];
    }

    const color = piece[0];
    const candidates = this.pseudoLegalMoves(square, piece);
    const legalMoves = [];

    for (const target of candidates) {
      const snapshot = this.snapshot();
      this.executeSimulatedMove(square, target, piece);
      if (!this.isInCheck(color)) {
        legalMoves.push(target);
      }
      this.restore(snapshot);
    }

    return legalMoves;
  }

  hasAnyLegalMoves(color) {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece[0] === color) {
          if (this.legalMovesForSquare(coordsToSquare(row, col)).length > 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  snapshot() {
    return {
      board: this.board.map((row) => row.slice()),
      enPassantTarget: this.enPassantTarget,
      castling: {
        w: { ...this.castling.w },
        b: { ...this.castling.b },
      },
    };
  }

  restore(snapshot) {
    this.board = snapshot.board.map((row) => row.slice());
    this.enPassantTarget = snapshot.enPassantTarget;
    this.castling = {
      w: { ...snapshot.castling.w },
      b: { ...snapshot.castling.b },
    };
  }

  executeSimulatedMove(fromSquare, toSquare, piece) {
    const [fromRow, fromCol] = squareToCoords(fromSquare);
    const [toRow, toCol] = squareToCoords(toSquare);
    const capturedPiece = this.board[toRow][toCol];
    this.applyMove(fromSquare, toSquare);

    if (piece[1] === "p" && fromCol !== toCol && !capturedPiece) {
      const capturedRow = toRow + (piece[0] === "w" ? 1 : -1);
      if (onBoard(capturedRow, toCol)) {
        this.board[capturedRow][toCol] = "";
      }
    }

    if (piece[1] === "k" && Math.abs(fromCol - toCol) === 2) {
      if (toCol === 6) {
        this.applyMove(coordsToSquare(fromRow, 7), coordsToSquare(fromRow, 5));
      } else {
        this.applyMove(coordsToSquare(fromRow, 0), coordsToSquare(fromRow, 3));
      }
    }
  }

  isInCheck(color) {
    const kingSquare = this.findKing(color);
    if (!kingSquare) {
      return false;
    }

    const enemy = color === "w" ? "b" : "w";
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece[0] === enemy) {
          const square = coordsToSquare(row, col);
          if (this.attackSquares(square, piece).includes(kingSquare)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  findKing(color) {
    const target = `${color}k`;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        if (this.board[row][col] === target) {
          return coordsToSquare(row, col);
        }
      }
    }
    return null;
  }

  pseudoLegalMoves(square, piece) {
    const color = piece[0];
    const kind = piece[1];
    const [row, col] = squareToCoords(square);
    const moves = [];

    if (kind === "p") {
      const direction = color === "w" ? -1 : 1;
      const startRow = color === "w" ? 6 : 1;
      const oneStep = row + direction;
      if (onBoard(oneStep, col) && !this.board[oneStep][col]) {
        moves.push(coordsToSquare(oneStep, col));
        const twoStep = row + 2 * direction;
        if (row === startRow && !this.board[twoStep][col]) {
          moves.push(coordsToSquare(twoStep, col));
        }
      }

      for (const deltaCol of [-1, 1]) {
        const nextRow = row + direction;
        const nextCol = col + deltaCol;
        if (!onBoard(nextRow, nextCol)) {
          continue;
        }
        const target = this.board[nextRow][nextCol];
        if (target && target[0] !== color) {
          moves.push(coordsToSquare(nextRow, nextCol));
        } else if (this.enPassantTarget === coordsToSquare(nextRow, nextCol)) {
          const adjacent = this.board[row][nextCol];
          if (adjacent && adjacent[0] !== color && adjacent[1] === "p") {
            moves.push(coordsToSquare(nextRow, nextCol));
          }
        }
      }
    } else if (kind === "n") {
      for (const [deltaRow, deltaCol] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ]) {
        const nextRow = row + deltaRow;
        const nextCol = col + deltaCol;
        if (!onBoard(nextRow, nextCol)) {
          continue;
        }
        const target = this.board[nextRow][nextCol];
        if (!target || target[0] !== color) {
          moves.push(coordsToSquare(nextRow, nextCol));
        }
      }
    } else if (["b", "r", "q"].includes(kind)) {
      const directions = [];
      if (["b", "q"].includes(kind)) {
        directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (["r", "q"].includes(kind)) {
        directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      moves.push(...this.slidingMoves(row, col, color, directions));
    } else if (kind === "k") {
      for (let deltaRow = -1; deltaRow <= 1; deltaRow += 1) {
        for (let deltaCol = -1; deltaCol <= 1; deltaCol += 1) {
          if (deltaRow === 0 && deltaCol === 0) {
            continue;
          }
          const nextRow = row + deltaRow;
          const nextCol = col + deltaCol;
          if (!onBoard(nextRow, nextCol)) {
            continue;
          }
          const target = this.board[nextRow][nextCol];
          if (!target || target[0] !== color) {
            moves.push(coordsToSquare(nextRow, nextCol));
          }
        }
      }
      moves.push(...this.castlingMoves(square, color));
    }

    return moves;
  }

  attackSquares(square, piece) {
    const color = piece[0];
    const kind = piece[1];
    const [row, col] = squareToCoords(square);
    const squares = [];

    if (kind === "p") {
      const direction = color === "w" ? -1 : 1;
      for (const deltaCol of [-1, 1]) {
        const nextRow = row + direction;
        const nextCol = col + deltaCol;
        if (onBoard(nextRow, nextCol)) {
          squares.push(coordsToSquare(nextRow, nextCol));
        }
      }
      return squares;
    }

    if (kind === "n") {
      for (const [deltaRow, deltaCol] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ]) {
        const nextRow = row + deltaRow;
        const nextCol = col + deltaCol;
        if (onBoard(nextRow, nextCol)) {
          squares.push(coordsToSquare(nextRow, nextCol));
        }
      }
      return squares;
    }

    if (["b", "r", "q"].includes(kind)) {
      const directions = [];
      if (["b", "q"].includes(kind)) {
        directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (["r", "q"].includes(kind)) {
        directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      for (const [deltaRow, deltaCol] of directions) {
        let nextRow = row + deltaRow;
        let nextCol = col + deltaCol;
        while (onBoard(nextRow, nextCol)) {
          squares.push(coordsToSquare(nextRow, nextCol));
          if (this.board[nextRow][nextCol]) {
            break;
          }
          nextRow += deltaRow;
          nextCol += deltaCol;
        }
      }
      return squares;
    }

    if (kind === "k") {
      for (let deltaRow = -1; deltaRow <= 1; deltaRow += 1) {
        for (let deltaCol = -1; deltaCol <= 1; deltaCol += 1) {
          if (deltaRow === 0 && deltaCol === 0) {
            continue;
          }
          const nextRow = row + deltaRow;
          const nextCol = col + deltaCol;
          if (onBoard(nextRow, nextCol)) {
            squares.push(coordsToSquare(nextRow, nextCol));
          }
        }
      }
    }

    return squares;
  }

  slidingMoves(row, col, color, directions) {
    const moves = [];
    for (const [deltaRow, deltaCol] of directions) {
      let nextRow = row + deltaRow;
      let nextCol = col + deltaCol;
      while (onBoard(nextRow, nextCol)) {
        const target = this.board[nextRow][nextCol];
        if (!target) {
          moves.push(coordsToSquare(nextRow, nextCol));
        } else {
          if (target[0] !== color) {
            moves.push(coordsToSquare(nextRow, nextCol));
          }
          break;
        }
        nextRow += deltaRow;
        nextCol += deltaCol;
      }
    }
    return moves;
  }

  castlingMoves(square, color) {
    if (this.isInCheck(color)) {
      return [];
    }

    const [row, col] = squareToCoords(square);
    if (col !== 4) {
      return [];
    }

    const enemy = color === "w" ? "b" : "w";
    const attacks = this.allAttackSquares(enemy);
    const moves = [];

    for (const [side, rookCol, spaces, targetCol] of [
      ["king_side", 7, [5, 6], 6],
      ["queen_side", 0, [1, 2, 3], 2],
    ]) {
      if (!this.castling[color][side]) {
        continue;
      }
      if (this.board[row][rookCol] !== `${color}r`) {
        continue;
      }
      if (spaces.some((spaceCol) => this.board[row][spaceCol])) {
        continue;
      }
      const pathCols = side === "king_side" ? [4, 5, 6] : [4, 3, 2];
      if (pathCols.some((pathCol) => attacks.has(coordsToSquare(row, pathCol)))) {
        continue;
      }
      moves.push(coordsToSquare(row, targetCol));
    }

    return moves;
  }

  allAttackSquares(color) {
    const squares = new Set();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece[0] === color) {
          this.attackSquares(coordsToSquare(row, col), piece).forEach((square) => squares.add(square));
        }
      }
    }
    return squares;
  }
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updatePlatformUi() {
  const ios = isIosDevice();
  const standalone = isStandaloneMode();

  document.body.classList.toggle("ios-mobile", ios);
  document.body.classList.toggle("standalone", standalone);
}

function makeAxis() {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

  document.querySelector("#filesTop").innerHTML = files.map((item) => `<span>${item}</span>`).join("");
  document.querySelector("#filesBottom").innerHTML = files.map((item) => `<span>${item}</span>`).join("");
  document.querySelector("#ranksLeft").innerHTML = ranks.map((item) => `<span>${item}</span>`).join("");
}

function loadGame() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new ChessGame();
    }
    return new ChessGame(JSON.parse(raw));
  } catch {
    return new ChessGame();
  }
}

function saveGame(game) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game.serialize()));
}

const game = loadGame();

function renderBoard(serverState) {
  boardElement.innerHTML = "";

  serverState.board.forEach((row, rowIndex) => {
    row.forEach((piece, colIndex) => {
      const square = coordsToSquare(rowIndex, colIndex);
      const button = document.createElement("button");
      const isLight = (rowIndex + colIndex) % 2 === 0;
      const isSelected = serverState.selected === square;
      const isLegal = serverState.legalMoves.includes(square);
      const isLastMove =
        serverState.lastMove &&
        (serverState.lastMove.from === square || serverState.lastMove.to === square);

      button.className = `square ${isLight ? "light" : "dark"}${isSelected ? " selected" : ""}${isLegal ? " legal" : ""}${isLastMove ? " last-move" : ""}${piece ? " occupied" : ""}`;
      button.type = "button";
      button.dataset.square = square;
      button.setAttribute("aria-label", `Клетка ${square}`);

      const pieceNode = document.createElement("span");
      pieceNode.className = "piece";
      pieceNode.innerHTML = pieceMarkup(piece);

      button.appendChild(pieceNode);
      button.addEventListener("click", onSquareClick);
      boardElement.appendChild(button);
    });
  });
}

function renderSidebar(serverState) {
  statusText.textContent = serverState.status;
  turnChip.textContent = `Ход: ${serverState.turnLabel}`;
  checkChip.textContent = serverState.isCheck ? "Шах" : "Без шаха";
  checkChip.style.background = serverState.isCheck ? "rgba(183, 75, 75, 0.18)" : "rgba(255,255,255,0.64)";
  checkChip.style.color = serverState.isCheck ? "#8b2222" : "";

  historyList.innerHTML = serverState.history.length
    ? serverState.history
        .map((item) => {
          const special = item.special ? ` · ${SPECIAL_LABELS[item.special] || item.special}` : "";
          return `<li>${pieceMarkup(item.piece, true)}<span>${item.move}${special}</span></li>`;
        })
        .join("")
    : "<li>Пока без ходов</li>";

  capturedWhite.innerHTML = serverState.captured.w.length
    ? serverState.captured.w.map((piece) => pieceMarkup(piece, true)).join("")
    : "-";
  capturedBlack.innerHTML = serverState.captured.b.length
    ? serverState.captured.b.map((piece) => pieceMarkup(piece, true)).join("")
    : "-";
}

function render() {
  const state = game.exportState();
  renderBoard(state);
  renderSidebar(state);
}

function onSquareClick(event) {
  const square = event.currentTarget.dataset.square;
  const piece = game.getPiece(square);
  const legalMoves = game.selected ? game.legalMovesForSquare(game.selected) : [];

  if (game.selected && legalMoves.includes(square)) {
    game.move(game.selected, square);
    saveGame(game);
    render();
    return;
  }

  if (piece) {
    game.select(square);
    saveGame(game);
    render();
    return;
  }

  if (game.selected) {
    game.clearSelection();
    saveGame(game);
    render();
  }
}

function resetGame() {
  game.reset();
  saveGame(game);
  render();
}

function registerPwa() {
  if ("serviceWorker" in navigator && (window.isSecureContext || isLocalHost())) {
    navigator.serviceWorker.register("./sw.js");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    updatePlatformUi();
  });

  updatePlatformUi();
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function fetchPushConfig() {
  const response = await fetch("./api/push/config", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Push backend is unavailable on this deployment.");
  }
  return response.json();
}

async function ensurePushSubscription(registration, vapidPublicKey) {
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    return subscription;
  }

  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const subscribeResponse = await fetch("./api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  if (!subscribeResponse.ok) {
    throw new Error("The server rejected the push subscription.");
  }

  return subscription;
}

async function scheduleTestNotification() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    window.alert("Уведомления не поддерживаются в этом браузере.");
    return;
  }

  if (!(window.isSecureContext || isLocalHost())) {
    window.alert("Для push-уведомлений нужен HTTPS или localhost.");
    return;
  }

  if (isLocalHost()) {
    await scheduleLocalTestNotification();
    return;
  }

  if (!("PushManager" in window)) {
    window.alert("Push API не поддерживается в этом браузере.");
    return;
  }

  if (isIosDevice() && !isStandaloneMode()) {
    window.alert("На iPhone web push работает из установленного приложения на экране домой.");
    return;
  }

  const config = await fetchPushConfig();
  if (!config.supported) {
    throw new Error(config.reason || "Push backend is not configured.");
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    window.alert("Разрешение на уведомления не выдано.");
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await ensurePushSubscription(registration, config.vapidPublicKey);

  notifyButton.classList.add("is-pending");
  notifyButton.textContent = "Push запланирован";

  const pushResponse = await fetch("./api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      delaySeconds: 10,
    }),
  });

  const payload = await pushResponse.json();
  if (!pushResponse.ok || !payload.ok) {
    throw new Error(payload.message || "The server failed to schedule the push notification.");
  }

  if (notificationTimer) {
    window.clearTimeout(notificationTimer);
  }
  notificationTimer = window.setTimeout(() => {
    notifyButton.classList.remove("is-pending");
    notifyButton.textContent = "Тестовое уведомление";
    notificationTimer = null;
  }, 10000);
}

async function scheduleLocalTestNotification() {
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    window.alert("Разрешение на уведомления не выдано.");
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  if (notificationTimer) {
    window.clearTimeout(notificationTimer);
  }

  notifyButton.classList.add("is-pending");
  notifyButton.textContent = "Уведомление через 10 сек";

  notificationTimer = window.setTimeout(async () => {
    try {
      await registration.showNotification("Шахматы", {
        body: "Тестовое уведомление с локального сайта",
        icon: "./apple-touch-icon.png",
        badge: "./apple-touch-icon.png",
        tag: "local-chess-desktop-test",
        data: { url: "./" },
      });
    } finally {
      notifyButton.classList.remove("is-pending");
      notifyButton.textContent = "Тестовое уведомление";
      notificationTimer = null;
    }
  }, 10000);
}

makeAxis();
registerPwa();
resetButton.addEventListener("click", resetGame);
notifyButton.addEventListener("click", () => {
  scheduleTestNotification().catch(() => {
    notifyButton.classList.remove("is-pending");
    notifyButton.textContent = "Тестовое уведомление";
    window.alert("Не удалось запланировать уведомление.");
  });
});
render();
