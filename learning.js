(() => {
  "use strict";

  const core = window.DarkChessModelCore;
  const tf = window.tf;
  const DB_NAME = "taiwan-dark-chess-learning";
  const DB_VERSION = 2;
  const STORES = { games: "games", turns: "turns", decisions: "decisions", models: "models", metrics: "metrics" };
  const MODEL_SCHEMA = 2;
  const MODEL_PREFIX = "player-style-v2-";
  const POINTER_ID = "player-style-v2-pointer";
  const METRICS_ID = "player-style-v2-metrics";
  const BASE_MODEL_URL = "./base-model.json";
  const EMBEDDING_DIM = 64;
  const STYLE_DIM = 16;
  const RANK_DIM = 8;
  const PERSONAL_PARAM_COUNT = STYLE_DIM + STYLE_DIM * EMBEDDING_DIM + EMBEDDING_DIM * STYLE_DIM
    + RANK_DIM * EMBEDDING_DIM + EMBEDDING_DIM + RANK_DIM + 1;
  const REPLAY_LIMIT = 8192;
  const BATCH_SIZE = 32;
  const EPOCHS = 3;
  const LEARNING_RATE = 0.0005;
  const PAIR_MARGIN = 0.5;
  const MIN_PROBABILITY = 1e-7;

  let db = null;
  let baseModel = null;
  let baseMetadata = {};
  let persistenceGranted = false;
  let initPromise = null;
  let trainingQueue = Promise.resolve();
  let activeSlot = "a";
  let params = createPersonalParameters();
  let optimizer = createOptimizerState();
  let metadata = createMetadata();
  const subscribers = new Set();
  const inferenceSamples = [];

  function createMetadata() {
    return {
      modelSchema: MODEL_SCHEMA,
      baseVersion: "tactical-backbone-v2.0.0",
      personalVersion: 0,
      activeSlot: "a",
      status: "loading",
      updatedAt: null,
      learnedGames: 0,
      completedGames: 0,
      interruptedGames: 0,
      learnedDecisions: 0,
      approvals: 0,
      corrections: 0,
      demonstrations: 0,
      modelParams: 0,
      modelBytes: 0,
      baseModelBytes: 0,
      personalModelBytes: PERSONAL_PARAM_COUNT * 4,
      learningDataBytes: 0,
      persistenceGranted: false,
      averageInferenceMs: 0,
      p95InferenceMs: 0,
      metrics: emptyMetrics(),
      lastTrainingMs: 0,
      lastTrainingRows: 0,
      error: "",
    };
  }

  function emptyMetrics() {
    return {
      all: metricGroup([]),
      recent20: metricGroup([]),
      combo: metricGroup([]),
      stop: metricGroup([]),
      darkCapture: metricGroup([]),
      sequenceExact: 0,
      sequencePrefix: 0,
    };
  }

  function seededValue(index, salt) {
    let value = Math.imul(index + 1, 0x45d9f3b) ^ salt;
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  }

  function createPersonalParameters() {
    const down = new Float32Array(STYLE_DIM * EMBEDDING_DIM);
    const rank = new Float32Array(RANK_DIM * EMBEDDING_DIM);
    for (let index = 0; index < down.length; index += 1) down[index] = (seededValue(index, 0x137a) - 0.5) * 0.025;
    for (let index = 0; index < rank.length; index += 1) rank[index] = (seededValue(index, 0x913d) - 0.5) * 0.025;
    return {
      style: new Float32Array(STYLE_DIM),
      down,
      up: new Float32Array(EMBEDDING_DIM * STYLE_DIM),
      rank,
      output: new Float32Array(EMBEDDING_DIM),
      rankOutput: new Float32Array(RANK_DIM),
      bias: new Float32Array(1),
    };
  }

  function createOptimizerState() {
    const first = {};
    const second = {};
    for (const [name, values] of Object.entries(params)) {
      first[name] = new Float32Array(values.length);
      second[name] = new Float32Array(values.length);
    }
    return { step: 0, first, second };
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        if (!core || !tf) throw new Error("模型執行元件未載入");
        metadata.status = "loading";
        emitStats();
        persistenceGranted = await requestPersistentStorage();
        db = await openDatabase();
        await loadBaseModel();
        await loadPersonalModel();
        await recoverInterruptedGames();
        await migrateV1Games();
        await refreshStats();
        metadata.status = metadata.learnedDecisions > 0 ? "ready" : "base-ready";
        emitStats();
        scheduleTraining();
      } catch (error) {
        console.error(error && error.stack ? error.stack : error);
        metadata.status = "error";
        metadata.error = error instanceof Error ? error.message : String(error);
        emitStats();
      }
      return getStats();
    })();
    return initPromise;
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== "function") return false;
      if (typeof navigator.storage.persisted === "function" && await navigator.storage.persisted()) return true;
      return Boolean(await navigator.storage.persist());
    } catch {
      return false;
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const upgradeTransaction = request.transaction;
        ensureStore(database, upgradeTransaction, STORES.games, "id", [["status", "status"], ["learned", "learned"], ["updatedAt", "updatedAt"]]);
        ensureStore(database, upgradeTransaction, STORES.turns, "id", [["gameId", "gameId"], ["actor", "actor"]]);
        ensureStore(database, upgradeTransaction, STORES.decisions, "id", [["gameId", "gameId"], ["turnId", "turnId"], ["labelType", "labelType"], ["actionType", "actionType"]]);
        ensureStore(database, upgradeTransaction, STORES.models, "id", []);
        ensureStore(database, upgradeTransaction, STORES.metrics, "id", []);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟棋路資料庫"));
      request.onblocked = () => reject(new Error("棋路資料庫被其他頁面占用"));
    });
  }

  function ensureStore(database, upgradeTransaction, name, keyPath, indices) {
    const store = database.objectStoreNames.contains(name)
      ? upgradeTransaction.objectStore(name)
      : database.createObjectStore(name, { keyPath });
    for (const [indexName, path] of indices) if (!store.indexNames.contains(indexName)) store.createIndex(indexName, path, { unique: false });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("資料庫操作失敗"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("資料庫交易失敗"));
      transaction.onabort = () => reject(transaction.error || new Error("資料庫交易中止"));
    });
  }

  async function getAll(storeName) {
    const transaction = db.transaction(storeName, "readonly");
    const rows = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return Array.isArray(rows) ? rows : [];
  }

  async function getOne(storeName, id) {
    const transaction = db.transaction(storeName, "readonly");
    const row = await requestResult(transaction.objectStore(storeName).get(id));
    await transactionDone(transaction);
    return row || null;
  }

  async function putOne(storeName, value) {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(cloneSerializable(value));
    await transactionDone(transaction);
  }

  async function loadBaseModel() {
    baseModel = await tf.loadLayersModel(BASE_MODEL_URL);
    for (const layer of baseModel.layers) layer.trainable = false;
    baseMetadata = baseModel.getUserDefinedMetadata ? await baseModel.getUserDefinedMetadata() || {} : {};
    metadata.baseVersion = baseMetadata.version || metadata.baseVersion;
    metadata.modelParams = baseModel.countParams() + PERSONAL_PARAM_COUNT;
    try {
      const [jsonResponse, weightsResponse] = await Promise.all([
        fetch(BASE_MODEL_URL, { cache: "force-cache" }),
        fetch("./base-model.weights.bin", { cache: "force-cache" }),
      ]);
      metadata.baseModelBytes = (await jsonResponse.blob()).size + (await weightsResponse.blob()).size;
    } catch {
      metadata.baseModelBytes = baseModel.countParams() * 4;
    }
    metadata.modelBytes = metadata.baseModelBytes + metadata.personalModelBytes;
    await warmBaseModel();
  }

  async function warmBaseModel() {
    const observation = { boardChannels: new Float32Array(4 * 8 * 25), turnEvents: [], historyEvents: [], ownActor: "self" };
    const candidate = { action: ["stop"], consequence: new Float32Array(24) };
    await baseForward(observation, [candidate]);
  }

  async function loadPersonalModel() {
    const pointer = await getOne(STORES.models, POINTER_ID);
    activeSlot = pointer && ["a", "b"].includes(pointer.activeSlot) ? pointer.activeSlot : "a";
    const stored = await getOne(STORES.models, `${MODEL_PREFIX}${activeSlot}`);
    if (!stored || stored.modelSchema !== MODEL_SCHEMA) return;
    params = restoreParameterObject(stored.params, createPersonalParameters());
    optimizer = restoreOptimizer(stored.optimizer);
    metadata = { ...metadata, ...(stored.metadata || {}), activeSlot, error: "" };
  }

  function restoreParameterObject(source, fallback) {
    const restored = {};
    for (const [name, values] of Object.entries(fallback)) {
      const candidate = source && source[name];
      restored[name] = candidate && candidate.length === values.length ? Float32Array.from(candidate) : values;
    }
    return restored;
  }

  function restoreOptimizer(source) {
    const fallback = createOptimizerState();
    if (!source) return fallback;
    const restored = { step: Number(source.step) || 0, first: {}, second: {} };
    for (const name of Object.keys(params)) {
      restored.first[name] = source.first && source.first[name] && source.first[name].length === params[name].length
        ? Float32Array.from(source.first[name]) : fallback.first[name];
      restored.second[name] = source.second && source.second[name] && source.second[name].length === params[name].length
        ? Float32Array.from(source.second[name]) : fallback.second[name];
    }
    return restored;
  }

  function createSession() {
    const now = new Date().toISOString();
    const id = `game-v2-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const session = {
      id,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      status: "active",
      outcome: null,
      v2Learned: false,
      decisionIds: [],
      turnIds: [],
      sequence: 0,
    };
    if (db) void putOne(STORES.games, session);
    return session;
  }

  async function prepareDecision(observation, candidates) {
    const startedAt = performance.now();
    if (!observation || !Array.isArray(candidates) || candidates.length === 0) return null;
    const normalizedCandidates = candidates.map(normalizeCandidate).filter(Boolean);
    if (!normalizedCandidates.length) return null;
    let base = await baseForward(observation, normalizedCandidates);
    for (let index = 0; index < normalizedCandidates.length; index += 1) {
      normalizedCandidates[index].consequence[20] = base.continuationValues[index] || 0;
    }
    base = await baseForward(observation, normalizedCandidates);
    const scores = [];
    for (let index = 0; index < normalizedCandidates.length; index += 1) {
      scores.push(personalForward(base.embeddings[index], base.logits[index]).score);
    }
    const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);
    const probabilities = softmax(scores);
    const elapsedMs = performance.now() - startedAt;
    rememberInference(elapsedMs);
    return {
      observation: cloneSerializable(observation),
      candidates: normalizedCandidates.map(cloneSerializable),
      embeddings: base.embeddings.map((row) => Array.from(row)),
      baseLogits: [...base.logits],
      continuationValues: [...base.continuationValues],
      scores,
      probabilities,
      order: order.map((row) => row.index),
      elapsedMs,
      modelVersion: metadata.personalVersion,
      preparedAt: new Date().toISOString(),
    };
  }

  async function chooseAction(observation, candidates) {
    const context = await prepareDecision(observation, candidates);
    if (!context) return null;
    const bestIndex = context.order[0];
    return {
      action: [...context.candidates[bestIndex].action],
      confidence: context.probabilities[bestIndex],
      elapsedMs: context.elapsedMs,
      context,
      candidateIndex: bestIndex,
    };
  }

  async function baseForward(observation, candidates) {
    const count = candidates.length;
    const board = core.boardTensor(observation);
    const turn = core.eventTensor(observation.turnEvents, core.TURN_STEPS, observation.ownActor || "self");
    const history = core.eventTensor(observation.historyEvents, core.HISTORY_STEPS, observation.ownActor || "self");
    const boards = new Float32Array(count * board.length);
    const turns = new Float32Array(count * turn.length);
    const histories = new Float32Array(count * history.length);
    const belief = core.beliefVector(observation);
    const beliefs = new Float32Array(count * belief.length);
    const candidateRows = new Float32Array(count * core.CANDIDATE_DIM);
    for (let index = 0; index < count; index += 1) {
      boards.set(board, index * board.length);
      turns.set(turn, index * turn.length);
      histories.set(history, index * history.length);
      beliefs.set(belief, index * belief.length);
      candidateRows.set(core.candidateVector(candidates[index]), index * core.CANDIDATE_DIM);
    }
    const inputs = [
      tf.tensor4d(boards, [count, 4, 8, core.BOARD_CHANNELS]),
      tf.tensor3d(turns, [count, core.TURN_STEPS, core.EVENT_DIM]),
      tf.tensor3d(histories, [count, core.HISTORY_STEPS, core.EVENT_DIM]),
      tf.tensor2d(beliefs, [count, core.BELIEF_DIM]),
      tf.tensor2d(candidateRows, [count, core.CANDIDATE_DIM]),
    ];
    const outputs = baseModel.predict(inputs);
    const embeddingData = await outputs[0].data();
    const logitData = await outputs[1].data();
    const continuationData = await outputs[2].data();
    const embeddings = [];
    for (let index = 0; index < count; index += 1) embeddings.push(Float32Array.from(embeddingData.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM)));
    for (const tensor of [...inputs, ...outputs]) tensor.dispose();
    return { embeddings, logits: Array.from(logitData), continuationValues: Array.from(continuationData) };
  }

  function normalizeCandidate(candidate) {
    if (Array.isArray(candidate)) return { action: [...candidate], moverKind: null, targetKind: null, targetHidden: false, consequence: Array(24).fill(0) };
    if (!candidate || !Array.isArray(candidate.action)) return null;
    return {
      action: [...candidate.action],
      moverKind: candidate.moverKind || null,
      targetKind: candidate.targetKind || null,
      targetHidden: Boolean(candidate.targetHidden),
      consequence: Array.from(core.boardTensor ? pad(candidate.consequence, 24) : new Float32Array(24)),
    };
  }

  function pad(values, size) {
    const row = new Float32Array(size);
    if (!values) return row;
    for (let index = 0; index < Math.min(size, values.length || 0); index += 1) row[index] = Number(values[index]) || 0;
    return row;
  }

  function rememberInference(value) {
    inferenceSamples.push(value);
    if (inferenceSamples.length > 512) inferenceSamples.splice(0, inferenceSamples.length - 512);
    const sorted = [...inferenceSamples].sort((a, b) => a - b);
    metadata.averageInferenceMs = inferenceSamples.reduce((sum, row) => sum + row, 0) / inferenceSamples.length;
    metadata.p95InferenceMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
  }

  async function recordChoice(session, context, chosenAction, options = {}) {
    if (!session || session.status !== "active" || !context) return false;
    const chosenIndex = context.candidates.findIndex((candidate) => sameAction(candidate.action, chosenAction));
    if (chosenIndex < 0) return false;
    const rejectedIndex = options.rejectedAction
      ? context.candidates.findIndex((candidate) => sameAction(candidate.action, options.rejectedAction))
      : -1;
    const rank = context.order.indexOf(chosenIndex) + 1;
    const now = new Date().toISOString();
    const id = `decision-v2-${Date.now()}-${session.sequence++}-${Math.random().toString(36).slice(2, 7)}`;
    const row = {
      id,
      gameId: session.id,
      turnId: options.turnId || `${session.id}-turn-unknown`,
      recordedAt: now,
      modelVersionAtCollection: context.modelVersion,
      labelType: options.labelType || "normal",
      source: options.source || "human",
      actionType: chosenAction[0],
      combo: Boolean(options.combo),
      comboStep: Number(options.comboStep) || 0,
      phase: options.phase || "middle",
      chosenAction: [...chosenAction],
      rejectedAction: rejectedIndex >= 0 ? [...options.rejectedAction] : null,
      chosenIndex,
      rejectedIndex,
      predictedIndex: context.order[0],
      chosenRank: rank,
      candidates: context.candidates.map(cloneSerializable),
      embeddings: context.embeddings.map((embedding) => [...embedding]),
      baseLogits: [...context.baseLogits],
      sequenceIndex: Number(options.sequenceIndex) || 0,
      voluntaryStop: chosenAction[0] === "stop",
      darkCapture: chosenAction[0] === "darkCapture",
    };
    await putOne(STORES.decisions, row);
    session.decisionIds.push(id);
    session.updatedAt = now;
    await putOne(STORES.games, session);
    return true;
  }

  async function recordTurn(session, turn) {
    if (!session || !turn) return false;
    const id = turn.id || `${session.id}-turn-${session.turnIds.length}`;
    const row = { ...cloneSerializable(turn), id, gameId: session.id };
    await putOne(STORES.turns, row);
    if (!session.turnIds.includes(id)) session.turnIds.push(id);
    session.updatedAt = new Date().toISOString();
    await putOne(STORES.games, session);
    return true;
  }

  async function finishGame(session, status, outcome) {
    if (!session || session.status !== "active") return false;
    const now = new Date().toISOString();
    session.status = status === "completed" ? "completed" : "interrupted";
    session.outcome = outcome || session.status;
    session.finishedAt = now;
    session.updatedAt = now;
    session.v2Learned = session.decisionIds.length === 0;
    await putOne(STORES.games, session);
    if (session.decisionIds.length) scheduleTraining();
    return true;
  }

  async function recoverInterruptedGames() {
    const games = await getAll(STORES.games);
    const now = new Date().toISOString();
    for (const game of games) {
      if (game && game.status === "active" && Array.isArray(game.decisionIds) && game.decisionIds.length) {
        await putOne(STORES.games, { ...game, status: "interrupted", outcome: "interrupted", finishedAt: now, updatedAt: now, v2Learned: false });
      }
    }
  }

  async function migrateV1Games() {
    const games = await getAll(STORES.games);
    for (const game of games) {
      if (!game || game.v2MigratedAt || !Array.isArray(game.decisions) || game.decisions.length === 0) continue;
      const decisionIds = Array.isArray(game.decisionIds) ? [...game.decisionIds] : [];
      let sequence = 0;
      for (const old of game.decisions) {
        if (!old || !old.snapshot || !Array.isArray(old.legalActions) || !Array.isArray(old.chosenAction)) continue;
        const observation = migrateObservation(old.snapshot);
        const candidates = old.legalActions.map((action) => ({ action, consequence: Array(24).fill(0) }));
        const context = await prepareDecision(observation, candidates);
        const chosenIndex = context.candidates.findIndex((candidate) => sameAction(candidate.action, old.chosenAction));
        if (chosenIndex < 0) continue;
        const id = `decision-v2-migrated-${game.id}-${sequence}`;
        const row = {
          id,
          gameId: game.id,
          turnId: `${game.id}-v1-turn-${sequence}`,
          recordedAt: old.recordedAt || game.updatedAt || new Date().toISOString(),
          modelVersionAtCollection: metadata.personalVersion,
          labelType: "v1-migration",
          source: "human",
          actionType: old.chosenAction[0],
          combo: Boolean(old.snapshot.comboActive),
          comboStep: 0,
          phase: "unknown",
          chosenAction: [...old.chosenAction],
          rejectedAction: null,
          chosenIndex,
          rejectedIndex: -1,
          predictedIndex: context.order[0],
          chosenRank: context.order.indexOf(chosenIndex) + 1,
          candidates: context.candidates.map(cloneSerializable),
          embeddings: context.embeddings.map((embedding) => [...embedding]),
          baseLogits: [...context.baseLogits],
          sequenceIndex: sequence,
          voluntaryStop: old.chosenAction[0] === "stop",
          darkCapture: old.chosenAction[0] === "darkCapture",
          maskedHistory: true,
          maskedConsequences: true,
        };
        await putOne(STORES.decisions, row);
        decisionIds.push(id);
        sequence += 1;
        if (sequence % 8 === 0) await yieldToPage();
      }
      await putOne(STORES.games, {
        ...game,
        decisionIds,
        status: game.status === "active" ? "interrupted" : game.status,
        outcome: game.status === "active" ? "interrupted" : game.outcome,
        finishedAt: game.status === "active" ? new Date().toISOString() : game.finishedAt,
        v2MigratedAt: new Date().toISOString(),
        v2Learned: decisionIds.length === 0,
      });
    }
  }

  function migrateObservation(snapshot) {
    const channels = new Float32Array(4 * 8 * 25);
    const kindMap = { K: 0, A: 1, E: 2, R: 3, N: 4, C: 5, P: 6 };
    const board = Array.isArray(snapshot.board) ? snapshot.board : [];
    for (let index = 0; index < 32; index += 1) {
      const token = board[index] || ".";
      const offset = index * 25;
      if (token === ".") channels[offset + 15] = 1;
      else if (token === "D") channels[offset + 14] = 1;
      else {
        const sideOffset = token[0] === "o" ? 0 : 7;
        channels[offset + sideOffset + (kindMap[token[1]] || 0)] = 1;
      }
      channels[offset + 20] = snapshot.comboIndex === index ? 1 : 0;
      channels[offset + 23] = Math.floor(index / 8) / 3;
      channels[offset + 24] = (index % 8) / 7;
    }
    return { boardChannels: Array.from(channels), turnEvents: [], historyEvents: [], ownActor: "self" };
  }

  function scheduleTraining() {
    trainingQueue = trainingQueue.then(trainPendingGames).catch((error) => {
      metadata.status = "error";
      metadata.error = error instanceof Error ? error.message : String(error);
      emitStats();
    });
    return trainingQueue;
  }

  async function trainPendingGames() {
    if (!db || !baseModel) return;
    const games = await getAll(STORES.games);
    const pending = games.filter((game) => game && game.status !== "active" && game.v2Learned !== true && Array.isArray(game.decisionIds) && game.decisionIds.length);
    if (!pending.length) { await refreshStats(); return; }
    metadata.status = "training";
    metadata.error = "";
    emitStats();
    const startedAt = performance.now();
    const allDecisions = await getAll(STORES.decisions);
    const pendingIds = new Set(pending.flatMap((game) => game.decisionIds));
    const currentRows = allDecisions.filter((row) => pendingIds.has(row.id));
    const correctionRows = allDecisions.filter((row) => row.labelType === "correction");
    const reserved = new Set([...currentRows, ...correctionRows].map((row) => row.id));
    const replay = stratifiedReplay(allDecisions.filter((row) => !reserved.has(row.id)), REPLAY_LIMIT);
    const trainingRows = uniqueRows([...currentRows, ...correctionRows, ...replay]);
    await trainAdapter(trainingRows);
    const learnedAt = new Date().toISOString();
    const pendingGameIds = new Set(pending.map((game) => game.id));
    for (const game of games) if (pendingGameIds.has(game.id)) {
      game.v2Learned = true;
      game.v2LearnedAt = learnedAt;
    }
    metadata.personalVersion += 1;
    metadata.updatedAt = learnedAt;
    metadata.lastTrainingMs = performance.now() - startedAt;
    metadata.lastTrainingRows = trainingRows.length;
    await saveAtomicModel(games.filter((game) => pendingGameIds.has(game.id)));
    await refreshStats();
    metadata.status = "ready";
    emitStats();
    const newest = await getAll(STORES.games);
    if (newest.some((game) => game && game.status !== "active" && game.v2Learned !== true && game.decisionIds && game.decisionIds.length)) scheduleTraining();
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => row && !seen.has(row.id) && seen.add(row.id));
  }

  function stratifiedReplay(rows, limit) {
    if (rows.length <= limit) return [...rows];
    const groups = new Map();
    for (const row of rows) {
      const key = [row.actionType, row.combo ? "combo" : "ordinary", Math.min(5, row.comboStep || 0), row.phase || "unknown", row.voluntaryStop ? "stop" : "go", row.darkCapture ? "dark" : "known"].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const result = [];
    const buckets = [...groups.values()];
    let cursor = 0;
    while (result.length < limit && buckets.length) {
      const bucket = buckets[cursor % buckets.length];
      const index = Math.floor((result.length / Math.max(1, limit)) * bucket.length);
      const candidate = bucket[Math.min(bucket.length - 1, index)];
      if (candidate && !result.includes(candidate)) result.push(candidate);
      cursor += 1;
      if (cursor > limit * buckets.length * 2) break;
    }
    if (result.length < limit) for (const row of rows) { if (!result.includes(row)) result.push(row); if (result.length >= limit) break; }
    return result;
  }

  async function trainAdapter(rows) {
    if (!rows.length) return;
    const ordered = [...rows];
    for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
      deterministicShuffle(ordered, `${metadata.personalVersion + 1}-${epoch}-${rows.length}`);
      for (let start = 0; start < ordered.length; start += BATCH_SIZE) {
        const batch = ordered.slice(start, start + BATCH_SIZE);
        const gradients = zeroLikeParameters();
        for (const row of batch) accumulateDecisionGradients(row, gradients);
        applyAdam(gradients, batch.length, totalLearnedDecisionCount(rows.length));
        if ((start / BATCH_SIZE) % 4 === 0) await yieldToPage();
      }
    }
  }

  function totalLearnedDecisionCount(extra) { return Math.max(1, (metadata.learnedDecisions || 0) + extra); }

  function zeroLikeParameters() {
    const result = {};
    for (const [name, values] of Object.entries(params)) result[name] = new Float32Array(values.length);
    return result;
  }

  function accumulateDecisionGradients(row, gradients) {
    if (!row || !Array.isArray(row.embeddings) || row.chosenIndex < 0 || row.chosenIndex >= row.embeddings.length) return;
    const forward = row.embeddings.map((embedding, index) => personalForward(embedding, row.baseLogits[index] || 0));
    const probabilities = softmax(forward.map((item) => item.score));
    for (let index = 0; index < forward.length; index += 1) {
      const derivative = probabilities[index] - (index === row.chosenIndex ? 1 : 0);
      accumulatePersonalGradient(forward[index], derivative, gradients);
    }
    if (row.rejectedIndex >= 0 && row.rejectedIndex < forward.length && row.rejectedIndex !== row.chosenIndex) {
      const delta = forward[row.rejectedIndex].score - forward[row.chosenIndex].score + PAIR_MARGIN;
      const derivative = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, delta))));
      accumulatePersonalGradient(forward[row.rejectedIndex], derivative, gradients);
      accumulatePersonalGradient(forward[row.chosenIndex], -derivative, gradients);
    }
  }

  function personalForward(embeddingLike, baseLogit) {
    const x = embeddingLike instanceof Float32Array ? embeddingLike : Float32Array.from(embeddingLike || []);
    const down = new Float32Array(STYLE_DIM);
    for (let i = 0; i < STYLE_DIM; i += 1) {
      let value = params.style[i];
      for (let j = 0; j < EMBEDDING_DIM; j += 1) value += params.down[i * EMBEDDING_DIM + j] * (x[j] || 0);
      down[i] = Math.tanh(value);
    }
    const adapted = new Float32Array(EMBEDDING_DIM);
    for (let j = 0; j < EMBEDDING_DIM; j += 1) {
      let value = x[j] || 0;
      for (let i = 0; i < STYLE_DIM; i += 1) value += params.up[j * STYLE_DIM + i] * down[i];
      adapted[j] = value;
    }
    const rank = new Float32Array(RANK_DIM);
    for (let r = 0; r < RANK_DIM; r += 1) {
      let value = 0;
      for (let j = 0; j < EMBEDDING_DIM; j += 1) value += params.rank[r * EMBEDDING_DIM + j] * (x[j] || 0);
      rank[r] = Math.tanh(value);
    }
    let score = Number(baseLogit) || 0;
    for (let j = 0; j < EMBEDDING_DIM; j += 1) score += params.output[j] * adapted[j];
    for (let r = 0; r < RANK_DIM; r += 1) score += params.rankOutput[r] * rank[r];
    score += params.bias[0];
    return { x, down, adapted, rank, score };
  }

  function accumulatePersonalGradient(cache, derivative, gradients) {
    gradients.bias[0] += derivative;
    const downDerivative = new Float32Array(STYLE_DIM);
    for (let j = 0; j < EMBEDDING_DIM; j += 1) {
      gradients.output[j] += derivative * cache.adapted[j];
      for (let i = 0; i < STYLE_DIM; i += 1) {
        gradients.up[j * STYLE_DIM + i] += derivative * params.output[j] * cache.down[i];
        downDerivative[i] += derivative * params.output[j] * params.up[j * STYLE_DIM + i];
      }
    }
    for (let i = 0; i < STYLE_DIM; i += 1) {
      const preDerivative = downDerivative[i] * (1 - cache.down[i] * cache.down[i]);
      gradients.style[i] += preDerivative;
      for (let j = 0; j < EMBEDDING_DIM; j += 1) gradients.down[i * EMBEDDING_DIM + j] += preDerivative * cache.x[j];
    }
    for (let r = 0; r < RANK_DIM; r += 1) {
      gradients.rankOutput[r] += derivative * cache.rank[r];
      const preDerivative = derivative * params.rankOutput[r] * (1 - cache.rank[r] * cache.rank[r]);
      for (let j = 0; j < EMBEDDING_DIM; j += 1) gradients.rank[r * EMBEDDING_DIM + j] += preDerivative * cache.x[j];
    }
  }

  function applyAdam(gradients, batchLength, learnedCount) {
    optimizer.step += 1;
    const beta1 = 0.9;
    const beta2 = 0.999;
    const lambda = 1e-4 / Math.sqrt(1 + learnedCount / 200);
    const correction1 = 1 - beta1 ** optimizer.step;
    const correction2 = 1 - beta2 ** optimizer.step;
    for (const name of Object.keys(params)) {
      for (let index = 0; index < params[name].length; index += 1) {
        const gradient = gradients[name][index] / Math.max(1, batchLength) + lambda * params[name][index];
        optimizer.first[name][index] = beta1 * optimizer.first[name][index] + (1 - beta1) * gradient;
        optimizer.second[name][index] = beta2 * optimizer.second[name][index] + (1 - beta2) * gradient * gradient;
        const first = optimizer.first[name][index] / correction1;
        const second = optimizer.second[name][index] / correction2;
        params[name][index] -= LEARNING_RATE * first / (Math.sqrt(second) + 1e-8);
      }
    }
  }

  async function saveAtomicModel(updatedGames) {
    const nextSlot = activeSlot === "a" ? "b" : "a";
    const nextMetadata = { ...metadata, activeSlot: nextSlot, status: "ready", persistenceGranted, error: "" };
    const transaction = db.transaction([STORES.games, STORES.models, STORES.metrics], "readwrite");
    const gameStore = transaction.objectStore(STORES.games);
    for (const game of updatedGames) gameStore.put(cloneSerializable(game));
    transaction.objectStore(STORES.models).put({
      id: `${MODEL_PREFIX}${nextSlot}`,
      modelSchema: MODEL_SCHEMA,
      baseVersion: metadata.baseVersion,
      params: serializeParameterObject(params),
      optimizer: serializeOptimizer(optimizer),
      metadata: nextMetadata,
    });
    transaction.objectStore(STORES.models).put({ id: POINTER_ID, activeSlot: nextSlot, updatedAt: metadata.updatedAt });
    transaction.objectStore(STORES.metrics).put({ id: METRICS_ID, updatedAt: metadata.updatedAt, metrics: metadata.metrics });
    await transactionDone(transaction);
    activeSlot = nextSlot;
    metadata.activeSlot = nextSlot;
  }

  function serializeParameterObject(source) {
    return Object.fromEntries(Object.entries(source).map(([name, values]) => [name, Array.from(values)]));
  }

  function serializeOptimizer(source) {
    return {
      step: source.step,
      first: serializeParameterObject(source.first),
      second: serializeParameterObject(source.second),
    };
  }

  async function refreshStats() {
    if (!db) return;
    const [games, decisions] = await Promise.all([getAll(STORES.games), getAll(STORES.decisions)]);
    const learnedGames = games.filter((game) => game && game.v2Learned === true && game.decisionIds && game.decisionIds.length);
    metadata.learnedGames = learnedGames.length;
    metadata.completedGames = learnedGames.filter((game) => game.status === "completed").length;
    metadata.interruptedGames = learnedGames.filter((game) => game.status === "interrupted").length;
    metadata.learnedDecisions = decisions.filter((row) => learnedGames.some((game) => game.id === row.gameId)).length;
    metadata.approvals = decisions.filter((row) => row.labelType === "approval").length;
    metadata.corrections = decisions.filter((row) => row.labelType === "correction").length;
    metadata.demonstrations = decisions.filter((row) => row.labelType === "demonstration").length;
    metadata.persistenceGranted = persistenceGranted;
    metadata.modelParams = (baseModel ? baseModel.countParams() : 0) + PERSONAL_PARAM_COUNT;
    metadata.modelBytes = metadata.baseModelBytes + metadata.personalModelBytes;
    metadata.learningDataBytes = byteLengthOfJson(games) + byteLengthOfJson(decisions);
    metadata.metrics = computeMetrics(decisions, games);
    if (metadata.status !== "training" && metadata.status !== "error") metadata.status = metadata.learnedDecisions > 0 ? "ready" : "base-ready";
    emitStats();
  }

  function computeMetrics(decisions, games) {
    const finished = games.filter((game) => game && game.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
    const recentIds = new Set(finished.slice(-20).map((game) => game.id));
    const measured = decisions.filter((row) => Number.isFinite(row.chosenRank) && row.chosenRank > 0);
    const groups = new Map();
    for (const row of measured) {
      const key = `${row.gameId}|${row.turnId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    let exact = 0;
    let prefixTotal = 0;
    for (const rows of groups.values()) {
      rows.sort((a, b) => (a.sequenceIndex || 0) - (b.sequenceIndex || 0));
      if (rows.every((row) => row.chosenRank === 1)) exact += 1;
      let prefix = 0;
      while (prefix < rows.length && rows[prefix].chosenRank === 1) prefix += 1;
      prefixTotal += prefix / Math.max(1, rows.length);
    }
    return {
      all: metricGroup(measured),
      recent20: metricGroup(measured.filter((row) => recentIds.has(row.gameId))),
      combo: metricGroup(measured.filter((row) => row.combo)),
      stop: metricGroup(measured.filter((row) => row.voluntaryStop)),
      darkCapture: metricGroup(measured.filter((row) => row.darkCapture)),
      sequenceExact: groups.size ? exact / groups.size : 0,
      sequencePrefix: groups.size ? prefixTotal / groups.size : 0,
    };
  }

  function metricGroup(rows) {
    return {
      count: rows.length,
      top1: rows.length ? rows.filter((row) => row.chosenRank === 1).length / rows.length : 0,
      top3: rows.length ? rows.filter((row) => row.chosenRank <= 3).length / rows.length : 0,
    };
  }

  async function exportArchive() {
    const payload = {
      format: "taiwan-dark-chess-learning-v2",
      exportedAt: new Date().toISOString(),
      baseVersion: metadata.baseVersion,
      activeSlot,
      params: serializeParameterObject(params),
      optimizer: serializeOptimizer(optimizer),
      metadata: getStats(),
      games: await getAll(STORES.games),
      turns: await getAll(STORES.turns),
      decisions: await getAll(STORES.decisions),
    };
    return new Blob([JSON.stringify(payload)], { type: "application/json" });
  }

  async function importArchive(file) {
    const text = typeof file === "string" ? file : await file.text();
    const payload = JSON.parse(text);
    if (!payload || payload.format !== "taiwan-dark-chess-learning-v2") throw new Error("匯入檔案格式不符");
    const importedParams = restoreParameterObject(payload.params, createPersonalParameters());
    const importedOptimizer = restoreOptimizer(payload.optimizer);
    const nextSlot = activeSlot === "a" ? "b" : "a";
    const transaction = db.transaction([STORES.games, STORES.turns, STORES.decisions, STORES.models], "readwrite");
    for (const row of payload.games || []) transaction.objectStore(STORES.games).put(cloneSerializable(row));
    for (const row of payload.turns || []) transaction.objectStore(STORES.turns).put(cloneSerializable(row));
    for (const row of payload.decisions || []) transaction.objectStore(STORES.decisions).put(cloneSerializable(row));
    transaction.objectStore(STORES.models).put({
      id: `${MODEL_PREFIX}${nextSlot}`,
      modelSchema: MODEL_SCHEMA,
      baseVersion: payload.baseVersion || metadata.baseVersion,
      params: serializeParameterObject(importedParams),
      optimizer: serializeOptimizer(importedOptimizer),
      metadata: { ...metadata, ...(payload.metadata || {}), activeSlot: nextSlot, importedAt: new Date().toISOString() },
    });
    transaction.objectStore(STORES.models).put({ id: POINTER_ID, activeSlot: nextSlot, updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
    params = importedParams;
    optimizer = importedOptimizer;
    activeSlot = nextSlot;
    metadata.activeSlot = nextSlot;
    await refreshStats();
    emitStats();
    return true;
  }

  async function rollbackModel() {
    const previousSlot = activeSlot === "a" ? "b" : "a";
    const previous = await getOne(STORES.models, `${MODEL_PREFIX}${previousSlot}`);
    if (!previous || previous.modelSchema !== MODEL_SCHEMA) return false;
    params = restoreParameterObject(previous.params, createPersonalParameters());
    optimizer = restoreOptimizer(previous.optimizer);
    activeSlot = previousSlot;
    metadata = { ...metadata, ...(previous.metadata || {}), activeSlot: previousSlot, status: "ready", error: "" };
    await putOne(STORES.models, { id: POINTER_ID, activeSlot: previousSlot, updatedAt: new Date().toISOString() });
    emitStats();
    return true;
  }

  function softmax(scores) {
    const maximum = Math.max(...scores);
    const values = scores.map((score) => Math.exp(Math.max(-30, Math.min(30, score - maximum))));
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    return values.map((value) => Math.max(MIN_PROBABILITY, value / total));
  }

  function deterministicShuffle(rows, text) {
    let seed = hashString(text);
    const random = () => {
      seed += 0x6D2B79F5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    for (let index = rows.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [rows[index], rows[target]] = [rows[target], rows[index]];
    }
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  function sameAction(a, b) {
    return Boolean(Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]));
  }

  function cloneSerializable(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function byteLengthOfJson(value) {
    try { return new Blob([JSON.stringify(value)]).size; } catch { return 0; }
  }

  function yieldToPage() { return new Promise((resolve) => window.setTimeout(resolve, 0)); }

  function subscribe(callback) {
    if (typeof callback !== "function") return () => {};
    subscribers.add(callback);
    callback(getStats());
    return () => subscribers.delete(callback);
  }

  function emitStats() {
    const snapshot = getStats();
    for (const callback of subscribers) try { callback(snapshot); } catch { /* 顯示問題不影響資料保存。 */ }
  }

  function getStats() { return cloneSerializable(metadata); }

  window.DarkChessLearning = {
    init,
    createSession,
    prepareDecision,
    chooseAction,
    recordChoice,
    recordTurn,
    finishGame,
    exportArchive,
    importArchive,
    rollbackModel,
    getStats,
    subscribe,
  };
})();
