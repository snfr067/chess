const APP_VERSION = "mobile-r21-20260728-ismcts-alpha-beta";

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
  easy: {
    label: "入門", thinkMs: 200, comboThinkMs: 90, maxTurns: 2,
    rootLimit: 10, nodeActionLimit: 8, progressiveBase: 3, progressiveScale: 1.20,
    exploration: 1.40, minIterations: 12, leafTacticalDepth: 1, finalTacticalDepth: 2,
    tacticalBranchLimit: 4, maxTacticalExtensions: 4, finalVerifyCount: 1,
    finalTacticalWeight: 0.08, confidencePenalty: 0.04, hiddenRiskWeight: 0.08,
    kingSafetyWeight: 0.75, earlyStopVisits: 260, earlyStopMinChildVisits: 10,
    earlyStopMargin: 1.80,
    help: "快速搜尋安全吃子、基本反吃與短連吃。",
  },
  normal: {
    label: "一般", thinkMs: 600, comboThinkMs: 180, maxTurns: 3,
    rootLimit: 14, nodeActionLimit: 12, progressiveBase: 3, progressiveScale: 1.40,
    exploration: 1.25, minIterations: 24, leafTacticalDepth: 2, finalTacticalDepth: 4,
    tacticalBranchLimit: 6, maxTacticalExtensions: 6, finalVerifyCount: 2,
    finalTacticalWeight: 0.12, confidencePenalty: 0.06, hiddenRiskWeight: 0.10,
    kingSafetyWeight: 0.90, earlyStopVisits: 700, earlyStopMinChildVisits: 18,
    earlyStopMargin: 1.65,
    help: "完整比較安全吃子、暗吃結果與玩家反擊。",
  },
  hard: {
    label: "困難", thinkMs: 1400, comboThinkMs: 350, maxTurns: 5,
    rootLimit: 20, nodeActionLimit: 16, progressiveBase: 4, progressiveScale: 1.60,
    exploration: 1.12, minIterations: 48, leafTacticalDepth: 3, finalTacticalDepth: 6,
    tacticalBranchLimit: 8, maxTacticalExtensions: 8, finalVerifyCount: 3,
    finalTacticalWeight: 0.18, confidencePenalty: 0.08, hiddenRiskWeight: 0.12,
    kingSafetyWeight: 1.05, earlyStopVisits: 1400, earlyStopMinChildVisits: 28,
    earlyStopMargin: 1.50,
    help: "深入搜尋多步交換、連吃停止時機與雙方強制手段。",
  },
  master: {
    label: "強敵", thinkMs: 3000, comboThinkMs: 650, maxTurns: 7,
    rootLimit: 28, nodeActionLimit: 22, progressiveBase: 5, progressiveScale: 1.80,
    exploration: 1.00, minIterations: 80, leafTacticalDepth: 4, finalTacticalDepth: 8,
    tacticalBranchLimit: 10, maxTacticalExtensions: 10, finalVerifyCount: 4,
    finalTacticalWeight: 0.22, confidencePenalty: 0.10, hiddenRiskWeight: 0.14,
    kingSafetyWeight: 1.20, earlyStopVisits: 2500, earlyStopMinChildVisits: 40,
    earlyStopMargin: 1.35,
    help: "反覆抽樣暗棋配置，搜尋玩家最強反擊並深度驗證戰術。",
  },
};

const SEARCH_VALUE = { K: 950, A: 650, E: 520, R: 420, N: 340, C: 480, P: 220 };
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
  resetAiSearchEngine();
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

  const action = await findBestAction(cloneBoard(state.board), aiColor, humanColor, diff, {
    includeDarkCaptures: comboEnabled,
    captured: cloneCaptured(state.captured),
  });
  if (!isAiRunActive(runId)) return;
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
      const comboChoice = await chooseBestComboAction(state.board, aiColor, humanColor, pos, diff);
      if (!isAiRunActive(runId)) return;
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

/*
 * Dark Chess AI engine
 *
 * Design goals:
 * 1. Never inspect the real identity of a face-down piece.
 * 2. Treat an entire capture chain as one turn and make STOP a real decision.
 * 3. Model the opponent as an adversary, not as a random player.
 * 4. Use ISMCTS for hidden information and alpha-beta for visible tactics.
 * 5. Reuse information-set nodes after the real game advances.
 */

const AI_TREE_NODE_LIMIT = 60_000;
const AI_TREE_KEEP_GENERATIONS = 4;
const AI_REWARD_SCALE = 2_800;
const AI_MAX_SEARCH_STEPS = 40;

let aiInformationTree = new Map();
let aiSearchGeneration = 0;

function resetAiSearchEngine() {
  aiInformationTree = new Map();
  aiSearchGeneration = 0;
}

async function findBestAction(board, aiColor, humanColor, diff, options = {}) {
  const result = await searchBestInformationAction(board, aiColor, humanColor, diff, {
    captured: cloneCaptured(options.captured || (state ? state.captured : [])),
    comboEnabled: Boolean(options.includeDarkCaptures),
    comboPos: null,
    thinkMs: options.thinkMs,
    seed: options.seed,
  });
  return result ? result.action : null;
}

async function chooseBestComboAction(board, aiColor, humanColor, pos, diff, options = {}) {
  const result = await searchBestInformationAction(board, aiColor, humanColor, diff, {
    captured: cloneCaptured(options.captured || (state ? state.captured : [])),
    comboEnabled: true,
    comboPos: pos ? { r: pos.r, c: pos.c } : null,
    thinkMs: options.thinkMs ?? diff.comboThinkMs,
    seed: options.seed,
  });

  if (!result || !result.action || result.action[0] === "stop") return null;
  return { action: result.action, score: result.score, stats: result.stats };
}

async function searchBestInformationAction(board, aiColor, humanColor, diff, options = {}) {
  const captured = cloneCaptured(options.captured || []);
  const comboEnabled = Boolean(options.comboEnabled);
  const comboPos = options.comboPos ? { ...options.comboPos } : null;
  const publicState = createSimulationState({
    board: cloneBoard(board),
    captured,
    currentColor: aiColor,
    comboEnabled,
    comboPos,
    comboSteps: comboPos ? 1 : 0,
    positionCounts: state && state.positionCounts ? state.positionCounts : null,
  });

  const allRootActions = generateRootSearchActions(publicState, aiColor, humanColor, diff);
  if (allRootActions.length === 0) return null;
  const rootKey = informationSetKey(publicState);
  const rootNode = getOrCreateInformationNode(rootKey, publicState.currentColor, publicState.comboPos);
  rootNode.generation = aiSearchGeneration + 1;
  const rootRows = selectCandidateRows(
    buildCachedActionRows(rootNode, allRootActions, publicState, aiColor, diff),
    diff.rootLimit,
    true,
  );
  const rootActions = rootRows.map((row) => row.action);
  if (rootActions.length === 1) {
    const onlyAction = rootActions[0];
    const onlyScore = rootRows[0].prior;
    if (state) {
      state.aiSearchInfo = {
        engine: "ISMCTS+AlphaBeta",
        elapsedMs: 0,
        iterations: 0,
        nodes: 0,
        reusedVisits: 0,
        action: [...onlyAction],
        top: [{ action: [...onlyAction], visits: 0, mean: 0, prior: onlyScore }],
      };
    }
    return { action: onlyAction, score: onlyScore, stats: state ? state.aiSearchInfo : null };
  }

  aiSearchGeneration += 1;
  rootNode.generation = aiSearchGeneration;
  ensureInformationEdges(rootNode, rootRows);

  const startTime = nowMs();
  const requestedBudget = Number.isFinite(options.thinkMs) ? options.thinkMs : diff.thinkMs;
  const thinkMs = Math.max(25, requestedBudget);
  const totalDeadline = startTime + thinkMs;
  const deadline = startTime + thinkMs * 0.82;
  const seedBase = Number.isInteger(options.seed)
    ? options.seed >>> 0
    : hashString32(`${rootKey}|${aiSearchGeneration}|${Math.floor(startTime)}`);

  const context = {
    rootColor: aiColor,
    opponentColor: humanColor,
    diff,
    comboEnabled,
    rootKey,
    rootActionKeys: new Set(rootRows.map((row) => row.key)),
    deadline,
    nodes: 0,
    iterations: 0,
    seedBase,
    currentIteration: 0,
    iterationLimit: Number.isInteger(options.iterationLimit) && options.iterationLimit > 0
      ? options.iterationLimit
      : null,
  };

  const reusedVisits = rootNode.visits;
  let timedOut = false;
  let lastYield = startTime;

  while (true) {
    if (context.iterationLimit !== null && context.iterations >= context.iterationLimit) break;
    if (context.iterationLimit === null && nowMs() >= deadline && context.iterations >= diff.minIterations) break;
    context.currentIteration = context.iterations;
    const rng = createSeededRng(mixSeed(seedBase, context.iterations + 1));
    try {
      runIsmctsIteration(publicState, rootNode, context, rng);
    } catch (error) {
      if (error !== SEARCH_TIMEOUT) throw error;
      timedOut = true;
      break;
    }
    context.iterations += 1;

    const current = nowMs();
    if (current - lastYield >= 12) {
      await sleep(0);
      lastYield = nowMs();
      if (!state || !state.aiThinking || state.currentPlayer !== AI) return null;
    }

    if (context.iterations >= diff.minIterations && canStopSearchEarly(rootNode, rootRows, diff)) break;
  }

  context.deadline = totalDeadline;
  const ranked = rankRootEdges(rootNode, rootRows, publicState, context);
  const best = ranked[0] || null;
  const elapsedMs = Math.max(0, nowMs() - startTime);

  if (state && best) {
    state.aiSearchInfo = {
      engine: "ISMCTS+AlphaBeta",
      elapsedMs: Math.round(elapsedMs),
      iterations: context.iterations,
      nodes: context.nodes,
      reusedVisits,
      timedOut,
      action: [...best.action],
      score: best.selectionScore,
      top: ranked.slice(0, 5).map((row) => ({
        action: [...row.action],
        visits: row.visits,
        mean: row.mean,
        confidence: row.confidence,
        prior: row.prior,
        tactical: row.tactical,
      })),
    };
  }

  pruneInformationTree(rootKey);
  return best
    ? { action: best.action, score: best.selectionScore, stats: state ? state.aiSearchInfo : null }
    : null;
}

function runIsmctsIteration(publicState, rootNode, ctx, rng) {
  const determinedBoard = determinizeBoard(publicState.board, publicState.captured, rng);
  const sim = createSimulationState({
    board: determinedBoard,
    captured: cloneCaptured(publicState.captured),
    currentColor: publicState.currentColor,
    comboEnabled: publicState.comboEnabled,
    comboPos: publicState.comboPos ? { ...publicState.comboPos } : null,
    comboSteps: publicState.comboSteps,
    positionCounts: publicState.positionCounts,
  });

  const visitedNodes = [rootNode];
  const visitedEdges = [];
  let node = rootNode;
  let completedTurns = 0;
  let steps = 0;
  let reward = null;

  while (steps < AI_MAX_SEARCH_STEPS && completedTurns < ctx.diff.maxTurns) {
    steps += 1;
    touchAiSearchNode(ctx);

    const winner = checkWinner(sim.board);
    if (winner !== null) {
      reward = terminalReward(winner, ctx.rootColor, completedTurns);
      break;
    }

    const isRootNode = node.key === ctx.rootKey;
    const actions = generateSimulationActions(sim, ctx, isRootNode);
    if (actions.length === 0) {
      reward = sim.currentColor === ctx.rootColor ? -1 : 1;
      break;
    }

    let rows = buildCachedActionRows(node, actions, sim, sim.currentColor, ctx.diff);
    rows = selectCandidateRows(rows, isRootNode ? ctx.diff.rootLimit : ctx.diff.nodeActionLimit, isRootNode);
    ensureInformationEdges(node, rows);

    const selectable = progressiveInformationEdges(node, rows, ctx.diff, isRootNode);
    const edge = selectInformationEdge(node, selectable, sim.currentColor, ctx, rng);
    if (!edge) {
      reward = evaluateSimulationReward(sim, ctx);
      break;
    }

    const wasUnvisited = edge.visits === 0;
    const previousColor = sim.currentColor;
    const transition = applySimulationAction(sim, edge.action);
    if (transition.invalid) {
      reward = previousColor === ctx.rootColor ? -1 : 1;
      break;
    }
    if (transition.turnEnded) completedTurns += 1;

    const childKey = informationSetKey(sim);
    const childNode = getOrCreateInformationNode(childKey, sim.currentColor, sim.comboPos);
    childNode.generation = aiSearchGeneration;
    edge.childKeys.add(childKey);

    visitedEdges.push(edge);
    visitedNodes.push(childNode);
    node = childNode;

    if (wasUnvisited || childNode.visits === 0) {
      reward = evaluateSimulationReward(sim, ctx);
      break;
    }
  }

  if (reward === null) reward = evaluateSimulationReward(sim, ctx);
  reward = clamp(reward, -1, 1);

  for (const visitedNode of visitedNodes) {
    visitedNode.visits += 1;
    visitedNode.valueSum += reward;
    visitedNode.generation = aiSearchGeneration;
  }
  for (const edge of visitedEdges) {
    edge.visits += 1;
    edge.valueSum += reward;
  }
}

function createSimulationState(options) {
  const counts = Object.create(null);
  if (options.positionCounts) {
    for (const [key, value] of Object.entries(options.positionCounts)) counts[key] = value;
  }
  return {
    board: options.board,
    captured: options.captured || [],
    currentColor: options.currentColor,
    comboEnabled: Boolean(options.comboEnabled),
    comboPos: options.comboPos ? { ...options.comboPos } : null,
    comboSteps: options.comboSteps || 0,
    positionCounts: counts,
  };
}

function cloneSimulationState(sim) {
  return createSimulationState({
    board: cloneBoard(sim.board),
    captured: cloneCaptured(sim.captured),
    currentColor: sim.currentColor,
    comboEnabled: sim.comboEnabled,
    comboPos: sim.comboPos ? { ...sim.comboPos } : null,
    comboSteps: sim.comboSteps,
    positionCounts: sim.positionCounts,
  });
}

function generateRootSearchActions(sim, aiColor, humanColor, diff) {
  let actions;
  if (sim.comboPos) {
    actions = [
      ["stop"],
      ...generateCaptureActionsFrom(sim.board, sim.currentColor, sim.comboPos, { includeDark: sim.comboEnabled }),
    ];
  } else {
    actions = generateActions(sim.board, sim.currentColor, {
      includeFlips: true,
      includeMoves: true,
      includeCaptures: true,
      includeDarkCaptures: sim.comboEnabled,
    }).filter((action) => !evaluateAiOpeningPolicy(sim.board, action, aiColor, humanColor).forbidden);
  }

  return actions;
}

function generateSimulationActions(sim, ctx, isRoot = false) {
  let actions;
  if (sim.comboPos) {
    actions = [
      ["stop"],
      ...generateCaptureActionsFrom(sim.board, sim.currentColor, sim.comboPos, { includeDark: sim.comboEnabled }),
    ];
  } else {
    actions = generateActions(sim.board, sim.currentColor, {
      includeFlips: true,
      includeMoves: true,
      includeCaptures: true,
      includeDarkCaptures: sim.comboEnabled,
    });
  }

  actions = actions.filter((action) => !simulationActionForbidden(sim, action));
  if (isRoot) actions = actions.filter((action) => ctx.rootActionKeys.has(actionKey(action)));
  const unique = [];
  for (const action of actions) {
    if (!unique.some((existing) => sameAction(existing, action))) unique.push(action);
  }
  return unique;
}

function buildCachedActionRows(node, actions, sim, actorColor, diff) {
  return actions
    .map((action) => {
      const key = actionKey(action);
      const existing = node.edges.get(key);
      return {
        action,
        key,
        prior: existing ? existing.prior : quickActionPrior(sim, action, actorColor, diff),
      };
    })
    .sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
}

function selectCandidateRows(rows, limit, isRoot) {
  if (rows.length <= limit) return rows;
  const selected = [];
  const add = (row) => {
    if (row && !selected.some((item) => item.key === row.key)) selected.push(row);
  };

  for (const row of rows) if (row.action[0] === "capture") add(row);
  for (const type of ["stop", "darkCapture", "move", "flip"]) add(rows.find((row) => row.action[0] === type));
  for (const row of rows) {
    if (selected.length >= limit) break;
    add(row);
  }

  if (!isRoot && selected.length > limit) selected.length = limit;
  return selected.sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
}

function simulationActionForbidden(sim, action) {
  if (action[0] !== "move") return false;
  const nextBoard = cloneBoard(sim.board);
  const result = applyAction(nextBoard, action);
  if (result.invalid) return true;
  const nextKey = visiblePositionKey(nextBoard, opponentColor(sim.currentColor));
  return (sim.positionCounts[nextKey] || 0) >= REPETITION_LIMIT - 1;
}

function applySimulationAction(sim, action) {
  if (!action) return { invalid: true, turnEnded: false };
  if (action[0] === "stop") {
    endSimulationTurn(sim);
    return { invalid: false, turnEnded: true, stopped: true };
  }

  const result = applyAction(sim.board, action);
  if (result.invalid) return { invalid: true, turnEnded: false, result };
  if (result.captured) sim.captured.push({ ...result.captured, faceUp: true });

  const winner = checkWinner(sim.board);
  if (winner !== null) return { invalid: false, turnEnded: false, result, winner };

  if (result.successCapture && sim.comboEnabled && result.lastMove) {
    const nextPos = { r: result.lastMove.r, c: result.lastMove.c };
    const canContinue = sim.comboSteps < MAX_COMBO_STEPS
      && hasCaptureOpportunityFrom(sim.board, sim.currentColor, nextPos, { includeDark: true });
    if (canContinue) {
      sim.comboPos = nextPos;
      sim.comboSteps += 1;
      return { invalid: false, turnEnded: false, result };
    }
  }

  endSimulationTurn(sim);
  return { invalid: false, turnEnded: true, result };
}

function endSimulationTurn(sim) {
  sim.currentColor = opponentColor(sim.currentColor);
  sim.comboPos = null;
  sim.comboSteps = 0;
  const key = visiblePositionKey(sim.board, sim.currentColor);
  sim.positionCounts[key] = (sim.positionCounts[key] || 0) + 1;
}

function determinizeBoard(publicBoard, captured, rng) {
  const hiddenPositions = [];
  const nextBoard = cloneBoard(publicBoard);
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = publicBoard[r][c];
      if (piece && !piece.faceUp) hiddenPositions.push({ r, c, id: piece.id });
    }
  }

  const pool = unseenPieceList(publicBoard, captured);
  if (pool.length !== hiddenPositions.length) {
    throw new Error(`暗棋池數量不一致：暗格 ${hiddenPositions.length}，剩餘棋子 ${pool.length}`);
  }
  shuffleWithRng(pool, rng);

  for (let i = 0; i < hiddenPositions.length; i += 1) {
    const pos = hiddenPositions[i];
    const sampled = pool[i];
    nextBoard[pos.r][pos.c] = {
      color: sampled.color,
      kind: sampled.kind,
      faceUp: false,
      id: pos.id || `det-${i}-${sampled.color}-${sampled.kind}`,
    };
  }
  return nextBoard;
}

function unseenPieceList(board, captured) {
  const pool = getUnseenPool(board, captured);
  const pieces = [];
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      for (let i = 0; i < pool.counts[color][kind]; i += 1) pieces.push({ color, kind });
    }
  }
  return pieces;
}

function informationSetKey(sim) {
  const visibleKey = visiblePositionKey(sim.board, sim.currentColor);
  const capturedKey = capturedCountKey(sim.captured);
  const comboKey = sim.comboPos ? `${sim.comboPos.r},${sim.comboPos.c},${sim.comboSteps}` : "-";
  const repetition = Math.min(REPETITION_LIMIT, sim.positionCounts[visibleKey] || 0);
  return `${visibleKey}|cap=${capturedKey}|combo=${comboKey}|rep=${repetition}|rule=${sim.comboEnabled ? 1 : 0}`;
}

function actionKey(action) {
  return action.join(":");
}

function getOrCreateInformationNode(key, currentColor, comboPos) {
  let node = aiInformationTree.get(key);
  if (!node) {
    node = {
      key,
      currentColor,
      combo: Boolean(comboPos),
      visits: 0,
      valueSum: 0,
      edges: new Map(),
      generation: aiSearchGeneration,
    };
    aiInformationTree.set(key, node);
  }
  return node;
}

function ensureInformationEdges(node, rows) {
  for (const row of rows) {
    if (!node.edges.has(row.key)) {
      node.edges.set(row.key, {
        key: row.key,
        action: [...row.action],
        prior: row.prior,
        visits: 0,
        valueSum: 0,
        childKeys: new Set(),
      });
    } else {
      node.edges.get(row.key).prior = row.prior;
    }
  }
}

function progressiveInformationEdges(node, rows, diff, isRoot) {
  const available = rows
    .map((row) => node.edges.get(row.key))
    .filter(Boolean)
    .sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
  if (isRoot) return available;

  const allowed = Math.max(
    2,
    Math.min(
      available.length,
      Math.floor(diff.progressiveBase + diff.progressiveScale * Math.sqrt(node.visits + 1)),
    ),
  );
  return available.slice(0, allowed);
}

function selectInformationEdge(node, edges, currentColor, ctx, rng) {
  if (edges.length === 0) return null;
  const unvisited = edges.filter((edge) => edge.visits === 0);
  if (unvisited.length > 0) {
    unvisited.sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
    const choiceCount = Math.min(unvisited.length, currentColor === ctx.rootColor ? 2 : 3);
    return unvisited[Math.floor(rng() * choiceCount)];
  }

  const logParent = Math.log(node.visits + 1);
  let bestEdge = null;
  let bestValue = -Infinity;
  for (const edge of edges) {
    const mean = edge.valueSum / edge.visits;
    const exploitation = currentColor === ctx.rootColor ? mean : -mean;
    const exploration = ctx.diff.exploration * Math.sqrt(logParent / edge.visits);
    const prior = 0.10 * edge.prior / (1 + Math.sqrt(edge.visits));
    const noise = rng() * 1e-8;
    const value = exploitation + exploration + prior + noise;
    if (value > bestValue) {
      bestValue = value;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

function evaluateSimulationReward(sim, ctx) {
  const winner = checkWinner(sim.board);
  if (winner !== null) return terminalReward(winner, ctx.rootColor, 0);
  if (!hasImmediateTacticalNeed(sim)) return scoreToReward(evaluatePositionRaw(sim, ctx.rootColor, ctx.diff));

  const tactical = tacticalAlphaBeta(
    sim,
    ctx.diff.leafTacticalDepth,
    -SEARCH_MATE,
    SEARCH_MATE,
    ctx,
    0,
    new Map(),
  );
  return scoreToReward(tactical);
}

function hasImmediateTacticalNeed(sim) {
  if (sim.comboPos) return true;
  const captures = generateActions(sim.board, sim.currentColor, {
    includeFlips: false,
    includeMoves: false,
    includeCaptures: true,
    includeDarkCaptures: false,
  });
  if (captures.length > 0) return true;
  return aggregateKnownRisk(sim.board, sim.currentColor) >= SEARCH_VALUE.N * 0.55;
}

function tacticalAlphaBeta(sim, depth, alpha, beta, ctx, extensionSteps, transposition) {
  touchAiSearchNode(ctx);
  const winner = checkWinner(sim.board);
  if (winner === ctx.rootColor) return SEARCH_MATE - extensionSteps * 100;
  if (winner === ctx.opponentColor) return -SEARCH_MATE + extensionSteps * 100;

  const tacticalActions = generateTacticalActions(sim, ctx.diff);
  if (depth <= 0 && tacticalActions.length === 0) {
    return evaluatePositionRaw(sim, ctx.rootColor, ctx.diff);
  }
  if (extensionSteps >= ctx.diff.maxTacticalExtensions) {
    return evaluatePositionRaw(sim, ctx.rootColor, ctx.diff);
  }

  const effectiveActions = tacticalActions.length > 0
    ? tacticalActions
    : generateEmergencyActions(sim, ctx.diff);
  if (effectiveActions.length === 0) return evaluatePositionRaw(sim, ctx.rootColor, ctx.diff);

  const cacheKey = `${informationSetKey(sim)}|d=${depth}|x=${extensionSteps}`;
  const cached = transposition.get(cacheKey);
  if (cached !== undefined) return cached;

  const maximizing = sim.currentColor === ctx.rootColor;
  let best = maximizing ? -Infinity : Infinity;
  let exact = true;

  for (const action of effectiveActions) {
    const next = cloneSimulationState(sim);
    const beforeColor = next.currentColor;
    const transition = applySimulationAction(next, action);
    if (transition.invalid) continue;
    const nextDepth = transition.turnEnded ? depth - 1 : depth;
    const value = tacticalAlphaBeta(
      next,
      nextDepth,
      alpha,
      beta,
      ctx,
      extensionSteps + (beforeColor === next.currentColor ? 1 : 0),
      transposition,
    );

    if (maximizing) {
      if (value > best) best = value;
      alpha = Math.max(alpha, best);
    } else {
      if (value < best) best = value;
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      exact = false;
      break;
    }
  }

  if (!Number.isFinite(best)) best = evaluatePositionRaw(sim, ctx.rootColor, ctx.diff);
  if (exact) transposition.set(cacheKey, best);
  return best;
}

function generateTacticalActions(sim, diff) {
  let actions = [];
  if (sim.comboPos) {
    actions = [
      ["stop"],
      ...generateCaptureActionsFrom(sim.board, sim.currentColor, sim.comboPos, { includeDark: false }),
    ];
  } else {
    actions = generateActions(sim.board, sim.currentColor, {
      includeFlips: false,
      includeMoves: false,
      includeCaptures: true,
      includeDarkCaptures: false,
    });
  }

  actions = actions.filter((action) => !simulationActionForbidden(sim, action));
  return actions
    .map((action) => ({ action, prior: quickActionPrior(sim, action, sim.currentColor, diff) }))
    .sort((a, b) => b.prior - a.prior)
    .slice(0, diff.tacticalBranchLimit)
    .map((row) => row.action);
}

function generateEmergencyActions(sim, diff) {
  if (sim.comboPos) return [["stop"]];
  const currentRisk = aggregateKnownRisk(sim.board, sim.currentColor);
  if (currentRisk < SEARCH_VALUE.N * 0.55) return [];

  const moves = generateActions(sim.board, sim.currentColor, {
    includeFlips: false,
    includeMoves: true,
    includeCaptures: false,
    includeDarkCaptures: false,
  });
  const rows = [];
  for (const action of moves) {
    if (simulationActionForbidden(sim, action)) continue;
    const next = cloneSimulationState(sim);
    const transition = applySimulationAction(next, action);
    if (transition.invalid) continue;
    const nextRisk = aggregateKnownRisk(next.board, sim.currentColor);
    if (nextRisk + 1 < currentRisk) {
      rows.push({ action, gain: currentRisk - nextRisk + quickActionPrior(sim, action, sim.currentColor, diff) * 100 });
    }
  }
  return rows
    .sort((a, b) => b.gain - a.gain)
    .slice(0, Math.max(2, Math.floor(diff.tacticalBranchLimit / 2)))
    .map((row) => row.action);
}

function evaluatePositionRaw(sim, perspectiveColor, diff) {
  const winner = checkWinner(sim.board);
  if (winner === perspectiveColor) return SEARCH_MATE;
  if (winner === opponentColor(perspectiveColor)) return -SEARCH_MATE;

  const enemyColor = opponentColor(perspectiveColor);
  const remaining = remainingPieceCounts(sim.captured);
  let score = 0;

  for (const kind of Object.keys(PIECE_COUNTS)) {
    score += (remaining[perspectiveColor][kind] - remaining[enemyColor][kind]) * SEARCH_VALUE[kind];
  }

  const ownFeatures = evaluateVisibleColorFeatures(sim, perspectiveColor, diff);
  const enemyFeatures = evaluateVisibleColorFeatures(sim, enemyColor, diff);
  score += ownFeatures.activity - enemyFeatures.activity;
  score += ownFeatures.threat - enemyFeatures.threat;
  score += enemyFeatures.risk - ownFeatures.risk;
  score += ownFeatures.cannon - enemyFeatures.cannon;
  score += ownFeatures.structure - enemyFeatures.structure;

  if (sim.currentColor === perspectiveColor) score += 18;
  else score -= 18;

  if (sim.comboPos) {
    const comboValue = comboOpportunityValue(sim.board, sim.currentColor, sim.comboPos, sim.comboEnabled);
    score += sim.currentColor === perspectiveColor ? comboValue : -comboValue;
  }

  return score;
}

function evaluateVisibleColorFeatures(sim, color, diff) {
  let activity = 0;
  let risk = 0;
  let cannon = 0;
  let structure = 0;
  const threatByTarget = new Map();
  const pool = getUnseenPool(sim.board, sim.captured);

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = sim.board[r][c];
      if (!piece || !piece.faceUp || piece.color !== color) continue;
      const value = SEARCH_VALUE[piece.kind];
      const emptyMoves = neighbors(r, c).filter((pos) => sim.board[pos.r][pos.c] === null).length;
      const captures = generateCaptureActionsFrom(sim.board, color, { r, c }, { includeDark: false });

      activity += emptyMoves * 12 + captures.length * 18 - centerDistance(r, c) * 2.2;
      risk += estimateKnownLossAt(sim.board, { r, c }, color);
      structure += visibleSupportValue(sim.board, { r, c }, color) * 20;
      structure -= expectedAdjacentHiddenDanger(sim.board, pool, { r, c }, piece, color) * value * diff.hiddenRiskWeight;

      for (const action of captures) {
        const target = sim.board[action[3]][action[4]];
        if (!target) continue;
        const targetKey = `${action[3]},${action[4]}`;
        const gain = estimateCaptureNetGain(sim.board, action, color);
        const old = threatByTarget.get(targetKey) || 0;
        if (gain > old) threatByTarget.set(targetKey, gain);
      }

      if (piece.kind === "C") cannon += evaluateCannonPosition(sim.board, { r, c }, color);
      if (piece.kind === "K") structure -= kingPawnExposure(sim.board, pool, { r, c }, color) * diff.kingSafetyWeight;
      if (piece.kind === "P") structure += pawnKingPressure(sim.board, { r, c }, color);
    }
  }

  const threatValues = [...threatByTarget.values()].sort((a, b) => b - a);
  let threat = 0;
  for (let i = 0; i < Math.min(3, threatValues.length); i += 1) threat += threatValues[i] * (1 - i * 0.22);
  return { activity, risk, cannon, structure, threat };
}

function estimateKnownLossAt(board, pos, ownColor) {
  const target = board[pos.r][pos.c];
  if (!target || !target.faceUp || target.color !== ownColor) return 0;
  let worst = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const attacker = board[r][c];
      if (!attacker || !attacker.faceUp || attacker.color === ownColor) continue;
      const action = ["capture", r, c, pos.r, pos.c];
      if (!canCapture(board, { r, c }, pos)) continue;

      const nextBoard = cloneBoard(board);
      applyAction(nextBoard, action);
      const recapture = bestKnownCaptureOnSquare(nextBoard, pos, ownColor);
      const targetLoss = SEARCH_VALUE[target.kind];
      const attackerValue = SEARCH_VALUE[attacker.kind];
      const netLoss = targetLoss - (recapture ? attackerValue * 0.78 : 0);
      worst = Math.max(worst, netLoss);
    }
  }
  return Math.max(0, worst);
}

function bestKnownCaptureOnSquare(board, pos, actorColor) {
  let best = 0;
  const target = board[pos.r][pos.c];
  if (!target || target.color === actorColor) return 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (!piece || !piece.faceUp || piece.color !== actorColor) continue;
      if (canCapture(board, { r, c }, pos)) best = Math.max(best, SEARCH_VALUE[target.kind]);
    }
  }
  return best;
}

function estimateCaptureNetGain(board, action, actorColor) {
  const target = board[action[3]][action[4]];
  const attacker = board[action[1]][action[2]];
  if (!target || !attacker) return 0;
  const nextBoard = cloneBoard(board);
  applyAction(nextBoard, action);
  const destination = { r: action[3], c: action[4] };
  const replyLoss = estimateKnownLossAt(nextBoard, destination, actorColor);
  return SEARCH_VALUE[target.kind] - replyLoss * 0.9;
}

function aggregateKnownRisk(board, color) {
  let risk = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r][c];
      if (piece && piece.faceUp && piece.color === color) risk += estimateKnownLossAt(board, { r, c }, color);
    }
  }
  return risk;
}

function visibleSupportValue(board, pos, color) {
  let supporters = 0;
  const target = board[pos.r][pos.c];
  if (!target) return 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (r === pos.r && c === pos.c) continue;
      const piece = board[r][c];
      if (!piece || !piece.faceUp || piece.color !== color) continue;
      const hypothetical = { ...target, color: opponentColor(color), faceUp: true };
      if (canHypotheticalCapture(board, { r, c }, pos, hypothetical)) supporters += 1;
    }
  }
  return Math.min(2, supporters);
}

function expectedAdjacentHiddenDanger(board, pool, pos, target, color) {
  if (!pool.total) return 0;
  const enemy = opponentColor(color);
  let probability = 0;
  for (const nb of neighbors(pos.r, pos.c)) {
    const cell = board[nb.r][nb.c];
    if (!cell || cell.faceUp) continue;
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[enemy][kind];
      if (count <= 0 || kind === "C") continue;
      const attacker = { color: enemy, kind, faceUp: true };
      if (canNormalPieceCapture(attacker, target)) probability += count / pool.total;
    }
  }
  return Math.min(1.5, probability);
}

function evaluateCannonPosition(board, pos, color) {
  let score = 0;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of directions) {
    let r = pos.r + dr;
    let c = pos.c + dc;
    let screenFound = false;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const cell = board[r][c];
      if (cell) {
        if (!screenFound) {
          screenFound = true;
          score += 9;
        } else {
          if (!cell.faceUp) score += 28;
          else if (cell.color !== color) score += SEARCH_VALUE[cell.kind] * 0.18;
          else score -= 8;
          break;
        }
      }
      r += dr;
      c += dc;
    }
  }
  return score;
}

function kingPawnExposure(board, pool, pos, color) {
  const enemy = opponentColor(color);
  let exposure = 0;
  for (const nb of neighbors(pos.r, pos.c)) {
    const piece = board[nb.r][nb.c];
    if (!piece) continue;
    if (piece.faceUp && piece.color === enemy && piece.kind === "P") exposure += 1.8;
    if (!piece.faceUp && pool.total) exposure += pool.counts[enemy].P / pool.total;
  }
  return exposure * SEARCH_VALUE.K * 0.75;
}

function pawnKingPressure(board, pos, color) {
  let score = 0;
  for (const nb of neighbors(pos.r, pos.c)) {
    const piece = board[nb.r][nb.c];
    if (piece && piece.faceUp && piece.color !== color && piece.kind === "K") score += SEARCH_VALUE.K * 1.2;
  }
  return score;
}

function comboOpportunityValue(board, color, pos, includeDark) {
  const actions = generateCaptureActionsFrom(board, color, pos, { includeDark });
  let known = 0;
  let hidden = 0;
  for (const action of actions) {
    if (action[0] === "capture") {
      const target = board[action[3]][action[4]];
      if (target) known = Math.max(known, SEARCH_VALUE[target.kind]);
    } else hidden += 1;
  }
  return known * 0.45 + Math.min(3, hidden) * 45;
}

function quickActionPrior(sim, action, actorColor, diff) {
  const kind = action[0];
  if (kind === "stop") {
    const before = evaluatePositionRaw(sim, actorColor, diff);
    const next = cloneSimulationState(sim);
    applySimulationAction(next, action);
    const after = evaluatePositionRaw(next, actorColor, diff);
    return Math.tanh((after - before) / 1_600);
  }

  if (kind === "capture" || kind === "move") {
    const before = evaluatePositionRaw(sim, actorColor, diff);
    const next = cloneSimulationState(sim);
    const transition = applySimulationAction(next, action);
    if (transition.invalid) return -1;
    const after = evaluatePositionRaw(next, actorColor, diff);
    let bonus = 0;
    if (kind === "capture") {
      const target = sim.board[action[3]][action[4]];
      if (target) bonus += SEARCH_VALUE[target.kind] * 0.35;
      if (transition.winner === actorColor) bonus += SEARCH_MATE / 2;
    }
    return Math.tanh((after - before + bonus) / 1_600);
  }

  if (kind === "flip") return expectedRevealPrior(sim, action, actorColor, diff);
  if (kind === "darkCapture") return expectedDarkCapturePrior(sim, action, actorColor, diff);
  return 0;
}

function expectedRevealPrior(sim, action, actorColor, diff) {
  const pool = getUnseenPool(sim.board, sim.captured);
  if (!pool.total) return -1;
  const [, r, c] = action;
  const outcomes = fullUnseenOutcomes(pool);
  let expected = 0;

  for (const outcome of outcomes) {
    const next = cloneSimulationState(sim);
    const oldId = next.board[r][c] ? next.board[r][c].id : `flip-${r}-${c}`;
    next.board[r][c] = { color: outcome.color, kind: outcome.kind, faceUp: true, id: oldId };
    endSimulationTurn(next);
    const value = evaluatePositionRaw(next, actorColor, diff);
    expected += outcome.probability * value;
  }
  const locationBias = -centerDistance(r, c) * 7;
  return Math.tanh((expected + locationBias) / AI_REWARD_SCALE);
}

function expectedDarkCapturePrior(sim, action, actorColor, diff) {
  const pool = getUnseenPool(sim.board, sim.captured);
  if (!pool.total) return -1;
  const [, sr, sc, dr, dc] = action;
  const outcomes = fullUnseenOutcomes(pool);
  let expected = 0;

  for (const outcome of outcomes) {
    const next = cloneSimulationState(sim);
    next.board[dr][dc] = {
      color: outcome.color,
      kind: outcome.kind,
      faceUp: false,
      id: next.board[dr][dc] ? next.board[dr][dc].id : `dark-${dr}-${dc}`,
    };
    const transition = applySimulationAction(next, action);
    if (transition.invalid) continue;
    expected += outcome.probability * evaluatePositionRaw(next, actorColor, diff);
  }
  const stopValue = evaluatePositionRaw(sim, actorColor, diff);
  return Math.tanh((expected - stopValue) / AI_REWARD_SCALE);
}

function fullUnseenOutcomes(pool) {
  const outcomes = [];
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count > 0) outcomes.push({ color, kind, count, probability: count / pool.total });
    }
  }
  return outcomes;
}

function rankRootEdges(rootNode, rootRows, publicState, ctx) {
  const maxVisits = Math.max(1, ...rootRows.map((row) => rootNode.edges.get(row.key)?.visits || 0));
  const tacticalCandidates = rootRows
    .map((row) => rootNode.edges.get(row.key))
    .filter(Boolean)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, ctx.diff.finalVerifyCount);
  const tacticalMap = new Map();

  for (const edge of tacticalCandidates) {
    if (!["capture", "move", "stop"].includes(edge.action[0])) continue;
    const next = cloneSimulationState(publicState);
    const transition = applySimulationAction(next, edge.action);
    if (transition.invalid) continue;
    try {
      const value = tacticalAlphaBeta(
        next,
        ctx.diff.finalTacticalDepth,
        -SEARCH_MATE,
        SEARCH_MATE,
        ctx,
        0,
        new Map(),
      );
      tacticalMap.set(edge.key, scoreToReward(value));
    } catch (error) {
      if (error !== SEARCH_TIMEOUT) throw error;
      break;
    }
  }

  return rootRows
    .map((row) => {
      const edge = rootNode.edges.get(row.key);
      const visits = edge ? edge.visits : 0;
      const mean = visits > 0 ? edge.valueSum / visits : -1;
      const confidence = Math.sqrt(Math.log(rootNode.visits + 2) / (visits + 1));
      const tactical = tacticalMap.has(row.key) ? tacticalMap.get(row.key) : null;
      const visitShare = visits / maxVisits;
      const selectionScore = mean
        - ctx.diff.confidencePenalty * confidence
        + row.prior * 0.06
        + visitShare * 0.035
        + (tactical === null ? 0 : tactical * ctx.diff.finalTacticalWeight);
      return {
        action: row.action,
        prior: row.prior,
        visits,
        mean,
        confidence,
        tactical,
        selectionScore,
      };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore || b.visits - a.visits || actionKey(a.action).localeCompare(actionKey(b.action)));
}

function canStopSearchEarly(rootNode, rootRows, diff) {
  if (rootNode.visits < diff.earlyStopVisits) return false;
  const ranked = rootRows
    .map((row) => {
      const edge = rootNode.edges.get(row.key);
      return {
        visits: edge ? edge.visits : 0,
        mean: edge && edge.visits ? edge.valueSum / edge.visits : -1,
      };
    })
    .filter((row) => row.visits >= diff.earlyStopMinChildVisits)
    .sort((a, b) => b.mean - a.mean);
  if (ranked.length < 2) return false;
  const first = ranked[0];
  const second = ranked[1];
  const firstError = Math.sqrt(Math.log(rootNode.visits + 2) / first.visits);
  const secondError = Math.sqrt(Math.log(rootNode.visits + 2) / second.visits);
  return first.mean - diff.earlyStopMargin * firstError > second.mean + diff.earlyStopMargin * secondError;
}

function terminalReward(winnerColor, rootColor, distance) {
  const base = winnerColor === rootColor ? 1 : -1;
  const distanceAdjustment = Math.min(0.08, distance * 0.006);
  return base > 0 ? base - distanceAdjustment : base + distanceAdjustment;
}

function scoreToReward(score) {
  if (score >= SEARCH_MATE / 2) return 1;
  if (score <= -SEARCH_MATE / 2) return -1;
  return Math.tanh(score / AI_REWARD_SCALE);
}

function remainingPieceCounts(captured) {
  const counts = {
    red: { ...PIECE_COUNTS },
    black: { ...PIECE_COUNTS },
  };
  for (const piece of captured || []) {
    if (counts[piece.color] && Number.isFinite(counts[piece.color][piece.kind])) {
      counts[piece.color][piece.kind] = Math.max(0, counts[piece.color][piece.kind] - 1);
    }
  }
  return counts;
}

function capturedCountKey(captured) {
  const counts = {
    red: { K: 0, A: 0, E: 0, R: 0, N: 0, C: 0, P: 0 },
    black: { K: 0, A: 0, E: 0, R: 0, N: 0, C: 0, P: 0 },
  };
  for (const piece of captured || []) {
    if (counts[piece.color] && Number.isFinite(counts[piece.color][piece.kind])) counts[piece.color][piece.kind] += 1;
  }
  return ["red", "black"]
    .map((color) => Object.keys(PIECE_COUNTS).map((kind) => counts[color][kind]).join(","))
    .join("/");
}

function centerDistance(r, c) {
  return Math.abs(r - (ROWS - 1) / 2) + Math.abs(c - (COLS - 1) / 2);
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function touchAiSearchNode(ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 127) === 0 && nowMs() >= ctx.deadline) throw SEARCH_TIMEOUT;
}

function pruneInformationTree(rootKey) {
  if (aiInformationTree.size <= AI_TREE_NODE_LIMIT) return;
  const entries = [...aiInformationTree.entries()];
  entries.sort((a, b) => {
    const aNode = a[1];
    const bNode = b[1];
    const aRoot = a[0] === rootKey ? 1 : 0;
    const bRoot = b[0] === rootKey ? 1 : 0;
    if (aRoot !== bRoot) return bRoot - aRoot;
    if (aNode.generation !== bNode.generation) return bNode.generation - aNode.generation;
    return bNode.visits - aNode.visits;
  });

  const keep = new Set(entries.slice(0, Math.floor(AI_TREE_NODE_LIMIT * 0.78)).map(([key]) => key));
  for (const [key, node] of entries) {
    const recent = aiSearchGeneration - node.generation <= AI_TREE_KEEP_GENERATIONS;
    if (!keep.has(key) && !recent) aiInformationTree.delete(key);
  }
  if (aiInformationTree.size > AI_TREE_NODE_LIMIT) {
    const remaining = [...aiInformationTree.entries()]
      .sort((a, b) => b[1].visits - a[1].visits)
      .slice(0, AI_TREE_NODE_LIMIT);
    aiInformationTree = new Map(remaining);
  }
}

function createSeededRng(seed) {
  let value = seed >>> 0;
  if (value === 0) value = 0x9e3779b9;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
}

function mixSeed(a, b) {
  let value = (a ^ Math.imul(b >>> 0, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function hashString32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleWithRng(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
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
    navigator.serviceWorker.register("./service-worker.js?v=mobile-r21-20260728-ismcts-alpha-beta").catch(() => {});
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
