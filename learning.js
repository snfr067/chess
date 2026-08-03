(() => {
  "use strict";

  const DB_NAME = "taiwan-dark-chess-learning";
  const DB_VERSION = 1;
  const GAME_STORE = "games";
  const MODEL_STORE = "models";
  const MODEL_ID = "player-style-v1";
  const MODEL_VERSION = 1;
  const FEATURE_COUNT = 8192;
  const MAX_REPLAY_DECISIONS = 900;
  const MAX_NEW_DECISIONS = 1800;
  const BASE_LEARNING_RATE = 0.12;
  const MIN_PROBABILITY = 1e-7;

  let db = null;
  let persistenceGranted = false;
  let weights = new Float32Array(FEATURE_COUNT);
  let gradientSquares = new Float32Array(FEATURE_COUNT);
  let metadata = createEmptyMetadata();
  let initPromise = null;
  let trainingQueue = Promise.resolve();
  const subscribers = new Set();

  function createEmptyMetadata() {
    return {
      modelVersion: MODEL_VERSION,
      status: "untrained",
      updatedAt: null,
      learnedGames: 0,
      completedGames: 0,
      interruptedGames: 0,
      learnedDecisions: 0,
      modelBytes: 0,
      learningDataBytes: 0,
      persistenceGranted: false,
      lastInferenceMs: 0,
      error: "",
    };
  }

  function createSession() {
    const now = new Date().toISOString();
    const randomPart = Math.random().toString(36).slice(2, 10);
    return {
      id: `game-${Date.now()}-${randomPart}`,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      status: "active",
      outcome: null,
      learned: false,
      learnedAt: null,
      decisions: [],
    };
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        persistenceGranted = await requestPersistentStorage();
        db = await openDatabase();
        await loadStoredModel();
        await recoverInterruptedGames();
        metadata.persistenceGranted = persistenceGranted;
        emitStats();
        scheduleTraining();
      } catch (error) {
        metadata.status = "error";
        metadata.error = error instanceof Error ? error.message : String(error);
        emitStats();
      }
      return getStats();
    })();
    return initPromise;
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || typeof navigator.storage.persist !== "function") return false;
    try {
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
        if (!database.objectStoreNames.contains(GAME_STORE)) {
          const games = database.createObjectStore(GAME_STORE, { keyPath: "id" });
          games.createIndex("status", "status", { unique: false });
          games.createIndex("learned", "learned", { unique: false });
          games.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(MODEL_STORE)) {
          database.createObjectStore(MODEL_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟棋路學習資料庫"));
      request.onblocked = () => reject(new Error("棋路學習資料庫被其他頁面占用"));
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 操作失敗"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 交易失敗"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 交易已中止"));
    });
  }

  async function getAllGames() {
    if (!db) return [];
    const transaction = db.transaction(GAME_STORE, "readonly");
    const request = transaction.objectStore(GAME_STORE).getAll();
    const result = await requestToPromise(request);
    await transactionDone(transaction);
    return Array.isArray(result) ? result : [];
  }

  async function putGame(game) {
    if (!db || !game || !game.id) return;
    const transaction = db.transaction(GAME_STORE, "readwrite");
    transaction.objectStore(GAME_STORE).put(cloneSerializable(game));
    await transactionDone(transaction);
  }

  async function loadStoredModel() {
    if (!db) return;
    const transaction = db.transaction(MODEL_STORE, "readonly");
    const stored = await requestToPromise(transaction.objectStore(MODEL_STORE).get(MODEL_ID));
    await transactionDone(transaction);
    if (!stored || stored.modelVersion !== MODEL_VERSION) {
      metadata.modelBytes = calculateModelBytes();
      return;
    }

    if (stored.weights instanceof Float32Array && stored.weights.length === FEATURE_COUNT) {
      weights = new Float32Array(stored.weights);
    } else if (Array.isArray(stored.weights) && stored.weights.length === FEATURE_COUNT) {
      weights = Float32Array.from(stored.weights);
    }

    if (stored.gradientSquares instanceof Float32Array && stored.gradientSquares.length === FEATURE_COUNT) {
      gradientSquares = new Float32Array(stored.gradientSquares);
    } else if (Array.isArray(stored.gradientSquares) && stored.gradientSquares.length === FEATURE_COUNT) {
      gradientSquares = Float32Array.from(stored.gradientSquares);
    }

    metadata = {
      ...createEmptyMetadata(),
      ...(stored.metadata || {}),
      persistenceGranted,
      status: stored.metadata && stored.metadata.learnedGames > 0 ? "ready" : "untrained",
      error: "",
    };
    metadata.modelBytes = calculateModelBytes();
  }

  async function recoverInterruptedGames() {
    const games = await getAllGames();
    const activeGames = games.filter((game) =>
      game
      && game.status === "active"
      && Array.isArray(game.decisions)
      && game.decisions.length > 0
    );
    if (activeGames.length === 0) return;

    const transaction = db.transaction(GAME_STORE, "readwrite");
    const store = transaction.objectStore(GAME_STORE);
    const now = new Date().toISOString();
    for (const game of activeGames) {
      store.put({
        ...game,
        status: "interrupted",
        outcome: "interrupted",
        finishedAt: game.finishedAt || now,
        updatedAt: now,
        learned: false,
      });
    }
    await transactionDone(transaction);
  }

  async function recordDecision(session, snapshot, legalActions, chosenAction) {
    if (!session || session.status !== "active" || !snapshot || !Array.isArray(legalActions)) return false;
    const sanitizedActions = legalActions.map(cloneAction).filter(Boolean);
    const sanitizedChoice = cloneAction(chosenAction);
    if (!sanitizedChoice || !sanitizedActions.some((action) => sameAction(action, sanitizedChoice))) return false;

    session.decisions.push({
      recordedAt: new Date().toISOString(),
      snapshot: cloneSerializable(snapshot),
      legalActions: sanitizedActions,
      chosenAction: sanitizedChoice,
    });
    session.updatedAt = new Date().toISOString();
    await putGame(session);
    return true;
  }

  function finishGame(session, status, outcome) {
    if (!session || session.status !== "active") return Promise.resolve(false);
    if (!Array.isArray(session.decisions) || session.decisions.length === 0) {
      session.status = status;
      session.outcome = outcome;
      session.finishedAt = new Date().toISOString();
      return Promise.resolve(false);
    }

    session.status = status === "completed" ? "completed" : "interrupted";
    session.outcome = outcome || session.status;
    session.finishedAt = new Date().toISOString();
    session.updatedAt = session.finishedAt;
    session.learned = false;

    return putGame(session)
      .then(() => {
        scheduleTraining();
        return true;
      })
      .catch((error) => {
        metadata.status = "error";
        metadata.error = error instanceof Error ? error.message : String(error);
        emitStats();
        return false;
      });
  }

  function scheduleTraining() {
    if (metadata.status !== "training") {
      metadata.status = "training";
      metadata.error = "";
      emitStats();
    }
    trainingQueue = trainingQueue
      .then(() => trainPendingGames())
      .catch((error) => {
        metadata.status = "error";
        metadata.error = error instanceof Error ? error.message : String(error);
        emitStats();
      });
    return trainingQueue;
  }

  async function trainPendingGames() {
    if (!db) return;
    const games = await getAllGames();
    const pendingGames = games.filter(isPendingLearningGame);
    if (pendingGames.length === 0) {
      await refreshMetadataFromGames(games);
      return;
    }

    metadata.status = "training";
    metadata.error = "";
    emitStats();

    const newDecisions = pendingGames
      .flatMap((game) => game.decisions || [])
      .slice(-MAX_NEW_DECISIONS);
    const learnedDecisions = games
      .filter((game) => game && game.learned === true)
      .flatMap((game) => game.decisions || []);
    const replayDecisions = sampleEvenly(learnedDecisions, MAX_REPLAY_DECISIONS);

    const trainingRows = [];
    for (let repeat = 0; repeat < 5; repeat += 1) trainingRows.push(...newDecisions);
    trainingRows.push(...replayDecisions);
    deterministicShuffle(trainingRows, pendingGames.map((game) => game.id).join("|"));

    const nextWeights = new Float32Array(weights);
    const nextGradientSquares = new Float32Array(gradientSquares);
    let processed = 0;
    for (const decision of trainingRows) {
      trainDecision(decision, nextWeights, nextGradientSquares);
      processed += 1;
      if ((processed % 10) === 0) await yieldToPage();
    }

    const learnedAt = new Date().toISOString();
    const pendingIds = new Set(pendingGames.map((game) => game.id));
    const updatedGames = games.map((game) => pendingIds.has(game.id)
      ? { ...game, learned: true, learnedAt }
      : game);
    const learnedGameRows = updatedGames.filter((game) => game && game.learned === true);
    const nextMetadata = buildMetadata(learnedGameRows, learnedAt);

    const transaction = db.transaction([GAME_STORE, MODEL_STORE], "readwrite");
    const gameStore = transaction.objectStore(GAME_STORE);
    for (const game of updatedGames) {
      if (pendingIds.has(game.id)) gameStore.put(game);
    }
    transaction.objectStore(MODEL_STORE).put({
      id: MODEL_ID,
      modelVersion: MODEL_VERSION,
      weights: nextWeights,
      gradientSquares: nextGradientSquares,
      metadata: nextMetadata,
    });
    await transactionDone(transaction);

    weights = nextWeights;
    gradientSquares = nextGradientSquares;
    metadata = {
      ...nextMetadata,
      status: "ready",
      persistenceGranted,
      error: "",
    };
    emitStats();

    const newestGames = await getAllGames();
    if (newestGames.some(isPendingLearningGame)) scheduleTraining();
  }

  function isPendingLearningGame(game) {
    return Boolean(
      game
      && game.learned !== true
      && game.status !== "active"
      && Array.isArray(game.decisions)
      && game.decisions.length > 0
    );
  }

  async function refreshMetadataFromGames(games) {
    const learnedGames = games.filter((game) => game && game.learned === true);
    const retainedUpdatedAt = metadata.updatedAt;
    const refreshed = buildMetadata(learnedGames, retainedUpdatedAt);
    metadata = {
      ...metadata,
      ...refreshed,
      status: refreshed.learnedGames > 0 ? "ready" : "untrained",
      persistenceGranted,
      error: "",
    };
    emitStats();
  }

  function buildMetadata(learnedGames, updatedAt) {
    const decisions = learnedGames.reduce((sum, game) => sum + (game.decisions ? game.decisions.length : 0), 0);
    const completed = learnedGames.filter((game) => game.status === "completed").length;
    const interrupted = learnedGames.filter((game) => game.status === "interrupted").length;
    const learningDataBytes = byteLengthOfJson(learnedGames);
    return {
      modelVersion: MODEL_VERSION,
      status: learnedGames.length > 0 ? "ready" : "untrained",
      updatedAt: learnedGames.length > 0 ? updatedAt : null,
      learnedGames: learnedGames.length,
      completedGames: completed,
      interruptedGames: interrupted,
      learnedDecisions: decisions,
      modelBytes: calculateModelBytes(),
      learningDataBytes,
      persistenceGranted,
      lastInferenceMs: metadata.lastInferenceMs || 0,
      error: "",
    };
  }

  function trainDecision(decision, targetWeights, targetGradientSquares) {
    if (!decision || !decision.snapshot || !Array.isArray(decision.legalActions)) return;
    const chosenIndex = decision.legalActions.findIndex((action) => sameAction(action, decision.chosenAction));
    if (chosenIndex < 0 || decision.legalActions.length < 2) return;

    const featureRows = decision.legalActions.map((action) => featureIndices(decision.snapshot, action));
    const scores = featureRows.map((indices) => scoreFeaturesWithWeights(indices, targetWeights));
    const probabilities = softmax(scores);

    for (let actionIndex = 0; actionIndex < featureRows.length; actionIndex += 1) {
      const error = (actionIndex === chosenIndex ? 1 : 0) - probabilities[actionIndex];
      for (const featureIndex of featureRows[actionIndex]) {
        const regularizedGradient = error - targetWeights[featureIndex] * 0.00003;
        targetGradientSquares[featureIndex] += regularizedGradient * regularizedGradient;
        const step = BASE_LEARNING_RATE / Math.sqrt(targetGradientSquares[featureIndex] + 1e-6);
        targetWeights[featureIndex] += step * regularizedGradient;
      }
    }
  }

  function chooseAction(snapshot, legalActions, fallbackScores = []) {
    const startedAt = performance.now();
    if (!snapshot || !Array.isArray(legalActions) || legalActions.length === 0) return null;
    if (legalActions.length === 1) {
      return {
        action: cloneAction(legalActions[0]),
        confidence: 1,
        styleWeight: metadata.learnedDecisions > 0 ? 1 : 0,
        elapsedMs: performance.now() - startedAt,
      };
    }

    const styleScores = legalActions.map((action) => scoreFeatures(featureIndices(snapshot, action)));
    const normalizedStyle = normalizeScores(styleScores);
    const normalizedFallback = normalizeScores(legalActions.map((_, index) =>
      Number.isFinite(fallbackScores[index]) ? fallbackScores[index] : 0
    ));
    const learnedCount = metadata.learnedDecisions || 0;
    const styleWeight = learnedCount === 0 ? 0 : Math.min(0.96, 0.32 + learnedCount / 550);
    const combined = legalActions.map((action, index) => {
      const stableTieBreak = (hashString(action.join(":")) % 997) / 997000;
      return normalizedStyle[index] * styleWeight
        + normalizedFallback[index] * (1 - styleWeight)
        + stableTieBreak;
    });

    let bestIndex = 0;
    for (let index = 1; index < combined.length; index += 1) {
      if (combined[index] > combined[bestIndex]) bestIndex = index;
    }

    const probabilities = softmax(combined);
    const elapsedMs = performance.now() - startedAt;
    metadata.lastInferenceMs = elapsedMs;
    return {
      action: cloneAction(legalActions[bestIndex]),
      confidence: probabilities[bestIndex],
      styleWeight,
      elapsedMs,
    };
  }

  function featureIndices(snapshot, action) {
    const canonical = canonicalize(snapshot, action);
    const board = canonical.snapshot.board;
    const normalizedAction = canonical.action;
    const actionSignature = normalizedAction.join(":");
    const kind = normalizedAction[0];
    const source = actionSource(normalizedAction);
    const destination = actionDestination(normalizedAction);
    const features = [
      "bias",
      `kind:${kind}`,
      `combo:${canonical.snapshot.comboActive ? 1 : 0}:${kind}`,
      `hidden:${bucketCount(board.filter((cell) => cell === "D").length)}`,
      `action:${actionSignature}`,
    ];

    if (source) {
      const sourceIndex = source.r * 8 + source.c;
      const attacker = board[sourceIndex] || ".";
      features.push(`src:${sourceIndex}:${kind}`);
      features.push(`attacker:${attacker}:${kind}`);
      features.push(`src-cell:${sourceIndex}:${attacker}:${kind}`);
      appendNeighborhoodFeatures(features, board, source, `src:${kind}`);
    }

    if (destination) {
      const destinationIndex = destination.r * 8 + destination.c;
      const target = board[destinationIndex] || ".";
      features.push(`dst:${destinationIndex}:${kind}`);
      features.push(`target:${target}:${kind}`);
      features.push(`dst-cell:${destinationIndex}:${target}:${kind}`);
      appendNeighborhoodFeatures(features, board, destination, `dst:${kind}`);
    }

    if (source && destination) {
      const distance = Math.abs(source.r - destination.r) + Math.abs(source.c - destination.c);
      features.push(`distance:${kind}:${bucketCount(distance)}`);
      features.push(`vector:${kind}:${destination.r - source.r}:${destination.c - source.c}`);
    }

    for (let index = 0; index < board.length; index += 1) {
      const token = board[index];
      if (token === ".") continue;
      features.push(`cell:${index}:${token}`);
      features.push(`context-action:${index}:${token}:${actionSignature}`);
    }

    const pool = canonical.snapshot.pool || {};
    for (const side of ["own", "opponent"]) {
      const counts = pool[side] || {};
      for (const pieceKind of ["K", "A", "E", "R", "N", "C", "P"]) {
        features.push(`pool:${side}:${pieceKind}:${counts[pieceKind] || 0}:${kind}`);
      }
    }

    features.push(`position:${board.join(",")}|combo=${canonical.snapshot.comboIndex ?? -1}|action=${actionSignature}`);
    return [...new Set(features.map(hashFeature))];
  }

  function canonicalize(snapshot, action) {
    const candidates = [0, 1, 2, 3].map((transformId) => {
      const board = transformBoard(snapshot.board || [], transformId);
      const comboIndex = Number.isInteger(snapshot.comboIndex) && snapshot.comboIndex >= 0
        ? transformIndex(snapshot.comboIndex, transformId)
        : -1;
      const transformedAction = transformAction(action, transformId);
      const key = `${board.join(",")}|combo=${comboIndex}`;
      return {
        key,
        snapshot: {
          ...snapshot,
          board,
          comboIndex,
        },
        action: transformedAction,
      };
    });
    candidates.sort((a, b) => a.key.localeCompare(b.key));
    return candidates[0];
  }

  function transformBoard(board, transformId) {
    const transformed = Array(32).fill(".");
    for (let index = 0; index < 32; index += 1) {
      const nextIndex = transformIndex(index, transformId);
      transformed[nextIndex] = board[index] || ".";
    }
    return transformed;
  }

  function transformIndex(index, transformId) {
    const r = Math.floor(index / 8);
    const c = index % 8;
    const transformed = transformPosition({ r, c }, transformId);
    return transformed.r * 8 + transformed.c;
  }

  function transformPosition(position, transformId) {
    if (transformId === 1) return { r: position.r, c: 7 - position.c };
    if (transformId === 2) return { r: 3 - position.r, c: position.c };
    if (transformId === 3) return { r: 3 - position.r, c: 7 - position.c };
    return { r: position.r, c: position.c };
  }

  function transformAction(action, transformId) {
    const cloned = cloneAction(action);
    if (!cloned || cloned[0] === "stop") return cloned;
    if (cloned[0] === "flip") {
      const position = transformPosition({ r: cloned[1], c: cloned[2] }, transformId);
      return [cloned[0], position.r, position.c];
    }
    const source = transformPosition({ r: cloned[1], c: cloned[2] }, transformId);
    const destination = transformPosition({ r: cloned[3], c: cloned[4] }, transformId);
    return [cloned[0], source.r, source.c, destination.r, destination.c];
  }

  function appendNeighborhoodFeatures(features, board, position, prefix) {
    const directions = [
      ["u", -1, 0],
      ["d", 1, 0],
      ["l", 0, -1],
      ["r", 0, 1],
    ];
    for (const [label, dr, dc] of directions) {
      const r = position.r + dr;
      const c = position.c + dc;
      const token = r >= 0 && r < 4 && c >= 0 && c < 8 ? board[r * 8 + c] : "edge";
      features.push(`${prefix}:near:${label}:${token}`);
    }
  }

  function scoreFeatures(indices) {
    return scoreFeaturesWithWeights(indices, weights);
  }

  function scoreFeaturesWithWeights(indices, targetWeights) {
    let score = 0;
    for (const index of indices) score += targetWeights[index];
    return score / Math.sqrt(Math.max(1, indices.length));
  }

  function softmax(scores) {
    const maxScore = Math.max(...scores);
    const exponentials = scores.map((score) => Math.exp(Math.max(-30, Math.min(30, score - maxScore))));
    const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
    return exponentials.map((value) => Math.max(MIN_PROBABILITY, value / total));
  }

  function normalizeScores(scores) {
    if (!scores.length) return [];
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;
    const deviation = Math.sqrt(variance);
    if (deviation < 1e-8) return scores.map(() => 0);
    return scores.map((value) => (value - mean) / deviation);
  }

  function hashFeature(value) {
    return hashString(value) % FEATURE_COUNT;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function deterministicShuffle(array, seedText) {
    let seed = hashString(seedText || "dark-chess");
    const random = () => {
      seed += 0x6D2B79F5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    for (let index = array.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [array[index], array[target]] = [array[target], array[index]];
    }
  }

  function sampleEvenly(rows, limit) {
    if (rows.length <= limit) return [...rows];
    const sampled = [];
    const step = rows.length / limit;
    for (let index = 0; index < limit; index += 1) sampled.push(rows[Math.floor(index * step)]);
    return sampled;
  }

  function bucketCount(value) {
    if (value <= 0) return 0;
    if (value <= 2) return value;
    if (value <= 4) return 4;
    if (value <= 8) return 8;
    if (value <= 16) return 16;
    return 32;
  }

  function calculateModelBytes() {
    const metadataBytes = byteLengthOfJson({
      id: MODEL_ID,
      modelVersion: MODEL_VERSION,
      featureCount: FEATURE_COUNT,
      updatedAt: metadata.updatedAt,
    });
    return weights.byteLength + gradientSquares.byteLength + metadataBytes;
  }

  function byteLengthOfJson(value) {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 0;
    }
  }

  function cloneSerializable(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cloneAction(action) {
    return Array.isArray(action) ? [...action] : null;
  }

  function sameAction(a, b) {
    return Boolean(
      Array.isArray(a)
      && Array.isArray(b)
      && a.length === b.length
      && a.every((value, index) => value === b[index])
    );
  }

  function actionSource(action) {
    if (!action || !["move", "capture", "darkCapture"].includes(action[0])) return null;
    return { r: action[1], c: action[2] };
  }

  function actionDestination(action) {
    if (!action) return null;
    if (action[0] === "flip") return { r: action[1], c: action[2] };
    if (["move", "capture", "darkCapture"].includes(action[0])) return { r: action[3], c: action[4] };
    return null;
  }

  function yieldToPage() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function subscribe(callback) {
    if (typeof callback !== "function") return () => {};
    subscribers.add(callback);
    callback(getStats());
    return () => subscribers.delete(callback);
  }

  function emitStats() {
    const snapshot = getStats();
    for (const callback of subscribers) {
      try {
        callback(snapshot);
      } catch {
        // 顯示層錯誤不得中斷模型保存或訓練。
      }
    }
  }

  function getStats() {
    return { ...metadata };
  }

  window.DarkChessLearning = {
    init,
    createSession,
    recordDecision,
    finishGame,
    chooseAction,
    getStats,
    subscribe,
  };
})();
