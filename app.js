const APP_VERSION = "mobile-r15-safearea-fix-001";

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
  easy: { label: "入門", depth: 1, branchLimit: 10, riskTaste: 0.85, help: "反應最快。" },
  normal: { label: "一般", depth: 3, branchLimit: 16, riskTaste: 1.0, help: "速度與強度平衡。" },
  hard: { label: "困難", depth: 4, branchLimit: 20, riskTaste: 1.15, help: "搜尋較深，重視風險。" },
  master: { label: "強敵", depth: 5, branchLimit: 24, riskTaste: 1.28, help: "候選步更多，估算更細。" },
};

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
      : generateActions(state.board, state.turnColor, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: isComboRuleEnabled() }).filter((a) => a[1] === selected.r && a[2] === selected.c);
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
    const result = await performVisibleAction(["move", src.r, src.c, dst.r, dst.c], HUMAN);
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
    setStatus("AI 行動中", "");
    render();
    window.setTimeout(aiMove, 160);
  } else {
    state.aiThinking = false;
    setStatus(state.combo.active ? "可連吃" : "輪到您", "");
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

  let action = findBestAction(cloneBoard(state.board), aiColor, humanColor, diff, { includeDarkCaptures: comboEnabled });
  if (!action) { state.aiThinking = false; state.locked = true; state.pendingAction = null; render(); showModal("遊戲結束", "您獲勝。"); return; }

  let result = await performVisibleAction(action, AI, { runId });
  if (!isAiRunActive(runId)) return;
  let winner = checkWinner(state.board);
  if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }

  if (comboEnabled && result.successCapture && result.lastMove) {
    let pos = { r: result.lastMove.r, c: result.lastMove.c };
    let guard = 0;
    while (guard < 16) {
      guard += 1;
      const comboChoice = chooseBestComboAction(state.board, aiColor, humanColor, pos, diff);
      if (!comboChoice || comboChoice.score < 90) break;
      result = await performVisibleAction(comboChoice.action, AI, { runId, combo: true });
      if (!isAiRunActive(runId)) return;
      winner = checkWinner(state.board);
      if (winner !== null) { state.aiThinking = false; state.pendingAction = null; render(); showWinner(winner); return; }
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
  setStatus("輪到您", "");
  render();
}

function isAiRunActive(runId) { return Boolean(state && state.aiThinking && state.currentPlayer === AI && runId === aiRunId); }

async function performVisibleAction(action, actor, options = {}) {
  if (!state || !action) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "invalid" };
  state.locked = true;
  state.pendingAction = action;
  state.actionViz = buildActionViz(actor, action, null, "preview");
  state.actionViz.pulse = true;
  render();
  await sleep(actor === AI ? loadAiDelayMs() : 150);
  if (actor === AI && options.runId && !isAiRunActive(options.runId)) return { invalid: true, successCapture: false, captured: null, lastMove: null, type: "cancelled" };

  if (action[0] === "darkCapture") {
    const result = await performVisibleDarkCapture(action, actor, options);
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
function orderActions(board, actions, aiColor, humanColor, diff) { return actions.map((action) => ({ action, score: quickActionScore(board, action, aiColor, humanColor, diff), key: action.join("-") })).sort((a, b) => b.score !== a.score ? b.score - a.score : b.key.localeCompare(a.key)).map((item) => item.action); }

function findBestAction(board, aiColor, humanColor, diff, options = {}) {
  let actions = generateActions(board, aiColor, { includeFlips: true, includeMoves: true, includeCaptures: true, includeDarkCaptures: Boolean(options.includeDarkCaptures) });
  if (actions.length === 0) return null;
  actions = orderActions(board, actions, aiColor, humanColor, diff).slice(0, diff.branchLimit);
  let bestScore = -Infinity, bestAction = null, alpha = -Infinity, beta = Infinity;
  for (const action of actions) {
    let score = quickActionScore(board, action, aiColor, humanColor, diff);
    if (action[0] === "move" || action[0] === "capture") {
      const nextBoard = cloneBoard(board);
      applyAction(nextBoard, action);
      score += minimax(nextBoard, diff.depth - 1, humanColor, aiColor, humanColor, alpha, beta, false, diff);
    }
    if (score > bestScore) { bestScore = score; bestAction = action; }
    alpha = Math.max(alpha, bestScore);
  }
  return bestAction;
}

function minimax(board, depth, currentColor, aiColor, humanColor, alpha, beta, maximizing, diff) {
  const winner = checkWinnerForSearch(board);
  if (winner === aiColor) return 1_000_000 + depth;
  if (winner === humanColor) return -1_000_000 - depth;
  if (depth <= 0) return evaluateBoard(board, aiColor, humanColor, diff);
  let actions = generateActions(board, currentColor, { includeFlips: false, includeMoves: true, includeCaptures: true, includeDarkCaptures: false });
  if (actions.length === 0) return evaluateBoard(board, aiColor, humanColor, diff);
  actions = orderActions(board, actions, aiColor, humanColor, diff).slice(0, diff.branchLimit);
  const nextColor = currentColor === aiColor ? humanColor : aiColor;
  if (maximizing) {
    let value = -Infinity;
    for (const action of actions) { const nextBoard = cloneBoard(board); applyAction(nextBoard, action); const score = minimax(nextBoard, depth - 1, nextColor, aiColor, humanColor, alpha, beta, false, diff); value = Math.max(value, score); alpha = Math.max(alpha, value); if (beta <= alpha) break; }
    return value;
  }
  let value = Infinity;
  for (const action of actions) { const nextBoard = cloneBoard(board); applyAction(nextBoard, action); const score = minimax(nextBoard, depth - 1, nextColor, aiColor, humanColor, alpha, beta, true, diff); value = Math.min(value, score); beta = Math.min(beta, value); if (beta <= alpha) break; }
  return value;
}

function quickActionScore(board, action, aiColor, humanColor, diff) {
  const kind = action[0];
  if (kind === "capture") {
    const [, sr, sc, dr, dc] = action;
    const attacker = board[sr][sc], defender = board[dr][dc];
    let gain = VALUE[defender.kind] * 10;
    const risk = pieceDangerAfterMove(board, action, attacker.color) * 2;
    const tradeBonus = VALUE[defender.kind] - VALUE[attacker.kind];
    if (attacker.kind === "P" && defender.kind === "K") gain += 3000;
    return gain + tradeBonus - risk;
  }
  if (kind === "darkCapture") return expectedHiddenCaptureScore(board, action, aiColor, humanColor, diff);
  if (kind === "move") {
    const [, sr, sc, dr, dc] = action;
    const piece = board[sr][sc];
    const nextBoard = cloneBoard(board);
    applyAction(nextBoard, action);
    const beforeRisk = squareRisk(board, sr, sc, piece.color);
    const afterRisk = squareRisk(nextBoard, dr, dc, piece.color);
    return threatScoreFrom(nextBoard, dr, dc, piece.color) + (beforeRisk - afterRisk) * 3;
  }
  if (kind === "flip") { const [, r, c] = action; return expectedFlipScore(board, r, c, aiColor, humanColor, diff); }
  return 0;
}

function evaluateBoard(board, aiColor, humanColor, diff) {
  let score = 0;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (!piece || !piece.faceUp) continue;
    let pieceScore = VALUE[piece.kind] + threatScoreFrom(board, r, c, piece.color) * 0.35 - squareRisk(board, r, c, piece.color) * 0.45;
    if (piece.kind === "K") pieceScore -= kingNearEnemyPawnPenalty(board, r, c, piece.color, diff);
    score += piece.color === aiColor ? pieceScore : -pieceScore;
  }
  score += (generateNonFlipActions(board, aiColor).length - generateNonFlipActions(board, humanColor).length) * 8;
  return score;
}

function threatScoreFrom(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || !piece.faceUp) return 0;
  let score = 0;
  for (let rr = 0; rr < ROWS; rr += 1) for (let cc = 0; cc < COLS; cc += 1) {
    const target = board[rr][cc];
    if (!target || !target.faceUp || target.color === color) continue;
    if (canCapture(board, { r, c }, { r: rr, c: cc })) { score += VALUE[target.kind]; if (piece.kind === "P" && target.kind === "K") score += 2500; }
  }
  return score;
}

function squareRisk(board, r, c, ownColor) {
  const target = board[r][c];
  if (!target || !target.faceUp) return 0;
  let risk = 0;
  for (let rr = 0; rr < ROWS; rr += 1) for (let cc = 0; cc < COLS; cc += 1) {
    const attacker = board[rr][cc];
    if (!attacker || !attacker.faceUp || attacker.color === ownColor) continue;
    if (canCapture(board, { r: rr, c: cc }, { r, c })) { risk += VALUE[target.kind]; if (attacker.kind === "P" && target.kind === "K") risk += 3000; }
  }
  return risk;
}

function pieceDangerAfterMove(board, action, ownColor) {
  const nextBoard = cloneBoard(board);
  applyAction(nextBoard, action);
  if (action[0] === "move" || action[0] === "capture") { const [, , , dr, dc] = action; return squareRisk(nextBoard, dr, dc, ownColor); }
  return 0;
}

function expectedFlipScore(board, r, c, aiColor, humanColor, diff) {
  const pool = getUnseenPool(board);
  const total = pool.total || 1;
  let expected = 0;
  for (const color of ["red", "black"]) for (const kind of Object.keys(PIECE_COUNTS)) {
    const count = pool.counts[color][kind];
    if (count <= 0) continue;
    expected += (count / total) * VALUE[kind] * (color === aiColor ? 0.26 : -0.24);
  }
  return expected + flipPositionScore(board, r, c, aiColor, diff);
}

function expectedHiddenCaptureScore(board, action, aiColor, humanColor, diff) {
  const [, sr, sc, dr, dc] = action;
  const attacker = board[sr][sc];
  const pool = getUnseenPool(board);
  const total = pool.total || 1;
  let successProb = 0, expectedGain = 0, failPain = 0;
  for (const color of ["red", "black"]) for (const kind of Object.keys(PIECE_COUNTS)) {
    const count = pool.counts[color][kind];
    if (count <= 0) continue;
    const prob = count / total;
    const hypothetical = { color, kind, faceUp: true };
    const canEat = color !== attacker.color && canHypotheticalCapture(board, { r: sr, c: sc }, { r: dr, c: dc }, hypothetical);
    if (canEat) { successProb += prob; expectedGain += prob * VALUE[kind] * 9.5; if (attacker.kind === "P" && kind === "K") expectedGain += prob * 3000; }
    else { let pain = 120; if (color !== attacker.color) pain += VALUE[kind] * 0.9; if (attacker.kind === "K" && color !== attacker.color && kind === "P") pain += 2600; failPain += prob * pain; }
  }
  return expectedGain + successProb * 260 - failPain * diff.riskTaste - squareRisk(board, sr, sc, attacker.color) * 0.45;
}

function flipPositionScore(board, r, c, aiColor, diff = DIFFICULTIES.normal) {
  let score = 0;
  const pool = getUnseenPool(board);
  const enemyColor = opponentColor(aiColor);
  const enemyPawnProb = pool.total ? pool.counts[enemyColor].P / pool.total : 0;
  const aiPawnProb = pool.total ? pool.counts[aiColor].P / pool.total : 0;
  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];
    if (!piece || !piece.faceUp) continue;
    if (piece.color === aiColor) { score += VALUE[piece.kind] * 0.06; if (piece.kind === "K") score -= enemyPawnProb * 1600 * diff.riskTaste; }
    else { score -= VALUE[piece.kind] * 0.08; if (piece.kind === "K") score += aiPawnProb * 1200; }
  }
  const centerR = (ROWS - 1) / 2, centerC = (COLS - 1) / 2;
  return score - (Math.abs(r - centerR) + Math.abs(c - centerC)) * 3;
}

function kingNearEnemyPawnPenalty(board, r, c, color, diff = DIFFICULTIES.normal) {
  let penalty = 0;
  const pool = getUnseenPool(board);
  const enemyColor = opponentColor(color);
  const hiddenEnemyPawnProb = pool.total ? pool.counts[enemyColor].P / pool.total : 0;
  for (const nb of neighbors(r, c)) {
    const piece = board[nb.r][nb.c];
    if (!piece) continue;
    if (!piece.faceUp) penalty += hiddenEnemyPawnProb * 950 * diff.riskTaste;
    else if (piece.color !== color && piece.kind === "P") penalty += 3500;
  }
  return penalty;
}

function chooseBestComboAction(board, aiColor, humanColor, pos, diff) {
  const actions = generateCaptureActionsFrom(board, aiColor, pos, { includeDark: true });
  let best = null;
  for (const action of actions) {
    const score = quickActionScore(board, action, aiColor, humanColor, diff);
    if (!best || score > best.score) best = { action, score };
  }
  return best;
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=mobile-r15-safearea-fix-001").catch(() => {});
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
