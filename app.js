// 台灣暗棋 PWA 版
// 純前端實作：首頁、設定、遊戲、AI 搜尋、離線快取註冊

const ROWS = 4;
const COLS = 8;

const HUMAN = "human";
const AI = "ai";

const RANK = {
  K: 7,
  A: 6,
  E: 5,
  R: 4,
  N: 3,
  C: 2,
  P: 1,
};

const VALUE = {
  K: 700,
  A: 720,
  E: 400,
  R: 260,
  N: 190,
  C: 500,
  P: 130,
};

const RED_NAMES = {
  K: "帥",
  A: "仕",
  E: "相",
  R: "俥",
  N: "傌",
  C: "炮",
  P: "兵",
};

const BLACK_NAMES = {
  K: "將",
  A: "士",
  E: "象",
  R: "車",
  N: "馬",
  C: "包",
  P: "卒",
};

const PIECE_COUNTS = {
  K: 1,
  A: 2,
  E: 2,
  R: 2,
  N: 2,
  C: 2,
  P: 5,
};

const DIFFICULTIES = {
  easy: {
    label: "入門",
    depth: 2,
    branchLimit: 12,
    peekHidden: false,
    help: "反應最快，AI 主要看明棋風險與簡短局面，不偷看暗子。適合測試與輕鬆玩。",
  },
  normal: {
    label: "一般",
    depth: 4,
    branchLimit: 18,
    peekHidden: false,
    help: "速度與強度平衡，AI 不看暗子內容，主要依明棋威脅、行動力與位置判斷。",
  },
  hard: {
    label: "困難",
    depth: 5,
    branchLimit: 20,
    peekHidden: true,
    help: "AI 會把暗子納入搜尋評估，強度明顯提高，適合想被壓迫感追著走的局。",
  },
  master: {
    label: "強敵",
    depth: 6,
    branchLimit: 24,
    peekHidden: true,
    help: "搜尋更深、候選步更多，手機較舊時 AI 思考時間會拉長。",
  },
};

let state = null;

const dom = {};

function makePiece(color, kind, id) {
  return {
    color,
    kind,
    faceUp: false,
    id,
  };
}

function pieceName(piece) {
  return piece.color === "red" ? RED_NAMES[piece.kind] : BLACK_NAMES[piece.kind];
}

function colorLabel(color) {
  if (!color) return "未定";
  return color === "red" ? "紅方" : "黑方";
}

function opponentColor(color) {
  return color === "red" ? "black" : "red";
}

function loadDifficulty() {
  const saved = localStorage.getItem("darkChessDifficulty");
  return DIFFICULTIES[saved] ? saved : "normal";
}

function saveDifficulty(value) {
  if (!DIFFICULTIES[value]) return;
  localStorage.setItem("darkChessDifficulty", value);
}

function initDom() {
  dom.homeView = document.getElementById("homeView");
  dom.settingsView = document.getElementById("settingsView");
  dom.gameView = document.getElementById("gameView");
  dom.startGameBtn = document.getElementById("startGameBtn");
  dom.openSettingsBtn = document.getElementById("openSettingsBtn");
  dom.settingsBackBtn = document.getElementById("settingsBackBtn");
  dom.gameBackBtn = document.getElementById("gameBackBtn");
  dom.newGameBtn = document.getElementById("newGameBtn");
  dom.difficultySelect = document.getElementById("difficultySelect");
  dom.difficultyHelp = document.getElementById("difficultyHelp");
  dom.board = document.getElementById("board");
  dom.statusText = document.getElementById("statusText");
  dom.detailText = document.getElementById("detailText");
  dom.humanColorLabel = document.getElementById("humanColorLabel");
  dom.aiColorLabel = document.getElementById("aiColorLabel");
  dom.turnOrb = document.getElementById("turnOrb");
  dom.modal = document.getElementById("modal");
  dom.modalTitle = document.getElementById("modalTitle");
  dom.modalText = document.getElementById("modalText");
  dom.modalHomeBtn = document.getElementById("modalHomeBtn");
  dom.modalRestartBtn = document.getElementById("modalRestartBtn");
}

function bindEvents() {
  dom.startGameBtn.addEventListener("click", () => {
    newGame();
    showView("game");
  });

  dom.openSettingsBtn.addEventListener("click", () => {
    syncSettingsUI();
    showView("settings");
  });

  dom.settingsBackBtn.addEventListener("click", () => showView("home"));
  dom.gameBackBtn.addEventListener("click", () => {
    hideModal();
    showView("home");
  });

  dom.newGameBtn.addEventListener("click", () => newGame());

  dom.difficultySelect.addEventListener("change", () => {
    saveDifficulty(dom.difficultySelect.value);
    syncSettingsUI();
  });

  dom.modalHomeBtn.addEventListener("click", () => {
    hideModal();
    showView("home");
  });

  dom.modalRestartBtn.addEventListener("click", () => {
    hideModal();
    newGame();
    showView("game");
  });
}

function showView(name) {
  dom.homeView.classList.toggle("active", name === "home");
  dom.settingsView.classList.toggle("active", name === "settings");
  dom.gameView.classList.toggle("active", name === "game");
}

function syncSettingsUI() {
  const difficulty = loadDifficulty();
  dom.difficultySelect.value = difficulty;
  dom.difficultyHelp.textContent = DIFFICULTIES[difficulty].help;
}

function createBoardButtons() {
  dom.board.innerHTML = "";

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      const button = document.createElement("button");
      button.className = "piece-btn hidden-piece";
      button.type = "button";
      button.dataset.r = String(r);
      button.dataset.c = String(c);
      button.textContent = "暗";
      button.addEventListener("click", () => onCellClick(r, c));

      cell.appendChild(button);
      dom.board.appendChild(cell);
    }
  }
}

function newGame() {
  const pieces = [];
  let id = 1;

  for (const color of ["red", "black"]) {
    for (const [kind, count] of Object.entries(PIECE_COUNTS)) {
      for (let i = 0; i < count; i += 1) {
        pieces.push(makePiece(color, kind, `${color}-${kind}-${id}`));
        id += 1;
      }
    }
  }

  shuffle(pieces);

  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let idx = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      board[r][c] = pieces[idx];
      idx += 1;
    }
  }

  state = {
    board,
    selected: null,
    turnColor: null,
    playerColor: {
      [HUMAN]: null,
      [AI]: null,
    },
    currentPlayer: HUMAN,
    aiThinking: false,
    locked: false,
  };

  setStatus("玩家先手。請先翻一顆棋。", "第一次翻出的顏色歸您，另一色歸 AI。");
  render();
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
}

function getButton(r, c) {
  return dom.board.querySelector(`button[data-r="${r}"][data-c="${c}"]`);
}

function render() {
  if (!state) return;

  const legalTargets = new Set();
  if (state.selected) {
    for (const action of generateActions(state.board, state.turnColor).filter((a) => a[0] !== "flip")) {
      if (action[1] === state.selected.r && action[2] === state.selected.c) {
        legalTargets.add(`${action[3]},${action[4]}`);
      }
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = state.board[r][c];
      const btn = getButton(r, c);
      btn.disabled = state.aiThinking || state.locked || state.currentPlayer === AI;
      btn.className = "piece-btn";
      btn.textContent = "";

      if (!piece) {
        btn.classList.add("empty");
        btn.textContent = "";
      } else if (!piece.faceUp) {
        btn.classList.add("hidden-piece");
        btn.textContent = "暗";
      } else {
        btn.classList.add(piece.color === "red" ? "red-piece" : "black-piece");
        btn.textContent = pieceName(piece);
      }

      if (state.selected && state.selected.r === r && state.selected.c === c) {
        btn.classList.add("selected");
      }

      if (legalTargets.has(`${r},${c}`)) {
        btn.classList.add("hint-target");
      }
    }
  }

  dom.humanColorLabel.textContent = colorLabel(state.playerColor[HUMAN]);
  dom.aiColorLabel.textContent = colorLabel(state.playerColor[AI]);

  if (state.turnColor === null) {
    dom.turnOrb.textContent = "先翻";
  } else if (state.currentPlayer === HUMAN) {
    dom.turnOrb.textContent = "您";
  } else {
    dom.turnOrb.textContent = "AI";
  }
}

function setStatus(main, detail = "") {
  dom.statusText.textContent = main;
  dom.detailText.textContent = detail;
}

function onCellClick(r, c) {
  if (!state || state.aiThinking || state.locked || state.currentPlayer === AI) return;

  const piece = state.board[r][c];

  if (!piece) {
    if (state.selected) {
      tryMoveOrCapture(state.selected, { r, c });
    }
    return;
  }

  if (!piece.faceUp) {
    if (state.selected) {
      state.selected = null;
      setStatus("已取消選取。", "若要翻棋，請再點一次暗棋。");
      render();
      return;
    }

    piece.faceUp = true;

    if (state.turnColor === null) {
      state.playerColor[HUMAN] = piece.color;
      state.playerColor[AI] = opponentColor(piece.color);
      state.turnColor = state.playerColor[HUMAN];
      setStatus(`您翻出${pieceName(piece)}，您為${colorLabel(piece.color)}。`, "接著輪到 AI。");
    }

    endTurn();
    return;
  }

  if (state.turnColor === null) {
    setStatus("尚未分配顏色。", "請先翻棋。");
    return;
  }

  if (piece.color === state.turnColor) {
    if (state.selected && state.selected.r === r && state.selected.c === c) {
      state.selected = null;
      setStatus("已取消選取。", "請選擇要操作的棋，或翻開暗棋。");
    } else {
      state.selected = { r, c };
      setStatus(`已選取${pieceName(piece)}。`, "請點空格移動，或點對方明棋吃子。");
    }

    render();
    return;
  }

  if (state.selected) {
    tryMoveOrCapture(state.selected, { r, c });
  } else {
    setStatus("請先選取自己的明棋。", "只有己方明棋可以移動或吃子。");
  }
}

function tryMoveOrCapture(src, dst) {
  const moving = state.board[src.r][src.c];
  const target = state.board[dst.r][dst.c];

  if (!moving || !moving.faceUp) {
    state.selected = null;
    setStatus("選取來源無效。", "請重新選取自己的明棋。");
    render();
    return;
  }

  if (moving.color !== state.turnColor) {
    state.selected = null;
    setStatus("只能操作自己的棋。", "請重新選取目前輪到的顏色。");
    render();
    return;
  }

  if (!target) {
    if (canMoveToEmpty(state.board, src, dst)) {
      applyAction(state.board, ["move", src.r, src.c, dst.r, dst.c]);
      state.selected = null;
      afterHumanAction();
    } else {
      setStatus("這一步不能走。", "一般移動只能上下左右一格。");
      render();
    }
    return;
  }

  if (!target.faceUp) {
    setStatus("不能直接吃暗棋。", "請先翻開，或改走其他合法步。");
    return;
  }

  if (target.color === moving.color) {
    setStatus("不能吃自己的棋。", "請改點空格或對方明棋。");
    return;
  }

  if (canCapture(state.board, src, dst)) {
    applyAction(state.board, ["capture", src.r, src.c, dst.r, dst.c]);
    state.selected = null;
    afterHumanAction();
  } else {
    setStatus("這顆棋不能這樣吃。", "請依棋階或炮／包跳吃規則操作。");
    render();
  }
}

function afterHumanAction() {
  const winner = checkWinner(state.board);
  if (winner !== null) {
    render();
    showWinner(winner);
    return;
  }

  endTurn();
}

function endTurn() {
  state.selected = null;

  if (state.turnColor === null) {
    render();
    setStatus("請繼續翻棋。", "第一次翻出的顏色會決定雙方歸屬。");
    return;
  }

  state.currentPlayer = state.currentPlayer === HUMAN ? AI : HUMAN;
  state.turnColor = state.playerColor[state.currentPlayer];

  render();

  if (!hasAnyAction(state.board, state.turnColor)) {
    const winnerPlayer = state.currentPlayer === HUMAN ? AI : HUMAN;
    state.locked = true;
    render();
    showModal("遊戲結束", winnerPlayer === HUMAN ? "您獲勝。" : "AI 獲勝。");
    return;
  }

  if (state.currentPlayer === AI) {
    state.aiThinking = true;
    render();

    const diff = DIFFICULTIES[loadDifficulty()];
    setStatus("AI 思考中。", `目前難度：${diff.label}，搜尋深度 ${diff.depth}。`);

    window.setTimeout(aiMove, 80);
  } else {
    state.aiThinking = false;
    render();
    setStatus("輪到您。", `您是${colorLabel(state.playerColor[HUMAN])}，AI 是${colorLabel(state.playerColor[AI])}。`);
  }
}

function aiMove() {
  if (!state) return;

  const aiColor = state.playerColor[AI];
  const humanColor = state.playerColor[HUMAN];
  const boardCopy = cloneBoard(state.board);
  const diff = DIFFICULTIES[loadDifficulty()];

  const action = findBestAction(boardCopy, aiColor, humanColor, diff);

  if (!action) {
    state.aiThinking = false;
    state.locked = true;
    render();
    showModal("遊戲結束", "您獲勝。");
    return;
  }

  applyAction(state.board, action);
  const actionText = describeAction(action);

  const winner = checkWinner(state.board);
  if (winner !== null) {
    state.aiThinking = false;
    render();
    showWinner(winner);
    return;
  }

  state.aiThinking = false;
  state.currentPlayer = HUMAN;
  state.turnColor = state.playerColor[HUMAN];
  render();
  setStatus(`AI 已行動：${actionText}。`, "輪到您。");
}

function describeAction(action) {
  const [kind, sr, sc, dr, dc] = action;

  if (kind === "flip") {
    return `翻開第 ${sr + 1} 列第 ${sc + 1} 格`;
  }

  if (kind === "move") {
    return `移動第 ${sr + 1} 列第 ${sc + 1} 格到第 ${dr + 1} 列第 ${dc + 1} 格`;
  }

  if (kind === "capture") {
    return `吃掉第 ${dr + 1} 列第 ${dc + 1} 格`;
  }

  return "完成一步";
}

function findBestAction(board, aiColor, humanColor, diff) {
  let actions = generateActions(board, aiColor);
  if (actions.length === 0) return null;

  actions = orderActions(board, actions, aiColor, humanColor, diff).slice(0, diff.branchLimit);

  let bestScore = -Infinity;
  let bestAction = null;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const action of actions) {
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);

    const score = minimax(nextBoard, diff.depth - 1, humanColor, aiColor, humanColor, alpha, beta, false, diff);

    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }

    alpha = Math.max(alpha, bestScore);
  }

  return bestAction;
}

function minimax(board, depth, currentColor, aiColor, humanColor, alpha, beta, maximizing, diff) {
  const winner = checkWinner(board);

  if (winner === aiColor) return 1_000_000 + depth;
  if (winner === humanColor) return -1_000_000 - depth;

  if (depth <= 0) {
    return evaluateBoard(board, aiColor, humanColor, diff);
  }

  let actions = generateActions(board, currentColor);

  if (actions.length === 0) {
    return currentColor === aiColor ? -800_000 : 800_000;
  }

  actions = orderActions(board, actions, aiColor, humanColor, diff).slice(0, diff.branchLimit);

  const nextColor = currentColor === aiColor ? humanColor : aiColor;

  if (maximizing) {
    let value = -Infinity;

    for (const action of actions) {
      const nextBoard = cloneBoard(board);
      applyAction(nextBoard, action);

      const score = minimax(nextBoard, depth - 1, nextColor, aiColor, humanColor, alpha, beta, false, diff);
      value = Math.max(value, score);
      alpha = Math.max(alpha, value);

      if (beta <= alpha) break;
    }

    return value;
  }

  let value = Infinity;

  for (const action of actions) {
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);

    const score = minimax(nextBoard, depth - 1, nextColor, aiColor, humanColor, alpha, beta, true, diff);
    value = Math.min(value, score);
    beta = Math.min(beta, value);

    if (beta <= alpha) break;
  }

  return value;
}

function generateActions(board, color) {
  const actions = [];

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && !piece.faceUp) {
        actions.push(["flip", r, c]);
      }
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];

      if (!piece || !piece.faceUp || piece.color !== color) {
        continue;
      }

      for (const nb of neighbors(r, c)) {
        const target = board[nb.r][nb.c];

        if (!target) {
          actions.push(["move", r, c, nb.r, nb.c]);
        } else if (target.faceUp && target.color !== color && canCapture(board, { r, c }, nb)) {
          actions.push(["capture", r, c, nb.r, nb.c]);
        }
      }

      if (piece.kind === "C") {
        for (let rr = 0; rr < ROWS; rr += 1) {
          for (let cc = 0; cc < COLS; cc += 1) {
            if (rr === r && cc === c) continue;
            const target = board[rr][cc];

            if (!target || !target.faceUp || target.color === color) {
              continue;
            }

            if (canCapture(board, { r, c }, { r: rr, c: cc })) {
              const action = ["capture", r, c, rr, cc];
              if (!actions.some((a) => sameAction(a, action))) {
                actions.push(action);
              }
            }
          }
        }
      }
    }
  }

  return actions;
}

function generateNonFlipActions(board, color) {
  return generateActions(board, color).filter((a) => a[0] !== "flip");
}

function orderActions(board, actions, aiColor, humanColor, diff) {
  return actions
    .map((action) => ({
      action,
      score: quickActionScore(board, action, aiColor, humanColor, diff),
      key: actionSortKey(action),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.key.localeCompare(a.key);
    })
    .map((item) => item.action);
}

function actionSortKey(action) {
  return action.join("-");
}

function quickActionScore(board, action, aiColor, humanColor, diff) {
  const kind = action[0];

  if (kind === "capture") {
    const [, sr, sc, dr, dc] = action;
    const attacker = board[sr][sc];
    const defender = board[dr][dc];

    let gain = VALUE[defender.kind] * 10;
    const risk = pieceDangerAfterMove(board, action, attacker.color) * 2;
    const tradeBonus = VALUE[defender.kind] - VALUE[attacker.kind];

    if (attacker.kind === "P" && defender.kind === "K") {
      gain += 3000;
    }

    return gain + tradeBonus - risk;
  }

  if (kind === "move") {
    const [, sr, sc, dr, dc] = action;
    const piece = board[sr][sc];
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);

    let score = 0;
    score += threatScoreFrom(nextBoard, dr, dc, piece.color);

    const beforeRisk = squareRisk(board, sr, sc, piece.color);
    const afterRisk = squareRisk(nextBoard, dr, dc, piece.color);
    score += (beforeRisk - afterRisk) * 3;

    return score;
  }

  if (kind === "flip") {
    const [, r, c] = action;
    const piece = board[r][c];

    if (diff.peekHidden) {
      if (piece.color === aiColor) {
        return VALUE[piece.kind] + flipPositionScore(board, r, c, aiColor);
      }
      return -VALUE[piece.kind] + flipPositionScore(board, r, c, aiColor);
    }

    return flipPositionScore(board, r, c, aiColor);
  }

  return 0;
}

function evaluateBoard(board, aiColor, humanColor, diff) {
  let score = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];

      if (!piece) continue;

      const base = VALUE[piece.kind];

      if (!piece.faceUp) {
        if (diff.peekHidden) {
          const hiddenScore = base * 0.45;
          score += piece.color === aiColor ? hiddenScore : -hiddenScore;
        }
        continue;
      }

      const safety = squareRisk(board, r, c, piece.color);
      const threat = threatScoreFrom(board, r, c, piece.color);

      let pieceScore = base + threat * 0.35 - safety * 0.45;

      if (piece.kind === "K") {
        pieceScore -= kingNearEnemyPawnPenalty(board, r, c, piece.color);
      }

      if (piece.color === aiColor) {
        score += pieceScore;
      } else {
        score -= pieceScore;
      }
    }
  }

  const aiMoves = generateNonFlipActions(board, aiColor).length;
  const humanMoves = generateNonFlipActions(board, humanColor).length;
  score += (aiMoves - humanMoves) * 8;

  return score;
}

function threatScoreFrom(board, r, c, color) {
  const piece = board[r][c];

  if (!piece || !piece.faceUp) return 0;

  let score = 0;

  for (let rr = 0; rr < ROWS; rr += 1) {
    for (let cc = 0; cc < COLS; cc += 1) {
      const target = board[rr][cc];

      if (!target || !target.faceUp || target.color === color) {
        continue;
      }

      if (canCapture(board, { r, c }, { r: rr, c: cc })) {
        score += VALUE[target.kind];

        if (piece.kind === "P" && target.kind === "K") {
          score += 2500;
        }
      }
    }
  }

  return score;
}

function squareRisk(board, r, c, ownColor) {
  const target = board[r][c];

  if (!target || !target.faceUp) return 0;

  let risk = 0;

  for (let rr = 0; rr < ROWS; rr += 1) {
    for (let cc = 0; cc < COLS; cc += 1) {
      const attacker = board[rr][cc];

      if (!attacker || !attacker.faceUp || attacker.color === ownColor) {
        continue;
      }

      if (canCapture(board, { r: rr, c: cc }, { r, c })) {
        risk += VALUE[target.kind];

        if (attacker.kind === "P" && target.kind === "K") {
          risk += 3000;
        }
      }
    }
  }

  return risk;
}

function pieceDangerAfterMove(board, action, ownColor) {
  const nextBoard = cloneBoard(board);
  applyAction(nextBoard, action);

  if (action[0] === "move" || action[0] === "capture") {
    const [, , , dr, dc] = action;
    return squareRisk(nextBoard, dr, dc, ownColor);
  }

  return 0;
}

function flipPositionScore(board, r, c, aiColor) {
  let score = 0;

  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];

    if (!piece || !piece.faceUp) {
      continue;
    }

    if (piece.color === aiColor) {
      score += VALUE[piece.kind] * 0.08;
    } else {
      score -= VALUE[piece.kind] * 0.1;
    }
  }

  const centerR = (ROWS - 1) / 2;
  const centerC = (COLS - 1) / 2;
  const dist = Math.abs(r - centerR) + Math.abs(c - centerC);
  score -= dist * 3;

  return score;
}

function kingNearEnemyPawnPenalty(board, r, c, color) {
  let penalty = 0;

  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];

    if (!piece || !piece.faceUp) {
      continue;
    }

    if (piece.color !== color && piece.kind === "P") {
      penalty += 3500;
    }
  }

  return penalty;
}

function canMoveToEmpty(board, src, dst) {
  return Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) === 1;
}

function canCapture(board, src, dst) {
  const attacker = board[src.r][src.c];
  const defender = board[dst.r][dst.c];

  if (!attacker || !defender) return false;
  if (!attacker.faceUp || !defender.faceUp) return false;
  if (attacker.color === defender.color) return false;

  if (attacker.kind === "C") {
    return canCannonCapture(board, src, dst);
  }

  if (Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) !== 1) {
    return false;
  }

  return canNormalPieceCapture(attacker, defender);
}

function canCannonCapture(board, src, dst) {
  if (src.r !== dst.r && src.c !== dst.c) {
    return false;
  }

  let countBetween = 0;

  if (src.r === dst.r) {
    const step = dst.c > src.c ? 1 : -1;

    for (let c = src.c + step; c !== dst.c; c += step) {
      if (board[src.r][c] !== null) countBetween += 1;
    }
  } else {
    const step = dst.r > src.r ? 1 : -1;

    for (let r = src.r + step; r !== dst.r; r += step) {
      if (board[r][src.c] !== null) countBetween += 1;
    }
  }

  return countBetween === 1;
}

function canNormalPieceCapture(attacker, defender) {
  if (attacker.kind === "K" && defender.kind === "P") return false;
  if (attacker.kind === "P" && defender.kind === "K") return true;
  return RANK[attacker.kind] >= RANK[defender.kind];
}

function applyAction(board, action) {
  const kind = action[0];

  if (kind === "flip") {
    const [, r, c] = action;
    if (board[r][c]) board[r][c].faceUp = true;
    return;
  }

  if (kind === "move" || kind === "capture") {
    const [, sr, sc, dr, dc] = action;
    board[dr][dc] = board[sr][sc];
    board[sr][sc] = null;
  }
}

function cloneBoard(board) {
  return board.map((row) => row.map((piece) => {
    if (!piece) return null;
    return { ...piece };
  }));
}

function neighbors(r, c) {
  const result = [];

  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const rr = r + dr;
    const cc = c + dc;

    if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
      result.push({ r: rr, c: cc });
    }
  }

  return result;
}

function hasAnyAction(board, color) {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && !piece.faceUp) return true;
    }
  }

  return generateNonFlipActions(board, color).length > 0;
}

function checkWinner(board) {
  let redExists = false;
  let blackExists = false;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];

      if (!piece) continue;

      if (piece.color === "red") redExists = true;
      if (piece.color === "black") blackExists = true;
    }
  }

  if (redExists && blackExists) return null;
  if (redExists) return "red";
  if (blackExists) return "black";
  return null;
}

function showWinner(winnerColor) {
  state.locked = true;
  render();

  const humanWon = state.playerColor[HUMAN] === winnerColor;
  showModal("遊戲結束", humanWon ? "您獲勝。" : "AI 獲勝。");
}

function showModal(title, text) {
  dom.modalTitle.textContent = title;
  dom.modalText.textContent = text;
  dom.modal.classList.remove("hidden");
}

function hideModal() {
  dom.modal.classList.add("hidden");
}

function sameAction(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // 不中斷遊戲。若瀏覽器不給註冊，仍可線上遊玩。
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initDom();
  bindEvents();
  syncSettingsUI();
  createBoardButtons();
  newGame();
  showView("home");
  registerServiceWorker();
});
