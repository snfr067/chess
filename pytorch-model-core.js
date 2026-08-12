(() => {
  "use strict";

  const ROWS = 4;
  const COLS = 8;
  const KINDS = ["K", "A", "E", "R", "N", "C", "P"];
  const ACTION_KINDS = ["flip", "move", "capture", "dark_capture", "stop"];
  const PIECE_COUNTS = { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 };
  const SEARCH_VALUE = { K: 950, A: 650, E: 520, R: 420, N: 340, C: 480, P: 220 };
  const BOARD_CHANNELS = 18;
  const GLOBAL_DIM = 54;
  const HISTORY_LENGTH = 8;
  const HISTORY_DIM = 79;
  const ACTION_DIM = 106;

  const positionIndex = (row, col) => row * COLS + col;
  const faceUp = (piece) => Boolean(piece && (piece.faceUp ?? piece.face_up));
  const currentColor = (state) => state.playerColor[state.currentPlayer] || null;
  const normalizeAction = (action) => action.map((value, index) => index === 0 && value === "darkCapture" ? "dark_capture" : value);

  function unseenCounts(state) {
    const counts = {
      red: { ...PIECE_COUNTS },
      black: { ...PIECE_COUNTS },
    };
    for (const piece of state.board.flat()) {
      if (piece && faceUp(piece) && counts[piece.color] && piece.kind in counts[piece.color]) counts[piece.color][piece.kind] -= 1;
    }
    for (const piece of state.captured || []) {
      if (piece && counts[piece.color] && piece.kind in counts[piece.color]) counts[piece.color][piece.kind] -= 1;
    }
    return counts;
  }

  function encodeBoard(state) {
    const output = new Float32Array(BOARD_CHANNELS * ROWS * COLS);
    const color = currentColor(state);
    const set = (channel, row, col) => { output[(channel * ROWS + row) * COLS + col] = 1; };
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = state.board[row][col];
        if (!piece) set(0, row, col);
        else if (!faceUp(piece)) set(1, row, col);
        else {
          set(2 + (piece.color === "red" ? 0 : KINDS.length) + KINDS.indexOf(piece.kind), row, col);
          if (color) set(piece.color === color ? 16 : 17, row, col);
        }
      }
    }
    return output;
  }

  function encodeGlobal(state) {
    const output = new Float32Array(GLOBAL_DIM);
    let cursor = 0;
    output[cursor + (state.currentPlayer === "ai" ? 0 : 1)] = 1;
    cursor += 2;
    const color = currentColor(state);
    output[cursor + (color === "red" ? 1 : color === "black" ? 2 : 0)] = 1;
    cursor += 3;
    output[cursor] = state.combo && state.combo.active ? 1 : 0;
    cursor += 1;
    if (state.combo && state.combo.active) output[cursor + positionIndex(state.combo.r, state.combo.c)] = 1;
    cursor += ROWS * COLS;
    const counts = unseenCounts(state);
    for (const side of ["red", "black"]) for (const kind of KINDS) output[cursor++] = counts[side][kind] / 5;
    output[cursor] = Math.min(1, Number(state.completedTurns || 0) / 160);
    output[cursor + 1] = Math.min(1, Number(state.atomicPly || 0) / 320);
    return output;
  }

  function encodeHistory(state) {
    const output = new Float32Array(HISTORY_LENGTH * HISTORY_DIM);
    const turns = (state.turnHistory || []).slice(-HISTORY_LENGTH);
    const start = HISTORY_LENGTH - turns.length;
    turns.forEach((turn, turnIndex) => {
      const offset = (start + turnIndex) * HISTORY_DIM;
      let cursor = 0;
      output[offset + cursor + (turn.actor === state.currentPlayer ? 0 : 1)] = 1;
      cursor += 2;
      output[offset + cursor] = turn.hadCapture ? 1 : 0;
      output[offset + cursor + 1] = turn.hadFlip ? 1 : 0;
      cursor += 2;
      const source = turn.from;
      output[offset + cursor + (source ? positionIndex(source.r, source.c) : ROWS * COLS)] = 1;
      cursor += ROWS * COLS + 1;
      const target = turn.to;
      output[offset + cursor + (target ? positionIndex(target.r, target.c) : ROWS * COLS)] = 1;
      cursor += ROWS * COLS + 1;
      const moverKind = turn.moverKind || turn.mover_kind;
      const moverIndex = KINDS.indexOf(moverKind);
      if (moverIndex >= 0) output[offset + cursor + moverIndex] = 1;
      cursor += KINDS.length;
      const actions = turn.actions || [];
      output[offset + cursor] = Math.min(1, actions.length / 8);
      output[offset + cursor + 1] = Math.min(1, actions.filter((item) => item.successCapture || item.success_capture).length / 8);
    });
    return output;
  }

  function relativePieceIndex(piece, color, includeHidden) {
    if (!piece) return 0;
    if (!faceUp(piece)) return includeHidden ? 1 : 0;
    return 2 + KINDS.indexOf(piece.kind) + (color && piece.color === color ? 0 : KINDS.length);
  }

  function canNormalCapture(attacker, defender) {
    const rank = { K: 7, A: 6, E: 5, R: 4, N: 3, C: 2, P: 1 };
    if (attacker.kind === "K" && defender.kind === "P") return false;
    if (attacker.kind === "P" && defender.kind === "K") return true;
    return rank[attacker.kind] >= rank[defender.kind];
  }

  function expectedDarkCaptureValue(state, action) {
    const attacker = state.board[action[1]][action[2]];
    if (!attacker || !faceUp(attacker)) return 0;
    const counts = unseenCounts(state);
    let total = 0;
    let score = 0;
    for (const side of ["red", "black"]) for (const kind of KINDS) {
      const count = counts[side][kind];
      if (!count) continue;
      total += count;
      const success = attacker.color !== side && (attacker.kind === "C" || canNormalCapture(attacker, { kind }));
      score += count * (success ? SEARCH_VALUE[kind] : -80);
    }
    return total ? score / total : 0;
  }

  function publicActionScore(state, action) {
    if (globalThis.DarkChessWorkerGame && typeof globalThis.DarkChessWorkerGame.publicActionScore === "function") {
      const runtimeScore = globalThis.DarkChessWorkerGame.publicActionScore(action);
      if (Number.isFinite(runtimeScore)) return runtimeScore;
    }
    if (action[0] === "stop") return 0;
    if (action[0] === "flip") return 10 - Math.abs(action[1] - 1.5) * 2 - Math.abs(action[2] - 3.5);
    if (action[0] === "capture") {
      const target = state.board[action[3]][action[4]];
      return target ? SEARCH_VALUE[target.kind] : 0;
    }
    if (action[0] === "dark_capture") return expectedDarkCaptureValue(state, action);
    return 0;
  }

  function encodeAction(state, sourceAction) {
    const action = normalizeAction(sourceAction);
    const output = new Float32Array(ACTION_DIM);
    let cursor = 0;
    output[cursor + ACTION_KINDS.indexOf(action[0])] = 1;
    cursor += ACTION_KINDS.length;
    let source = null;
    let target = null;
    if (["move", "capture", "dark_capture"].includes(action[0])) {
      source = [action[1], action[2]];
      target = [action[3], action[4]];
    } else if (action[0] === "flip") target = [action[1], action[2]];
    output[cursor + (source ? positionIndex(...source) : ROWS * COLS)] = 1;
    cursor += ROWS * COLS + 1;
    output[cursor + (target ? positionIndex(...target) : ROWS * COLS)] = 1;
    cursor += ROWS * COLS + 1;
    const color = currentColor(state);
    let attackerIndex = relativePieceIndex(source ? state.board[source[0]][source[1]] : null, color, false);
    if (attackerIndex === 1) attackerIndex = 0;
    else if (attackerIndex >= 2) attackerIndex -= 1;
    output[cursor + attackerIndex] = 1;
    cursor += 15;
    const defenderIndex = relativePieceIndex(target ? state.board[target[0]][target[1]] : null, color, true);
    output[cursor + defenderIndex] = 1;
    cursor += 16;
    output[cursor] = Math.tanh(publicActionScore(state, action) / 600);
    const policy = globalThis.DarkChessWorkerGame && typeof globalThis.DarkChessWorkerGame.movePolicy === "function"
      ? globalThis.DarkChessWorkerGame.movePolicy(sourceAction)
      : { forbidden: false, penalty: 0 };
    output[cursor + 1] = policy.forbidden || !Number.isFinite(policy.penalty) ? 0 : Math.tanh(policy.penalty / 9000);
    output[cursor + 2] = state.combo && state.combo.active ? 1 : 0;
    if (source && target) output[cursor + 3] = (Math.abs(source[0] - target[0]) + Math.abs(source[1] - target[1])) / 10;
    return output;
  }

  function encode(state, candidates) {
    const actions = new Float32Array(candidates.length * ACTION_DIM);
    candidates.forEach((candidate, index) => actions.set(encodeAction(state, candidate.action), index * ACTION_DIM));
    return {
      board: encodeBoard(state),
      global: encodeGlobal(state),
      history: encodeHistory(state),
      actions,
    };
  }

  globalThis.DarkChessPyTorchModelCore = {
    BOARD_CHANNELS,
    GLOBAL_DIM,
    HISTORY_LENGTH,
    HISTORY_DIM,
    ACTION_DIM,
    encode,
    normalizeAction,
  };
})();
