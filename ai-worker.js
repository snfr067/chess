/* global tf, DarkChessModelCore, DarkChessWorkerGame */
"use strict";

globalThis.window = globalThis;
importScripts(
  "./vendor/tf.min.js?v=4.22.0",
  "./model-core.js?v=learning-v2-20260805-exact-worker",
  "./app.js?v=learning-v2-20260805-exact-worker"
);

const WORKER_EMBEDDING_DIM = 64;
const WORKER_STYLE_DIM = 16;
const WORKER_RANK_DIM = 8;
let workerEnginePromise = null;

function repeatVector(source, count) {
  const result = new Float32Array(count * source.length);
  for (let index = 0; index < count; index += 1) result.set(source, index * source.length);
  return result;
}

async function workerStateForward(stateModel, observation) {
  const core = DarkChessModelCore;
  const board = core.boardTensor(observation);
  const turn = core.eventTensor(observation.turnEvents, core.TURN_STEPS, observation.ownActor || "self");
  const history = core.eventTensor(observation.historyEvents, core.HISTORY_STEPS, observation.ownActor || "self");
  const belief = core.beliefVector(observation);
  const inputs = [
    tf.tensor4d(board, [1, 4, 8, core.BOARD_CHANNELS]),
    tf.tensor3d(turn, [1, core.TURN_STEPS, core.EVENT_DIM]),
    tf.tensor3d(history, [1, core.HISTORY_STEPS, core.EVENT_DIM]),
    tf.tensor2d(belief, [1, core.BELIEF_DIM]),
  ];
  let output = null;
  try {
    output = stateModel.predict(inputs);
    return Float32Array.from(await output.data());
  } finally {
    for (const tensor of inputs) tensor.dispose();
    if (output) output.dispose();
  }
}

async function workerCandidateForward(candidateModel, stateVector, candidates) {
  const core = DarkChessModelCore;
  const count = candidates.length;
  const candidateRows = new Float32Array(count * core.CANDIDATE_DIM);
  for (let index = 0; index < count; index += 1) {
    candidateRows.set(core.candidateVector(candidates[index]), index * core.CANDIDATE_DIM);
  }
  const inputs = [
    tf.tensor2d(repeatVector(stateVector, count), [count, core.STATE_DIM]),
    tf.tensor2d(candidateRows, [count, core.CANDIDATE_DIM]),
  ];
  let outputs = null;
  try {
    outputs = candidateModel.predict(inputs);
    const [embeddingData, logitData, continuationData] = await Promise.all([
      outputs[0].data(),
      outputs[1].data(),
      outputs[2].data(),
    ]);
    const embeddings = [];
    for (let index = 0; index < count; index += 1) {
      embeddings.push(Array.from(embeddingData.slice(
        index * WORKER_EMBEDDING_DIM,
        (index + 1) * WORKER_EMBEDDING_DIM
      )));
    }
    return {
      embeddings,
      logits: Array.from(logitData),
      continuationValues: Array.from(continuationData),
    };
  } finally {
    for (const tensor of inputs) tensor.dispose();
    if (outputs) for (const tensor of outputs) tensor.dispose();
  }
}

async function workerEnsureEngine() {
  if (!workerEnginePromise) {
    workerEnginePromise = (async () => {
      if (typeof tf.enableProdMode === "function") tf.enableProdMode();
      await tf.ready();
      const baseModel = await tf.loadLayersModel("./base-model.json");
      for (const layer of baseModel.layers) layer.trainable = false;
      const inference = DarkChessModelCore.createInferenceModels(tf, baseModel);
      const emptyObservation = {
        boardChannels: Array(4 * 8 * DarkChessModelCore.BOARD_CHANNELS).fill(0),
        belief: Array(DarkChessModelCore.BELIEF_DIM).fill(0),
        turnEvents: [],
        historyEvents: [],
        ownActor: "self",
      };
      const emptyCandidate = {
        action: ["flip", 0, 0],
        targetHidden: true,
        consequence: Array(DarkChessModelCore.CONSEQUENCE_DIM).fill(0),
      };
      const stateVector = await workerStateForward(inference.stateModel, emptyObservation);
      await workerCandidateForward(inference.candidateModel, stateVector, [emptyCandidate]);
      return { baseModel, ...inference };
    })().catch((error) => {
      workerEnginePromise = null;
      throw error;
    });
  }
  return workerEnginePromise;
}

function workerPersonalScore(embedding, baseLogit, source) {
  const parameters = source && source.params;
  if (!parameters) return Number(baseLogit) || 0;
  const x = embedding || [];
  const down = new Float32Array(WORKER_STYLE_DIM);
  for (let i = 0; i < WORKER_STYLE_DIM; i += 1) {
    let value = Number(parameters.style && parameters.style[i]) || 0;
    for (let j = 0; j < WORKER_EMBEDDING_DIM; j += 1) {
      value += (Number(parameters.down && parameters.down[i * WORKER_EMBEDDING_DIM + j]) || 0) * (Number(x[j]) || 0);
    }
    down[i] = Math.tanh(value);
  }
  const adapted = new Float32Array(WORKER_EMBEDDING_DIM);
  for (let j = 0; j < WORKER_EMBEDDING_DIM; j += 1) {
    let value = Number(x[j]) || 0;
    for (let i = 0; i < WORKER_STYLE_DIM; i += 1) {
      value += (Number(parameters.up && parameters.up[j * WORKER_STYLE_DIM + i]) || 0) * down[i];
    }
    adapted[j] = value;
  }
  const rank = new Float32Array(WORKER_RANK_DIM);
  for (let r = 0; r < WORKER_RANK_DIM; r += 1) {
    let value = 0;
    for (let j = 0; j < WORKER_EMBEDDING_DIM; j += 1) {
      value += (Number(parameters.rank && parameters.rank[r * WORKER_EMBEDDING_DIM + j]) || 0) * (Number(x[j]) || 0);
    }
    rank[r] = Math.tanh(value);
  }
  let score = Number(baseLogit) || 0;
  for (let j = 0; j < WORKER_EMBEDDING_DIM; j += 1) score += (Number(parameters.output && parameters.output[j]) || 0) * adapted[j];
  for (let r = 0; r < WORKER_RANK_DIM; r += 1) score += (Number(parameters.rankOutput && parameters.rankOutput[r]) || 0) * rank[r];
  score += Number(parameters.bias && parameters.bias[0]) || 0;
  return score;
}

function workerSoftmax(scores) {
  const maximum = Math.max(...scores);
  const values = scores.map((score) => Math.exp(Math.max(-30, Math.min(30, score - maximum))));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return values.map((value) => value / total);
}

async function workerEvaluate(observation, sourceCandidates, learningSnapshot) {
  const startedAt = performance.now();
  if (!observation || !Array.isArray(sourceCandidates) || !sourceCandidates.length) return null;
  const candidates = sourceCandidates.map((candidate) => ({
    ...candidate,
    action: [...candidate.action],
    consequence: Array.from(candidate.consequence || []).slice(0, DarkChessModelCore.CONSEQUENCE_DIM),
  }));
  const engine = await workerEnsureEngine();
  const stateVector = await workerStateForward(engine.stateModel, observation);
  let base = await workerCandidateForward(engine.candidateModel, stateVector, candidates);
  for (let index = 0; index < candidates.length; index += 1) {
    candidates[index].consequence[20] = base.continuationValues[index] || 0;
  }
  base = await workerCandidateForward(engine.candidateModel, stateVector, candidates);
  const scores = candidates.map((candidate, index) => workerPersonalScore(
    base.embeddings[index],
    base.logits[index],
    learningSnapshot
  ));
  const order = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const probabilities = workerSoftmax(scores);
  return {
    observation,
    candidates,
    embeddings: base.embeddings,
    baseLogits: base.logits,
    continuationValues: base.continuationValues,
    scores,
    probabilities,
    order: order.map((row) => row.index),
    elapsedMs: performance.now() - startedAt,
    modelVersion: Number(learningSnapshot && learningSnapshot.modelVersion) || 0,
    preparedAt: new Date().toISOString(),
  };
}

function workerPreparePosition(snapshot, actor, comboPos) {
  return DarkChessWorkerGame.buildDecisionInput(snapshot, actor, comboPos);
}

async function workerThink(message) {
  const startedAt = performance.now();
  const prepared = workerPreparePosition(message.snapshot, "ai", message.comboPos);
  if (!prepared.candidates.length) throw new Error("no-legal-action");
  const context = await workerEvaluate(prepared.observation, prepared.candidates, message.learningSnapshot);
  const bestIndex = context.order[0];
  return {
    action: [...context.candidates[bestIndex].action],
    confidence: context.probabilities[bestIndex],
    elapsedMs: performance.now() - startedAt,
    candidateIndex: bestIndex,
    context,
    featureElapsedMs: prepared.featureElapsedMs,
  };
}

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (!["think", "prepare", "evaluate"].includes(message.type)) return;
  try {
    if (message.type === "think") {
      self.postMessage({ type: "result", id: message.id, choice: await workerThink(message) });
      return;
    }
    if (message.type === "prepare") {
      self.postMessage({
        type: "prepared",
        id: message.id,
        prepared: workerPreparePosition(message.snapshot, message.actor, message.comboPos),
      });
      return;
    }
    self.postMessage({
      type: "evaluated",
      id: message.id,
      context: await workerEvaluate(message.observation, message.candidates, message.learningSnapshot),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

void workerEnsureEngine().then(() => self.postMessage({ type: "ready" })).catch((error) => {
  self.postMessage({ type: "worker-load-error", error: error instanceof Error ? error.message : String(error) });
});
