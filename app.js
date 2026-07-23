const APP_VERSION = "mobile-r21-20260723-omniscient-master";

const ROWS = 4;
const COLS = 8;
const HUMAN = "human";
const AI = "ai";

const RANK = { K: 7, A: 6, E: 5, R: 4, N: 3, C: 2, P: 1 };
const VALUE = { K: 700, A: 720, E: 400, R: 260, N: 190, C: 500, P: 130 };
const RED_NAMES = { K: "帥", A: "仕", E: "相", R: "俥", N: "傌", C: "炮", P: "兵" };
const BLACK_NAMES = { K: "將", A: "士", E: "象", R: "車", N: "馬", C: "包", P: "卒" };
const PIECE_COUNTS = { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 };

const DIFFICULTIES = {
  easy: { label: "入門", depth: 1, branchLimit: 10, flipLimit: 6, chanceLimit: 8, thinkMs: 120, riskTaste: 0.90, help: "快速完成基本攻防判斷。" },
  normal: { label: "一般", depth: 3, branchLimit: 18, flipLimit: 10, chanceLimit: 10, thinkMs: 520, riskTaste: 1.00, help: "搜尋完整回合與下一輪反擊。" },
  hard: { label: "困難", depth: 4, branchLimit: 25, flipLimit: 14, chanceLimit: 12, thinkMs: 1200, riskTaste: 1.12, help: "加深勝負搜尋，減少貪吃與送棋。" },
  master: { label: "全知強敵", depth: 6, branchLimit: 34, flipLimit: 18, chanceLimit: 14, thinkMs: 700, riskTaste: 1.28, help: "最高難度會掌握暗棋配置，以勝利為唯一目標。" },
};

const SEARCH_VALUE = { K: 1200, A: 300, E: 300, R: 680, N: 440, C: 560, P: 210 };
const SEARCH_MATE = 100_000_000;
const SEARCH_FORBIDDEN = 50_000_000;
const SEARCH_TIMEOUT = { timeout: true };
const MAX_COMBO_STEPS = 15;
const MAX_TURN_HISTORY = 96;
const REPETITION_LIMIT = 3;

let state = null;
let aiRunId = 0;
let toastTimer = null;
const dom = {};

function makePiece(color, kind, id) { return { color, kind, faceUp: false, id }; }
function pieceName(piece) { return piece.color === "red" ? RED_NAMES[piece.kind] : BLACK_NAMES[piece.kind]; }
function colorLabel(color) { if (!color) return "未定"; return color === "red" ? "紅方" : "黑方"; }
function opponentColor(color) { return color === "red" ? "black" : "red"; }
function clamp(value, min, max) { if (!Number.isFinite(value)) return min; return Math.min(max, Math.max(min, value)); }
function sleep(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function samePos(a, b) { return Boolean(a && b && a.r === b.r && a.c === b.c); }
function posLabel(pos) { return pos ? `${pos.r + 1},${pos.c + 1}` : "—"; }

function loadDifficulty() { const saved = localStorage.getItem("darkChessDifficulty"); return DIFFICULTIES[saved] ? saved : "normal"; }
function saveDifficulty(value) { if (DIFFICULTIES[value]) localStorage.setItem("darkChessDifficulty", value); }
function loadComboRule() { const saved = localStorage.getItem("darkChessComboRule"); return saved === null ? true : saved === "true"; }
function saveComboRule(enabled) { localStorage.setItem("darkChessComboRule", enabled ? "true" : "false"); }
function loadAiDelaySeconds() { const saved = Number.parseFloat(localStorage.getItem("darkChessAiDelaySeconds")); return Number.isFinite(saved) ? clamp(saved, 0.2, 2.5) : 0.8; }
function saveAiDelaySeconds(value) { localStorage.setItem("darkChessAiDelaySeconds", clamp(Number.parseFloat(value), 0.2, 2.5).toFixed(1)); }
function loadAiDelayMs() { return Math.round(loadAiDelaySeconds() * 1000); }
function formatSeconds(value) { return `${Number.parseFloat(value).toFixed(1)} 秒`; }
function isComboRuleEnabled() { return state && typeof state.comboRule === "boolean" ? state.comboRule : loadComboRule(); }
function actorDelay(actor, ratio = 1) { return actor === AI ? Math.max(220, Math.round(loadAiDelayMs() * ratio)) : Math.max(260, Math.round(520 * ratio)); }

function initDom() {
  for (const id of [
    "homeView", "settingsView", "gameView", "startGameBtn", "openSettingsBtn", "settingsBackBtn", "gameBackBtn", "newGameBtn", "endTurnBtn",
    "difficultySelect", "comboRuleCheckbox", "aiDelayRange", "aiDelayValue", "difficultyHelp", "board", "statusText", "detailText",
    "humanColorLabel", "aiColorLabel", "turnOrb", "redGrave", "blackGrave", "capturedCount", "leftGraveTitle", "rightGraveTitle", "leftGraveCount", "rightGraveCount", "toast", "modal", "modalTitle", "modalText", "modalHomeBtn", "modalRestartBtn"
  ]) dom[id] = document.getElementById(id);
}

function bindEvents() {
  dom.startGameBtn.addEventListener("click", () => { newGame(); showView("game"); });
  dom.openSettingsBtn.addEventListener("click", () => { syncSettingsUI(); showView("settings"); });
  dom.settingsBackBtn.addEventListener("click", () => showView("home"));
  dom.gameBackBtn.addEventListener("click", () => { hideModal(); showView("home"); });
  dom.newGameBtn.addEventListener("click", () => newGame());
  dom.endTurnBtn.addEventListener("click", () => {
    if (!state || !state.combo.active || state.currentPlayer !== HUMAN || state.aiThinking || state.locked) return;
    state.combo = { active: false, r: null, c: null };
    state.selected = null;
    endTurn();
  });
  dom.difficultySelect.addEventListener("change", () => { saveDifficulty(dom.difficultySelect.value); syncSettingsUI(); });
  dom.comboRuleCheckbox.addEventListener("change", () => { saveComboRule(dom.comboRuleCheckbox.checked); syncSettingsUI(); });
  dom.aiDelayRange.addEventListener("input", () => { saveAiDelaySeconds(dom.aiDelayRange.value); syncSettingsUI(); });
  dom.modalHomeBtn.addEventListener("click", () => { hideModal(); showView("home"); });
  dom.modalRestartBtn.addEventListener("click", () => { hideModal(); newGame(); showView("game"); });
}

function showView(name) {
  dom.homeView.classList.toggle("active", name === "home");
  dom.settingsView.classList.toggle("active", name === "settings");
  dom.gameView.classList.toggle("active", name === "game");
  document.body.classList.toggle("is-game-view", name === "game");
}

function syncSettingsUI() {
  const difficulty = loadDifficulty();
  dom.difficultySelect.value = difficulty;
  dom.difficultyHelp.textContent = DIFFICULTIES[difficulty].help;
  dom.comboRuleCheckbox.checked = loadComboRule();
  const aiDelay = loadAiDelaySeconds();
  dom.aiDelayRange.value = aiDelay.toFixed(1);
  dom.aiDelayValue.textContent = formatSeconds(aiDelay);
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
      for (let i = 0; i < count; i += 1) pieces.push(makePiece(color, kind, `${color}-${kind}-${id++}`));
    }
  }
  shuffle(pieces);
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let idx = 0;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) board[r][c] = pieces[idx++];
  state = {
    board,
    selected: null,
    turnColor: null,
    playerColor: { [HUMAN]: null, [AI]: null },
    currentPlayer: HUMAN,
    aiThinking: false,
    locked: false,
    captured: [],
    lastMove: null,
    lastCapturedId: null,
    pendingAction: null,
    animation: null,
    actionViz: null,
    comboRule: loadComboRule(),
    combo: { active: false, r: null, c: null },
    turnActions: [],
    turnHistory: [],
    positionHistory: [],
    positionCounts: Object.create(null),
    aiSearchInfo: null,
  };
  setStatus("請先翻一顆棋。", "");
  render();
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function getButton(r, c) { return dom.board.querySelector(`button[data-r="${r}"][data-c="${c}"]`); }

function render() {
  if (!state) return;
  const legalTargets = new Set();
  const selected = state.combo.active ? { r: state.combo.r, c: state.combo.c } : state.selected;
  if (selected && state.turnColor) {
    const actions = state.combo.active
      ? generateCaptureActionsFrom(state.board, state.turnColor, selected, { includeDark: isComboRuleEnabled() })
      : generateActions(state.board, state.turnColor, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: isComboRuleEnabled() })
          .filter((a) => a[1] === selected.r && a[2] === selected.c)
          .filter((a) => !evaluateHumanOpeningPolicy(state.board, a).forbidden);
    for (const action of actions) legalTargets.add(`${action[3]},${action[4]}`);
  }

  const pendingSource = actionSource(state.pendingAction);
  const pendingDest = actionDestination(state.pendingAction);
  const animAction = state.animation ? state.animation.action : null;
  const animResult = state.animation ? state.animation.result : null;
  const animSource = actionSource(animAction);
  const animDest = actionDestination(animAction);

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = state.board[r][c];
      const btn = getButton(r, c);
      const cell = btn.parentElement;
      const isLastMove = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
      cell.className = "cell";
      if (isLastMove) cell.classList.add("last-move-cell");
      if (samePos(pendingSource, { r, c })) cell.classList.add("preview-source");
      if (samePos(pendingDest, { r, c })) cell.classList.add("preview-target");
      if (samePos(animSource, { r, c })) cell.classList.add("anim-from-cell");
      if (samePos(animDest, { r, c })) {
        cell.classList.add("anim-to-cell");
        if (animAction && animAction[0] === "darkCapture" && animResult && !animResult.successCapture) cell.classList.add("anim-fail-cell");
      }
      if (state.combo.active && state.combo.r === r && state.combo.c === c) cell.classList.add("combo-anchor");

      btn.disabled = state.aiThinking || state.locked || state.currentPlayer === AI;
      btn.className = "piece-btn";
      btn.textContent = "";
      if (!piece) {
        btn.classList.add("empty");
      } else if (!piece.faceUp) {
        btn.classList.add("hidden-piece");
        btn.textContent = "暗";
      } else {
        btn.classList.add(piece.color === "red" ? "red-piece" : "black-piece");
        btn.textContent = pieceName(piece);
      }
      if (selected && selected.r === r && selected.c === c) btn.classList.add("selected");
      if (legalTargets.has(`${r},${c}`)) btn.classList.add("hint-target");
      if (samePos(animDest, { r, c }) && animAction) {
        if (animAction[0] === "flip" || (animAction[0] === "darkCapture" && animResult && animResult.phase === "reveal")) btn.classList.add("flip-anim");
        else if (animAction[0] === "move") btn.classList.add("move-anim");
        else if (animAction[0] === "capture" || (animAction[0] === "darkCapture" && animResult && animResult.successCapture)) btn.classList.add("capture-anim");
        else if (animAction[0] === "darkCapture" && animResult && !animResult.successCapture) btn.classList.add("fail-anim");
      }
    }
  }

  dom.humanColorLabel.textContent = colorLabel(state.playerColor[HUMAN]);
  dom.aiColorLabel.textContent = colorLabel(state.playerColor[AI]);
  dom.turnOrb.textContent = state.turnColor === null ? "先翻" : state.combo.active && state.currentPlayer === HUMAN ? "連吃" : state.currentPlayer === HUMAN ? "您" : "AI";
  dom.endTurnBtn.classList.toggle("hidden", !(state.combo.active && state.currentPlayer === HUMAN && !state.aiThinking && !state.locked));
  renderGraveyard();
}

function renderActionVisual() {
  const viz = state.actionViz;
  dom.actionVisual.classList.toggle("idle", !viz);
  dom.actionVisual.classList.toggle("pulse", Boolean(viz && viz.pulse));
  if (!viz) {
    dom.actionActor.textContent = "等待";
    dom.actionActor.className = "actor-pill";
    dom.actionKind.textContent = "上一步";
    dom.actionFrom.textContent = "起點";
    dom.actionFrom.className = "pos-chip muted";
    dom.actionTo.textContent = "目標";
    dom.actionTo.className = "pos-chip muted";
    dom.actionReveal.classList.add("hidden");
    dom.actionCaptured.classList.add("hidden");
    return;
  }
  dom.actionActor.textContent = viz.actor === AI ? "AI" : "您";
  dom.actionActor.className = `actor-pill ${viz.actor}`;
  dom.actionKind.textContent = viz.kindLabel || "動作";
  dom.actionFrom.textContent = posLabel(viz.from);
  dom.actionFrom.className = `pos-chip ${viz.from ? "active" : "muted"}`;
  dom.actionTo.textContent = posLabel(viz.to);
  dom.actionTo.className = `pos-chip ${viz.to ? "active" : "muted"}`;
  fillEventChip(dom.actionReveal, viz.revealed, viz.success === false ? "fail" : "reveal", viz.revealLabel || "翻");
  fillEventChip(dom.actionCaptured, viz.captured, "captured", "入墓");
}

function fillEventChip(el, piece, cls, label) {
  if (!piece) { el.className = "event-chip hidden"; el.innerHTML = ""; return; }
  el.className = `event-chip ${cls}`;
  el.innerHTML = `${label}<span class="event-piece ${piece.color === "red" ? "red-piece" : "black-piece"}">${pieceName(piece)}</span>`;
}

function renderGraveyard() {
  const captured = state.captured || [];
  const humanColor = state.playerColor[HUMAN];
  const aiColor = state.playerColor[AI];

  const leftPieces = humanColor
    ? captured.filter((piece) => piece.color === humanColor)
    : captured.filter((piece) => piece.color === "black");
  const rightPieces = aiColor
    ? captured.filter((piece) => piece.color === aiColor)
    : captured.filter((piece) => piece.color === "red");

  dom.capturedCount.textContent = String(captured.length);
  if (dom.leftGraveTitle) dom.leftGraveTitle.textContent = "您墳墓";
  if (dom.rightGraveTitle) dom.rightGraveTitle.textContent = "AI 墳墓";
  if (dom.leftGraveCount) dom.leftGraveCount.textContent = `${leftPieces.length}/16`;
  if (dom.rightGraveCount) dom.rightGraveCount.textContent = `${rightPieces.length}/16`;

  fillGraveList(dom.redGrave, leftPieces);
  fillGraveList(dom.blackGrave, rightPieces);
}

function fillGraveList(container, pieces) {
  container.innerHTML = "";
  container.classList.remove("empty-note");
  const ordered = [...pieces].reverse();

  for (let i = 0; i < 16; i += 1) {
    const piece = ordered[i] || null;
    const slot = document.createElement("span");
    slot.className = "grave-slot";

    if (!piece) {
      slot.classList.add("empty-slot");
      container.appendChild(slot);
      continue;
    }

    slot.classList.add("filled-slot");
    const chip = document.createElement("span");
    chip.className = `grave-piece ${piece.color === "red" ? "red-piece" : "black-piece"}`;
    if (state.lastCapturedId && piece.id === state.lastCapturedId) chip.classList.add("new-captured");
    chip.textContent = pieceName(piece);
    chip.title = `${colorLabel(piece.color)} ${pieceName(piece)}`;
    slot.appendChild(chip);
    container.appendChild(slot);
  }
}

function setStatus(main, detail = "") { dom.statusText.textContent = main; dom.detailText.textContent = detail; }
function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove("hidden");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.add("hidden"), 1500);
}

async function onCellClick(r, c) {
  if (!state || state.aiThinking || state.locked || state.currentPlayer === AI) return;
  const piece = state.board[r][c];

  if (state.combo.active) {
    const src = { r: state.combo.r, c: state.combo.c };
    if (r === src.r && c === src.c) { showToast("連吃中，只能點可食用目標，或結束回合。"); return; }
    if (!piece) { showToast("連吃中不能移動到空格。"); return; }
    state.selected = src;
    render();
    await tryMoveOrCapture(src, { r, c });
    return;
  }

  if (!piece) {
    if (state.selected) await tryMoveOrCapture(state.selected, { r, c });
    return;
  }

  if (!piece.faceUp) {
    if (state.selected) {
      await tryMoveOrCapture(state.selected, { r, c });
      return;
    }
    const result = await performVisibleAction(["flip", r, c], HUMAN, { preview: false });
    if (state.turnColor === null) {
      state.playerColor[HUMAN] = piece.color;
      state.playerColor[AI] = opponentColor(piece.color);
      state.turnColor = state.playerColor[HUMAN];
    }
    if (!result.invalid) endTurn();
    return;
  }

  if (state.turnColor === null) { showToast("請先翻棋。"); return; }

  if (piece.color === state.turnColor) {
    if (state.selected && state.selected.r === r && state.selected.c === c) state.selected = null;
    else state.selected = { r, c };
    render();
    return;
  }

  if (state.selected) await tryMoveOrCapture(state.selected, { r, c });
  else showToast("請先選取自己的明棋。");
}

async function tryMoveOrCapture(src, dst) {
  const moving = state.board[src.r][src.c];
  const target = state.board[dst.r][dst.c];
  const inCombo = state.combo.active;

  if (!moving || !moving.faceUp) { state.selected = null; state.combo = { active: false, r: null, c: null }; showToast("來源無效，請重新選棋。"); render(); return; }
  if (moving.color !== state.turnColor) { state.selected = null; showToast("只能操作目前輪到的顏色。"); render(); return; }
  if (inCombo && (src.r !== state.combo.r || src.c !== state.combo.c)) { state.selected = { r: state.combo.r, c: state.combo.c }; showToast("連吃中不能換棋。"); render(); return; }

  if (!target) {
    if (inCombo) { showToast("連吃給的是食用機會，不能移動到空格。"); return; }
    if (!canMoveToEmpty(state.board, src, dst)) { showToast("一般移動只能上下左右一格。"); return; }
    const action = ["move", src.r, src.c, dst.r, dst.c];
    const policy = evaluateHumanOpeningPolicy(state.board, action);
    if (policy.forbidden) {
      rejectHumanPerpetualChase();
      return;
    }
    const result = await performVisibleAction(action, HUMAN);
    afterHumanAction(result);
    return;
  }

  if (!target.faceUp) {
    if (!isComboRuleEnabled()) { showToast("目前不能直接吃暗棋。"); return; }
    if (!canAttemptHiddenCapturePath(state.board, src, dst)) {
      showToast(moving.kind === "C" ? "炮／包食用必須跳吃。" : "一般棋只能食用相鄰暗棋。");
      return;
    }
    const result = await performVisibleAction(["darkCapture", src.r, src.c, dst.r, dst.c], HUMAN);
    afterHumanAction(result);
    return;
  }

  if (target.color === moving.color) { showToast("不能吃自己的棋。"); return; }
  if (!canCapture(state.board, src, dst)) { showToast("這顆棋不能這樣吃。"); return; }
  const result = await performVisibleAction(["capture", src.r, src.c, dst.r, dst.c], HUMAN);
  afterHumanAction(result);
}

function afterHumanAction(result) {
  const winner = checkWinner(state.board);
  if (winner !== null) { state.combo = { active: false, r: null, c: null }; state.selected = null; render(); showWinner(winner); return; }

  if (isComboRuleEnabled() && result.successCapture && result.lastMove) {
    const pos = { r: result.lastMove.r, c: result.lastMove.c };
    state.combo = { active: true, r: pos.r, c: pos.c };
    state.selected = pos;
    if (hasCaptureOpportunityFrom(state.board, state.turnColor, pos, { includeDark: true })) {
      setStatus("可連吃", "");
      render();
      return;
    }
  }
  state.combo = { active: false, r: null, c: null };
  state.selected = null;
  endTurn();
}

function endTurn() {
  state.selected = null;
  state.combo = { active: false, r: null, c: null };
  if (state.turnColor === null) { render(); setStatus("請先翻棋", ""); return; }

  const finishedPlayer = state.currentPlayer;
  const nextPlayer = finishedPlayer === HUMAN ? AI : HUMAN;
  const nextColor = state.playerColor[nextPlayer];
  finalizeTurnHistory(finishedPlayer, nextColor);

  state.currentPlayer = nextPlayer;
  state.turnColor = nextColor;
  render();

  if (!hasAnyAllowedOpeningAction(state.board, state.currentPlayer, state.turnColor)) {
    const winnerPlayer = state.currentPlayer === HUMAN ? AI : HUMAN;
    state.locked = true;
    render();
    if (state.currentPlayer === HUMAN && hasAnyAction(state.board, state.turnColor)) {
      showToast("禁止長追");
      showModal("禁止長追", "您沒有其他可行動作，依規則判負。AI 獲勝。");
    } else {
      showModal("遊戲結束", winnerPlayer === HUMAN ? "您獲勝。" : "AI 獲勝。");
    }
    return;
  }

  if (state.currentPlayer === AI) {
    state.aiThinking = true;
    setStatus("AI 搜尋勝負中", "");
    render();
    window.setTimeout(aiMove, 40);
  } else {
    state.aiThinking = false;
    setStatus("輪到您", "");
    render();
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

  const action = findBestAction(cloneBoard(state.board), aiColor, humanColor, diff, {
    includeDarkCaptures: comboEnabled,
    captured: cloneCaptured(state.captured),
  });
  if (!action) {
    state.aiThinking = false;
    state.locked = true;
    state.pendingAction = null;
    render();
    showModal("遊戲結束", "您獲勝。");
    return;
  }

  let result = await performVisibleAction(action, AI, { runId });
  if (!isAiRunActive(runId)) return;
  let winner = checkWinner(state.board);
  if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }

  if (comboEnabled && result.successCapture && result.lastMove) {
    let pos = { r: result.lastMove.r, c: result.lastMove.c };
    let guard = 0;
    while (guard < MAX_COMBO_STEPS) {
      guard += 1;
      const comboChoice = chooseBestComboAction(state.board, aiColor, humanColor, pos, diff);
      if (!comboChoice) break;
      result = await performVisibleAction(comboChoice.action, AI, { runId, combo: true });
      if (!isAiRunActive(runId)) return;
      winner = checkWinner(state.board);
      if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }
      if (!result.successCapture || !result.lastMove) break;
      pos = { r: result.lastMove.r, c: result.lastMove.c };
    }
  }

  state.pendingAction = null;
  state.aiThinking = false;
  endTurn();
}
function isAiRunActive(runId) { return Boolean(state && state.aiThinking && state.currentPlayer === AI && runId === aiRunId); }

async function performVisibleAction(action, actor, options = {}) {
  if (!state || !action) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "invalid" };
  const historyMeta = captureActionHistoryMeta(state.board, action);
  state.locked = true;
  state.pendingAction = action;
  state.actionViz = buildActionViz(actor, action, null, "preview");
  state.actionViz.pulse = true;
  render();
  await sleep(actor === AI ? loadAiDelayMs() : 150);
  if (actor === AI && options.runId && !isAiRunActive(options.runId)) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "cancelled" };

  if (action[0] === "darkCapture") {
    const result = await performVisibleDarkCapture(action, actor, options);
    recordTurnAction(actor, action, result, historyMeta);
    state.pendingAction = null;
    state.locked = false;
    render();
    return result;
  }

  const result = applyAction(state.board, action);
  if (result.captured) {
    const captured = { ...result.captured, faceUp: true };
    state.captured.push(captured);
    state.lastCapturedId = captured.id || null;
    result.captured = captured;
  }
  state.lastMove = result.lastMove ? { kind: action[0], ...result.lastMove } : actionDestination(action);
  recordTurnAction(actor, action, result, historyMeta);
  state.actionViz = buildActionViz(actor, action, result, "done");
  await playAnimation(action, result, actorDelay(actor, 0.72));
  state.pendingAction = null;
  state.locked = false;
  render();
  return result;
}

async function performVisibleDarkCapture(action, actor, options = {}) {
  const [, sr, sc, dr, dc] = action;
  const src = { r: sr, c: sc };
  const dst = { r: dr, c: dc };
  if (!canAttemptHiddenCapturePath(state.board, src, dst)) {
    const invalid = { type: "darkCapture", successCapture: false, captured: null, lastMove: null, invalid: true };
    state.actionViz = buildActionViz(actor, action, invalid, "fail");
    await playAnimation(action, invalid, actorDelay(actor, 0.5));
    return invalid;
  }

  const target = state.board[dr][dc];
  if (target) target.faceUp = true;
  const revealed = target ? { ...target, faceUp: true } : null;
  const revealResult = { type: "darkCapture", phase: "reveal", successCapture: false, captured: null, revealed, lastMove: { r: dr, c: dc }, invalid: false };
  state.lastMove = { kind: "darkReveal", r: dr, c: dc };
  state.actionViz = buildActionViz(actor, action, revealResult, "reveal");
  await playAnimation(["flip", dr, dc], revealResult, actorDelay(actor, actor === AI ? 0.95 : 1.05));
  if (actor === AI && options.runId && !isAiRunActive(options.runId)) return revealResult;

  if (canCapture(state.board, src, dst)) {
    const captured = state.board[dr][dc] ? { ...state.board[dr][dc], faceUp: true } : null;
    state.board[dr][dc] = state.board[sr][sc];
    state.board[sr][sc] = null;
    if (captured) {
      state.captured.push(captured);
      state.lastCapturedId = captured.id || null;
    }
    const result = { type: "darkCapture", successCapture: true, captured, revealed, lastMove: { r: dr, c: dc }, invalid: false };
    state.lastMove = { kind: "darkCapture", r: dr, c: dc };
    state.actionViz = buildActionViz(actor, action, result, "done");
    await playAnimation(action, result, actorDelay(actor, 0.72));
    return result;
  }

  const fail = { type: "darkCapture", successCapture: false, captured: null, revealed, lastMove: { r: dr, c: dc }, invalid: false };
  state.lastMove = { kind: "darkCaptureFail", r: dr, c: dc };
  state.actionViz = buildActionViz(actor, action, fail, "fail");
  await playAnimation(action, fail, actorDelay(actor, 0.8));
  return fail;
}

async function playAnimation(action, result, duration) {
  const id = `${Date.now()}-${Math.random()}`;
  state.animation = { id, action: [...action], result: result ? { ...result, revealed: result.revealed ? { ...result.revealed } : null, captured: result.captured ? { ...result.captured } : null } : null };
  render();
  await sleep(duration);
  if (state && state.animation && state.animation.id === id) state.animation = null;
  if (state && state.actionViz) state.actionViz.pulse = false;
  render();
}

function buildActionViz(actor, action, result = null, phase = "preview") {
  const kind = action[0];
  const from = actionSource(action);
  const to = actionDestination(action);
  let kindLabel = "行動";
  if (kind === "flip") kindLabel = phase === "preview" ? "翻" : "翻開";
  if (kind === "move") kindLabel = phase === "preview" ? "移" : "移動";
  if (kind === "capture") kindLabel = phase === "preview" ? "吃" : "食用";
  if (kind === "darkCapture") kindLabel = phase === "reveal" ? "翻暗棋" : phase === "fail" ? "失敗" : phase === "preview" ? "探暗棋" : "食用";
  let revealed = result && result.revealed ? result.revealed : null;
  if (!revealed && kind === "flip" && to && state.board[to.r] && state.board[to.r][to.c]) {
    revealed = state.board[to.r][to.c];
  }
  if (!revealed && phase === "fail" && to && state.board[to.r] && state.board[to.r][to.c]) {
    revealed = state.board[to.r][to.c];
  }

  return {
    actor,
    kindLabel,
    from,
    to,
    revealed,
    revealLabel: "翻出",
    captured: result && result.captured ? result.captured : null,
    success: result ? result.successCapture : null,
    pulse: true,
  };
}

function actionSource(action) { if (!action) return null; if (["move", "capture", "darkCapture"].includes(action[0])) return { r: action[1], c: action[2] }; return null; }
function actionDestination(action) { if (!action) return null; if (action[0] === "flip") return { r: action[1], c: action[2] }; if (["move", "capture", "darkCapture"].includes(action[0])) return { r: action[3], c: action[4] }; return null; }

function generateActions(board, color, options = {}) {
  const includeFlips = options.includeFlips !== false;
  const includeMoves = options.includeMoves !== false;
  const includeCaptures = options.includeCaptures !== false;
  const includeDarkCaptures = Boolean(options.includeDarkCaptures);
  const actions = [];
  if (includeFlips) {
    for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) if (board[r][c] && !board[r][c].faceUp) actions.push(["flip", r, c]);
  }
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (!piece || !piece.faceUp || piece.color !== color) continue;
      if (includeMoves) for (const nb of neighbors(r, c)) if (board[nb.r][nb.c] === null) actions.push(["move", r, c, nb.r, nb.c]);
      if (includeCaptures || includeDarkCaptures) {
        for (const action of generateCaptureActionsFrom(board, color, { r, c }, { includeDark: includeDarkCaptures })) {
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
        if (includeDark && canAttemptHiddenCapturePath(board, src, dst)) actions.push(["darkCapture", src.r, src.c, rr, cc]);
        continue;
      }
      if (target.color !== color && canCapture(board, src, dst)) actions.push(["capture", src.r, src.c, rr, cc]);
    }
  }
  return actions;
}

function hasCaptureOpportunityFrom(board, color, src, options = {}) { return generateCaptureActionsFrom(board, color, src, options).length > 0; }
function generateNonFlipActions(board, color) { return generateActions(board, color, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: false }); }
function cloneCaptured(captured) { return (captured || []).map((piece) => ({ ...piece, faceUp: true })); }

function r21MasterUsesOmniscience(diff) {
  return Boolean(diff && diff.depth >= DIFFICULTIES.master.depth);
}

function r21OmniscientActionScore(board, captured, action, aiColor, humanColor, diff) {
  const nextBoard = cloneBoard(board);
  const nextCaptured = cloneCaptured(captured);
  const result = applyAction(nextBoard, action);
  if (result.invalid) return -Infinity;
  if (result.captured) nextCaptured.push({ ...result.captured, faceUp: true });

  const winner = checkWinner(nextBoard);
  if (winner === aiColor) return SEARCH_MATE;
  if (winner === humanColor) return -SEARCH_MATE;

  let score = evaluateBoard(nextBoard, nextCaptured, aiColor, humanColor, diff);
  if (result.successCapture && result.lastMove) {
    score += r20BestKnownComboRoute(nextBoard, nextCaptured, aiColor, result.lastMove, 9, new Map()) * 4.0;
  }
  score -= r20BestImmediateKnownCapture(nextBoard, nextCaptured, humanColor) * 2.0;
  score += r20BestImmediateKnownCapture(nextBoard, nextCaptured, aiColor) * 0.45;

  if (action[0] === "flip") {
    const piece = nextBoard[action[1]][action[2]];
    if (piece) score += (piece.color === aiColor ? SEARCH_VALUE[piece.kind] : -SEARCH_VALUE[piece.kind]) * 1.5;
  }
  if (action[0] === "darkCapture" && !result.successCapture) score -= 280;
  return score;
}

function r21FairActionScore(board, captured, action, aiColor, humanColor, diff) {
  let score = searchActionOrderingScore(board, captured, action, aiColor, aiColor, humanColor, diff);
  if (action[0] === "capture") {
    const nextBoard = cloneBoard(board);
    const nextCaptured = cloneCaptured(captured);
    const result = applyAction(nextBoard, action);
    if (result.captured) nextCaptured.push({ ...result.captured, faceUp: true });
    if (result.successCapture && result.lastMove) {
      score += r20BestKnownComboRoute(nextBoard, nextCaptured, aiColor, result.lastMove, Math.max(2, diff.depth), new Map()) * 2.65;
    }
    score -= r20BestImmediateKnownCapture(nextBoard, nextCaptured, humanColor) * 1.25;
  } else if (action[0] === "move") {
    const nextBoard = cloneBoard(board);
    const nextCaptured = cloneCaptured(captured);
    applyAction(nextBoard, action);
    score -= r20BestImmediateKnownCapture(nextBoard, nextCaptured, humanColor) * 1.10;
    score += r20BestImmediateKnownCapture(nextBoard, nextCaptured, aiColor) * 0.20;
  } else if (action[0] === "flip") {
    score *= 0.85;
  }
  return score;
}

function findBestAction(board, aiColor, humanColor, diff, options = {}) {
  const captured = cloneCaptured(options.captured || (state ? state.captured : []));
  const actions = generateAllowedOpeningActions(board, AI, aiColor);
  if (actions.length === 0) return null;

  const omniscient = r21MasterUsesOmniscience(diff);
  let bestAction = null;
  let bestScore = -Infinity;
  for (const action of actions) {
    const score = omniscient
      ? r21OmniscientActionScore(board, captured, action, aiColor, humanColor, diff)
      : r21FairActionScore(board, captured, action, aiColor, humanColor, diff);
    if (score > bestScore) { bestScore = score; bestAction = action; }
  }
  if (state && bestAction) state.aiSearchInfo = { depth: omniscient ? 9 : 2, score: bestScore, nodes: actions.length, action: [...bestAction], omniscient };
  return bestAction;
}

function r20ExpectedFlipSafety(board, captured, r, c, aiColor, humanColor, diff) {
  const pool = getUnseenPool(board, captured);
  if (pool.total <= 0) return 0;
  const outcomes = getUnseenOutcomes(pool, 14);
  const before = evaluateBoard(board, captured, aiColor, humanColor, diff);
  let expected = 0;

  for (const outcome of outcomes) {
    const nextBoard = cloneBoard(board);
    const hiddenId = nextBoard[r][c] ? nextBoard[r][c].id : `r20-flip-${r}-${c}`;
    nextBoard[r][c] = { color: outcome.color, kind: outcome.kind, faceUp: true, id: hiddenId };
    const after = evaluateBoard(nextBoard, captured, aiColor, humanColor, diff);
    const opponentHit = r20BestImmediateKnownCapture(nextBoard, captured, humanColor);
    const ownHit = r20BestImmediateKnownCapture(nextBoard, captured, aiColor);
    expected += outcome.probability * ((after - before) * 0.75 - opponentHit * 1.80 + ownHit * 0.38);
  }
  return expected;
}

function r20BestKnownComboRoute(board, captured, actorColor, pos, depth, memo) {
  if (!pos || depth <= 0) return 0;
  const key = `${visiblePositionKey(board, actorColor)}|${capturedCountKey(captured)}|${pos.r},${pos.c}|${depth}`;
  if (memo.has(key)) return memo.get(key);

  let best = 0;
  const actions = generateCaptureActionsFrom(board, actorColor, pos, { includeDark: false });
  for (const action of actions) {
    const defender = board[action[3]][action[4]];
    if (!defender) continue;
    const nextBoard = cloneBoard(board);
    const nextCaptured = cloneCaptured(captured);
    const result = applyAction(nextBoard, action);
    if (!result.successCapture || !result.lastMove) continue;
    nextCaptured.push({ ...result.captured, faceUp: true });

    const winner = checkSearchWinner(nextCaptured);
    if (winner === actorColor) {
      memo.set(key, SEARCH_MATE / 5);
      return SEARCH_MATE / 5;
    }

    const future = r20BestKnownComboRoute(nextBoard, nextCaptured, actorColor, result.lastMove, depth - 1, memo);
    const finalRisk = maxSquareRisk(nextBoard, result.lastMove.r, result.lastMove.c, actorColor);
    const score = SEARCH_VALUE[defender.kind] + future * 0.96 - finalRisk * 0.42;
    if (score > best) best = score;
  }
  memo.set(key, best);
  return best;
}

function r20BestImmediateKnownCapture(board, captured, actorColor) {
  let best = 0;
  const actions = generateActions(board, actorColor, {
    includeFlips: false,
    includeMoves: false,
    includeCaptures: true,
    includeDarkCaptures: false,
  });
  for (const action of actions) {
    const defender = board[action[3]][action[4]];
    if (!defender) continue;
    const nextBoard = cloneBoard(board);
    const result = applyAction(nextBoard, action);
    const finalRisk = result.lastMove ? maxSquareRisk(nextBoard, result.lastMove.r, result.lastMove.c, actorColor) : 0;
    best = Math.max(best, SEARCH_VALUE[defender.kind] * 1.35 - finalRisk * 0.70);
  }
  return best;
}

function createSearchContext(diff, aiColor, humanColor, comboEnabled, deadline) {
  const actualCounts = new Map();
  if (state && state.positionCounts) {
    for (const [key, value] of Object.entries(state.positionCounts)) actualCounts.set(key, value);
  }
  return {
    diff,
    aiColor,
    humanColor,
    comboEnabled,
    deadline,
    nodes: 0,
    transposition: new Map(),
    pathCounts: new Map(),
    actualCounts,
  };
}

function nowMs() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }

function touchSearchNode(ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 127) === 0 && nowMs() >= ctx.deadline) throw SEARCH_TIMEOUT;
}

function searchRootActions(board, captured, candidates, depth, ctx) {
  let bestAction = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const row of candidates) {
    touchSearchNode(ctx);
    const basePenalty = row.policy.penalty || 0;
    const value = evaluateSearchAction(board, captured, row.action, depth, ctx.aiColor, null, 0, alpha, beta, ctx, true) - basePenalty;
    if (value > bestScore) { bestScore = value; bestAction = row.action; }
    alpha = Math.max(alpha, value);
  }

  return { action: bestAction, score: bestScore };
}

function searchPosition(board, captured, depth, currentColor, comboPos, comboSteps, alpha, beta, ctx) {
  touchSearchNode(ctx);
  const winner = checkSearchWinner(captured);
  if (winner === ctx.aiColor) return SEARCH_MATE + depth * 10_000 - comboSteps;
  if (winner === ctx.humanColor) return -SEARCH_MATE - depth * 10_000 + comboSteps;

  if (!comboPos && depth <= 0) return evaluateBoard(board, captured, ctx.aiColor, ctx.humanColor, ctx.diff);
  if (comboSteps >= MAX_COMBO_STEPS) return finishSearchTurn(board, captured, depth, currentColor, alpha, beta, ctx);

  const cacheKey = searchCacheKey(board, captured, depth, currentColor, comboPos, comboSteps);
  const useCache = ctx.pathCounts.size === 0;
  const cached = useCache ? ctx.transposition.get(cacheKey) : undefined;
  if (cached !== undefined) return cached;

  const maximizing = currentColor === ctx.aiColor;
  let actions;
  let best;
  let exact = true;

  if (comboPos) {
    actions = prepareSearchActions(board, captured, currentColor, ctx.aiColor, ctx.humanColor, ctx.diff, ctx.comboEnabled, comboPos, false);
    best = finishSearchTurn(board, captured, depth, currentColor, alpha, beta, ctx);
    if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
  } else {
    actions = prepareSearchActions(board, captured, currentColor, ctx.aiColor, ctx.humanColor, ctx.diff, ctx.comboEnabled, null, false);
    if (actions.length === 0) return currentColor === ctx.aiColor ? -SEARCH_MATE + depth : SEARCH_MATE - depth;
    best = maximizing ? -Infinity : Infinity;
  }

  for (const action of actions) {
    const value = evaluateSearchAction(board, captured, action, depth, currentColor, comboPos, comboSteps, alpha, beta, ctx, false);
    if (maximizing) {
      if (value > best) best = value;
      alpha = Math.max(alpha, best);
    } else {
      if (value < best) best = value;
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) { exact = false; break; }
  }

  if (exact && useCache) ctx.transposition.set(cacheKey, best);
  return best;
}

function evaluateSearchAction(board, captured, action, depth, currentColor, comboPos, comboSteps, alpha, beta, ctx, isRoot) {
  const kind = action[0];
  if (kind === "flip") return evaluateFlipChance(board, captured, action, depth, currentColor, alpha, beta, ctx);
  if (kind === "darkCapture") return evaluateDarkCaptureChance(board, captured, action, depth, currentColor, comboSteps, alpha, beta, ctx);

  const nextBoard = cloneBoard(board);
  const nextCaptured = cloneCaptured(captured);
  const result = applyAction(nextBoard, action);
  if (result.invalid) return currentColor === ctx.aiColor ? -SEARCH_FORBIDDEN : SEARCH_FORBIDDEN;
  if (result.captured) nextCaptured.push({ ...result.captured, faceUp: true });

  if (kind === "capture" && result.successCapture && ctx.comboEnabled && result.lastMove) {
    return searchPosition(nextBoard, nextCaptured, depth, currentColor, { r: result.lastMove.r, c: result.lastMove.c }, comboSteps + 1, alpha, beta, ctx);
  }
  return finishSearchTurn(nextBoard, nextCaptured, depth, currentColor, alpha, beta, ctx);
}

function finishSearchTurn(board, captured, depth, actorColor, alpha, beta, ctx) {
  const nextColor = opponentColor(actorColor);
  const key = visiblePositionKey(board, nextColor);
  const actualCount = ctx.actualCounts.get(key) || 0;
  const pathCount = ctx.pathCounts.get(key) || 0;

  if (actualCount >= REPETITION_LIMIT - 1) {
    return actorColor === ctx.aiColor ? -SEARCH_FORBIDDEN : SEARCH_FORBIDDEN;
  }
  if (pathCount >= 1) {
    return actorColor === ctx.aiColor ? -18_000 : 18_000;
  }

  ctx.pathCounts.set(key, pathCount + 1);
  try {
    return searchPosition(board, captured, depth - 1, nextColor, null, 0, alpha, beta, ctx);
  } finally {
    if (pathCount === 0) ctx.pathCounts.delete(key);
    else ctx.pathCounts.set(key, pathCount);
  }
}

function evaluateFlipChance(board, captured, action, depth, currentColor, alpha, beta, ctx) {
  const [, r, c] = action;
  const pool = getUnseenPool(board, captured);
  if (pool.total <= 0) return currentColor === ctx.aiColor ? -SEARCH_FORBIDDEN : SEARCH_FORBIDDEN;
  const outcomes = getUnseenOutcomes(pool, ctx.diff.chanceLimit);
  let expected = 0;

  for (const outcome of outcomes) {
    const nextBoard = cloneBoard(board);
    nextBoard[r][c] = { color: outcome.color, kind: outcome.kind, faceUp: true, id: `search-${outcome.color}-${outcome.kind}-${r}-${c}` };
    const value = finishSearchTurn(nextBoard, captured, depth, currentColor, alpha, beta, ctx);
    expected += outcome.probability * value;
  }
  const actorBias = strategicFlipBias(board, captured, r, c, currentColor, ctx.diff);
  return expected + (currentColor === ctx.aiColor ? actorBias : -actorBias);
}

function evaluateDarkCaptureChance(board, captured, action, depth, currentColor, comboSteps, alpha, beta, ctx) {
  const [, sr, sc, dr, dc] = action;
  const attacker = board[sr][sc];
  if (!attacker || !canAttemptHiddenCapturePath(board, { r: sr, c: sc }, { r: dr, c: dc })) {
    return currentColor === ctx.aiColor ? -SEARCH_FORBIDDEN : SEARCH_FORBIDDEN;
  }

  const pool = getUnseenPool(board, captured);
  if (pool.total <= 0) return currentColor === ctx.aiColor ? -SEARCH_FORBIDDEN : SEARCH_FORBIDDEN;
  const outcomes = getUnseenOutcomes(pool, ctx.diff.chanceLimit);
  let expected = 0;

  for (const outcome of outcomes) {
    const nextBoard = cloneBoard(board);
    const nextCaptured = cloneCaptured(captured);
    const defender = { color: outcome.color, kind: outcome.kind, faceUp: true, id: `search-${outcome.color}-${outcome.kind}-${dr}-${dc}` };
    nextBoard[dr][dc] = defender;
    let value;

    if (canCapture(nextBoard, { r: sr, c: sc }, { r: dr, c: dc })) {
      nextBoard[dr][dc] = nextBoard[sr][sc];
      nextBoard[sr][sc] = null;
      nextCaptured.push(defender);
      if (ctx.comboEnabled) value = searchPosition(nextBoard, nextCaptured, depth, currentColor, { r: dr, c: dc }, comboSteps + 1, alpha, beta, ctx);
      else value = finishSearchTurn(nextBoard, nextCaptured, depth, currentColor, alpha, beta, ctx);
    } else {
      value = finishSearchTurn(nextBoard, nextCaptured, depth, currentColor, alpha, beta, ctx);
    }
    expected += outcome.probability * value;
  }
  return expected;
}

function getUnseenOutcomes(pool, limit) {
  const outcomes = [];
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count > 0) outcomes.push({ color, kind, count, probability: count / pool.total, importance: count * SEARCH_VALUE[kind] });
    }
  }
  outcomes.sort((a, b) => b.importance - a.importance);
  if (outcomes.length <= limit) return outcomes;
  const kept = outcomes.slice(0, limit);
  const keptProbability = kept.reduce((sum, item) => sum + item.probability, 0) || 1;
  for (const item of kept) item.probability /= keptProbability;
  return kept;
}

function prepareSearchActions(board, captured, currentColor, aiColor, humanColor, diff, comboEnabled, comboPos = null, isRoot = false) {
  let actions;
  if (comboPos) {
    actions = generateCaptureActionsFrom(board, currentColor, comboPos, { includeDark: comboEnabled });
  } else {
    actions = generateActions(board, currentColor, {
      includeFlips: true,
      includeMoves: true,
      includeCaptures: true,
      includeDarkCaptures: comboEnabled,
    });
  }

  const rows = actions.map((action) => ({
    action,
    score: searchActionOrderingScore(board, captured, action, currentColor, aiColor, humanColor, diff),
  }));
  rows.sort((a, b) => b.score !== a.score ? b.score - a.score : a.action.join("-").localeCompare(b.action.join("-")));

  if (comboPos) return rows.slice(0, diff.branchLimit).map((row) => row.action);

  const forced = rows.filter((row) => row.action[0] === "capture");
  const dark = rows.filter((row) => row.action[0] === "darkCapture").slice(0, Math.max(4, Math.floor(diff.branchLimit / 3)));
  const moves = rows.filter((row) => row.action[0] === "move").slice(0, Math.max(5, Math.floor(diff.branchLimit / 2)));
  const flips = rows.filter((row) => row.action[0] === "flip").slice(0, diff.flipLimit);
  const merged = [...forced, ...dark, ...moves, ...flips];
  const unique = [];
  for (const row of merged.sort((a, b) => b.score - a.score)) {
    if (!unique.some((item) => sameAction(item, row.action))) unique.push(row.action);
    if (unique.length >= diff.branchLimit) break;
  }
  return unique;
}

function searchActionOrderingScore(board, captured, action, currentColor, aiColor, humanColor, diff) {
  const kind = action[0];
  if (kind === "capture") {
    const [, sr, sc, dr, dc] = action;
    const attacker = board[sr][sc];
    const defender = board[dr][dc];
    if (!attacker || !defender) return -Infinity;
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);
    const replyRisk = maxSquareRisk(nextBoard, dr, dc, currentColor);
    const winningCapture = checkWinner(nextBoard) === currentColor ? SEARCH_MATE / 10 : 0;
    return winningCapture + SEARCH_VALUE[defender.kind] * 20 - SEARCH_VALUE[attacker.kind] * 0.5 - replyRisk * 5;
  }
  if (kind === "darkCapture") return expectedDarkCaptureOrderingScore(board, captured, action, currentColor, diff);
  if (kind === "move") {
    const [, sr, sc, dr, dc] = action;
    const piece = board[sr][sc];
    if (!piece) return -Infinity;
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);
    const beforeRisk = maxSquareRisk(board, sr, sc, currentColor);
    const afterRisk = maxSquareRisk(nextBoard, dr, dc, currentColor);
    const threat = maxThreatValueFrom(nextBoard, dr, dc, currentColor);
    const mobility = generateCaptureActionsFrom(nextBoard, currentColor, { r: dr, c: dc }, { includeDark: false }).length;
    return (beforeRisk - afterRisk) * 6 + threat * 3 + mobility * 20 - centerDistance(dr, dc) * 2;
  }
  if (kind === "flip") {
    const [, r, c] = action;
    return strategicFlipBias(board, captured, r, c, currentColor, diff);
  }
  return 0;
}

function evaluateBoard(board, captured, aiColor, humanColor, diff) {
  const winner = checkSearchWinner(captured);
  if (winner === aiColor) return SEARCH_MATE;
  if (winner === humanColor) return -SEARCH_MATE;

  const remaining = remainingPieceCounts(captured);
  let score = 0;
  let aiCount = 0;
  let humanCount = 0;
  for (const kind of Object.keys(PIECE_COUNTS)) {
    score += (remaining[aiColor][kind] - remaining[humanColor][kind]) * SEARCH_VALUE[kind];
    aiCount += remaining[aiColor][kind];
    humanCount += remaining[humanColor][kind];
  }
  score += (aiCount - humanCount) * 260;

  let aiRisk = 0;
  let humanRisk = 0;
  let aiThreat = 0;
  let humanThreat = 0;
  let aiActivity = 0;
  let humanActivity = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (!piece || !piece.faceUp) continue;
      const risk = maxSquareRisk(board, r, c, piece.color);
      const threat = maxThreatValueFrom(board, r, c, piece.color);
      const activity = neighbors(r, c).filter((pos) => board[pos.r][pos.c] === null).length * 8 - centerDistance(r, c) * 1.5;
      const pawnKing = piece.kind === "K" ? kingNearEnemyPawnPenalty(board, captured, r, c, piece.color, diff) : 0;
      if (piece.color === aiColor) {
        aiRisk += risk + pawnKing;
        aiThreat += threat;
        aiActivity += activity;
      } else {
        humanRisk += risk + pawnKing;
        humanThreat += threat;
        humanActivity += activity;
      }
    }
  }

  const aiMobility = countKnownMobility(board, aiColor);
  const humanMobility = countKnownMobility(board, humanColor);
  score += (aiThreat - humanThreat) * 0.78;
  score += (humanRisk - aiRisk) * 0.92 * diff.riskTaste;
  score += (aiMobility - humanMobility) * 11;
  score += aiActivity - humanActivity;
  score += forcingCaptureRouteValue(board, aiColor, 3) * 0.42;
  score -= forcingCaptureRouteValue(board, humanColor, 3) * 0.48;
  return score;
}


function checkSearchWinner(captured) {
  const remaining = remainingPieceCounts(captured);
  const redTotal = Object.values(remaining.red).reduce((sum, value) => sum + value, 0);
  const blackTotal = Object.values(remaining.black).reduce((sum, value) => sum + value, 0);
  if (redTotal > 0 && blackTotal > 0) return null;
  if (redTotal > 0) return "red";
  if (blackTotal > 0) return "black";
  return null;
}

function remainingPieceCounts(captured) {
  const counts = {
    red: { ...PIECE_COUNTS },
    black: { ...PIECE_COUNTS },
  };
  for (const piece of captured || []) counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
  return counts;
}

function countKnownMobility(board, color) {
  return generateActions(board, color, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: false }).length;
}

function maxThreatValueFrom(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || !piece.faceUp || piece.color !== color) return 0;
  let best = 0;
  for (let rr = 0; rr < ROWS; rr += 1) {
    for (let cc = 0; cc < COLS; cc += 1) {
      const target = board[rr][cc];
      if (!target || !target.faceUp || target.color === color) continue;
      if (canCapture(board, { r, c }, { r: rr, c: cc })) {
        let value = SEARCH_VALUE[target.kind];
        if (piece.kind === "P" && target.kind === "K") value += 2400;
        best = Math.max(best, value);
      }
    }
  }
  return best;
}

function maxSquareRisk(board, r, c, ownColor) {
  const target = board[r][c];
  if (!target || !target.faceUp || target.color !== ownColor) return 0;
  let worst = 0;
  for (let rr = 0; rr < ROWS; rr += 1) {
    for (let cc = 0; cc < COLS; cc += 1) {
      const attacker = board[rr][cc];
      if (!attacker || !attacker.faceUp || attacker.color === ownColor) continue;
      if (canCapture(board, { r: rr, c: cc }, { r, c })) {
        let value = SEARCH_VALUE[target.kind];
        if (attacker.kind === "P" && target.kind === "K") value += 2400;
        worst = Math.max(worst, value);
      }
    }
  }
  return worst;
}

function forcingCaptureRouteValue(board, color, depth, pos = null) {
  if (depth <= 0) return 0;
  const sources = [];
  if (pos) sources.push(pos);
  else {
    for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && piece.faceUp && piece.color === color) sources.push({ r, c });
    }
  }
  let best = 0;
  for (const src of sources) {
    const actions = generateCaptureActionsFrom(board, color, src, { includeDark: false });
    for (const action of actions) {
      const defender = board[action[3]][action[4]];
      const nextBoard = cloneBoard(board);
      const result = applyAction(nextBoard, action);
      const future = result.lastMove ? forcingCaptureRouteValue(nextBoard, color, depth - 1, result.lastMove) : 0;
      best = Math.max(best, SEARCH_VALUE[defender.kind] + future * 0.8);
    }
  }
  return best;
}

function strategicFlipBias(board, captured, r, c, currentColor, diff) {
  const pool = getUnseenPool(board, captured);
  if (pool.total <= 0) return -SEARCH_FORBIDDEN;
  const enemyColor = opponentColor(currentColor);
  let score = -centerDistance(r, c) * 5;
  const enemyPawnProb = pool.counts[enemyColor].P / pool.total;
  const ownPawnProb = pool.counts[currentColor].P / pool.total;

  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];
    if (!piece || !piece.faceUp) continue;
    if (piece.color === currentColor) {
      score += SEARCH_VALUE[piece.kind] * 0.06;
      if (piece.kind === "K") score -= enemyPawnProb * 1800 * diff.riskTaste;
    } else {
      score -= SEARCH_VALUE[piece.kind] * 0.08;
      if (piece.kind === "K") score += ownPawnProb * 1500;
    }
  }
  return score;
}

function expectedDarkCaptureOrderingScore(board, captured, action, currentColor, diff) {
  const [, sr, sc, dr, dc] = action;
  const attacker = board[sr][sc];
  if (!attacker) return -Infinity;
  const pool = getUnseenPool(board, captured);
  if (pool.total <= 0) return -Infinity;
  let expected = 0;
  let success = 0;
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count <= 0) continue;
      const probability = count / pool.total;
      const defender = { color, kind, faceUp: true };
      if (color !== currentColor && canHypotheticalCapture(board, { r: sr, c: sc }, { r: dr, c: dc }, defender)) {
        success += probability;
        expected += probability * SEARCH_VALUE[kind];
      } else {
        expected -= probability * (color === currentColor ? 160 : SEARCH_VALUE[kind] * 0.35);
      }
    }
  }
  const danger = maxSquareRisk(board, sr, sc, currentColor);
  return expected * 3 + success * 400 - danger * diff.riskTaste;
}

function kingNearEnemyPawnPenalty(board, captured, r, c, color, diff = DIFFICULTIES.normal) {
  let penalty = 0;
  const pool = getUnseenPool(board, captured);
  const enemyColor = opponentColor(color);
  const hiddenEnemyPawnProb = pool.total ? pool.counts[enemyColor].P / pool.total : 0;
  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];
    if (!piece) continue;
    if (!piece.faceUp) penalty += hiddenEnemyPawnProb * 1250 * diff.riskTaste;
    else if (piece.color !== color && piece.kind === "P") penalty += 4200;
  }
  return penalty;
}

function centerDistance(r, c) {
  return Math.abs(r - (ROWS - 1) / 2) + Math.abs(c - (COLS - 1) / 2);
}

function searchCacheKey(board, captured, depth, currentColor, comboPos, comboSteps) {
  const capturedKey = capturedCountKey(captured);
  const comboKey = comboPos ? `${comboPos.r},${comboPos.c},${comboSteps}` : "-";
  return `${visiblePositionKey(board, currentColor)}|${capturedKey}|${depth}|${comboKey}`;
}

function capturedCountKey(captured) {
  const counts = { red: { K: 0, A: 0, E: 0, R: 0, N: 0, C: 0, P: 0 }, black: { K: 0, A: 0, E: 0, R: 0, N: 0, C: 0, P: 0 } };
  for (const piece of captured || []) counts[piece.color][piece.kind] += 1;
  return ["red", "black"].map((color) => Object.keys(PIECE_COUNTS).map((kind) => counts[color][kind]).join("")).join("/");
}

function chooseBestComboAction(board, aiColor, humanColor, pos, diff) {
  const captured = cloneCaptured(state ? state.captured : []);
  const actions = generateCaptureActionsFrom(board, aiColor, pos, { includeDark: true });
  if (actions.length === 0) return null;
  const omniscient = r21MasterUsesOmniscience(diff);
  let bestAction = null;
  let bestScore = omniscient ? 0 : 40;
  for (const action of actions) {
    const score = omniscient
      ? r21OmniscientActionScore(board, captured, action, aiColor, humanColor, diff)
      : r21FairActionScore(board, captured, action, aiColor, humanColor, diff);
    if (score > bestScore) { bestScore = score; bestAction = action; }
  }
  return bestAction ? { action: bestAction, score: bestScore } : null;
}

function visiblePositionKey(board, nextColor) {
  const cells = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (!piece) cells.push(".");
      else if (!piece.faceUp) cells.push("D");
      else cells.push(`${piece.color === "red" ? "r" : "b"}${piece.kind}`);
    }
  }
  return `${nextColor || "none"}|${cells.join(",")}`;
}

function captureActionHistoryMeta(board, action) {
  const src = actionSource(action);
  const dst = actionDestination(action);
  const attacker = src && board[src.r] ? board[src.r][src.c] : null;
  const target = dst && board[dst.r] ? board[dst.r][dst.c] : null;
  return {
    source: src ? { ...src } : null,
    destination: dst ? { ...dst } : null,
    movedPieceId: attacker ? attacker.id : null,
    targetPieceId: target ? target.id : null,
  };
}

function recordTurnAction(actor, action, result, meta) {
  if (!state || !result || result.invalid) return;
  if (!Array.isArray(state.turnActions)) state.turnActions = [];
  state.turnActions.push({
    actor,
    kind: action[0],
    action: [...action],
    source: meta && meta.source ? { ...meta.source } : null,
    destination: meta && meta.destination ? { ...meta.destination } : actionDestination(action),
    movedPieceId: meta ? meta.movedPieceId : null,
    targetPieceId: meta ? meta.targetPieceId : null,
    successCapture: Boolean(result.successCapture),
    capturedId: result.captured ? result.captured.id : null,
  });
}

function finalizeTurnHistory(actor, nextColor) {
  if (!state) return;
  const actions = Array.isArray(state.turnActions) ? state.turnActions : [];
  const key = visiblePositionKey(state.board, nextColor);

  if (actions.length > 0) {
    const moveActions = actions.filter((item) => item.movedPieceId);
    const firstMove = moveActions[0] || null;
    const lastMove = moveActions.length > 0 ? moveActions[moveActions.length - 1] : null;
    const movedPieceId = lastMove ? lastMove.movedPieceId : null;
    const finalPos = movedPieceId ? findPiecePositionById(state.board, movedPieceId) : null;
    const chaseTargetIds = movedPieceId && finalPos ? threatenedEnemyIdsFrom(state.board, finalPos, state.playerColor[actor]) : [];
    const record = {
      actor,
      color: state.playerColor[actor],
      actions: actions.map((item) => ({ ...item, action: [...item.action] })),
      movedPieceId,
      from: firstMove && firstMove.source ? { ...firstMove.source } : null,
      to: finalPos ? { ...finalPos } : lastMove && lastMove.destination ? { ...lastMove.destination } : null,
      hadCapture: actions.some((item) => item.successCapture),
      hadFlip: actions.some((item) => item.kind === "flip" || item.kind === "darkCapture"),
      chaseTargetIds,
      positionKey: key,
    };
    state.turnHistory.push(record);
    if (state.turnHistory.length > MAX_TURN_HISTORY) state.turnHistory.splice(0, state.turnHistory.length - MAX_TURN_HISTORY);
  }

  state.positionHistory.push(key);
  if (state.positionHistory.length > MAX_TURN_HISTORY) state.positionHistory.splice(0, state.positionHistory.length - MAX_TURN_HISTORY);
  state.positionCounts[key] = (state.positionCounts[key] || 0) + 1;
  state.turnActions = [];
}

function findPiecePositionById(board, id) {
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    if (board[r][c] && board[r][c].id === id) return { r, c };
  }
  return null;
}

function threatenedEnemyIdsFrom(board, pos, color) {
  const ids = [];
  const attacker = board[pos.r][pos.c];
  if (!attacker || !attacker.faceUp || attacker.color !== color) return ids;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const target = board[r][c];
    if (!target || !target.faceUp || target.color === color) continue;
    if (canCapture(board, pos, { r, c }) && target.id) ids.push(target.id);
  }
  return ids;
}

function evaluateOpeningPolicy(board, action, actor, actorColor, nextColor) {
  if (!state) return { forbidden: false, penalty: 0, reason: "" };
  if (action[0] !== "move") return { forbidden: false, penalty: 0, reason: "" };

  const [, sr, sc, dr, dc] = action;
  const attacker = board[sr] ? board[sr][sc] : null;
  if (!attacker || !attacker.faceUp || attacker.color !== actorColor) {
    return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "invalid" };
  }

  const nextBoard = cloneBoard(board);
  const result = applyAction(nextBoard, action);
  if (result.invalid) return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "invalid" };

  const nextKey = visiblePositionKey(nextBoard, nextColor);
  const count = state.positionCounts && state.positionCounts[nextKey] ? state.positionCounts[nextKey] : 0;
  if (count >= REPETITION_LIMIT - 1) {
    return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "third-repetition" };
  }

  const history = Array.isArray(state.turnHistory)
    ? state.turnHistory.filter((item) => item.actor === actor)
    : [];
  const lastTurn = history.length ? history[history.length - 1] : null;
  const secondLastTurn = history.length > 1 ? history[history.length - 2] : null;
  const recentSameActorPosition = state.positionHistory && state.positionHistory.length >= 2
    ? state.positionHistory[state.positionHistory.length - 2]
    : null;

  if (recentSameActorPosition === nextKey) {
    return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "two-position-loop" };
  }

  const reversesLastMove = Boolean(
    lastTurn
    && lastTurn.movedPieceId === attacker.id
    && lastTurn.from
    && lastTurn.to
    && lastTurn.from.r === dr
    && lastTurn.from.c === dc
    && lastTurn.to.r === sr
    && lastTurn.to.c === sc
  );
  const repeatsOscillation = Boolean(
    reversesLastMove
    && secondLastTurn
    && !lastTurn.hadCapture
    && !secondLastTurn.hadCapture
    && lastTurn.movedPieceId === attacker.id
    && secondLastTurn.movedPieceId === attacker.id
    && secondLastTurn.from
    && secondLastTurn.to
    && secondLastTurn.from.r === sr
    && secondLastTurn.from.c === sc
    && secondLastTurn.to.r === dr
    && secondLastTurn.to.c === dc
  );
  if (repeatsOscillation) {
    return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "repeated-backtrack" };
  }

  const chaseIds = threatenedEnemyIdsFrom(nextBoard, { r: dr, c: dc }, actorColor);
  if (lastTurn && secondLastTurn && !lastTurn.hadCapture && !secondLastTurn.hadCapture
      && lastTurn.movedPieceId === attacker.id && secondLastTurn.movedPieceId === attacker.id) {
    const repeatedTarget = chaseIds.some((id) => lastTurn.chaseTargetIds.includes(id) && secondLastTurn.chaseTargetIds.includes(id));
    if (repeatedTarget) {
      return { forbidden: true, penalty: SEARCH_FORBIDDEN, reason: "perpetual-chase" };
    }
  }

  let penalty = count * 9000;
  if (reversesLastMove) penalty += 3200;
  if (lastTurn && lastTurn.to && lastTurn.to.r === dr && lastTurn.to.c === dc) penalty += 1200;
  if (chaseIds.length > 0 && lastTurn && chaseIds.some((id) => lastTurn.chaseTargetIds.includes(id))) penalty += 2800;
  return { forbidden: false, penalty, reason: "" };
}

function evaluateAiOpeningPolicy(board, action, aiColor, humanColor) {
  return evaluateOpeningPolicy(board, action, AI, aiColor, humanColor);
}

function evaluateHumanOpeningPolicy(board, action) {
  if (!state || !state.playerColor[HUMAN] || !state.playerColor[AI]) {
    return { forbidden: false, penalty: 0, reason: "" };
  }
  return evaluateOpeningPolicy(board, action, HUMAN, state.playerColor[HUMAN], state.playerColor[AI]);
}

function generateAllowedOpeningActions(board, actor, color) {
  if (!color) return [];
  const opponentActor = actor === HUMAN ? AI : HUMAN;
  const nextColor = state && state.playerColor[opponentActor]
    ? state.playerColor[opponentActor]
    : opponentColor(color);
  const actions = generateActions(board, color, {
    includeFlips: true,
    includeMoves: true,
    includeCaptures: true,
    includeDarkCaptures: isComboRuleEnabled(),
  });
  return actions.filter((action) => !evaluateOpeningPolicy(board, action, actor, color, nextColor).forbidden);
}

function hasAnyAllowedOpeningAction(board, actor, color) {
  return generateAllowedOpeningActions(board, actor, color).length > 0;
}

function rejectHumanPerpetualChase() {
  if (!state) return;
  state.selected = null;
  showToast("禁止長追");
  render();

  if (!hasAnyAllowedOpeningAction(state.board, HUMAN, state.playerColor[HUMAN])) {
    state.locked = true;
    render();
    showModal("禁止長追", "您沒有其他可行動作，依規則判負。AI 獲勝。");
  }
}
function getUnseenPool(board, captured = state ? state.captured : []) {
  const counts = { red: { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 }, black: { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 } };
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (piece && piece.faceUp) counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
  }
  for (const piece of captured || []) counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
  let total = 0;
  for (const color of ["red", "black"]) for (const kind of Object.keys(PIECE_COUNTS)) total += counts[color][kind];
  return { counts, total };
}

function checkWinnerForSearch(board) { for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) if (board[r][c] && !board[r][c].faceUp) return null; return checkWinner(board); }

function canAttemptHiddenCapturePath(board, src, dst) {
  const attacker = board[src.r][src.c], target = board[dst.r][dst.c];
  if (!attacker || !attacker.faceUp || !target || target.faceUp) return false;
  if (attacker.kind === "C") return canCannonPath(board, src, dst);
  return Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) === 1;
}

function canHypotheticalCapture(board, src, dst, hypotheticalDefender) {
  const attacker = board[src.r][src.c];
  if (!attacker || !attacker.faceUp || attacker.color === hypotheticalDefender.color) return false;
  if (attacker.kind === "C") return canCannonPath(board, src, dst);
  if (Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) !== 1) return false;
  return canNormalPieceCapture(attacker, hypotheticalDefender);
}

function canCannonPath(board, src, dst) {
  if (src.r !== dst.r && src.c !== dst.c) return false;
  let countBetween = 0;
  if (src.r === dst.r) {
    const step = dst.c > src.c ? 1 : -1;
    for (let c = src.c + step; c !== dst.c; c += step) if (board[src.r][c] !== null) countBetween += 1;
  } else {
    const step = dst.r > src.r ? 1 : -1;
    for (let r = src.r + step; r !== dst.r; r += step) if (board[r][src.c] !== null) countBetween += 1;
  }
  return countBetween === 1;
}

function canMoveToEmpty(board, src, dst) { return Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) === 1; }
function canCapture(board, src, dst) {
  const attacker = board[src.r][src.c], defender = board[dst.r][dst.c];
  if (!attacker || !defender || !attacker.faceUp || !defender.faceUp || attacker.color === defender.color) return false;
  if (attacker.kind === "C") return canCannonCapture(board, src, dst);
  if (Math.abs(src.r - dst.r) + Math.abs(src.c - dst.c) !== 1) return false;
  return canNormalPieceCapture(attacker, defender);
}
function canCannonCapture(board, src, dst) { return canCannonPath(board, src, dst); }
function canNormalPieceCapture(attacker, defender) { if (attacker.kind === "K" && defender.kind === "P") return false; if (attacker.kind === "P" && defender.kind === "K") return true; return RANK[attacker.kind] >= RANK[defender.kind]; }

function applyAction(board, action) {
  const kind = action[0];
  if (kind === "flip") { const [, r, c] = action; if (board[r][c]) board[r][c].faceUp = true; return { type: "flip", successCapture: false, captured: null, lastMove: { r, c }, invalid: false }; }
  if (kind === "move") { const [, sr, sc, dr, dc] = action; board[dr][dc] = board[sr][sc]; board[sr][sc] = null; return { type: "move", successCapture: false, captured: null, lastMove: { r: dr, c: dc }, invalid: false }; }
  if (kind === "capture") { const [, sr, sc, dr, dc] = action; const captured = board[dr][dc] ? { ...board[dr][dc], faceUp: true } : null; board[dr][dc] = board[sr][sc]; board[sr][sc] = null; return { type: "capture", successCapture: true, captured, lastMove: { r: dr, c: dc }, invalid: false }; }
  if (kind === "darkCapture") {
    const [, sr, sc, dr, dc] = action;
    if (!canAttemptHiddenCapturePath(board, { r: sr, c: sc }, { r: dr, c: dc })) return { type: "darkCapture", successCapture: false, captured: null, lastMove: null, invalid: true };
    if (board[dr][dc]) board[dr][dc].faceUp = true;
    if (canCapture(board, { r: sr, c: sc }, { r: dr, c: dc })) {
      const captured = board[dr][dc] ? { ...board[dr][dc], faceUp: true } : null;
      board[dr][dc] = board[sr][sc]; board[sr][sc] = null;
      return { type: "darkCapture", successCapture: true, captured, lastMove: { r: dr, c: dc }, invalid: false };
    }
    return { type: "darkCapture", successCapture: false, captured: null, lastMove: { r: dr, c: dc }, invalid: false };
  }
  return { type: kind, successCapture: false, captured: null, lastMove: null, invalid: true };
}

function cloneBoard(board) { return board.map((row) => row.map((piece) => piece ? { ...piece } : null)); }
function neighbors(r, c) { const result = []; for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) result.push({ r: rr, c: cc }); } return result; }
function hasAnyAction(board, color) { for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) if (board[r][c] && !board[r][c].faceUp) return true; return generateNonFlipActions(board, color).length > 0; }
function checkWinner(board) { let redExists = false, blackExists = false; for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) { const piece = board[r][c]; if (!piece) continue; if (piece.color === "red") redExists = true; if (piece.color === "black") blackExists = true; } if (redExists && blackExists) return null; if (redExists) return "red"; if (blackExists) return "black"; return null; }
function showWinner(winnerColor) { state.locked = true; render(); showModal("遊戲結束", state.playerColor[HUMAN] === winnerColor ? "您獲勝。" : "AI 獲勝。"); }
function showModal(title, text) { dom.modalTitle.textContent = title; dom.modalText.textContent = text; dom.modal.classList.remove("hidden"); }
function hideModal() { dom.modal.classList.add("hidden"); }
function sameAction(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

function applyFixedLandscapeStage() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const STAGE_W = 932;
  const STAGE_H = 430;
  const vw = window.innerWidth || document.documentElement.clientWidth || STAGE_W;
  const vh = window.innerHeight || document.documentElement.clientHeight || STAGE_H;
  const initialPortrait = vw < vh;

  let scale;
  let left;
  let top;
  let transform;

  if (initialPortrait) {
    scale = Math.min(vw / STAGE_H, vh / STAGE_W);
    left = (vw + STAGE_H * scale) / 2;
    top = (vh - STAGE_W * scale) / 2;
    transform = `rotate(90deg) scale(${scale})`;
    document.body.classList.add("stage-initial-portrait");
  } else {
    scale = Math.min(vw / STAGE_W, vh / STAGE_H);
    left = (vw - STAGE_W * scale) / 2;
    top = (vh - STAGE_H * scale) / 2;
    transform = `scale(${scale})`;
    document.body.classList.add("stage-initial-landscape");
  }

  shell.style.setProperty("--stage-left", `${left}px`);
  shell.style.setProperty("--stage-top", `${top}px`);
  shell.style.setProperty("--stage-transform", transform);
  shell.style.setProperty("--stage-scale", String(scale));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=mobile-r21-20260723-omniscient-master").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyFixedLandscapeStage();
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
