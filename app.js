const APP_VERSION = "learning-v2-20260805-exact-worker";

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
const SEARCH_FORBIDDEN = 50_000_000;
const MAX_COMBO_STEPS = 15;
const MAX_TURN_HISTORY = 96;
const REPETITION_LIMIT = 3;
const AI_STEP_HARD_LIMIT_MS = 1900;
const AI_STEP_GUARD_MS = 70;

let state = null;
let aiRunId = 0;
let toastTimer = null;
let aiWorker = null;
let aiWorkerRequestId = 0;
const aiWorkerRequests = new Map();
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
function actorDelay(actor, ratio = 1) { return Math.max(120, Math.round(loadAiDelayMs() * ratio)); }
function loadCorrectionMode() { const saved = localStorage.getItem("darkChessCorrectionMode"); return saved === null ? true : saved === "true"; }
function saveCorrectionMode(enabled) { localStorage.setItem("darkChessCorrectionMode", enabled ? "true" : "false"); }
function isCorrectionInputActive() { return Boolean(state && state.correction && ["change", "takeover"].includes(state.correction.inputMode)); }

function initDom() {
  for (const id of [
    "homeView", "settingsView", "gameView", "startGameBtn", "openSettingsBtn", "settingsBackBtn", "gameBackBtn", "newGameBtn", "endTurnBtn",
    "difficultySelect", "comboRuleCheckbox", "aiDelayRange", "aiDelayValue", "difficultyHelp", "board", "statusText", "detailText",
    "humanColorLabel", "aiColorLabel", "turnOrb", "redGrave", "blackGrave", "capturedCount", "leftGraveTitle", "rightGraveTitle", "leftGraveCount", "rightGraveCount", "toast", "modal", "modalTitle", "modalText", "modalHomeBtn", "modalRestartBtn",
    "correctionModeCheckbox", "correctionPanel", "correctionText", "approveAiStepBtn", "changeAiStepBtn", "takeOverAiTurnBtn",
    "learningModelStatus", "learningUpdatedAt", "learningGameCount", "learningGameBreakdown", "learningDecisionCount", "learningModelSize", "learningDataSize",
    "learningBaseVersion", "learningPersonalVersion", "learningApprovalCount", "learningCorrectionCount", "learningDemoCount", "learningTop1", "learningTop3", "learningComboTop1", "learningDarkTop1", "learningStopTop1", "learningSequenceExact", "learningRecentTop1", "learningInferenceTime", "learningTrainingInfo", "learningPersistence", "learningParamCount", "exportLearningBtn", "importLearningBtn", "importLearningFile", "rollbackLearningBtn"
  ]) dom[id] = document.getElementById(id);
}

function bindEvents() {
  dom.startGameBtn.addEventListener("click", () => { newGame(); showView("game"); });
  dom.openSettingsBtn.addEventListener("click", () => { syncSettingsUI(); showView("settings"); });
  dom.settingsBackBtn.addEventListener("click", () => showView("home"));
  dom.gameBackBtn.addEventListener("click", () => { interruptCurrentGame(); hideModal(); showView("home"); });
  dom.newGameBtn.addEventListener("click", () => newGame());
  dom.endTurnBtn.addEventListener("click", async () => {
    if (!state || !state.combo.active || state.locked) return;
    if (isCorrectionInputActive()) {
      await completeCorrectionInput(["stop"], { type: "stop", successCapture: false, captured: null, lastMove: null, invalid: false });
      return;
    }
    if (state.currentPlayer !== HUMAN || state.aiThinking) return;
    recordHumanLearningDecision(["stop"], "normal");
    recordTurnAction(HUMAN, ["stop"], { type: "stop", successCapture: false, captured: null, lastMove: null, invalid: false }, {});
    state.combo = { active: false, r: null, c: null };
    state.selected = null;
    endTurn();
  });
  if (dom.difficultySelect) dom.difficultySelect.addEventListener("change", () => { saveDifficulty(dom.difficultySelect.value); syncSettingsUI(); });
  dom.comboRuleCheckbox.addEventListener("change", () => { saveComboRule(dom.comboRuleCheckbox.checked); syncSettingsUI(); });
  dom.correctionModeCheckbox.addEventListener("change", () => { saveCorrectionMode(dom.correctionModeCheckbox.checked); syncSettingsUI(); });
  dom.aiDelayRange.addEventListener("input", () => { saveAiDelaySeconds(dom.aiDelayRange.value); syncSettingsUI(); });
  dom.approveAiStepBtn.addEventListener("click", () => resolveAiCorrection("approve"));
  dom.changeAiStepBtn.addEventListener("click", () => resolveAiCorrection("change"));
  dom.takeOverAiTurnBtn.addEventListener("click", () => resolveAiCorrection("takeover"));
  dom.exportLearningBtn.addEventListener("click", exportLearningArchive);
  dom.importLearningBtn.addEventListener("click", () => dom.importLearningFile.click());
  dom.importLearningFile.addEventListener("change", importLearningArchive);
  dom.rollbackLearningBtn.addEventListener("click", rollbackLearningModel);
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
  if (dom.difficultySelect) dom.difficultySelect.value = difficulty;
  if (dom.difficultyHelp) dom.difficultyHelp.textContent = DIFFICULTIES[difficulty].help;
  dom.comboRuleCheckbox.checked = loadComboRule();
  dom.correctionModeCheckbox.checked = loadCorrectionMode();
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

function newGame(startTurn = true) {
  persistCurrentLearningTurn(true);
  finishCurrentLearningGame("interrupted", "interrupted");
  cancelAiCorrection();
  if (aiWorkerRequests.size) recycleAiWorker();
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
  const firstPlayer = Math.random() < 0.5 ? HUMAN : AI;
  state = {
    board,
    selected: null,
    turnColor: null,
    playerColor: { [HUMAN]: null, [AI]: null },
    currentPlayer: firstPlayer,
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
    learningGame: startTurn && window.DarkChessLearning ? window.DarkChessLearning.createSession() : null,
    learningTurnNumber: 0,
    learningSequenceIndex: 0,
    correction: {
      inputMode: null,
      takeOver: false,
      proposedAction: null,
      proposalContext: null,
      inputContext: null,
      rejectedAction: null,
      resolveProposal: null,
      resolveInput: null,
    },
  };
  if (window.DarkChessLearning && typeof window.DarkChessLearning.setGameplayActive === "function") {
    window.DarkChessLearning.setGameplayActive(Boolean(startTurn));
  }
  if (state.currentPlayer === AI && startTurn) {
    state.aiThinking = true;
    setStatus("AI 正在行動", "");
    render();
    scheduleAiMove();
  } else {
    setStatus("請先翻一顆棋。", "");
    render();
  }
}

function finishCurrentLearningGame(status, outcome) {
  if (window.DarkChessLearning && typeof window.DarkChessLearning.setGameplayActive === "function") {
    window.DarkChessLearning.setGameplayActive(false);
  }
  if (!state || !state.learningGame || !window.DarkChessLearning) return;
  if (state.learningGame.status !== "active") return;
  void window.DarkChessLearning.finishGame(state.learningGame, status, outcome).catch((error) => {
    console.error("Unable to finish the learning game.", error);
  });
}

function interruptCurrentGame() {
  persistCurrentLearningTurn(true);
  finishCurrentLearningGame("interrupted", "interrupted");
  cancelAiCorrection();
  if (aiWorkerRequests.size) recycleAiWorker();
  aiRunId += 1;
  if (!state) return;
  state.aiThinking = false;
  state.locked = true;
  state.pendingAction = null;
}

function recordHumanLearningDecision(action, labelType = "normal") {
  if (!state || !state.learningGame || !window.DarkChessLearning) return false;
  try {
    const session = state.learningGame;
    const snapshot = createWorkerStateSnapshot();
    const comboPos = state.combo.active ? { r: state.combo.r, c: state.combo.c } : null;
    const sequenceIndex = state.learningSequenceIndex++;
    const options = {
      labelType,
      source: "human",
      turnId: currentLearningTurnId(),
      combo: state.combo.active,
      comboStep: sequenceIndex,
      sequenceIndex,
      phase: learningPhaseLabel(),
    };
    if (typeof window.DarkChessLearning.recordPositionChoice === "function") {
      void window.DarkChessLearning.recordPositionChoice(session, snapshot, HUMAN, comboPos, action, options).catch((error) => {
        console.error("Unable to save the human learning decision.", error);
      });
      return true;
    }
    void requestWorkerPositionPreparation(snapshot, HUMAN, comboPos).then((prepared) => {
      if (!prepared || !Array.isArray(prepared.candidates)) return false;
      return window.DarkChessLearning.recordRawChoice(session, prepared.observation, prepared.candidates, action, options);
    }).catch((error) => {
      console.error("Unable to save the human learning decision.", error);
    });
    return true;
  } catch {
    return false;
  }
}

function currentLearningTurnId() {
  const gameId = state && state.learningGame ? state.learningGame.id : "game";
  return `${gameId}-turn-${state ? state.learningTurnNumber : 0}`;
}

function persistCurrentLearningTurn(partial = false) {
  if (!state || !state.learningGame || !window.DarkChessLearning || !state.turnActions.length) return;
  void window.DarkChessLearning.recordTurn(state.learningGame, {
    id: currentLearningTurnId(),
    actor: state.currentPlayer,
    color: state.playerColor[state.currentPlayer],
    actions: state.turnActions.map((row) => ({ ...row, action: [...row.action] })),
    partial,
    completedAt: new Date().toISOString(),
  }).catch((error) => {
    console.error("Unable to save the learning turn.", error);
  });
}

function learningPhaseLabel() {
  const occupied = state.board.flat().filter(Boolean).length;
  if (occupied >= 24) return "opening";
  if (occupied >= 10) return "middle";
  return "late";
}

function buildLearningObservation(actor, comboPos = null) {
  const ownColor = state.playerColor[actor];
  const enemyColor = ownColor ? opponentColor(ownColor) : null;
  const channels = new Float32Array(ROWS * COLS * 25);
  const kindIndex = { K: 0, A: 1, E: 2, R: 3, N: 4, C: 5, P: 6 };
  const activeCombo = comboPos || (
    state.combo.active && state.currentPlayer === actor
      ? { r: state.combo.r, c: state.combo.c }
      : null
  );
  const lastEvent = state.turnActions.length
    ? state.turnActions[state.turnActions.length - 1]
    : state.turnHistory.length && state.turnHistory[state.turnHistory.length - 1].actions.length
      ? state.turnHistory[state.turnHistory.length - 1].actions.at(-1)
      : null;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const offset = (r * COLS + c) * 25;
      const piece = state.board[r][c];
      if (!piece) channels[offset + 15] = 1;
      else if (!piece.faceUp) channels[offset + 14] = 1;
      else if (ownColor) channels[offset + (piece.color === ownColor ? 0 : 7) + kindIndex[piece.kind]] = 1;
      else channels[offset + (piece.color === "red" ? 0 : 7) + kindIndex[piece.kind]] = 1;
      if (ownColor) {
        channels[offset + 16] = countPublicAttackers(state.board, { r, c }, ownColor) > 0 ? 1 : 0;
        channels[offset + 17] = countPublicAttackers(state.board, { r, c }, enemyColor) > 0 ? 1 : 0;
        channels[offset + 18] = countPublicSupporters(state.board, { r, c }, ownColor) > 0 ? 1 : 0;
        channels[offset + 19] = countPublicSupporters(state.board, { r, c }, enemyColor) > 0 ? 1 : 0;
      }
      channels[offset + 20] = activeCombo && activeCombo.r === r && activeCombo.c === c ? 1 : 0;
      channels[offset + 21] = lastEvent && lastEvent.source && lastEvent.source.r === r && lastEvent.source.c === c ? 1 : 0;
      channels[offset + 22] = lastEvent && lastEvent.destination && lastEvent.destination.r === r && lastEvent.destination.c === c ? 1 : 0;
      channels[offset + 23] = r / 3;
      channels[offset + 24] = c / 7;
    }
  }

  const unseen = getUnseenPool(state.board, state.captured);
  const sideOrder = ownColor ? [ownColor, enemyColor] : ["red", "black"];
  const total = Math.max(1, unseen.total);
  const belief = sideOrder.flatMap((color) => ["K", "A", "E", "R", "N", "C", "P"].map((kind) => unseen.counts[color][kind] / total));
  const turnEvents = state.turnActions.map((event) => toLearningEvent(event, actor, false));
  const historyEvents = state.turnHistory.flatMap((turn) => turn.actions.map((event, index) =>
    toLearningEvent(event, actor, index === turn.actions.length - 1)
  )).slice(-32);
  return {
    boardChannels: Array.from(channels),
    belief,
    turnEvents,
    historyEvents,
    ownActor: actor,
    comboActive: Boolean(activeCombo),
    comboIndex: activeCombo ? activeCombo.r * COLS + activeCombo.c : -1,
  };
}

function toLearningEvent(event, actor, turnBoundary) {
  const mover = event.source && state.board[event.source.r] ? state.board[event.source.r][event.source.c] : null;
  let revealSide = null;
  if (event.revealedColor && state.playerColor[actor]) revealSide = event.revealedColor === state.playerColor[actor] ? "own" : "opponent";
  return {
    actor: event.actor,
    kind: event.kind,
    action: event.action ? [...event.action] : null,
    source: event.source ? { ...event.source } : null,
    destination: event.destination ? { ...event.destination } : null,
    moverKind: event.moverKind || (mover && mover.faceUp ? mover.kind : null),
    successCapture: Boolean(event.successCapture),
    revealSide,
    turnBoundary,
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

function generateLearningCandidates(actor, comboPos = null) {
  const analysisContext = createLearningAnalysisContext(actor, comboPos);
  return generateLearningLegalActions(actor, comboPos).map((action) => buildLearningCandidate(actor, action, analysisContext));
}

function createLearningAnalysisContext(actor, comboPos = null) {
  const color = state.playerColor[actor];
  return {
    color,
    enemy: color ? opponentColor(color) : null,
    before: color ? summarizePublicBoard(state.board, color) : null,
    unseen: getUnseenPool(state.board, state.captured),
    comboPos: comboPos || (
      state.combo.active && state.currentPlayer === actor
        ? { r: state.combo.r, c: state.combo.c }
        : null
    ),
  };
}

function buildLearningCandidate(actor, action, analysisContext = null) {
  const source = actionSource(action);
  const destination = actionDestination(action);
  const mover = source ? state.board[source.r][source.c] : null;
  const target = destination ? state.board[destination.r][destination.c] : null;
  return {
    action: [...action],
    moverKind: mover && mover.faceUp ? mover.kind : null,
    targetKind: target && target.faceUp ? target.kind : null,
    targetHidden: Boolean(target && !target.faceUp),
    consequence: analyzeLearningCandidate(actor, action, analysisContext || createLearningAnalysisContext(actor)),
  };
}

function analyzeLearningCandidate(actor, action, analysisContext) {
  const color = analysisContext.color;
  const enemy = analysisContext.enemy;
  const vector = new Float32Array(24);
  if (!color) return Array.from(vector);
  const source = actionSource(action);
  const destination = actionDestination(action);
  const before = analysisContext.before;
  const branches = learningActionBranches(action, color, analysisContext);
  for (const branch of branches) {
    const weight = branch.probability;
    const after = summarizePublicBoard(branch.board, color);
    const nextActions = branch.successCapture && branch.finalPos && isComboRuleEnabled()
      ? generateCaptureActionsFrom(branch.board, color, branch.finalPos, { includeDark: true })
      : [];
    const turnEnds = action[0] === "stop" || !branch.successCapture || nextActions.length === 0;
    const immediateReplies = turnEnds && enemy
      ? generateActions(branch.board, enemy, { includeFlips: false, includeMoves: false, includeCaptures: true, includeDarkCaptures: false })
      : [];
    const finalPiece = branch.finalPos ? branch.board[branch.finalPos.r][branch.finalPos.c] : null;
    const finalLoss = finalPiece && immediateReplies.some((reply) => reply[3] === branch.finalPos.r && reply[4] === branch.finalPos.c)
      ? SEARCH_VALUE[finalPiece.kind] : 0;
    vector[0] += weight * (branch.successCapture ? 1 : 0);
    vector[1] += weight * (action[0] === "darkCapture" && !branch.successCapture ? 1 : 0);
    vector[2] += weight * branch.capturedValue / 1000;
    vector[3] += weight * finalLoss / 1000;
    vector[4] += weight * (branch.finalPos ? branch.finalPos.r / 3 : 0);
    vector[5] += weight * (branch.finalPos ? branch.finalPos.c / 7 : 0);
    vector[6] += weight * after.ownAttackCount / 16;
    vector[7] += weight * (branch.finalPos ? countPublicSupporters(branch.board, branch.finalPos, color) / 8 : 0);
    vector[8] += weight * (finalLoss > 0 ? 1 : 0);
    vector[9] += weight * nextActions.filter((candidate) => candidate[0] === "capture").length / 16;
    vector[10] += weight * nextActions.filter((candidate) => candidate[0] === "darkCapture").length / 16;
    vector[11] += weight * (nextActions.length > 0 ? 1 : 0);
    vector[12] += weight * (after.ownMobility - before.ownMobility) / 32;
    vector[13] += weight * (after.enemyMobility - before.enemyMobility) / 32;
    vector[14] += weight * (after.ownCannonLines - before.ownCannonLines) / 16;
    vector[15] += weight * (after.enemyCannonLines - before.enemyCannonLines) / 16;
    vector[16] += weight * (after.ownAttackCount - before.ownAttackCount) / 16;
    vector[17] += weight * (after.ownProtection - before.ownProtection) / 16;
    vector[18] += weight * (after.enemyAttackCount - before.enemyAttackCount) / 16;
    vector[19] += weight * (branch.capturedValue - finalLoss) / 1000;
    vector[20] = 0;
    vector[21] += weight * learningTerminalValue(branch.board, color);
    vector[22] += weight * learningRepetitionDelta(branch.board, enemy);
    vector[23] += weight * (action[0] === "capture" ? 1 : 0);
  }
  return Array.from(vector);
}

function learningActionBranches(action, color, analysisContext = null) {
  const source = actionSource(action);
  const destination = actionDestination(action);
  const branches = [];
  if (action[0] === "stop") return [{
    probability: 1,
    board: cloneBoard(state.board),
    successCapture: false,
    capturedValue: 0,
    finalPos: source || (analysisContext && analysisContext.comboPos) || (state.combo.active ? { r: state.combo.r, c: state.combo.c } : null),
  }];
  if (action[0] === "darkCapture") {
    const unseen = analysisContext && analysisContext.unseen
      ? analysisContext.unseen
      : getUnseenPool(state.board, state.captured);
    const total = Math.max(1, unseen.total);
    const original = state.board[destination.r][destination.c];
    for (const outcomeColor of ["red", "black"]) {
      for (const kind of ["K", "A", "E", "R", "N", "C", "P"]) {
        const count = unseen.counts[outcomeColor][kind];
        if (!count) continue;
        const board = cloneBoard(state.board);
        board[destination.r][destination.c] = { ...(original || {}), color: outcomeColor, kind, faceUp: true, id: "belief-piece" };
        const successCapture = canCapture(board, source, destination);
        let capturedValue = 0;
        let finalPos = source;
        if (successCapture) {
          capturedValue = SEARCH_VALUE[kind];
          board[destination.r][destination.c] = board[source.r][source.c];
          board[source.r][source.c] = null;
          finalPos = destination;
        }
        branches.push({ probability: count / total, board, successCapture, capturedValue, finalPos });
      }
    }
    return branches.length ? branches : [{ probability: 1, board: cloneBoard(state.board), successCapture: false, capturedValue: 0, finalPos: source }];
  }
  const board = cloneBoard(state.board);
  const target = destination ? board[destination.r][destination.c] : null;
  const result = applyAction(board, action);
  return [{
    probability: 1,
    board,
    successCapture: Boolean(result.successCapture),
    capturedValue: result.successCapture && target ? SEARCH_VALUE[target.kind] : 0,
    finalPos: result.lastMove || destination || source,
  }];
}

function summarizePublicBoard(board, color) {
  const enemy = opponentColor(color);
  const ownActions = generateActions(board, color, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: false });
  const enemyActions = generateActions(board, enemy, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: false });
  let ownProtection = 0;
  let ownCannonLines = 0;
  let enemyCannonLines = 0;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (!piece || !piece.faceUp) continue;
    if (piece.color === color) ownProtection += countPublicSupporters(board, { r, c }, color);
    if (piece.kind === "C") {
      const lines = generateCaptureActionsFrom(board, piece.color, { r, c }, { includeDark: true }).length;
      if (piece.color === color) ownCannonLines += lines;
      else enemyCannonLines += lines;
    }
  }
  return {
    ownMobility: ownActions.length,
    enemyMobility: enemyActions.length,
    ownAttackCount: ownActions.filter((action) => action[0] === "capture").length,
    enemyAttackCount: enemyActions.filter((action) => action[0] === "capture").length,
    ownProtection,
    ownCannonLines,
    enemyCannonLines,
  };
}

function countPublicAttackers(board, destination, color) {
  const target = board[destination.r] ? board[destination.r][destination.c] : null;
  if (!target || !target.faceUp || target.color === color) return 0;
  let count = 0;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (piece && piece.faceUp && piece.color === color && canCapture(board, { r, c }, destination)) count += 1;
  }
  return count;
}

function countPublicSupporters(board, destination, color) {
  const target = board[destination.r] ? board[destination.r][destination.c] : null;
  if (!target || !target.faceUp || target.color !== color) return 0;
  return visibleFriendlySupport(board, destination, color);
}

function learningTerminalValue(board, color) {
  const winner = checkWinner(board);
  if (winner === color) return 1;
  if (winner === opponentColor(color)) return -1;
  return 0;
}

function learningRepetitionDelta(board, nextColor) {
  const key = visiblePositionKey(board, nextColor);
  return Math.min(1, (state.positionCounts[key] || 0) / REPETITION_LIMIT);
}

function renderLearningStats(stats = null) {
  const modelStats = stats || (
    window.DarkChessLearning
      ? window.DarkChessLearning.getStats()
      : null
  );
  if (!modelStats || !dom.learningModelStatus) return;

  const statusLabels = {
    loading: "載入中",
    "base-ready": "基礎模型已就緒",
    training: "更新中",
    ready: "已更新",
    degraded: "模型可用／儲存待修復",
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
  dom.learningBaseVersion.textContent = modelStats.baseVersion || "—";
  dom.learningPersonalVersion.textContent = `v${modelStats.personalVersion || 0}（槽 ${String(modelStats.activeSlot || "a").toUpperCase()}）`;
  dom.learningApprovalCount.textContent = `${modelStats.approvals || 0} 步`;
  dom.learningCorrectionCount.textContent = `${modelStats.corrections || 0} 步`;
  dom.learningDemoCount.textContent = `${modelStats.demonstrations || 0} 步`;
  dom.learningParamCount.textContent = `${Number(modelStats.modelParams || 0).toLocaleString("zh-TW")} 個`;
  const metrics = modelStats.metrics || {};
  dom.learningTop1.textContent = formatLearningRate(metrics.all && metrics.all.top1, metrics.all && metrics.all.count);
  dom.learningTop3.textContent = formatLearningRate(metrics.all && metrics.all.top3, metrics.all && metrics.all.count);
  dom.learningRecentTop1.textContent = formatLearningRate(metrics.recent20 && metrics.recent20.top1, metrics.recent20 && metrics.recent20.count);
  dom.learningComboTop1.textContent = formatLearningRate(metrics.combo && metrics.combo.top1, metrics.combo && metrics.combo.count);
  dom.learningDarkTop1.textContent = formatLearningRate(metrics.darkCapture && metrics.darkCapture.top1, metrics.darkCapture && metrics.darkCapture.count);
  dom.learningStopTop1.textContent = formatLearningRate(metrics.stop && metrics.stop.top1, metrics.stop && metrics.stop.count);
  dom.learningSequenceExact.textContent = `${formatPercent(metrics.sequenceExact || 0)}／前綴 ${formatPercent(metrics.sequencePrefix || 0)}`;
  dom.learningInferenceTime.textContent = `平均 ${Math.round(modelStats.averageInferenceMs || 0)}／P95 ${Math.round(modelStats.p95InferenceMs || 0)} ms`;
  dom.learningTrainingInfo.textContent = `${modelStats.lastTrainingRows || 0} 筆／${Math.round(modelStats.lastTrainingMs || 0)} ms`;
  dom.learningPersistence.textContent = modelStats.status === "degraded"
    ? `暫時使用基礎模型：${modelStats.error || "學習資料庫無法使用"}`
    : modelStats.persistenceGranted ? "已取得持久儲存" : "一般網站儲存";
}

function formatPercent(value) { return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`; }
function formatLearningRate(value, count) { return `${formatPercent(value)}（${Number(count) || 0}）`; }

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

async function exportLearningArchive() {
  if (!window.DarkChessLearning) return;
  try {
    const blob = await window.DarkChessLearning.exportArchive();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dark-chess-learning-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("模型與棋譜已匯出");
  } catch {
    showToast("匯出失敗");
  }
}

async function importLearningArchive(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file || !window.DarkChessLearning) return;
  try {
    await window.DarkChessLearning.importArchive(file);
    renderLearningStats();
    showToast("模型與棋譜已匯入");
  } catch {
    showToast("匯入檔案無法使用");
  }
}

async function rollbackLearningModel() {
  if (!window.DarkChessLearning) return;
  const restored = await window.DarkChessLearning.rollbackModel();
  renderLearningStats();
  showToast(restored ? "已切回上一個模型槽" : "目前沒有可回復的模型槽");
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
  const correctionInput = isCorrectionInputActive();
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

      btn.disabled = state.locked || (state.aiThinking && !correctionInput) || (state.currentPlayer === AI && !correctionInput);
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
  dom.turnOrb.textContent = state.turnColor === null ? "先翻" : correctionInput ? "示範" : state.combo.active && state.currentPlayer === HUMAN ? "連吃" : state.currentPlayer === HUMAN ? "您" : "AI";
  dom.endTurnBtn.classList.toggle("hidden", !(state.combo.active && !state.locked && (correctionInput || (state.currentPlayer === HUMAN && !state.aiThinking))));
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

function showCorrectionPanel(message, inputActive = false) {
  dom.correctionText.textContent = message;
  dom.correctionPanel.classList.remove("hidden");
  dom.correctionPanel.classList.toggle("input-active", inputActive);
}

function hideCorrectionPanel() {
  if (!dom.correctionPanel) return;
  dom.correctionPanel.classList.add("hidden");
  dom.correctionPanel.classList.remove("input-active");
}

function requestAiCorrection(choice, comboPos) {
  if (!state || !state.correction) return Promise.resolve("approve");
  state.correction.proposedAction = [...choice.action];
  state.correction.proposalContext = choice.context;
  state.correction.inputMode = null;
  state.pendingAction = [...choice.action];
  state.actionViz = buildActionViz(AI, choice.action, null, "preview");
  showCorrectionPanel(comboPos ? "AI 的下一段連吃" : "AI 打算走這一步");
  render();
  return new Promise((resolve) => { state.correction.resolveProposal = resolve; });
}

function resolveAiCorrection(response) {
  if (!state || !state.correction || typeof state.correction.resolveProposal !== "function") return;
  const resolve = state.correction.resolveProposal;
  state.correction.resolveProposal = null;
  state.pendingAction = null;
  hideCorrectionPanel();
  resolve(response);
}

function beginCorrectionInput(mode, context, rejectedAction, comboPos) {
  state.correction.inputMode = mode;
  state.correction.inputContext = context;
  state.correction.rejectedAction = rejectedAction ? [...rejectedAction] : null;
  state.selected = null;
  state.combo = comboPos ? { active: true, r: comboPos.r, c: comboPos.c } : { active: false, r: null, c: null };
  showCorrectionPanel(mode === "change" ? "請示範這一個原子行動" : "本回合由您示範", true);
  render();
  return new Promise((resolve) => { state.correction.resolveInput = resolve; });
}

async function completeCorrectionInput(action, result) {
  if (!state || !state.correction || !state.correction.inputMode) return false;
  const mode = state.correction.inputMode;
  const context = state.correction.inputContext;
  const rejectedAction = state.correction.rejectedAction;
  try {
    const options = {
      labelType: mode === "change" ? "correction" : "demonstration",
      source: mode === "change" ? "change-one-step" : "take-over-turn",
      rejectedAction: mode === "change" ? rejectedAction : null,
      turnId: currentLearningTurnId(),
      combo: state.combo.active,
      comboStep: state.learningSequenceIndex,
      sequenceIndex: state.learningSequenceIndex++,
      phase: learningPhaseLabel(),
    };
    const saved = await window.DarkChessLearning.recordChoice(state.learningGame, context, action, options);
    if (!saved) throw new Error("糾正行動不在完整合法候選中");
  } catch {
    showToast("這一步已執行，學習紀錄保存失敗");
  }
  const resolve = state.correction.resolveInput;
  state.correction.resolveInput = null;
  state.correction.inputMode = null;
  state.correction.inputContext = null;
  state.correction.rejectedAction = null;
  state.selected = null;
  state.combo = { active: false, r: null, c: null };
  hideCorrectionPanel();
  render();
  if (typeof resolve === "function") resolve({ action: [...action], result });
  return true;
}

function cancelAiCorrection() {
  if (!state || !state.correction) return;
  if (typeof state.correction.resolveProposal === "function") state.correction.resolveProposal("cancel");
  if (typeof state.correction.resolveInput === "function") state.correction.resolveInput({ cancelled: true });
  state.correction.resolveProposal = null;
  state.correction.resolveInput = null;
  state.correction.inputMode = null;
  state.correction.takeOver = false;
  state.pendingAction = null;
  hideCorrectionPanel();
}

function createWorkerStateSnapshot() {
  return {
    board: cloneBoard(state.board),
    turnColor: state.turnColor,
    playerColor: { ...state.playerColor },
    currentPlayer: state.currentPlayer,
    comboRule: state.comboRule,
    combo: { ...state.combo },
    captured: state.captured.map((piece) => ({ ...piece })),
    turnActions: state.turnActions.map((row) => ({
      ...row,
      action: Array.isArray(row.action) ? [...row.action] : null,
      source: row.source ? { ...row.source } : null,
      destination: row.destination ? { ...row.destination } : null,
    })),
    turnHistory: state.turnHistory.map((turn) => ({
      ...turn,
      from: turn.from ? { ...turn.from } : null,
      to: turn.to ? { ...turn.to } : null,
      chaseTargetIds: Array.isArray(turn.chaseTargetIds) ? [...turn.chaseTargetIds] : [],
      actions: Array.isArray(turn.actions) ? turn.actions.map((row) => ({
        ...row,
        action: Array.isArray(row.action) ? [...row.action] : null,
        source: row.source ? { ...row.source } : null,
        destination: row.destination ? { ...row.destination } : null,
      })) : [],
    })),
    positionHistory: [...state.positionHistory],
    positionCounts: { ...state.positionCounts },
  };
}

function ensureAiWorker() {
  if (aiWorker || typeof Worker !== "function") return aiWorker;
  try {
    aiWorker = new Worker(`./ai-worker.js?v=${APP_VERSION}`);
    aiWorker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "worker-load-error") {
        console.error("AI worker model failed to load.", message.error || "unknown error");
        recycleAiWorker();
        return;
      }
      if (!["result", "prepared", "evaluated", "error"].includes(message.type)) return;
      const pending = aiWorkerRequests.get(message.id);
      if (!pending) return;
      aiWorkerRequests.delete(message.id);
      if (message.type === "error") {
        pending.reject(new Error(message.error || "AI worker failed"));
        return;
      }
      if (message.type === "result") pending.resolve(message.choice);
      else if (message.type === "prepared") pending.resolve(message.prepared);
      else pending.resolve(message.context);
    });
    aiWorker.addEventListener("error", (error) => {
      console.error("AI worker failed.", error);
      recycleAiWorker();
    });
  } catch (error) {
    console.error("Unable to create AI worker.", error);
    aiWorker = null;
  }
  return aiWorker;
}

function recycleAiWorker() {
  if (aiWorker) aiWorker.terminate();
  aiWorker = null;
  for (const pending of aiWorkerRequests.values()) {
    pending.resolve(null);
  }
  aiWorkerRequests.clear();
}

function requestWorkerMessage(payload) {
  const worker = ensureAiWorker();
  if (!worker) return Promise.reject(new Error("此瀏覽器無法建立 AI 背景執行緒"));
  const id = ++aiWorkerRequestId;
  return new Promise((resolve, reject) => {
    aiWorkerRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ ...payload, id });
    } catch (error) {
      console.error("Unable to send the AI position to the worker.", error);
      aiWorkerRequests.delete(id);
      reject(error);
    }
  });
}

function currentLearningInferenceSnapshot() {
  return window.DarkChessLearning && typeof window.DarkChessLearning.getInferenceSnapshot === "function"
    ? window.DarkChessLearning.getInferenceSnapshot()
    : null;
}

async function requestAiWorkerDecision(comboPos) {
  if (!state) return Promise.resolve(null);
  if (window.DarkChessLearning && typeof window.DarkChessLearning.init === "function") {
    await window.DarkChessLearning.init();
  }
  return requestWorkerMessage({
    type: "think",
    snapshot: createWorkerStateSnapshot(),
    comboPos: comboPos ? { ...comboPos } : null,
    learningSnapshot: currentLearningInferenceSnapshot(),
  });
}

function requestWorkerPositionPreparation(snapshot, actor, comboPos) {
  return requestWorkerMessage({
    type: "prepare",
    snapshot,
    actor,
    comboPos: comboPos ? { ...comboPos } : null,
  });
}

function requestWorkerEvaluation(observation, candidates, learningSnapshot = null) {
  return requestWorkerMessage({
    type: "evaluate",
    observation,
    candidates,
    learningSnapshot: learningSnapshot || currentLearningInferenceSnapshot(),
  });
}

async function onCellClick(r, c) {
  const correctionInput = isCorrectionInputActive();
  if (!state || state.locked || (state.aiThinking && !correctionInput) || (state.currentPlayer === AI && !correctionInput)) return;
  const actor = correctionInput ? AI : HUMAN;
  const piece = state.board[r][c];

  if (state.combo.active) {
    const src = { r: state.combo.r, c: state.combo.c };
    if (r === src.r && c === src.c) { showToast("連吃中，只能點可食用目標，或結束回合。"); return; }
    if (!piece) { showToast("連吃中不能移動到空格。"); return; }
    state.selected = src;
    render();
    await tryMoveOrCapture(src, { r, c }, actor);
    return;
  }

  if (!piece) {
    if (state.selected) await tryMoveOrCapture(state.selected, { r, c }, actor);
    return;
  }

  if (!piece.faceUp) {
    if (state.selected) {
      await tryMoveOrCapture(state.selected, { r, c }, actor);
      return;
    }
    const action = ["flip", r, c];
    const result = await performVisibleAction(action, actor, { preview: false });
    if (!result.invalid) {
      if (correctionInput) await completeCorrectionInput(action, result);
      else endTurn();
    }
    return;
  }

  if (state.turnColor === null) { showToast("請先翻棋。"); return; }

  if (piece.color === state.turnColor) {
    if (state.selected && state.selected.r === r && state.selected.c === c) state.selected = null;
    else state.selected = { r, c };
    render();
    return;
  }

  if (state.selected) await tryMoveOrCapture(state.selected, { r, c }, actor);
  else showToast("請先選取自己的明棋。");
}

async function tryMoveOrCapture(src, dst, actor = HUMAN) {
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
    const policy = actor === HUMAN
      ? evaluateHumanOpeningPolicy(state.board, action)
      : evaluateAiOpeningPolicy(state.board, action, state.playerColor[AI], state.playerColor[HUMAN]);
    if (policy.forbidden) {
      if (actor === HUMAN) rejectHumanPerpetualChase();
      else showToast("這一步會觸發重複局面限制");
      return;
    }
    const result = await performVisibleAction(action, actor);
    if (actor === AI && isCorrectionInputActive()) await completeCorrectionInput(action, result);
    else afterHumanAction(result);
    return;
  }

  if (!target.faceUp) {
    if (!isComboRuleEnabled()) { showToast("目前不能直接吃暗棋。"); return; }
    if (!canAttemptHiddenCapturePath(state.board, src, dst)) {
      showToast(moving.kind === "C" ? "炮／包食用必須跳吃。" : "一般棋只能食用相鄰暗棋。");
      return;
    }
    const action = ["darkCapture", src.r, src.c, dst.r, dst.c];
    const result = await performVisibleAction(action, actor);
    if (actor === AI && isCorrectionInputActive()) await completeCorrectionInput(action, result);
    else afterHumanAction(result);
    return;
  }

  if (target.color === moving.color) { showToast("不能吃自己的棋。"); return; }
  if (!canCapture(state.board, src, dst)) { showToast("這顆棋不能這樣吃。"); return; }
  const action = ["capture", src.r, src.c, dst.r, dst.c];
  const result = await performVisibleAction(action, actor);
  if (actor === AI && isCorrectionInputActive()) await completeCorrectionInput(action, result);
  else afterHumanAction(result);
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
  hideCorrectionPanel();
  state.selected = null;
  state.combo = { active: false, r: null, c: null };
  if (state.turnColor === null) { render(); setStatus("請先翻棋", ""); return; }

  const finishedPlayer = state.currentPlayer;
  const nextPlayer = finishedPlayer === HUMAN ? AI : HUMAN;
  const nextColor = state.playerColor[nextPlayer];
  persistCurrentLearningTurn(false);
  finalizeTurnHistory(finishedPlayer, nextColor);
  state.learningTurnNumber += 1;
  state.learningSequenceIndex = 0;

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
    scheduleAiMove();
  } else {
    state.aiThinking = false;
    setStatus("輪到您", "");
    render();
  }
}

function scheduleAiMove() {
  window.setTimeout(() => {
    void aiMove().catch(recoverAiMoveFailure);
  }, 40);
}

async function recoverAiMoveFailure(error) {
  console.error("AI turn failed; recovering the turn.", error);
  if (!state || state.currentPlayer !== AI) return;
  const recoveryRunId = aiRunId + 1;
  aiRunId = recoveryRunId;
  cancelAiCorrection();
  state.locked = false;
  state.pendingAction = null;
  state.animation = null;
  state.aiThinking = true;

  try {
    const alreadyMoved = state.turnActions.some((event) => event && event.actor === AI);
    if (!alreadyMoved) {
      recycleAiWorker();
      const choice = await chooseLearnedAiAction();
      if (!choice || !choice.action || !isAiRunActive(recoveryRunId)) return;
      const result = await performVisibleAction(choice.action, AI, {
        runId: recoveryRunId,
        stepStartedAt: nowMs() - (choice.totalElapsedMs || 0),
      });
      const winner = checkWinner(state.board);
      if (winner !== null) {
        state.aiThinking = false;
        render();
        showWinner(winner);
        return;
      }
      if (result.invalid) throw new Error("AI 復原行動無效");
    }
  } catch (recoveryError) {
    console.error("AI turn recovery failed.", recoveryError);
    state.locked = false;
    state.pendingAction = null;
    state.aiThinking = false;
    setStatus("AI 背景模型載入失敗", "可返回首頁或重新開始");
    showToast("AI 背景模型載入失敗，未使用簡化行動");
    render();
    return;
  }

  state.locked = false;
  state.pendingAction = null;
  state.aiThinking = false;
  endTurn();
}

async function aiMove() {
  if (!state) return;
  const runId = aiRunId + 1;
  aiRunId = runId;
  let comboPos = null;
  let takeOver = false;
  let guard = 0;

  while (guard < MAX_COMBO_STEPS + 1) {
    guard += 1;
    let choice = null;
    let action = null;
    let result = null;

    if (takeOver) {
      const takeoverChoice = await chooseLearnedAiAction(comboPos);
      if (!isAiRunActive(runId)) return;
      if (!takeoverChoice || !takeoverChoice.action) break;
      const context = takeoverChoice.context;
      const demonstrated = await beginCorrectionInput("takeover", context, null, comboPos);
      if (!isAiRunActive(runId) || demonstrated.cancelled) return;
      action = demonstrated.action;
      result = demonstrated.result;
    } else {
      choice = await chooseLearnedAiAction(comboPos);
      if (!isAiRunActive(runId)) return;
      if (!choice || !choice.action) throw new Error("AI 模型沒有回傳行動");
      action = choice.action;

      const isInitialFlip = state.turnColor === null && action[0] === "flip";
      if (loadCorrectionMode() && !isInitialFlip) {
        const response = await requestAiCorrection(choice, comboPos);
        if (!isAiRunActive(runId) || response === "cancel") return;
        if (response === "approve") {
          await window.DarkChessLearning.recordChoice(state.learningGame, choice.context, action, {
            labelType: "approval",
            source: "approved-ai-proposal",
            turnId: currentLearningTurnId(),
            combo: Boolean(comboPos),
            comboStep: state.learningSequenceIndex,
            sequenceIndex: state.learningSequenceIndex++,
            phase: learningPhaseLabel(),
          });
        } else {
          takeOver = response === "takeover";
          const demonstrated = await beginCorrectionInput(
            takeOver ? "takeover" : "change",
            choice.context,
            takeOver ? null : action,
            comboPos
          );
          if (!isAiRunActive(runId) || demonstrated.cancelled) return;
          action = demonstrated.action;
          result = demonstrated.result;
        }
      }

      if (!result && action[0] === "stop") {
        result = { type: "stop", successCapture: false, captured: null, lastMove: null, invalid: false };
        recordTurnAction(AI, action, result, {});
      } else if (!result) {
        result = await performVisibleAction(action, AI, {
          runId,
          combo: Boolean(comboPos),
          stepStartedAt: nowMs() - (choice.totalElapsedMs || 0),
        });
      }
    }

    if (!isAiRunActive(runId)) return;
    const winner = checkWinner(state.board);
    if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }
    if (action[0] === "stop") break;
    if (!isComboRuleEnabled() || !result.successCapture || !result.lastMove) break;
    comboPos = { r: result.lastMove.r, c: result.lastMove.c };
    if (!hasCaptureOpportunityFrom(state.board, state.playerColor[AI], comboPos, { includeDark: true })) break;
  }

  state.pendingAction = null;
  state.aiThinking = false;
  state.correction.takeOver = false;
  endTurn();
}

async function chooseLearnedAiAction(comboPos = null) {
  if (!state) return null;
  const startedAt = nowMs();
  const legalActions = generateLearningLegalActions(AI, comboPos);
  if (legalActions.length === 0) return null;
  const choice = await requestAiWorkerDecision(comboPos);
  const validChoice = choice && Array.isArray(choice.action)
    && legalActions.some((action) => sameAction(action, choice.action));
  if (!validChoice) throw new Error("AI 背景模型回傳了不合法行動");

  state.aiSearchInfo = {
    engine: "tactical-imitation-v2-exact-worker",
    elapsedMs: Math.round(nowMs() - startedAt),
    learnedGames: window.DarkChessLearning ? window.DarkChessLearning.getStats().learnedGames : 0,
    learnedDecisions: window.DarkChessLearning ? window.DarkChessLearning.getStats().learnedDecisions : 0,
    confidence: choice.confidence,
    candidates: choice.context.candidates.length,
  };
  choice.totalElapsedMs = nowMs() - startedAt;
  return choice;
}

function isAiRunActive(runId) { return Boolean(state && state.aiThinking && state.currentPlayer === AI && runId === aiRunId); }

async function performVisibleAction(action, actor, options = {}) {
  if (!state || !action) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "invalid" };
  const stepStartedAt = Number.isFinite(options.stepStartedAt) ? options.stepStartedAt : nowMs();
  if (actor === HUMAN) recordHumanLearningDecision(action);
  const historyMeta = captureActionHistoryMeta(state.board, action);
  state.locked = true;
  state.pendingAction = action;
  state.actionViz = buildActionViz(actor, action, null, "preview");
  state.actionViz.pulse = true;
  render();
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
  if (action[0] === "flip" && state.turnColor === null) {
    const [, r, c] = action;
    const flippedPiece = state.board[r][c];
    if (flippedPiece) {
      const opponentActor = actor === HUMAN ? AI : HUMAN;
      state.playerColor[actor] = flippedPiece.color;
      state.playerColor[opponentActor] = opponentColor(flippedPiece.color);
      state.turnColor = flippedPiece.color;
    }
  }
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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
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
    moverKind: attacker && attacker.faceUp ? attacker.kind : null,
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
    moverKind: meta ? meta.moverKind : null,
    targetPieceId: meta ? meta.targetPieceId : null,
    successCapture: Boolean(result.successCapture),
    capturedId: result.captured ? result.captured.id : null,
    revealedColor: result.revealed ? result.revealed.color : null,
    revealedKind: result.revealed ? result.revealed.kind : null,
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
  persistCurrentLearningTurn(false);
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
    navigator.serviceWorker.register(`./service-worker.js?v=${APP_VERSION}`).catch(() => {});
  });
}

function initializeLearningWhenIdle() {
  if (!window.DarkChessLearning) return;
  window.DarkChessLearning.subscribe(renderLearningStats);
  const initialize = () => {
    void window.DarkChessLearning.init().then(() => renderLearningStats()).catch((error) => {
      console.error("Unable to initialize the learning model.", error);
      renderLearningStats();
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(initialize, { timeout: 600 });
  } else {
    window.setTimeout(initialize, 30);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.DarkChessWorkerApi = {
    preparePosition: requestWorkerPositionPreparation,
    evaluatePrepared: requestWorkerEvaluation,
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    applyFixedLandscapeStage();
    const versionBadge = document.getElementById("versionBadge");
    if (versionBadge) versionBadge.textContent = `版本：${APP_VERSION}`;
    initDom();
    bindEvents();
    syncSettingsUI();
    createBoardButtons();
    showView("home");
    newGame(false);
    registerServiceWorker();
    ensureAiWorker();
    initializeLearningWhenIdle();
  });
} else {
  globalThis.DarkChessWorkerGame = {
    buildDecisionInput(snapshot, actor, comboPos) {
      state = snapshot;
      const startedAt = nowMs();
      const observation = buildLearningObservation(actor, comboPos);
      const candidates = generateLearningCandidates(actor, comboPos);
      return { observation, candidates, featureElapsedMs: nowMs() - startedAt };
    },
  };
}
