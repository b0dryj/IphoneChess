const PIECE_THEMES = {
  w: {
    fill: "#fbf4e6",
    stroke: "#9c6a3b",
    shadow: "#d8b387",
  },
  b: {
    fill: "#26231f",
    stroke: "#575046",
    shadow: "#100f0d",
  },
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
const iosInstallHint = document.querySelector("#iosInstallHint");

let deferredPrompt = null;

function pieceMarkup(code, compact = false) {
  if (!code) {
    return "";
  }

  const side = code[0];
  const kind = code[1];
  const palette = PIECE_THEMES[side];
  const fillStyle = `fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  const lineStyle = `fill="none" stroke="${palette.stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  const shadow = `<ellipse cx="32" cy="55" rx="15" ry="4" fill="${palette.shadow}" opacity="${side === "w" ? "0.18" : "0.26"}"></ellipse>`;
  const className = compact ? "piece-svg piece-svg-compact" : "piece-svg";

  if (kind === "p") {
    return `
      <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
        ${shadow}
        <circle ${fillStyle} cx="32" cy="18" r="8"></circle>
        <path ${fillStyle} d="M26 29c0-4 3-7 6-7s6 3 6 7c0 2-1 4-2 6h4c4 0 7 3 7 7v2H17v-2c0-4 3-7 7-7h4c-1-2-2-4-2-6Z"></path>
        <path ${lineStyle} d="M22 52h20"></path>
        <path ${lineStyle} d="M18 58h28"></path>
      </svg>
    `;
  }

  if (kind === "r") {
    return `
      <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
        ${shadow}
        <path ${fillStyle} d="M19 16h6v7h4v-7h6v7h4v-7h6v11H19Z"></path>
        <path ${fillStyle} d="M23 29h18l-2 18H25Z"></path>
        <path ${lineStyle} d="M20 50h24"></path>
        <path ${lineStyle} d="M16 56h32"></path>
      </svg>
    `;
  }

  if (kind === "n") {
    return `
      <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
        ${shadow}
        <path ${fillStyle} d="M43 18c-7 0-12 4-16 10l6 5-8 7v8h17l5-11c2-5 1-9-2-12l5-4c-1-2-4-3-7-3Z"></path>
        <circle cx="37" cy="25" r="2.1" fill="${palette.stroke}"></circle>
        <path ${lineStyle} d="M31 34c4 0 7 2 10 6"></path>
        <path ${lineStyle} d="M22 50h22"></path>
        <path ${lineStyle} d="M18 56h30"></path>
      </svg>
    `;
  }

  if (kind === "b") {
    return `
      <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
        ${shadow}
        <path ${fillStyle} d="M32 13c4 0 6 3 6 6 0 3-2 5-4 7 4 3 6 7 6 12 0 3-1 5-3 8l6 6H21l6-6c-2-3-3-5-3-8 0-5 2-9 6-12-2-2-4-4-4-7 0-3 2-6 6-6Z"></path>
        <path ${lineStyle} d="M30 22 36 28"></path>
        <path ${lineStyle} d="M22 52h20"></path>
        <path ${lineStyle} d="M18 58h28"></path>
      </svg>
    `;
  }

  if (kind === "q") {
    return `
      <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
        ${shadow}
        <circle ${fillStyle} cx="18" cy="18" r="3"></circle>
        <circle ${fillStyle} cx="28" cy="14" r="3"></circle>
        <circle ${fillStyle} cx="36" cy="14" r="3"></circle>
        <circle ${fillStyle} cx="46" cy="18" r="3"></circle>
        <path ${fillStyle} d="M17 22 23 38h18l6-16-8 7-7-11-7 11Z"></path>
        <path ${fillStyle} d="M23 38h18l3 10H20Z"></path>
        <path ${lineStyle} d="M20 52h24"></path>
        <path ${lineStyle} d="M16 58h32"></path>
      </svg>
    `;
  }

  return `
    <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
      ${shadow}
      <path ${lineStyle} d="M32 9v9"></path>
      <path ${lineStyle} d="M27.5 13.5h9"></path>
      <path ${fillStyle} d="M24 21h16l-2 9 5 11H21l5-11Z"></path>
      <path ${fillStyle} d="M24 41h16l4 9H20Z"></path>
      <path ${lineStyle} d="M20 54h24"></path>
      <path ${lineStyle} d="M16 59h32"></path>
    </svg>
  `;
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

  if (iosInstallHint) {
    iosInstallHint.hidden = !(ios && !standalone);
  }
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
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if ("serviceWorker" in navigator && (window.isSecureContext || isLocalHost)) {
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

makeAxis();
registerPwa();
resetButton.addEventListener("click", resetGame);
render();
