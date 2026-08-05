(() => {
  "use strict";

  const ROWS = 4;
  const COLS = 8;
  const BOARD_CHANNELS = 25;
  const EVENT_DIM = 24;
  const TURN_STEPS = 16;
  const HISTORY_STEPS = 32;
  const CONSEQUENCE_DIM = 24;
  const BELIEF_DIM = 14;
  const CANDIDATE_DIM = 117;
  const ACTION_TYPES = ["flip", "move", "capture", "darkCapture", "stop"];
  const PIECE_TYPES = ["K", "A", "E", "R", "N", "C", "P"];

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.max(min, Math.min(max, numeric));
  }

  function padVector(values, size) {
    const result = new Float32Array(size);
    if (!values) return result;
    const limit = Math.min(size, values.length || 0);
    for (let index = 0; index < limit; index += 1) result[index] = Number(values[index]) || 0;
    return result;
  }

  function boardTensor(observation) {
    return padVector(observation && observation.boardChannels, ROWS * COLS * BOARD_CHANNELS);
  }

  function beliefVector(observation) {
    return padVector(observation && observation.belief, BELIEF_DIM);
  }

  function encodeEvent(event, ownActor) {
    const row = new Float32Array(EVENT_DIM);
    if (!event) return row;
    const isOwn = event.actor === ownActor;
    row[isOwn ? 0 : 1] = 1;
    const actionIndex = ACTION_TYPES.indexOf(event.kind || (event.action && event.action[0]));
    if (actionIndex >= 0) row[2 + actionIndex] = 1;
    const source = event.source || actionSource(event.action);
    const destination = event.destination || actionDestination(event.action);
    row[7] = source ? source.r / 3 : 0;
    row[8] = source ? source.c / 7 : 0;
    row[9] = destination ? destination.r / 3 : 0;
    row[10] = destination ? destination.c / 7 : 0;
    row[11] = event.successCapture ? 1 : 0;
    row[12] = event.kind === "darkCapture" && !event.successCapture ? 1 : 0;
    row[13] = event.kind === "stop" ? 1 : 0;
    const moverIndex = PIECE_TYPES.indexOf(event.moverKind);
    if (moverIndex >= 0) row[14 + moverIndex] = 1;
    row[21] = event.revealSide === "own" ? 1 : 0;
    row[22] = event.revealSide === "opponent" ? 1 : 0;
    row[23] = event.turnBoundary ? 1 : 0;
    return row;
  }

  function eventTensor(events, steps, ownActor) {
    const tensor = new Float32Array(steps * EVENT_DIM);
    const rows = Array.isArray(events) ? events.slice(-steps) : [];
    const offset = steps - rows.length;
    for (let index = 0; index < rows.length; index += 1) {
      tensor.set(encodeEvent(rows[index], ownActor), (offset + index) * EVENT_DIM);
    }
    return tensor;
  }

  function candidateVector(candidate) {
    const row = new Float32Array(CANDIDATE_DIM);
    if (!candidate || !Array.isArray(candidate.action)) return row;
    const action = candidate.action;
    let cursor = 0;

    const actionIndex = ACTION_TYPES.indexOf(action[0]);
    if (actionIndex >= 0) row[cursor + actionIndex] = 1;
    cursor += ACTION_TYPES.length;

    const moverIndex = PIECE_TYPES.indexOf(candidate.moverKind);
    row[cursor + (moverIndex >= 0 ? moverIndex + 1 : 0)] = 1;
    cursor += 8;

    const targetIndex = PIECE_TYPES.indexOf(candidate.targetKind);
    const targetBucket = candidate.targetHidden ? 1 : targetIndex >= 0 ? targetIndex + 2 : 0;
    row[cursor + targetBucket] = 1;
    cursor += 9;

    const source = actionSource(action);
    const destination = actionDestination(action);
    if (source) row[cursor + source.r * COLS + source.c] = 1;
    cursor += ROWS * COLS;
    if (destination) row[cursor + destination.r * COLS + destination.c] = 1;
    cursor += ROWS * COLS;

    row[cursor] = source && destination ? (destination.r - source.r) / 3 : 0;
    row[cursor + 1] = source && destination ? (destination.c - source.c) / 7 : 0;
    row[cursor + 2] = source && destination
      ? (Math.abs(destination.r - source.r) + Math.abs(destination.c - source.c)) / 10
      : 0;
    cursor += 3;

    row[cursor] = source ? source.r / 3 : 0;
    row[cursor + 1] = source ? source.c / 7 : 0;
    row[cursor + 2] = destination ? destination.r / 3 : 0;
    row[cursor + 3] = destination ? destination.c / 7 : 0;
    cursor += 4;

    const consequence = padVector(candidate.consequence, CONSEQUENCE_DIM);
    row.set(consequence, cursor);
    return row;
  }

  function actionSource(action) {
    if (!Array.isArray(action) || !["move", "capture", "darkCapture"].includes(action[0])) return null;
    return { r: action[1], c: action[2] };
  }

  function actionDestination(action) {
    if (!Array.isArray(action)) return null;
    if (action[0] === "flip") return { r: action[1], c: action[2] };
    if (["move", "capture", "darkCapture"].includes(action[0])) return { r: action[3], c: action[4] };
    return null;
  }

  function createBaseModel(tf) {
    const boardInput = tf.input({ shape: [ROWS, COLS, BOARD_CHANNELS], name: "board" });
    const turnInput = tf.input({ shape: [TURN_STEPS, EVENT_DIM], name: "turn" });
    const historyInput = tf.input({ shape: [HISTORY_STEPS, EVENT_DIM], name: "history" });
    const beliefInput = tf.input({ shape: [BELIEF_DIM], name: "belief" });
    const candidateInput = tf.input({ shape: [CANDIDATE_DIM], name: "candidate" });

    let board = tf.layers.conv2d({
      name: "board_conv",
      filters: 32,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: "heNormal",
    }).apply(boardInput);

    for (let block = 0; block < 3; block += 1) {
      const residual = board;
      let branch = tf.layers.conv2d({
        name: `res_${block}_conv_1`,
        filters: 32,
        kernelSize: 3,
        padding: "same",
        activation: "relu",
        kernelInitializer: "heNormal",
      }).apply(board);
      branch = tf.layers.conv2d({
        name: `res_${block}_conv_2`,
        filters: 32,
        kernelSize: 3,
        padding: "same",
        kernelInitializer: "heNormal",
      }).apply(branch);
      board = tf.layers.add({ name: `res_${block}_add` }).apply([residual, branch]);
      board = tf.layers.activation({ name: `res_${block}_relu`, activation: "relu" }).apply(board);
    }

    const boardMean = tf.layers.globalAveragePooling2d({ name: "board_mean" }).apply(board);
    const boardMax = tf.layers.globalMaxPooling2d({ name: "board_max" }).apply(board);
    const boardGlobal = tf.layers.concatenate({ name: "board_global" }).apply([boardMean, boardMax]);
    const turnState = tf.layers.gru({ name: "turn_gru", units: 32 }).apply(turnInput);
    const historyState = tf.layers.gru({ name: "history_gru", units: 32 }).apply(historyInput);
    const combined = tf.layers.concatenate({ name: "combined" }).apply([
      boardGlobal,
      turnState,
      historyState,
      beliefInput,
      candidateInput,
    ]);
    const hidden128 = tf.layers.dense({
      name: "candidate_dense_128",
      units: 128,
      activation: "relu",
      kernelInitializer: "heNormal",
    }).apply(combined);
    const embedding = tf.layers.dense({
      name: "candidate_embedding",
      units: 64,
      activation: "relu",
      kernelInitializer: "heNormal",
    }).apply(hidden128);
    const baseLogit = tf.layers.dense({ name: "base_logit", units: 1 }).apply(embedding);
    const continuation = tf.layers.dense({ name: "continuation_value", units: 1, activation: "tanh" }).apply(embedding);
    const auxiliary = tf.layers.dense({ name: "objective_auxiliary", units: CONSEQUENCE_DIM }).apply(embedding);

    return tf.model({
      name: "dark_chess_tactical_backbone_v2",
      inputs: [boardInput, turnInput, historyInput, beliefInput, candidateInput],
      outputs: [embedding, baseLogit, continuation, auxiliary],
    });
  }

  const api = {
    ROWS,
    COLS,
    BOARD_CHANNELS,
    EVENT_DIM,
    TURN_STEPS,
    HISTORY_STEPS,
    CONSEQUENCE_DIM,
    BELIEF_DIM,
    CANDIDATE_DIM,
    ACTION_TYPES,
    PIECE_TYPES,
    boardTensor,
    beliefVector,
    eventTensor,
    encodeEvent,
    candidateVector,
    actionSource,
    actionDestination,
    createBaseModel,
    clamp,
  };

  globalThis.DarkChessModelCore = api;
})();
