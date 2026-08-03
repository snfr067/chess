const APP_VERSION = "learning-r1-20260729-online-imitation";

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
    label: "入門", thinkMs: 160, comboThinkMs: 90, maxDepth: 2,
    rootLimit: 9, nodeActionLimit: 7, moveQuota: 3, flipQuota: 3, darkQuota: 2,
    chanceOutcomeLimit: 6, maxTacticalExtensions: 3, minCompletedDepth: 1,
    minNodes: 90, earlyStopScoreGap: 520, captureGateWindow: 90,
    darkRiskPenalty: 80, flipRiskPenalty: 18, comboKnownMargin: 18, comboDarkMargin: 95,
    help: "模型資料不足時採用較簡單的快速備援；資料增加後會逐漸以您的棋路為主。",
  },
  normal: {
    label: "一般", thinkMs: 420, comboThinkMs: 170, maxDepth: 3,
    rootLimit: 13, nodeActionLimit: 10, moveQuota: 4, flipQuota: 4, darkQuota: 3,
    chanceOutcomeLimit: 9, maxTacticalExtensions: 5, minCompletedDepth: 2,
    minNodes: 260, earlyStopScoreGap: 420, captureGateWindow: 80,
    darkRiskPenalty: 65, flipRiskPenalty: 12, comboKnownMargin: 12, comboDarkMargin: 75,
    help: "模型資料不足時平衡模仿結果與快速局面判斷。",
  },
  hard: {
    label: "困難", thinkMs: 900, comboThinkMs: 320, maxDepth: 4,
    rootLimit: 17, nodeActionLimit: 13, moveQuota: 5, flipQuota: 5, darkQuota: 4,
    chanceOutcomeLimit: 12, maxTacticalExtensions: 7, minCompletedDepth: 2,
    minNodes: 600, earlyStopScoreGap: 320, captureGateWindow: 70,
    darkRiskPenalty: 52, flipRiskPenalty: 8, comboKnownMargin: 8, comboDarkMargin: 58,
    help: "模型資料不足時更重視安全吃子與避免立即被吃。",
  },
  master: {
    label: "強敵", thinkMs: 1800, comboThinkMs: 520, maxDepth: 5,
    rootLimit: 22, nodeActionLimit: 16, moveQuota: 6, flipQuota: 7, darkQuota: 5,
    chanceOutcomeLimit: 14, maxTacticalExtensions: 9, minCompletedDepth: 3,
    minNodes: 1200, earlyStopScoreGap: 240, captureGateWindow: 60,
    darkRiskPenalty: 42, flipRiskPenalty: 5, comboKnownMargin: 4, comboDarkMargin: 45,
    help: "模型資料不足時採用較穩健的快速備援；不執行耗時的多層搜尋。",
  },
};

const SEARCH_VALUE = { K: 950, A: 650, E: 520, R: 420, N: 340, C: 480, P: 220 };
const SEARCH_MATE = 100_000_000;
const SEARCH_FORBIDDEN = 50_000_000;
const SEARCH_TIMEOUT = { timeout: true };
const MAX_COMBO_STEPS = 15;
const MAX_TURN_HISTORY = 96;
const REPETITION_LIMIT = 3;
const AI_STEP_HARD_LIMIT_MS = 1900;
const AI_STEP_GUARD_MS = 70;
const AI_MODEL_DECISION_BUDGET_MS = 250;

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
function loadAiDelaySeconds() { const saved = Number.parseFloat(localStorage.getItem("darkChessAiDelaySeconds")); return Number.isFinite(saved) ? clamp(saved, 0.2, 0.7) : 0.5; }
function saveAiDelaySeconds(value) { localStorage.setItem("darkChessAiDelaySeconds", clamp(Number.parseFloat(value), 0.2, 0.7).toFixed(1)); }
function loadAiDelayMs() { return Math.round(loadAiDelaySeconds() * 1000); }
function formatSeconds(value) { return `${Number.parseFloat(value).toFixed(1)} 秒`; }
function isComboRuleEnabled() { return state && typeof state.comboRule === "boolean" ? state.comboRule : loadComboRule(); }
function actorDelay(actor, ratio = 1) { return actor === AI ? Math.max(220, Math.round(loadAiDelayMs() * ratio)) : Math.max(260, Math.round(520 * ratio)); }

function initDom() {
  for (const id of [
    "homeView", "settingsView", "gameView", "startGameBtn", "openSettingsBtn", "settingsBackBtn", "gameBackBtn", "newGameBtn", "endTurnBtn",
    "difficultySelect", "comboRuleCheckbox", "aiDelayRange", "aiDelayValue", "difficultyHelp", "board", "statusText", "detailText",
    "humanColorLabel", "aiColorLabel", "turnOrb", "redGrave", "blackGrave", "capturedCount", "leftGraveTitle", "rightGraveTitle", "leftGraveCount", "rightGraveCount", "toast", "modal", "modalTitle", "modalText", "modalHomeBtn", "modalRestartBtn",
    "learningModelStatus", "learningUpdatedAt", "learningGameCount", "learningGameBreakdown", "learningDecisionCount", "learningModelSize", "learningDataSize"
  ]) dom[id] = document.getElementById(id);
}

function bindEvents() {
  dom.startGameBtn.addEventListener("click", () => { newGame(); showView("game"); });
  dom.openSettingsBtn.addEventListener("click", () => { syncSettingsUI(); showView("settings"); });
  dom.settingsBackBtn.addEventListener("click", () => showView("home"));
  dom.gameBackBtn.addEventListener("click", () => { interruptCurrentGame(); hideModal(); showView("home"); });
  dom.newGameBtn.addEventListener("click", () => newGame());
  dom.endTurnBtn.addEventListener("click", async () => {
    if (!state || !state.combo.active || state.currentPlayer !== HUMAN || state.aiThinking || state.locked) return;
    await recordHumanLearningDecision(["stop"]);
    state.combo = { active: false, r: null, c: null };
    state.selected = null;
    endTurn();
  });
  dom.difficultySelect.addEventListener("change", () => { saveDifficulty(dom.difficultySelect.value); syncSettingsUI(); });
  dom.comboRuleCheckbox.addEventListener("change", () => { saveComboRule(dom.comboRuleCheckbox.checked); syncSettingsUI(); });
  dom.aiDelayRange.addEventListener("input", () => { saveAiDelaySeconds(dom.aiDelayRange.value); syncSettingsUI(); });
  dom.modalHomeBtn.addEventListener("click", () => { interruptCurrentGame(); hideModal(); showView("home"); });
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
  finishCurrentLearningGame("interrupted", "interrupted");
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
    learningGame: window.DarkChessLearning ? window.DarkChessLearning.createSession() : null,
  };
  setStatus("請先翻一顆棋。", "");
  render();
}

function finishCurrentLearningGame(status, outcome) {
  if (!state || !state.learningGame || !window.DarkChessLearning) return;
  if (state.learningGame.status !== "active") return;
  void window.DarkChessLearning.finishGame(state.learningGame, status, outcome);
}

function interruptCurrentGame() {
  finishCurrentLearningGame("interrupted", "interrupted");
  aiRunId += 1;
  if (!state) return;
  state.aiThinking = false;
  state.locked = true;
  state.pendingAction = null;
}

async function recordHumanLearningDecision(action) {
  if (!state || !state.learningGame || !window.DarkChessLearning) return false;
  const legalActions = generateLearningLegalActions(HUMAN);
  if (!legalActions.some((candidate) => sameAction(candidate, action))) return false;
  const snapshot = buildLearningSnapshot(HUMAN);
  try {
    return await window.DarkChessLearning.recordDecision(
      state.learningGame,
      snapshot,
      legalActions,
      action
    );
  } catch {
    return false;
  }
}

function buildLearningSnapshot(actor, comboPos = null) {
  const ownColor = state.playerColor[actor];
  const opponent = ownColor ? opponentColor(ownColor) : null;
  const board = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = state.board[r][c];
      if (!piece) board.push(".");
      else if (!piece.faceUp) board.push("D");
      else if (!ownColor) board.push(`${piece.color === "red" ? "r" : "b"}${piece.kind}`);
      else board.push(`${piece.color === ownColor ? "o" : "x"}${piece.kind}`);
    }
  }

  const unseen = getUnseenPool(state.board, state.captured);
  const ownPool = ownColor ? unseen.counts[ownColor] : unseen.counts.red;
  const opponentPool = opponent ? unseen.counts[opponent] : unseen.counts.black;
  const activeCombo = comboPos || (
    state.combo.active && state.currentPlayer === actor
      ? { r: state.combo.r, c: state.combo.c }
      : null
  );

  return {
    board,
    pool: {
      own: { ...ownPool },
      opponent: { ...opponentPool },
    },
    comboActive: Boolean(activeCombo),
    comboIndex: activeCombo ? activeCombo.r * COLS + activeCombo.c : -1,
  };
}

function generateLearningLegalActions(actor, comboPos = null) {
  if (!state) return [];
  const color = state.playerColor[actor];
  if (!color) {
    return generateActions(state.board, "red", {
      includeFlips: true,
      includeMoves: false,
      includeCaptures: false,
      includeDarkCaptures: false,
    });
  }

  const activeCombo = comboPos || (
    state.combo.active && state.currentPlayer === actor
      ? { r: state.combo.r, c: state.combo.c }
      : null
  );
  if (activeCombo) {
    return [
      ["stop"],
      ...generateCaptureActionsFrom(state.board, color, activeCombo, {
        includeDark: isComboRuleEnabled(),
      }),
    ];
  }

  return generateAllowedOpeningActions(state.board, actor, color);
}

function renderLearningStats(stats = null) {
  const modelStats = stats || (
    window.DarkChessLearning
      ? window.DarkChessLearning.getStats()
      : null
  );
  if (!modelStats || !dom.learningModelStatus) return;

  const statusLabels = {
    untrained: "尚未訓練",
    training: "更新中",
    ready: "已更新",
    error: "更新失敗",
  };
  dom.learningModelStatus.textContent = statusLabels[modelStats.status] || "準備中";
  dom.learningModelStatus.dataset.status = modelStats.status || "untrained";
  dom.learningUpdatedAt.textContent = modelStats.updatedAt
    ? formatLearningDate(modelStats.updatedAt)
    : "尚無更新";
  dom.learningGameCount.textContent = `${modelStats.learnedGames || 0} 局`;
  dom.learningGameBreakdown.textContent = `${modelStats.completedGames || 0}／${modelStats.interruptedGames || 0} 局`;
  dom.learningDecisionCount.textContent = `${modelStats.learnedDecisions || 0} 步`;
  dom.learningModelSize.textContent = formatLearningBytes(modelStats.modelBytes || 0);
  dom.learningDataSize.textContent = formatLearningBytes(modelStats.learningDataBytes || 0);
}

function formatLearningDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚無更新";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatLearningBytes(bytes) {
  const value = Math.max(0, Math.round(Number(bytes) || 0));
  if (value < 1024) return `${value.toLocaleString("zh-TW")} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB（${value.toLocaleString("zh-TW")} B）`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB（${value.toLocaleString("zh-TW")} B）`;
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
    finishCurrentLearningGame("completed", winnerPlayer === HUMAN ? "human_win" : "ai_win");
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
    setStatus("AI 正在模仿您的棋路", "");
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
  const comboEnabled = isComboRuleEnabled();

  const openingChoice = chooseLearnedAiAction();
  const action = openingChoice ? openingChoice.action : null;
  if (!isAiRunActive(runId)) return;
  if (!action) {
    state.aiThinking = false;
    state.locked = true;
    state.pendingAction = null;
    render();
    finishCurrentLearningGame("completed", "human_win");
    showModal("遊戲結束", "您獲勝。");
    return;
  }

  let result = await performVisibleAction(action, AI, {
    runId,
    stepStartedAt: nowMs() - (openingChoice.totalElapsedMs || 0),
  });
  if (!isAiRunActive(runId)) return;
  let winner = checkWinner(state.board);
  if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }

  if (comboEnabled && result.successCapture && result.lastMove) {
    let pos = { r: result.lastMove.r, c: result.lastMove.c };
    let guard = 0;
    while (guard < MAX_COMBO_STEPS) {
      guard += 1;
      const comboChoice = chooseLearnedAiAction(pos);
      if (!isAiRunActive(runId)) return;
      if (!comboChoice || comboChoice.action[0] === "stop") break;
      result = await performVisibleAction(comboChoice.action, AI, {
        runId,
        combo: true,
        stepStartedAt: nowMs() - (comboChoice.totalElapsedMs || 0),
      });
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

function chooseLearnedAiAction(comboPos = null) {
  if (!state || !state.playerColor[AI]) return null;
  const startedAt = nowMs();
  const legalActions = generateLearningLegalActions(AI, comboPos);
  if (legalActions.length === 0) return null;

  const difficulty = loadDifficulty();
  const fallbackScores = [];
  for (const action of legalActions) {
    fallbackScores.push(fastFallbackActionScore(action, state.playerColor[AI], difficulty));
    if (nowMs() - startedAt >= AI_MODEL_DECISION_BUDGET_MS) break;
  }
  while (fallbackScores.length < legalActions.length) fallbackScores.push(0);

  let choice = null;
  if (window.DarkChessLearning && nowMs() - startedAt < AI_MODEL_DECISION_BUDGET_MS) {
    choice = window.DarkChessLearning.chooseAction(
      buildLearningSnapshot(AI, comboPos),
      legalActions,
      fallbackScores
    );
  }

  if (!choice || nowMs() - startedAt >= AI_MODEL_DECISION_BUDGET_MS) {
    let bestIndex = 0;
    for (let index = 1; index < legalActions.length; index += 1) {
      if (fallbackScores[index] > fallbackScores[bestIndex]) bestIndex = index;
    }
    choice = {
      action: [...legalActions[bestIndex]],
      confidence: 0,
      styleWeight: 0,
      elapsedMs: nowMs() - startedAt,
    };
  }

  state.aiSearchInfo = {
    engine: "online-imitation-policy",
    elapsedMs: Math.round(nowMs() - startedAt),
    learnedGames: window.DarkChessLearning ? window.DarkChessLearning.getStats().learnedGames : 0,
    learnedDecisions: window.DarkChessLearning ? window.DarkChessLearning.getStats().learnedDecisions : 0,
    styleWeight: choice.styleWeight,
    confidence: choice.confidence,
    candidates: legalActions.length,
  };
  choice.totalElapsedMs = nowMs() - startedAt;
  return choice;
}

function fastFallbackActionScore(action, actorColor, difficulty) {
  const safetyWeight = {
    easy: 0.55,
    normal: 0.8,
    hard: 1,
    master: 1.15,
  }[difficulty] || 0.8;
  const kind = action[0];
  if (kind === "stop") return 24;
  if (kind === "flip") {
    return 40 - centerDistance(action[1], action[2]) * 3;
  }
  if (kind === "darkCapture") {
    const attacker = state.board[action[1]][action[2]];
    return 58 - (attacker ? SEARCH_VALUE[attacker.kind] * 0.025 * safetyWeight : 0);
  }

  const nextBoard = cloneBoard(state.board);
  const destination = { r: action[3], c: action[4] };
  const target = state.board[destination.r][destination.c];
  const result = applyAction(nextBoard, action);
  if (result.invalid) return -SEARCH_MATE;
  const exposedLoss = immediateKnownLossOnSquare(nextBoard, destination, actorColor);
  const centerBonus = 18 - centerDistance(destination.r, destination.c) * 3;

  if (kind === "capture") {
    const capturedValue = target ? SEARCH_VALUE[target.kind] : 0;
    const winning = checkWinner(nextBoard) === actorColor ? 100_000 : 0;
    return winning + 220 + capturedValue - exposedLoss * safetyWeight + centerBonus;
  }
  return 70 - exposedLoss * safetyWeight + centerBonus;
}

function isAiRunActive(runId) { return Boolean(state && state.aiThinking && state.currentPlayer === AI && runId === aiRunId); }

async function performVisibleAction(action, actor, options = {}) {
  if (!state || !action) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "invalid" };
  const stepStartedAt = Number.isFinite(options.stepStartedAt) ? options.stepStartedAt : nowMs();
  if (actor === HUMAN) await recordHumanLearningDecision(action);
  const historyMeta = captureActionHistoryMeta(state.board, action);
  state.locked = true;
  state.pendingAction = action;
  state.actionViz = buildActionViz(actor, action, null, "preview");
  state.actionViz.pulse = true;
  render();
  await sleep(capAiStepDelay(actor, actor === AI ? loadAiDelayMs() : 150, stepStartedAt));
  if (actor === AI && options.runId && !isAiRunActive(options.runId)) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "cancelled" };

  if (action[0] === "darkCapture") {
    const result = await performVisibleDarkCapture(action, actor, { ...options, stepStartedAt });
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
  await playAnimation(action, result, capAiStepDelay(actor, actorDelay(actor, 0.72), stepStartedAt));
  state.pendingAction = null;
  state.locked = false;
  render();
  return result;
}

async function performVisibleDarkCapture(action, actor, options = {}) {
  const stepStartedAt = Number.isFinite(options.stepStartedAt) ? options.stepStartedAt : nowMs();
  const [, sr, sc, dr, dc] = action;
  const src = { r: sr, c: sc };
  const dst = { r: dr, c: dc };
  if (!canAttemptHiddenCapturePath(state.board, src, dst)) {
    const invalid = { type: "darkCapture", successCapture: false, captured: null, lastMove: null, invalid: true };
    state.actionViz = buildActionViz(actor, action, invalid, "fail");
    await playAnimation(action, invalid, capAiStepDelay(actor, actorDelay(actor, 0.5), stepStartedAt));
    return invalid;
  }

  const target = state.board[dr][dc];
  if (target) target.faceUp = true;
  const revealed = target ? { ...target, faceUp: true } : null;
  const revealResult = { type: "darkCapture", phase: "reveal", successCapture: false, captured: null, revealed, lastMove: { r: dr, c: dc }, invalid: false };
  state.lastMove = { kind: "darkReveal", r: dr, c: dc };
  state.actionViz = buildActionViz(actor, action, revealResult, "reveal");
  await playAnimation(["flip", dr, dc], revealResult, capAiStepDelay(actor, actorDelay(actor, actor === AI ? 0.95 : 1.05), stepStartedAt));
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
    await playAnimation(action, result, capAiStepDelay(actor, actorDelay(actor, 0.72), stepStartedAt));
    return result;
  }

  const fail = { type: "darkCapture", successCapture: false, captured: null, revealed, lastMove: { r: dr, c: dc }, invalid: false };
  state.lastMove = { kind: "darkCaptureFail", r: dr, c: dc };
  state.actionViz = buildActionViz(actor, action, fail, "fail");
  await playAnimation(action, fail, capAiStepDelay(actor, actorDelay(actor, 0.8), stepStartedAt));
  return fail;
}

function capAiStepDelay(actor, desiredMs, stepStartedAt) {
  if (actor !== AI) return Math.max(0, desiredMs);
  const remaining = AI_STEP_HARD_LIMIT_MS - AI_STEP_GUARD_MS - (nowMs() - stepStartedAt);
  return Math.max(0, Math.min(desiredMs, remaining));
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
 * Dark Chess AI engine — certainty-first expectiminimax
 *
 * Invariants:
 * 1. Face-down identities are never inspected. Only the remaining public pool is used.
 * 2. A deterministic, profitable known capture receives a guaranteed tactical floor.
 * 3. Continuing a capture chain can never reduce the value of stopping immediately.
 * 4. Chance search compares complete public outcomes; random exploration cannot overrule
 *    a clearly superior deterministic tactic.
 * 5. Visible captures are always retained when action lists are shortened.
 */

const AI_CACHE_LIMIT = 45_000;
const AI_TIME_CHECK_MASK = 63;
const AI_SAFE_CAPTURE_MIN_NET = 70;
const AI_SAFE_CAPTURE_TOLERANCE = 45;
const AI_MATE_DISTANCE_STEP = 120;

let aiPersistentCache = new Map();

function resetAiSearchEngine() {
  aiPersistentCache = new Map();
}

async function findBestAction(board, aiColor, humanColor, diff, options = {}) {
  const result = await certaintyFirstSearch(board, aiColor, humanColor, diff, {
    captured: cloneCaptured(options.captured || (state ? state.captured : [])),
    comboEnabled: Boolean(options.includeDarkCaptures),
    comboPos: null,
    comboSteps: 0,
    thinkMs: options.thinkMs,
    seed: options.seed,
  });
  return result ? result.action : null;
}

async function chooseBestComboAction(board, aiColor, humanColor, pos, diff, options = {}) {
  const result = await certaintyFirstSearch(board, aiColor, humanColor, diff, {
    captured: cloneCaptured(options.captured || (state ? state.captured : [])),
    comboEnabled: true,
    comboPos: pos ? { r: pos.r, c: pos.c } : null,
    comboSteps: Number.isFinite(options.comboSteps) ? options.comboSteps : 1,
    thinkMs: options.thinkMs ?? diff.comboThinkMs,
    seed: options.seed,
  });
  if (!result || !result.action || result.action[0] === "stop") return null;
  return { action: result.action, score: result.score, stats: result.stats };
}

async function certaintyFirstSearch(board, aiColor, humanColor, diff, options = {}) {
  const searchId = `${Date.now()}-${Math.random()}`;
  const startedAt = nowMs();
  const budgetMs = Math.max(40, Number.isFinite(options.thinkMs) ? options.thinkMs : diff.thinkMs);
  const ctx = {
    searchId,
    rootColor: aiColor,
    opponentColor: humanColor,
    diff,
    deadline: startedAt + budgetMs,
    nodes: 0,
    chanceNodes: 0,
    cacheHits: 0,
    depthCompleted: 0,
    rng: createSeededRng(Number.isFinite(options.seed)
      ? options.seed
      : mixSeed(hashString32(visiblePositionKey(board, aiColor)), Math.floor(startedAt))),
    localCache: new Map(),
  };

  const root = createCertaintyState({
    board: cloneBoard(board),
    captured: cloneCaptured(options.captured || []),
    currentColor: aiColor,
    comboEnabled: Boolean(options.comboEnabled),
    comboPos: options.comboPos ? { ...options.comboPos } : null,
    comboSteps: options.comboSteps || 0,
    positionCounts: state && state.positionCounts ? state.positionCounts : null,
  });

  let rootActions = generateCertaintyActions(root, ctx, true);
  if (rootActions.length === 0) return null;

  const rootRows = prepareCertaintyRows(root, rootActions, ctx, true);
  rootActions = applyKnownCaptureGate(root, rootRows, ctx);
  const selectedKeys = new Set(rootActions.map((row) => row.key));
  const candidateRows = rootRows.filter((row) => selectedKeys.has(row.key));

  let bestCompleted = candidateRows.map((row) => ({
    ...row,
    score: row.priorScore,
    depth: 0,
  }));

  for (let depth = 1; depth <= diff.maxDepth; depth += 1) {
    const depthRows = [];
    let completed = true;
    const ordered = [...bestCompleted]
      .sort((a, b) => b.score - a.score || b.priorScore - a.priorScore || a.key.localeCompare(b.key));

    try {
      for (const previous of ordered) {
        touchCertaintyNode(ctx, true);
        const row = candidateRows.find((item) => item.key === previous.key) || previous;
        const score = evaluateCertaintyAction(root, row.action, depth, -SEARCH_MATE, SEARCH_MATE, ctx, true);
        depthRows.push({ ...row, score, depth });
      }
    } catch (error) {
      if (error !== SEARCH_TIMEOUT) throw error;
      completed = false;
    }

    if (completed && depthRows.length === candidateRows.length) {
      bestCompleted = depthRows.sort(compareCertaintyRows);
      ctx.depthCompleted = depth;
      if (certaintyCanStopEarly(bestCompleted, ctx)) break;
    }

    if (nowMs() >= ctx.deadline || !completed) break;
    await yieldAiSearch();
  }

  bestCompleted.sort(compareCertaintyRows);
  let best = bestCompleted[0] || null;

  if (root.comboPos) {
    const stopRow = bestCompleted.find((row) => row.action[0] === "stop")
      || candidateRows.find((row) => row.action[0] === "stop");
    if (stopRow && best && best.action[0] !== "stop") {
      const stopScore = Number.isFinite(stopRow.score) ? stopRow.score : stopRow.priorScore;
      const margin = comboContinueRequiredMargin(best.action, root, ctx);
      if (best.score < stopScore + margin) best = { ...stopRow, score: stopScore };
    }
  }

  const elapsedMs = Math.max(0, nowMs() - startedAt);
  const info = {
    engine: "certainty-first-expectiminimax",
    depth: ctx.depthCompleted,
    nodes: ctx.nodes,
    chanceNodes: ctx.chanceNodes,
    cacheHits: ctx.cacheHits,
    elapsedMs: Math.round(elapsedMs),
    captureGate: candidateRows.length < rootRows.length,
    candidates: bestCompleted.slice(0, 8).map((row) => ({
      action: [...row.action],
      score: Math.round(row.score),
      prior: Math.round(row.priorScore),
      guarantee: Number.isFinite(row.guarantee) ? Math.round(row.guarantee) : null,
      netCapture: Number.isFinite(row.netCapture) ? Math.round(row.netCapture) : null,
    })),
  };
  if (state) state.aiSearchInfo = info;

  trimAiCache();
  return best ? { action: [...best.action], score: best.score, stats: info } : null;
}

function createCertaintyState(options) {
  return {
    board: options.board,
    captured: cloneCaptured(options.captured || []),
    currentColor: options.currentColor,
    comboEnabled: Boolean(options.comboEnabled),
    comboPos: options.comboPos ? { ...options.comboPos } : null,
    comboSteps: options.comboSteps || 0,
    positionCounts: { ...(options.positionCounts || {}) },
  };
}

function cloneCertaintyState(sim) {
  return createCertaintyState({
    board: cloneBoard(sim.board),
    captured: sim.captured,
    currentColor: sim.currentColor,
    comboEnabled: sim.comboEnabled,
    comboPos: sim.comboPos,
    comboSteps: sim.comboSteps,
    positionCounts: sim.positionCounts,
  });
}

function generateCertaintyActions(sim, ctx, isRoot = false) {
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

  const unique = [];
  for (const action of actions) {
    if (action[0] === "move") {
      if (certaintyMoveForbidden(sim, action)) continue;
      if (isRoot && sim.currentColor === ctx.rootColor) {
        const policy = evaluateAiOpeningPolicy(sim.board, action, ctx.rootColor, ctx.opponentColor);
        if (policy.forbidden) continue;
      }
    }
    if (!unique.some((existing) => sameAction(existing, action))) unique.push(action);
  }
  return unique;
}

function prepareCertaintyRows(sim, actions, ctx, isRoot) {
  const rows = actions.map((action) => {
    const details = certaintyActionPrior(sim, action, sim.currentColor, ctx);
    return {
      action: [...action],
      key: actionKey(action),
      priorScore: details.score,
      guarantee: details.guarantee,
      netCapture: details.netCapture,
      deterministic: details.deterministic,
    };
  }).sort((a, b) => b.priorScore - a.priorScore || a.key.localeCompare(b.key));

  const limit = isRoot ? ctx.diff.rootLimit : ctx.diff.nodeActionLimit;
  if (rows.length <= limit) return rows;

  const selected = [];
  const add = (row) => {
    if (row && !selected.some((item) => item.key === row.key)) selected.push(row);
  };

  for (const row of rows) if (row.action[0] === "capture") add(row);
  if (sim.comboPos) add(rows.find((row) => row.action[0] === "stop"));
  for (const type of ["move", "darkCapture", "flip"]) {
    const typeRows = rows.filter((row) => row.action[0] === type);
    const quota = type === "flip" ? ctx.diff.flipQuota : type === "darkCapture" ? ctx.diff.darkQuota : ctx.diff.moveQuota;
    for (const row of typeRows.slice(0, quota)) add(row);
  }
  for (const row of rows) {
    if (selected.length >= limit) break;
    add(row);
  }
  return selected.slice(0, Math.max(limit, selected.filter((row) => row.action[0] === "capture").length));
}

function applyKnownCaptureGate(sim, rows, ctx) {
  const captures = rows.filter((row) => row.action[0] === "capture");
  if (captures.length === 0) return rows;

  const actor = sim.currentColor;
  const actorMaximizes = actor === ctx.rootColor;
  const baseline = evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  const enriched = captures.map((row) => {
    const guaranteeInfo = knownCaptureGuarantee(sim, row.action, ctx);
    return { ...row, ...guaranteeInfo };
  });

  const safe = enriched.filter((row) => row.mate || row.netCapture >= AI_SAFE_CAPTURE_MIN_NET);
  if (safe.length === 0) return rows;

  const bestSafe = [...safe].sort((a, b) => {
    if (actorMaximizes) return b.guarantee - a.guarantee;
    return a.guarantee - b.guarantee;
  })[0];

  const alternatives = rows.filter((row) => row.action[0] !== "capture");
  let bestAlternative = baseline;
  for (const row of alternatives) {
    const value = row.priorScore;
    bestAlternative = actorMaximizes ? Math.max(bestAlternative, value) : Math.min(bestAlternative, value);
  }

  const clearlyAtLeastAsGood = actorMaximizes
    ? bestSafe.guarantee >= bestAlternative - AI_SAFE_CAPTURE_TOLERANCE
    : bestSafe.guarantee <= bestAlternative + AI_SAFE_CAPTURE_TOLERANCE;
  if (!bestSafe.mate && !clearlyAtLeastAsGood) return rows;

  const kept = safe.filter((row) => actorMaximizes
    ? row.guarantee >= bestSafe.guarantee - ctx.diff.captureGateWindow
    : row.guarantee <= bestSafe.guarantee + ctx.diff.captureGateWindow);

  if (sim.comboPos) {
    const stop = rows.find((row) => row.action[0] === "stop");
    if (stop) kept.push(stop);
  }
  return kept;
}

function knownCaptureGuarantee(sim, action, ctx) {
  const target = sim.board[action[3]][action[4]];
  const attacker = sim.board[action[1]][action[2]];
  if (!target || !attacker) return { guarantee: -SEARCH_MATE, netCapture: -SEARCH_MATE, mate: false };

  const next = cloneCertaintyState(sim);
  const transition = applyDeterministicCertaintyAction(next, action);
  if (transition.invalid) return { guarantee: -SEARCH_MATE, netCapture: -SEARCH_MATE, mate: false };
  const winner = publicWinner(next);
  if (winner === sim.currentColor) {
    const mateScore = sim.currentColor === ctx.rootColor ? SEARCH_MATE : -SEARCH_MATE;
    return { guarantee: mateScore, netCapture: SEARCH_MATE, mate: true };
  }

  if (next.comboPos) endCertaintyTurn(next);
  const recaptureLoss = immediateKnownLossOnSquare(next.board, { r: action[3], c: action[4] }, sim.currentColor);
  const netCapture = SEARCH_VALUE[target.kind] - recaptureLoss;
  const position = evaluateVisibleReplyFloor(next, ctx, 1);
  const captureBonus = netCapture * (sim.currentColor === ctx.rootColor ? 0.55 : -0.55);
  return {
    guarantee: position + captureBonus,
    netCapture,
    mate: false,
  };
}

function evaluateVisibleReplyFloor(sim, ctx, plies) {
  if (plies <= 0) return evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  const winner = publicWinner(sim);
  if (winner !== null) return winner === ctx.rootColor ? SEARCH_MATE : -SEARCH_MATE;

  const captures = generateActions(sim.board, sim.currentColor, {
    includeFlips: false,
    includeMoves: false,
    includeCaptures: true,
    includeDarkCaptures: false,
  }).filter((action) => !certaintyMoveForbidden(sim, action));
  if (captures.length === 0) return evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);

  const maximizing = sim.currentColor === ctx.rootColor;
  let best = maximizing ? -SEARCH_MATE : SEARCH_MATE;
  for (const action of captures) {
    const next = cloneCertaintyState(sim);
    const transition = applyDeterministicCertaintyAction(next, action);
    if (transition.invalid) continue;
    if (next.comboPos) endCertaintyTurn(next);
    const value = evaluateVisibleReplyFloor(next, ctx, plies - 1);
    best = maximizing ? Math.max(best, value) : Math.min(best, value);
  }
  return best;
}

function evaluateCertaintyAction(sim, action, depth, alpha, beta, ctx, isRoot = false) {
  if (action[0] === "flip" || action[0] === "darkCapture") {
    return evaluateChanceAction(sim, action, depth, alpha, beta, ctx, isRoot);
  }
  const next = cloneCertaintyState(sim);
  const transition = applyDeterministicCertaintyAction(next, action);
  if (transition.invalid) return sim.currentColor === ctx.rootColor ? -SEARCH_MATE : SEARCH_MATE;
  const nextDepth = transition.turnEnded ? depth - 1 : depth;
  return certaintySearchNode(next, nextDepth, alpha, beta, ctx, 0);
}

function certaintySearchNode(sim, depth, alpha, beta, ctx, extensionDepth) {
  touchCertaintyNode(ctx);
  const winner = publicWinner(sim);
  if (winner !== null) {
    const distance = Math.max(0, ctx.diff.maxDepth - depth) + extensionDepth;
    return winner === ctx.rootColor ? SEARCH_MATE - distance * AI_MATE_DISTANCE_STEP : -SEARCH_MATE + distance * AI_MATE_DISTANCE_STEP;
  }

  if (depth <= 0) return certaintyQuiescence(sim, alpha, beta, ctx, extensionDepth);

  const key = certaintyCacheKey(sim, depth, extensionDepth, ctx.rootColor);
  const cached = ctx.localCache.get(key) ?? aiPersistentCache.get(key);
  if (cached !== undefined) {
    ctx.cacheHits += 1;
    return cached;
  }

  const actions = generateCertaintyActions(sim, ctx, false);
  if (actions.length === 0) return sim.currentColor === ctx.rootColor ? -SEARCH_MATE : SEARCH_MATE;
  const rows = prepareCertaintyRows(sim, actions, ctx, false);
  const gated = applyKnownCaptureGate(sim, rows, ctx);
  const maximizing = sim.currentColor === ctx.rootColor;
  let best = maximizing ? -SEARCH_MATE : SEARCH_MATE;
  let exact = true;

  for (const row of gated) {
    const value = evaluateCertaintyAction(sim, row.action, depth, alpha, beta, ctx, false);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      exact = false;
      break;
    }
  }

  if (exact && Number.isFinite(best)) {
    ctx.localCache.set(key, best);
    aiPersistentCache.set(key, best);
  }
  return best;
}

function certaintyQuiescence(sim, alpha, beta, ctx, extensionDepth) {
  touchCertaintyNode(ctx);
  const stand = evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  if (extensionDepth >= ctx.diff.maxTacticalExtensions) return stand;

  let actions;
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
  if (actions.length === 0) return stand;

  const maximizing = sim.currentColor === ctx.rootColor;
  let best = stand;
  if (maximizing) alpha = Math.max(alpha, stand);
  else beta = Math.min(beta, stand);
  if (beta <= alpha) return stand;

  const rows = prepareCertaintyRows(sim, actions, ctx, false);
  const gated = applyKnownCaptureGate(sim, rows, ctx);
  for (const row of gated) {
    const next = cloneCertaintyState(sim);
    const transition = applyDeterministicCertaintyAction(next, row.action);
    if (transition.invalid) continue;
    const value = certaintyQuiescence(next, alpha, beta, ctx, extensionDepth + 1);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function evaluateChanceAction(sim, action, depth, alpha, beta, ctx, isRoot) {
  touchCertaintyNode(ctx);
  ctx.chanceNodes += 1;
  const outcomes = publicUnseenOutcomes(sim);
  if (outcomes.length === 0) return sim.currentColor === ctx.rootColor ? -SEARCH_MATE : SEARCH_MATE;

  const ordered = [...outcomes].sort((a, b) => {
    const aImpact = a.count * SEARCH_VALUE[a.kind];
    const bImpact = b.count * SEARCH_VALUE[b.kind];
    return bImpact - aImpact;
  });
  const limit = isRoot ? ordered.length : Math.min(ordered.length, ctx.diff.chanceOutcomeLimit);
  const exactOutcomes = ordered.slice(0, limit);
  const approximateOutcomes = ordered.slice(limit);

  let expected = 0;
  let probabilityUsed = 0;
  for (const outcome of exactOutcomes) {
    touchCertaintyNode(ctx);
    const next = cloneCertaintyState(sim);
    const transition = applyChanceOutcome(next, action, outcome);
    if (transition.invalid) continue;
    const nextDepth = transition.turnEnded ? depth - 1 : depth;
    const value = certaintySearchNode(next, nextDepth, alpha, beta, ctx, 0);
    expected += outcome.probability * value;
    probabilityUsed += outcome.probability;
  }

  for (const outcome of approximateOutcomes) {
    const next = cloneCertaintyState(sim);
    const transition = applyChanceOutcome(next, action, outcome);
    if (transition.invalid) continue;
    const value = evaluatePublicPosition(next, ctx.rootColor, ctx.diff);
    expected += outcome.probability * value;
    probabilityUsed += outcome.probability;
  }

  if (probabilityUsed <= 0) return evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  return expected / probabilityUsed;
}

function applyDeterministicCertaintyAction(sim, action) {
  if (!action) return { invalid: true, turnEnded: false };
  if (action[0] === "stop") {
    endCertaintyTurn(sim);
    return { invalid: false, turnEnded: true, stopped: true };
  }
  if (action[0] === "flip" || action[0] === "darkCapture") return { invalid: true, turnEnded: false };

  const result = applyAction(sim.board, action);
  if (result.invalid) return { invalid: true, turnEnded: false, result };
  if (result.captured) sim.captured.push({ ...result.captured, faceUp: true });

  const winner = publicWinner(sim);
  if (winner !== null) return { invalid: false, turnEnded: false, winner, result };

  if (result.successCapture && sim.comboEnabled && result.lastMove && sim.comboSteps < MAX_COMBO_STEPS) {
    const nextPos = { r: result.lastMove.r, c: result.lastMove.c };
    if (hasCaptureOpportunityFrom(sim.board, sim.currentColor, nextPos, { includeDark: true })) {
      sim.comboPos = nextPos;
      sim.comboSteps += 1;
      return { invalid: false, turnEnded: false, result };
    }
  }

  endCertaintyTurn(sim);
  return { invalid: false, turnEnded: true, result };
}

function applyChanceOutcome(sim, action, outcome) {
  const actorColor = sim.currentColor;
  if (action[0] === "flip") {
    const [, r, c] = action;
    const existing = sim.board[r][c];
    if (!existing || existing.faceUp) return { invalid: true, turnEnded: false };
    sim.board[r][c] = {
      color: outcome.color,
      kind: outcome.kind,
      faceUp: true,
      id: existing.id || `chance-${r}-${c}-${outcome.color}-${outcome.kind}`,
    };
    endCertaintyTurn(sim);
    return { invalid: false, turnEnded: true, revealed: true };
  }

  if (action[0] === "darkCapture") {
    const [, sr, sc, dr, dc] = action;
    const target = sim.board[dr][dc];
    if (!target || target.faceUp || !canAttemptHiddenCapturePath(sim.board, { r: sr, c: sc }, { r: dr, c: dc })) {
      return { invalid: true, turnEnded: false };
    }
    sim.board[dr][dc] = {
      color: outcome.color,
      kind: outcome.kind,
      faceUp: true,
      id: target.id || `chance-${dr}-${dc}-${outcome.color}-${outcome.kind}`,
    };

    if (canCapture(sim.board, { r: sr, c: sc }, { r: dr, c: dc })) {
      const captured = { ...sim.board[dr][dc], faceUp: true };
      sim.board[dr][dc] = sim.board[sr][sc];
      sim.board[sr][sc] = null;
      sim.captured.push(captured);
      const winner = publicWinner(sim);
      if (winner !== null) return { invalid: false, turnEnded: false, winner, successCapture: true };
      if (sim.comboEnabled && sim.comboSteps < MAX_COMBO_STEPS) {
        const nextPos = { r: dr, c: dc };
        if (hasCaptureOpportunityFrom(sim.board, actorColor, nextPos, { includeDark: true })) {
          sim.comboPos = nextPos;
          sim.comboSteps += 1;
          return { invalid: false, turnEnded: false, successCapture: true };
        }
      }
    }

    endCertaintyTurn(sim);
    return { invalid: false, turnEnded: true, successCapture: false };
  }

  return { invalid: true, turnEnded: false };
}

function endCertaintyTurn(sim) {
  sim.currentColor = opponentColor(sim.currentColor);
  sim.comboPos = null;
  sim.comboSteps = 0;
  const key = visiblePositionKey(sim.board, sim.currentColor);
  sim.positionCounts[key] = (sim.positionCounts[key] || 0) + 1;
}

function certaintyActionPrior(sim, action, actorColor, ctx) {
  const before = evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  const actorSign = actorColor === ctx.rootColor ? 1 : -1;

  if (action[0] === "capture") {
    const target = sim.board[action[3]][action[4]];
    const guarantee = knownCaptureGuarantee(sim, action, ctx);
    const targetValue = target ? SEARCH_VALUE[target.kind] : 0;
    return {
      score: guarantee.guarantee + actorSign * targetValue * 0.35,
      guarantee: guarantee.guarantee,
      netCapture: guarantee.netCapture,
      deterministic: true,
    };
  }

  if (action[0] === "move" || action[0] === "stop") {
    const next = cloneCertaintyState(sim);
    const transition = applyDeterministicCertaintyAction(next, action);
    if (transition.invalid) return { score: actorSign > 0 ? -SEARCH_MATE : SEARCH_MATE, guarantee: null, netCapture: null, deterministic: true };
    const after = evaluatePublicPosition(next, ctx.rootColor, ctx.diff);
    return { score: after + (after - before) * 0.18, guarantee: after, netCapture: null, deterministic: true };
  }

  const expected = expectedImmediateChanceValue(sim, action, ctx);
  return { score: expected, guarantee: null, netCapture: null, deterministic: false };
}

function expectedImmediateChanceValue(sim, action, ctx) {
  const outcomes = publicUnseenOutcomes(sim);
  if (outcomes.length === 0) return evaluatePublicPosition(sim, ctx.rootColor, ctx.diff);
  let total = 0;
  for (const outcome of outcomes) {
    const next = cloneCertaintyState(sim);
    const transition = applyChanceOutcome(next, action, outcome);
    if (transition.invalid) continue;
    total += outcome.probability * evaluatePublicPosition(next, ctx.rootColor, ctx.diff);
  }
  const uncertaintyPenalty = action[0] === "darkCapture" ? ctx.diff.darkRiskPenalty : ctx.diff.flipRiskPenalty;
  const actorSign = sim.currentColor === ctx.rootColor ? 1 : -1;
  return total - actorSign * uncertaintyPenalty;
}

function evaluatePublicPosition(sim, perspectiveColor, diff) {
  const winner = publicWinner(sim);
  if (winner !== null) return winner === perspectiveColor ? SEARCH_MATE : -SEARCH_MATE;

  const opponent = opponentColor(perspectiveColor);
  const pool = getUnseenPool(sim.board, sim.captured);
  const material = { red: 0, black: 0 };
  const visible = { red: [], black: [] };

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = sim.board[r][c];
      if (!piece || !piece.faceUp) continue;
      material[piece.color] += SEARCH_VALUE[piece.kind];
      visible[piece.color].push({ piece, r, c });
    }
  }
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) material[color] += pool.counts[color][kind] * SEARCH_VALUE[kind];
  }

  const features = { red: 0, black: 0 };
  for (const color of ["red", "black"]) {
    const enemy = opponentColor(color);
    const captures = generateActions(sim.board, color, {
      includeFlips: false,
      includeMoves: false,
      includeCaptures: true,
      includeDarkCaptures: false,
    });
    const moves = generateActions(sim.board, color, {
      includeFlips: false,
      includeMoves: true,
      includeCaptures: false,
      includeDarkCaptures: false,
    });

    features[color] += captures.length * 32 + moves.length * 8;
    for (const action of captures) {
      const target = sim.board[action[3]][action[4]];
      if (target) features[color] += SEARCH_VALUE[target.kind] * 0.23;
    }

    for (const item of visible[color]) {
      const pos = { r: item.r, c: item.c };
      const pieceValue = SEARCH_VALUE[item.piece.kind];
      const loss = immediateKnownLossOnSquare(sim.board, pos, color);
      if (loss > 0) features[color] -= Math.min(pieceValue, loss) * 0.62;
      const support = visibleFriendlySupport(sim.board, pos, color);
      features[color] += Math.min(2, support) * pieceValue * 0.06;
      features[color] -= centerDistance(item.r, item.c) * 4;

      let adjacentHidden = 0;
      for (const nb of neighbors(item.r, item.c)) {
        const target = sim.board[nb.r][nb.c];
        if (target && !target.faceUp) adjacentHidden += 1;
      }
      features[color] += Math.min(2, adjacentHidden) * 10;

      if (item.piece.kind === "P") {
        for (const nb of neighbors(item.r, item.c)) {
          const target = sim.board[nb.r][nb.c];
          if (target && target.faceUp && target.color === enemy && target.kind === "K") features[color] += SEARCH_VALUE.K * 0.75;
        }
      }
    }
  }

  const tempo = sim.currentColor === perspectiveColor ? 18 : -18;
  const combo = sim.comboPos
    ? (sim.currentColor === perspectiveColor ? 25 : -25)
    : 0;
  return (material[perspectiveColor] - material[opponent])
    + (features[perspectiveColor] - features[opponent])
    + tempo
    + combo;
}

function publicWinner(sim) {
  const pool = getUnseenPool(sim.board, sim.captured);
  const alive = { red: 0, black: 0 };
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = sim.board[r][c];
      if (piece && piece.faceUp) alive[piece.color] += 1;
    }
  }
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) alive[color] += pool.counts[color][kind];
  }
  if (alive.red > 0 && alive.black > 0) return null;
  if (alive.red > 0) return "red";
  if (alive.black > 0) return "black";
  return null;
}

function publicUnseenOutcomes(sim) {
  const pool = getUnseenPool(sim.board, sim.captured);
  if (!pool.total) return [];
  const outcomes = [];
  for (const color of ["red", "black"]) {
    for (const kind of Object.keys(PIECE_COUNTS)) {
      const count = pool.counts[color][kind];
      if (count > 0) outcomes.push({ color, kind, count, probability: count / pool.total });
    }
  }
  return outcomes;
}

function immediateKnownLossOnSquare(board, pos, ownColor) {
  const piece = board[pos.r] ? board[pos.r][pos.c] : null;
  if (!piece || !piece.faceUp || piece.color !== ownColor) return 0;
  const enemy = opponentColor(ownColor);
  let loss = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const attacker = board[r][c];
      if (!attacker || !attacker.faceUp || attacker.color !== enemy) continue;
      if (canCapture(board, { r, c }, pos)) loss = Math.max(loss, SEARCH_VALUE[piece.kind]);
    }
  }
  return loss;
}

function visibleFriendlySupport(board, pos, color) {
  let count = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (r === pos.r && c === pos.c) continue;
      const piece = board[r][c];
      if (!piece || !piece.faceUp || piece.color !== color) continue;
      const hypothetical = { ...board[pos.r][pos.c], color: opponentColor(color), faceUp: true };
      if (canHypotheticalCapture(board, { r, c }, pos, hypothetical)) count += 1;
    }
  }
  return count;
}

function certaintyMoveForbidden(sim, action) {
  if (action[0] !== "move") return false;
  const nextBoard = cloneBoard(sim.board);
  const result = applyAction(nextBoard, action);
  if (result.invalid) return true;
  const nextKey = visiblePositionKey(nextBoard, opponentColor(sim.currentColor));
  return (sim.positionCounts[nextKey] || 0) >= REPETITION_LIMIT - 1;
}

function certaintyCacheKey(sim, depth, extensionDepth, rootColor) {
  const combo = sim.comboPos ? `${sim.comboPos.r},${sim.comboPos.c},${sim.comboSteps}` : "-";
  return `${visiblePositionKey(sim.board, sim.currentColor)}|cap=${capturedCountKey(sim.captured)}|combo=${combo}|d=${depth}|x=${extensionDepth}|root=${rootColor}`;
}

function comboContinueRequiredMargin(action, sim, ctx) {
  if (action[0] === "capture") {
    const guarantee = knownCaptureGuarantee(sim, action, ctx);
    return guarantee.netCapture >= AI_SAFE_CAPTURE_MIN_NET ? -5 : ctx.diff.comboKnownMargin;
  }
  if (action[0] === "darkCapture") return ctx.diff.comboDarkMargin;
  return ctx.diff.comboKnownMargin;
}

function certaintyCanStopEarly(rows, ctx) {
  if (rows.length < 2 || ctx.depthCompleted < ctx.diff.minCompletedDepth) return false;
  const gap = rows[0].score - rows[1].score;
  return gap >= ctx.diff.earlyStopScoreGap && ctx.nodes >= ctx.diff.minNodes;
}

function compareCertaintyRows(a, b) {
  return b.score - a.score
    || b.priorScore - a.priorScore
    || a.key.localeCompare(b.key);
}

function actionKey(action) {
  return action.join(":");
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

function touchCertaintyNode(ctx, force = false) {
  ctx.nodes += 1;
  if ((force || (ctx.nodes & AI_TIME_CHECK_MASK) === 0) && nowMs() >= ctx.deadline) throw SEARCH_TIMEOUT;
}

function trimAiCache() {
  if (aiPersistentCache.size <= AI_CACHE_LIMIT) return;
  const keep = [...aiPersistentCache.entries()].slice(-Math.floor(AI_CACHE_LIMIT * 0.72));
  aiPersistentCache = new Map(keep);
}

function yieldAiSearch() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
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
    finishCurrentLearningGame("completed", "ai_win");
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
function showWinner(winnerColor) {
  state.locked = true;
  finishCurrentLearningGame(
    "completed",
    state.playerColor[HUMAN] === winnerColor ? "human_win" : "ai_win"
  );
  render();
  showModal("遊戲結束", state.playerColor[HUMAN] === winnerColor ? "您獲勝。" : "AI 獲勝。");
}
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
    navigator.serviceWorker.register("./service-worker.js?v=learning-r1-20260729-online-imitation").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  applyFixedLandscapeStage();
  const versionBadge = document.getElementById("versionBadge");
  if (versionBadge) versionBadge.textContent = `版本：${APP_VERSION}`;
  initDom();
  bindEvents();
  syncSettingsUI();
  createBoardButtons();
  showView("home");
  if (window.DarkChessLearning) {
    window.DarkChessLearning.subscribe(renderLearningStats);
    await window.DarkChessLearning.init();
    renderLearningStats();
  }
  newGame();
  registerServiceWorker();
});
