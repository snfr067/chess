const APP_VERSION = "mobile-r7-20260617-ai-delay-animation";
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
    depth: 1,
    branchLimit: 10,
    riskTaste: 0.85,
    help: "反應最快，AI 不知道暗棋內容，只依已翻開與已被吃的棋推估風險。適合測試與輕鬆玩。",
  },
  normal: {
    label: "一般",
    depth: 3,
    branchLimit: 16,
    riskTaste: 1.0,
    help: "速度與強度平衡，AI 不偷看暗棋，會用剩餘棋種機率評估翻棋與吃暗棋風險。",
  },
  hard: {
    label: "困難",
    depth: 4,
    branchLimit: 20,
    riskTaste: 1.15,
    help: "搜尋較深，AI 仍不偷看暗棋，但會更重視剩餘兵卒、帥將與炮包造成的風險。",
  },
  master: {
    label: "強敵",
    depth: 5,
    branchLimit: 24,
    riskTaste: 1.28,
    help: "候選步更多、計算更細，仍只根據公開資訊與剩餘棋種機率判斷，不讀取暗棋真實內容。",
  },
};

let state = null;
let aiRunId = 0;

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

function loadComboRule() {
  const saved = localStorage.getItem("darkChessComboRule");
  if (saved === null) return true;
  return saved === "true";
}

function saveComboRule(enabled) {
  localStorage.setItem("darkChessComboRule", enabled ? "true" : "false");
}

function loadAiDelaySeconds() {
  const saved = Number.parseFloat(localStorage.getItem("darkChessAiDelaySeconds"));
  if (Number.isFinite(saved)) return clamp(saved, 0.2, 2.5);
  return 0.8;
}

function saveAiDelaySeconds(value) {
  const n = clamp(Number.parseFloat(value), 0.2, 2.5);
  localStorage.setItem("darkChessAiDelaySeconds", n.toFixed(1));
}

function loadAiDelayMs() {
  return Math.round(loadAiDelaySeconds() * 1000);
}

function formatSeconds(value) {
  return `${Number.parseFloat(value).toFixed(1)} 秒`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isComboRuleEnabled() {
  if (state && typeof state.comboRule === "boolean") return state.comboRule;
  return loadComboRule();
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
  dom.endTurnBtn = document.getElementById("endTurnBtn");
  dom.difficultySelect = document.getElementById("difficultySelect");
  dom.comboRuleCheckbox = document.getElementById("comboRuleCheckbox");
  dom.aiDelayRange = document.getElementById("aiDelayRange");
  dom.aiDelayValue = document.getElementById("aiDelayValue");
  dom.difficultyHelp = document.getElementById("difficultyHelp");
  dom.board = document.getElementById("board");
  dom.statusText = document.getElementById("statusText");
  dom.detailText = document.getElementById("detailText");
  dom.humanColorLabel = document.getElementById("humanColorLabel");
  dom.aiColorLabel = document.getElementById("aiColorLabel");
  dom.turnOrb = document.getElementById("turnOrb");
  dom.redGrave = document.getElementById("redGrave");
  dom.blackGrave = document.getElementById("blackGrave");
  dom.capturedCount = document.getElementById("capturedCount");
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

  if (dom.endTurnBtn) {
    dom.endTurnBtn.addEventListener("click", () => {
      if (!state || !state.combo.active || state.currentPlayer !== HUMAN || state.aiThinking) return;
      state.combo = { active: false, r: null, c: null };
      state.selected = null;
      endTurn();
    });
  }

  dom.difficultySelect.addEventListener("change", () => {
    saveDifficulty(dom.difficultySelect.value);
    syncSettingsUI();
  });

  if (dom.comboRuleCheckbox) {
    dom.comboRuleCheckbox.addEventListener("change", () => {
      saveComboRule(dom.comboRuleCheckbox.checked);
      syncSettingsUI();
    });
  }

  if (dom.aiDelayRange) {
    dom.aiDelayRange.addEventListener("input", () => {
      saveAiDelaySeconds(dom.aiDelayRange.value);
      syncSettingsUI();
    });
  }

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
  if (dom.comboRuleCheckbox) dom.comboRuleCheckbox.checked = loadComboRule();

  const aiDelaySeconds = loadAiDelaySeconds();
  if (dom.aiDelayRange) dom.aiDelayRange.value = aiDelaySeconds.toFixed(1);
  if (dom.aiDelayValue) dom.aiDelayValue.textContent = formatSeconds(aiDelaySeconds);
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
  aiRunId += 1;
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
    captured: [],
    lastMove: null,
    pendingAction: null,
    animation: null,
    comboRule: loadComboRule(),
    combo: { active: false, r: null, c: null },
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
  const selected = state.combo.active ? { r: state.combo.r, c: state.combo.c } : state.selected;

  if (selected) {
    const actions = state.combo.active
      ? generateCaptureActionsFrom(state.board, state.turnColor, selected, { includeDark: isComboRuleEnabled() })
      : generateActions(state.board, state.turnColor, {
          includeFlips: false,
          includeMoves: true,
          includeCaptures: true,
          includeDarkCaptures: isComboRuleEnabled(),
        }).filter((a) => a[1] === selected.r && a[2] === selected.c);

    for (const action of actions) {
      legalTargets.add(`${action[3]},${action[4]}`);
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = state.board[r][c];
      const btn = getButton(r, c);
      const cell = btn.parentElement;
      const isLastMove = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
      const pendingSource = actionSource(state.pendingAction);
      const pendingDest = actionDestination(state.pendingAction);
      const animAction = state.animation ? state.animation.action : null;
      const animResult = state.animation ? state.animation.result : null;
      const animSource = actionSource(animAction);
      const animDest = actionDestination(animAction);

      cell.classList.remove(
        "ai-source-cell",
        "ai-target-cell",
        "anim-from-cell",
        "anim-to-cell",
        "anim-move-cell",
        "anim-flip-cell",
        "anim-capture-cell",
        "anim-fail-cell",
      );
      cell.classList.toggle("last-move-cell", Boolean(isLastMove));

      if (samePos(pendingSource, { r, c })) cell.classList.add("ai-source-cell");
      if (samePos(pendingDest, { r, c })) cell.classList.add("ai-target-cell");

      if (samePos(animSource, { r, c })) cell.classList.add("anim-from-cell");
      if (samePos(animDest, { r, c })) {
        cell.classList.add("anim-to-cell");
        if (animAction && animAction[0] === "flip") cell.classList.add("anim-flip-cell");
        if (animAction && animAction[0] === "move") cell.classList.add("anim-move-cell");
        if (animAction && (animAction[0] === "capture" || (animAction[0] === "darkCapture" && animResult && animResult.successCapture))) {
          cell.classList.add("anim-capture-cell");
        }
        if (animAction && animAction[0] === "darkCapture" && animResult && !animResult.successCapture) {
          cell.classList.add("anim-flip-cell", "anim-fail-cell");
        }
      }

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

      if (selected && selected.r === r && selected.c === c) {
        btn.classList.add("selected");
      }

      if (legalTargets.has(`${r},${c}`)) {
        btn.classList.add("hint-target");
      }

      if (isLastMove) {
        btn.classList.add("last-move-piece");
      }

      if (samePos(animDest, { r, c }) && animAction) {
        if (animAction[0] === "flip" || (animAction[0] === "darkCapture" && animResult && !animResult.successCapture)) {
          btn.classList.add("flip-anim");
        } else if (animAction[0] === "move") {
          btn.classList.add("move-anim");
        } else if (animAction[0] === "capture" || (animAction[0] === "darkCapture" && animResult && animResult.successCapture)) {
          btn.classList.add("capture-anim");
        }
      }
    }
  }

  dom.humanColorLabel.textContent = colorLabel(state.playerColor[HUMAN]);
  dom.aiColorLabel.textContent = colorLabel(state.playerColor[AI]);

  if (state.turnColor === null) {
    dom.turnOrb.textContent = "先翻";
  } else if (state.combo.active && state.currentPlayer === HUMAN) {
    dom.turnOrb.textContent = "連吃";
  } else if (state.currentPlayer === HUMAN) {
    dom.turnOrb.textContent = "您";
  } else {
    dom.turnOrb.textContent = "AI";
  }

  if (dom.endTurnBtn) {
    dom.endTurnBtn.classList.toggle(
      "hidden",
      !(state.combo.active && state.currentPlayer === HUMAN && !state.aiThinking && !state.locked),
    );
  }

  renderGraveyard();
}


function renderGraveyard() {
  if (!state || !dom.redGrave || !dom.blackGrave) return;

  const captured = state.captured || [];
  const redPieces = captured.filter((piece) => piece.color === "red");
  const blackPieces = captured.filter((piece) => piece.color === "black");

  dom.capturedCount.textContent = String(captured.length);
  fillGraveList(dom.redGrave, redPieces);
  fillGraveList(dom.blackGrave, blackPieces);
}

function fillGraveList(container, pieces) {
  container.innerHTML = "";
  container.classList.toggle("empty-note", pieces.length === 0);

  if (pieces.length === 0) {
    container.textContent = "尚無";
    return;
  }

  for (const piece of [...pieces].reverse()) {
    const chip = document.createElement("span");
    chip.className = `grave-piece ${piece.color === "red" ? "red-piece" : "black-piece"}`;
    chip.textContent = pieceName(piece);
    chip.title = `${colorLabel(piece.color)} ${pieceName(piece)}`;
    container.appendChild(chip);
  }
}

function performGameAction(action) {
  const result = applyAction(state.board, action);

  if (result.captured) {
    state.captured.push({ ...result.captured, faceUp: true });
  }

  state.lastMove = result.lastMove ? { kind: action[0], ...result.lastMove } : actionDestination(action);
  queueActionAnimation(action, result);
  return result;
}

function actionDestination(action) {
  if (!action) return null;

  if (action[0] === "flip") {
    return { r: action[1], c: action[2] };
  }

  if (action[0] === "move" || action[0] === "capture" || action[0] === "darkCapture") {
    return { r: action[3], c: action[4] };
  }

  return null;
}


function setStatus(main, detail = "") {
  dom.statusText.textContent = main;
  dom.detailText.textContent = detail;
}

function onCellClick(r, c) {
  if (!state || state.aiThinking || state.locked || state.currentPlayer === AI) return;

  const piece = state.board[r][c];

  if (state.combo.active) {
    const comboSrc = { r: state.combo.r, c: state.combo.c };

    if (r === comboSrc.r && c === comboSrc.c) {
      setStatus("連吃中。", "請點同一顆棋可食用的目標，或按「結束回合」。");
      render();
      return;
    }

    if (!piece) {
      setStatus("連吃中不能移動到空格。", "連吃只能靠成功食用取得下一次食用機會。若不想繼續，請按「結束回合」。");
      render();
      return;
    }

    state.selected = comboSrc;
    tryMoveOrCapture(comboSrc, { r, c });
    return;
  }

  if (!piece) {
    if (state.selected) {
      tryMoveOrCapture(state.selected, { r, c });
    }
    return;
  }

  if (!piece.faceUp) {
    if (state.selected) {
      tryMoveOrCapture(state.selected, { r, c });
      return;
    }

    const result = performGameAction(["flip", r, c]);

    if (state.turnColor === null) {
      state.playerColor[HUMAN] = piece.color;
      state.playerColor[AI] = opponentColor(piece.color);
      state.turnColor = state.playerColor[HUMAN];
      setStatus(`您翻出${pieceName(piece)}，您為${colorLabel(piece.color)}。`, "接著輪到 AI。");
    }

    if (!result.invalid) endTurn();
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
      setStatus(`已選取${pieceName(piece)}。`, isComboRuleEnabled()
        ? "請點空格移動、點對方明棋食用，或點可合法食用路徑上的暗棋嘗試食用。"
        : "請點空格移動，或點對方明棋吃子。");
    }

    render();
    return;
  }

  if (state.selected) {
    tryMoveOrCapture(state.selected, { r, c });
  } else {
    setStatus("請先選取自己的明棋。", "只有己方明棋可以移動或食用。");
  }
}

function tryMoveOrCapture(src, dst) {
  const moving = state.board[src.r][src.c];
  const target = state.board[dst.r][dst.c];
  const comboEnabled = isComboRuleEnabled();
  const inCombo = state.combo.active;

  if (!moving || !moving.faceUp) {
    state.selected = null;
    state.combo = { active: false, r: null, c: null };
    setStatus("選取來源無效。", "請重新選取自己的明棋。");
    render();
    return;
  }

  if (moving.color !== state.turnColor) {
    state.selected = null;
    state.combo = { active: false, r: null, c: null };
    setStatus("只能操作自己的棋。", "請重新選取目前輪到的顏色。");
    render();
    return;
  }

  if (inCombo && (src.r !== state.combo.r || src.c !== state.combo.c)) {
    state.selected = { r: state.combo.r, c: state.combo.c };
    setStatus("連吃中不能換棋。", "請繼續操作剛剛食用成功的那顆棋，或按「結束回合」。");
    render();
    return;
  }

  if (!target) {
    if (inCombo) {
      setStatus("連吃中不能移動到空格。", "連吃給的是食用機會，不是移動機會。若不繼續，請按「結束回合」。");
      render();
      return;
    }

    if (canMoveToEmpty(state.board, src, dst)) {
      const result = performGameAction(["move", src.r, src.c, dst.r, dst.c]);
      state.selected = null;
      afterHumanAction(result);
    } else {
      setStatus("這一步不能走。", "一般移動只能上下左右一格。");
      render();
    }
    return;
  }

  if (!target.faceUp) {
    if (!comboEnabled) {
      setStatus("不能直接吃暗棋。", "目前未啟用連吃規則，請先翻開，或改走其他合法步。");
      render();
      return;
    }

    if (!canAttemptHiddenCapturePath(state.board, src, dst)) {
      setStatus("這不是合法食用行動。", moving.kind === "C"
        ? "炮／包食用永遠必須跳吃；若沒有隔一顆棋，就不能把暗棋當成食用目標。"
        : "一般棋食用暗棋時，只能上下左右相鄰一格。");
      render();
      return;
    }

    const result = performGameAction(["darkCapture", src.r, src.c, dst.r, dst.c]);
    afterHumanAction(result);
    return;
  }

  if (target.color === moving.color) {
    setStatus("不能吃自己的棋。", inCombo ? "這只是違規操作，回合不會結束；請改選可食用目標或按「結束回合」。" : "請改點空格或對方明棋。");
    render();
    return;
  }

  if (canCapture(state.board, src, dst)) {
    const result = performGameAction(["capture", src.r, src.c, dst.r, dst.c]);
    afterHumanAction(result);
  } else {
    setStatus("這顆棋不能這樣吃。", inCombo ? "嘗試吃不能吃的明棋只算違規提醒，回合繼續。" : "請依棋階或炮／包跳吃規則操作。");
    render();
  }
}

function afterHumanAction(result) {
  const winner = checkWinner(state.board);
  if (winner !== null) {
    state.combo = { active: false, r: null, c: null };
    state.selected = null;
    render();
    showWinner(winner);
    return;
  }

  if (isComboRuleEnabled() && result.successCapture && result.lastMove) {
    const pos = { r: result.lastMove.r, c: result.lastMove.c };
    state.combo = { active: true, r: pos.r, c: pos.c };
    state.selected = pos;

    if (hasCaptureOpportunityFrom(state.board, state.turnColor, pos, { includeDark: true })) {
      render();
      setStatus("食用成功，可以連吃。", "請繼續用同一顆棋食用明棋或暗棋；若不想冒險，請按「結束回合」。");
      return;
    }

    state.combo = { active: false, r: null, c: null };
    state.selected = null;
    endTurn();
    return;
  }

  state.combo = { active: false, r: null, c: null };
  state.selected = null;
  endTurn();
}

function endTurn() {
  state.selected = null;
  state.combo = { active: false, r: null, c: null };

  if (state.turnColor === null) {
    render();
    setStatus("請繼續翻棋。", "第一次翻出的顏色會決定雙方歸屬。主上若啟用連吃，食用暗棋會先翻再判定。 ");
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
    setStatus("AI 思考中。", `目前難度：${diff.label}，搜尋深度 ${diff.depth}；每步延遲 ${formatSeconds(loadAiDelaySeconds())}。`);

    window.setTimeout(aiMove, 120);
  } else {
    state.aiThinking = false;
    render();
    setStatus("輪到您。", `您是${colorLabel(state.playerColor[HUMAN])}，AI 是${colorLabel(state.playerColor[AI])}。${isComboRuleEnabled() ? "連吃規則已啟用。" : "連吃規則未啟用。"}`);
  }
}

async function aiMove() {
  if (!state) return;

  const runId = aiRunId + 1;
  aiRunId = runId;

  const aiColor = state.playerColor[AI];
  const humanColor = state.playerColor[HUMAN];
  const diff = DIFFICULTIES[loadDifficulty()];
  const comboEnabled = isComboRuleEnabled();
  const actionTexts = [];

  let action = findBestAction(cloneBoard(state.board), aiColor, humanColor, diff, { includeDarkCaptures: comboEnabled });

  if (!action) {
    state.aiThinking = false;
    state.locked = true;
    state.pendingAction = null;
    render();
    showModal("遊戲結束", "您獲勝。");
    return;
  }

  await previewAiAction(action, runId);
  if (!isAiRunActive(runId)) return;

  let result = await performAiActionWithVisibleDarkReveal(action, runId);
  actionTexts.push(describeActionWithResult(action, result));
  state.pendingAction = null;
  render();
  setStatus(`AI 已行動：${describeActionWithResult(action, result)}。`, "棋盤上的亮色標示是這一步作用的位置。");
  await sleep(Math.max(260, Math.round(loadAiDelayMs() * 0.45)));
  if (!isAiRunActive(runId)) return;

  let winner = checkWinner(state.board);
  if (winner !== null) {
    state.aiThinking = false;
    state.combo = { active: false, r: null, c: null };
    state.pendingAction = null;
    render();
    showWinner(winner);
    return;
  }

  if (comboEnabled && result.successCapture && result.lastMove) {
    let pos = { r: result.lastMove.r, c: result.lastMove.c };
    let guard = 0;

    while (guard < 16) {
      guard += 1;
      const comboChoice = chooseBestComboAction(state.board, aiColor, humanColor, pos, diff);
      if (!comboChoice || comboChoice.score < 90) break;

      await previewAiAction(comboChoice.action, runId, "AI 準備連吃。");
      if (!isAiRunActive(runId)) return;

      result = await performAiActionWithVisibleDarkReveal(comboChoice.action, runId);
      actionTexts.push(describeActionWithResult(comboChoice.action, result));
      state.pendingAction = null;
      render();
      setStatus(`AI 連吃：${describeActionWithResult(comboChoice.action, result)}。`, "每一口會分開標示，不再一次跳完。");
      await sleep(Math.max(260, Math.round(loadAiDelayMs() * 0.45)));
      if (!isAiRunActive(runId)) return;

      winner = checkWinner(state.board);
      if (winner !== null) {
        state.aiThinking = false;
        state.combo = { active: false, r: null, c: null };
        state.pendingAction = null;
        render();
        showWinner(winner);
        return;
      }

      if (!result.successCapture || !result.lastMove) break;
      pos = { r: result.lastMove.r, c: result.lastMove.c };
    }
  }

  state.combo = { active: false, r: null, c: null };
  state.selected = null;
  state.pendingAction = null;
  state.aiThinking = false;
  state.currentPlayer = HUMAN;
  state.turnColor = state.playerColor[HUMAN];
  render();
  setStatus(`AI 已行動：${actionTexts.join(" → ")}。`, "輪到您。");
}

async function performAiActionWithVisibleDarkReveal(action, runId) {
  if (!state || !action) return null;

  if (action[0] !== "darkCapture") {
    return performGameAction(action);
  }

  const [, sr, sc, dr, dc] = action;
  const target = state.board[dr][dc];

  if (!target || target.faceUp) {
    return performGameAction(action);
  }

  if (!canAttemptHiddenCapturePath(state.board, { r: sr, c: sc }, { r: dr, c: dc })) {
    const invalidResult = {
      type: "darkCapture",
      successCapture: false,
      captured: null,
      lastMove: null,
      invalid: true,
    };
    queueActionAnimation(action, invalidResult);
    return invalidResult;
  }

  target.faceUp = true;

  const revealResult = {
    type: "flip",
    successCapture: false,
    captured: null,
    lastMove: { r: dr, c: dc },
    invalid: false,
  };

  state.lastMove = { kind: "darkReveal", r: dr, c: dc };
  queueActionAnimation(["flip", dr, dc], revealResult);
  render();

  setStatus(
    `AI 翻開暗棋：第 ${dr + 1} 列第 ${dc + 1} 格是「${pieceName(target)}」。`,
    "先讓您看清楚翻出的棋，再判定是否食用成功。"
  );

  await sleep(Math.max(520, Math.round(loadAiDelayMs() * 0.65)));
  if (!isAiRunActive(runId)) return revealResult;

  if (canCapture(state.board, { r: sr, c: sc }, { r: dr, c: dc })) {
    const captured = { ...target, faceUp: true };

    state.board[dr][dc] = state.board[sr][sc];
    state.board[sr][sc] = null;
    state.captured.push(captured);

    const result = {
      type: "darkCapture",
      successCapture: true,
      captured,
      lastMove: { r: dr, c: dc },
      invalid: false,
    };

    state.lastMove = { kind: "darkCapture", r: dr, c: dc };
    queueActionAnimation(action, result);
    render();

    return result;
  }

  const result = {
    type: "darkCapture",
    successCapture: false,
    captured: null,
    lastMove: { r: dr, c: dc },
    invalid: false,
  };

  state.lastMove = { kind: "darkCaptureFail", r: dr, c: dc };
  queueActionAnimation(action, result);
  render();

  return result;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAiRunActive(runId) {
  return Boolean(state && state.aiThinking && state.currentPlayer === AI && runId === aiRunId);
}

async function previewAiAction(action, runId, main = "AI 準備行動。") {
  if (!isAiRunActive(runId)) return;
  state.pendingAction = action;
  render();
  setStatus(main, `${describeAction(action)}；${formatSeconds(loadAiDelaySeconds())}後執行。`);
  await sleep(loadAiDelayMs());
}

function queueActionAnimation(action, result) {
  if (!state || !action) return;
  const id = `${Date.now()}-${Math.random()}`;
  state.animation = {
    id,
    action: [...action],
    result: result ? {
      type: result.type,
      successCapture: Boolean(result.successCapture),
      invalid: Boolean(result.invalid),
      lastMove: result.lastMove ? { ...result.lastMove } : null,
    } : null,
  };

  window.setTimeout(() => {
    if (state && state.animation && state.animation.id === id) {
      state.animation = null;
      render();
    }
  }, 720);
}

function actionSource(action) {
  if (!action) return null;
  if (action[0] === "move" || action[0] === "capture" || action[0] === "darkCapture") {
    return { r: action[1], c: action[2] };
  }
  return null;
}

function samePos(a, b) {
  return Boolean(a && b && a.r === b.r && a.c === b.c);
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
    return `食用第 ${dr + 1} 列第 ${dc + 1} 格`;
  }

  if (kind === "darkCapture") {
    return `嘗試食用第 ${dr + 1} 列第 ${dc + 1} 格暗棋`;
  }

  return "完成一步";
}

function describeActionWithResult(action, result) {
  if (action[0] !== "darkCapture") return describeAction(action);
  const [, , , dr, dc] = action;
  if (result.successCapture) return `食用第 ${dr + 1} 列第 ${dc + 1} 格暗棋成功`;
  return `翻開第 ${dr + 1} 列第 ${dc + 1} 格暗棋但食用失敗`;
}


function findBestAction(board, aiColor, humanColor, diff, options = {}) {
  let actions = generateActions(board, aiColor, {
    includeFlips: true,
    includeMoves: true,
    includeCaptures: true,
    includeDarkCaptures: Boolean(options.includeDarkCaptures),
  });

  if (actions.length === 0) return null;

  actions = orderActions(board, actions, aiColor, humanColor, diff).slice(0, diff.branchLimit);

  let bestScore = -Infinity;
  let bestAction = null;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const action of actions) {
    let score = quickActionScore(board, action, aiColor, humanColor, diff);

    if (action[0] === "move" || action[0] === "capture") {
      const nextBoard = cloneBoard(board);
      applyAction(nextBoard, action);
      score += minimax(nextBoard, diff.depth - 1, humanColor, aiColor, humanColor, alpha, beta, false, diff);
    }

    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }

    alpha = Math.max(alpha, bestScore);
  }

  return bestAction;
}

function minimax(board, depth, currentColor, aiColor, humanColor, alpha, beta, maximizing, diff) {
  const winner = checkWinnerForSearch(board);

  if (winner === aiColor) return 1_000_000 + depth;
  if (winner === humanColor) return -1_000_000 - depth;

  if (depth <= 0) {
    return evaluateBoard(board, aiColor, humanColor, diff);
  }

  let actions = generateActions(board, currentColor, {
    includeFlips: false,
    includeMoves: true,
    includeCaptures: true,
    includeDarkCaptures: false,
  });

  if (actions.length === 0) {
    return evaluateBoard(board, aiColor, humanColor, diff);
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

function generateActions(board, color, options = {}) {
  const includeFlips = options.includeFlips !== false;
  const includeMoves = options.includeMoves !== false;
  const includeCaptures = options.includeCaptures !== false;
  const includeDarkCaptures = Boolean(options.includeDarkCaptures);
  const actions = [];

  if (includeFlips) {
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const piece = board[r][c];
        if (piece && !piece.faceUp) {
          actions.push(["flip", r, c]);
        }
      }
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];

      if (!piece || !piece.faceUp || piece.color !== color) {
        continue;
      }

      if (includeMoves) {
        for (const nb of neighbors(r, c)) {
          if (board[nb.r][nb.c] === null) {
            actions.push(["move", r, c, nb.r, nb.c]);
          }
        }
      }

      if (includeCaptures || includeDarkCaptures) {
        const captureActions = generateCaptureActionsFrom(board, color, { r, c }, { includeDark: includeDarkCaptures });
        for (const action of captureActions) {
          if (action[0] === "capture" && !includeCaptures) continue;
          if (action[0] === "darkCapture" && !includeDarkCaptures) continue;
          if (!actions.some((a) => sameAction(a, action))) actions.push(action);
        }
      }
    }
  }

  return actions;
}

function generateCaptureActionsFrom(board, color, src, options = {}) {
  const includeDark = Boolean(options.includeDark);
  const actions = [];
  const attacker = board[src.r][src.c];

  if (!attacker || !attacker.faceUp || attacker.color !== color) return actions;

  for (let rr = 0; rr < ROWS; rr += 1) {
    for (let cc = 0; cc < COLS; cc += 1) {
      if (rr === src.r && cc === src.c) continue;
      const target = board[rr][cc];
      if (!target) continue;

      const dst = { r: rr, c: cc };

      if (!target.faceUp) {
        if (includeDark && canAttemptHiddenCapturePath(board, src, dst)) {
          actions.push(["darkCapture", src.r, src.c, rr, cc]);
        }
        continue;
      }

      if (target.color !== color && canCapture(board, src, dst)) {
        actions.push(["capture", src.r, src.c, rr, cc]);
      }
    }
  }

  return actions;
}

function hasCaptureOpportunityFrom(board, color, src, options = {}) {
  return generateCaptureActionsFrom(board, color, src, options).length > 0;
}

function generateNonFlipActions(board, color) {
  return generateActions(board, color, {
    includeFlips: false,
    includeMoves: true,
    includeCaptures: true,
    includeDarkCaptures: false,
  });
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

  if (kind === "darkCapture") {
    return expectedHiddenCaptureScore(board, action, aiColor, humanColor, diff);
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
    return expectedFlipScore(board, r, c, aiColor, humanColor, diff);
  }

  return 0;
}

function evaluateBoard(board, aiColor, humanColor, diff) {
  let score = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];

      if (!piece || !piece.faceUp) continue;

      const base = VALUE[piece.kind];
      const safety = squareRisk(board, r, c, piece.color);
      const threat = threatScoreFrom(board, r, c, piece.color);

      let pieceScore = base + threat * 0.35 - safety * 0.45;

      if (piece.kind === "K") {
        pieceScore -= kingNearEnemyPawnPenalty(board, r, c, piece.color, diff);
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

function expectedFlipScore(board, r, c, aiColor, humanColor, diff) {
  const pool = getUnseenPool(board);
  const total = pool.total || 1;
  let expected = 0;

  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count <= 0) continue;
      const prob = count / total;
      const base = VALUE[kind] * (color === aiColor ? 0.26 : -0.24);
      expected += prob * base;
    }
  }

  expected += flipPositionScore(board, r, c, aiColor, diff);
  return expected;
}

function expectedHiddenCaptureScore(board, action, aiColor, humanColor, diff) {
  const [, sr, sc, dr, dc] = action;
  const attacker = board[sr][sc];
  const pool = getUnseenPool(board);
  const total = pool.total || 1;
  let successProb = 0;
  let expectedGain = 0;
  let failPain = 0;

  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count <= 0) continue;
      const prob = count / total;
      const hypothetical = { color, kind, faceUp: true };
      const canEat = color !== attacker.color && canHypotheticalCapture(board, { r: sr, c: sc }, { r: dr, c: dc }, hypothetical);

      if (canEat) {
        successProb += prob;
        expectedGain += prob * VALUE[kind] * 9.5;
        if (attacker.kind === "P" && kind === "K") expectedGain += prob * 3000;
      } else {
        let pain = 120;
        if (color !== attacker.color) pain += VALUE[kind] * 0.9;
        if (attacker.kind === "K" && color !== attacker.color && kind === "P") pain += 2600;
        failPain += prob * pain;
      }
    }
  }

  const nextRisk = squareRisk(board, sr, sc, attacker.color) * 0.45;
  return expectedGain + successProb * 260 - failPain * diff.riskTaste - nextRisk;
}

function flipPositionScore(board, r, c, aiColor, diff = DIFFICULTIES.normal) {
  let score = 0;
  const pool = getUnseenPool(board);
  const enemyColor = opponentColor(aiColor);
  const enemyPawnProb = pool.total ? pool.counts[enemyColor].P / pool.total : 0;
  const aiPawnProb = pool.total ? pool.counts[aiColor].P / pool.total : 0;

  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];

    if (!piece || !piece.faceUp) {
      continue;
    }

    if (piece.color === aiColor) {
      score += VALUE[piece.kind] * 0.06;
      if (piece.kind === "K") score -= enemyPawnProb * 1600 * diff.riskTaste;
    } else {
      score -= VALUE[piece.kind] * 0.08;
      if (piece.kind === "K") score += aiPawnProb * 1200;
    }
  }

  const centerR = (ROWS - 1) / 2;
  const centerC = (COLS - 1) / 2;
  const dist = Math.abs(r - centerR) + Math.abs(c - centerC);
  score -= dist * 3;

  return score;
}

function kingNearEnemyPawnPenalty(board, r, c, color, diff = DIFFICULTIES.normal) {
  let penalty = 0;
  const pool = getUnseenPool(board);
  const enemyColor = opponentColor(color);
  const hiddenEnemyPawnProb = pool.total ? pool.counts[enemyColor].P / pool.total : 0;

  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];

    if (!piece) continue;

    if (!piece.faceUp) {
      penalty += hiddenEnemyPawnProb * 950 * diff.riskTaste;
      continue;
    }

    if (piece.color !== color && piece.kind === "P") {
      penalty += 3500;
    }
  }

  return penalty;
}

function chooseBestComboAction(board, aiColor, humanColor, pos, diff) {
  const actions = generateCaptureActionsFrom(board, aiColor, pos, { includeDark: true });
  if (actions.length === 0) return null;

  let best = null;
  for (const action of actions) {
    const score = quickActionScore(board, action, aiColor, humanColor, diff);
    if (!best || score > best.score) best = { action, score };
  }
  return best;
}

function getUnseenPool(board, captured = state ? state.captured : []) {
  const counts = {
    red: { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 },
    black: { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 },
  };

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && piece.faceUp) {
        counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
      }
    }
  }

  for (const piece of captured || []) {
    counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
  }

  let total = 0;
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      total += counts[color][kind];
    }
  }

  return { counts, total };
}

function checkWinnerForSearch(board) {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && !piece.faceUp) return null;
    }
  }
  return checkWinner(board);
}



function canAttemptHiddenCapturePath(board, src, dst) {
  const attacker = board[src.r][src.c];
  const target = board[dst.r][dst.c];

  if (!attacker || !attacker.faceUp || !target || target.faceUp) return false;

  if (attacker.kind === "C") {
    return canCannonPath(board, src, dst);
  }

  return Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) === 1;
}

function canHypotheticalCapture(board, src, dst, hypotheticalDefender) {
  const attacker = board[src.r][src.c];
  if (!attacker || !attacker.faceUp) return false;
  if (attacker.color === hypotheticalDefender.color) return false;

  if (attacker.kind === "C") {
    return canCannonPath(board, src, dst);
  }

  if (Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) !== 1) return false;
  return canNormalPieceCapture(attacker, hypotheticalDefender);
}

function canCannonPath(board, src, dst) {
  if (src.r !== dst.r && src.c !== dst.c) return false;

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
    return {
      type: "flip",
      successCapture: false,
      captured: null,
      lastMove: { r, c },
      invalid: false,
    };
  }

  if (kind === "move") {
    const [, sr, sc, dr, dc] = action;
    board[dr][dc] = board[sr][sc];
    board[sr][sc] = null;
    return {
      type: "move",
      successCapture: false,
      captured: null,
      lastMove: { r: dr, c: dc },
      invalid: false,
    };
  }

  if (kind === "capture") {
    const [, sr, sc, dr, dc] = action;
    const captured = board[dr][dc] ? { ...board[dr][dc], faceUp: true } : null;
    board[dr][dc] = board[sr][sc];
    board[sr][sc] = null;
    return {
      type: "capture",
      successCapture: true,
      captured,
      lastMove: { r: dr, c: dc },
      invalid: false,
    };
  }

  if (kind === "darkCapture") {
    const [, sr, sc, dr, dc] = action;

    if (!canAttemptHiddenCapturePath(board, { r: sr, c: sc }, { r: dr, c: dc })) {
      return {
        type: "darkCapture",
        successCapture: false,
        captured: null,
        lastMove: null,
        invalid: true,
      };
    }

    if (board[dr][dc]) board[dr][dc].faceUp = true;

    if (canCapture(board, { r: sr, c: sc }, { r: dr, c: dc })) {
      const captured = board[dr][dc] ? { ...board[dr][dc], faceUp: true } : null;
      board[dr][dc] = board[sr][sc];
      board[sr][sc] = null;
      return {
        type: "darkCapture",
        successCapture: true,
        captured,
        lastMove: { r: dr, c: dc },
        invalid: false,
      };
    }

    return {
      type: "darkCapture",
      successCapture: false,
      captured: null,
      lastMove: { r: dr, c: dc },
      invalid: false,
    };
  }

  return {
    type: kind,
    successCapture: false,
    captured: null,
    lastMove: null,
    invalid: true,
  };
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
    navigator.serviceWorker.register("./service-worker.js?v=mobile-r7-20260617-ai-delay-animation").catch(() => {
      // 不中斷遊戲。若瀏覽器不給註冊，仍可線上遊玩。
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const versionBadge = document.getElementById("versionBadge");
  if (versionBadge) versionBadge.textContent = `版本：${APP_VERSION}`;
  initDom();
  bindEvents();
  syncSettingsUI();
  createBoardButtons();
  newGame();
  showView("home");
  registerServiceWorker();
});
