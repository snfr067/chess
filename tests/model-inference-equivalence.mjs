import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tf = require("@tensorflow/tfjs");
const modelJson = JSON.parse(fs.readFileSync(new URL("../base-model.json", import.meta.url), "utf8"));
const weights = fs.readFileSync(new URL("../base-model.weights.bin", import.meta.url));
const model = await tf.loadLayersModel(tf.io.fromMemory({
  modelTopology: modelJson.modelTopology,
  weightSpecs: modelJson.weightsManifest[0].weights,
  weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
}));

globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(new URL("../model-core.js", import.meta.url), "utf8"), { filename: "model-core.js" });
const core = DarkChessModelCore;
const { stateModel, candidateModel } = core.createInferenceModels(tf, model);
const count = 32;
const board = Float32Array.from({ length: 4 * 8 * core.BOARD_CHANNELS }, (_, index) => (index % 29) / 29);
const turn = Float32Array.from({ length: core.TURN_STEPS * core.EVENT_DIM }, (_, index) => (index % 17) / 17);
const history = Float32Array.from({ length: core.HISTORY_STEPS * core.EVENT_DIM }, (_, index) => (index % 23) / 23);
const belief = Float32Array.from({ length: core.BELIEF_DIM }, (_, index) => (index + 1) / 105);
const candidates = Float32Array.from({ length: count * core.CANDIDATE_DIM }, (_, index) => (index % 31) / 31);

const repeated = (source) => {
  const result = new Float32Array(count * source.length);
  for (let index = 0; index < count; index += 1) result.set(source, index * source.length);
  return result;
};
const originalInputs = [
  tf.tensor4d(repeated(board), [count, 4, 8, core.BOARD_CHANNELS]),
  tf.tensor3d(repeated(turn), [count, core.TURN_STEPS, core.EVENT_DIM]),
  tf.tensor3d(repeated(history), [count, core.HISTORY_STEPS, core.EVENT_DIM]),
  tf.tensor2d(repeated(belief), [count, core.BELIEF_DIM]),
  tf.tensor2d(candidates, [count, core.CANDIDATE_DIM]),
];
const originalOutputs = model.predict(originalInputs);
const originalValues = await Promise.all(originalOutputs.map((tensor) => tensor.data()));

const stateInputs = [
  tf.tensor4d(board, [1, 4, 8, core.BOARD_CHANNELS]),
  tf.tensor3d(turn, [1, core.TURN_STEPS, core.EVENT_DIM]),
  tf.tensor3d(history, [1, core.HISTORY_STEPS, core.EVENT_DIM]),
  tf.tensor2d(belief, [1, core.BELIEF_DIM]),
];
const stateTensor = stateModel.predict(stateInputs);
const stateValues = await stateTensor.data();
const splitInputs = [
  tf.tensor2d(repeated(stateValues), [count, core.STATE_DIM]),
  tf.tensor2d(candidates, [count, core.CANDIDATE_DIM]),
];
const splitOutputs = candidateModel.predict(splitInputs);
const splitValues = await Promise.all(splitOutputs.map((tensor) => tensor.data()));

let maxDifference = 0;
for (let outputIndex = 0; outputIndex < originalValues.length; outputIndex += 1) {
  for (let index = 0; index < originalValues[outputIndex].length; index += 1) {
    maxDifference = Math.max(maxDifference, Math.abs(originalValues[outputIndex][index] - splitValues[outputIndex][index]));
  }
}
if (maxDifference > 1e-5) throw new Error(`等價推論誤差超標：${maxDifference}`);

async function measureOriginal() {
  const startedAt = performance.now();
  const inputs = [
    tf.tensor4d(repeated(board), [count, 4, 8, core.BOARD_CHANNELS]),
    tf.tensor3d(repeated(turn), [count, core.TURN_STEPS, core.EVENT_DIM]),
    tf.tensor3d(repeated(history), [count, core.HISTORY_STEPS, core.EVENT_DIM]),
    tf.tensor2d(repeated(belief), [count, core.BELIEF_DIM]),
    tf.tensor2d(candidates, [count, core.CANDIDATE_DIM]),
  ];
  for (let pass = 0; pass < 2; pass += 1) {
    const outputs = model.predict(inputs);
    await Promise.all(outputs.slice(0, 3).map((tensor) => tensor.data()));
    for (const tensor of outputs) tensor.dispose();
  }
  for (const tensor of inputs) tensor.dispose();
  return performance.now() - startedAt;
}

async function measureSplit() {
  const startedAt = performance.now();
  const stateInputsForMeasure = [
    tf.tensor4d(board, [1, 4, 8, core.BOARD_CHANNELS]),
    tf.tensor3d(turn, [1, core.TURN_STEPS, core.EVENT_DIM]),
    tf.tensor3d(history, [1, core.HISTORY_STEPS, core.EVENT_DIM]),
    tf.tensor2d(belief, [1, core.BELIEF_DIM]),
  ];
  const measuredStateTensor = stateModel.predict(stateInputsForMeasure);
  const measuredState = await measuredStateTensor.data();
  measuredStateTensor.dispose();
  for (const tensor of stateInputsForMeasure) tensor.dispose();
  const inputs = [
    tf.tensor2d(repeated(measuredState), [count, core.STATE_DIM]),
    tf.tensor2d(candidates, [count, core.CANDIDATE_DIM]),
  ];
  for (let pass = 0; pass < 2; pass += 1) {
    const outputs = candidateModel.predict(inputs);
    await Promise.all(outputs.slice(0, 3).map((tensor) => tensor.data()));
    for (const tensor of outputs) tensor.dispose();
  }
  for (const tensor of inputs) tensor.dispose();
  return performance.now() - startedAt;
}

await measureOriginal();
await measureSplit();
const originalMs = await measureOriginal();
const splitMs = await measureSplit();

for (const tensor of [...originalInputs, ...originalOutputs, ...stateInputs, stateTensor, ...splitInputs, ...splitOutputs]) tensor.dispose();
console.log(JSON.stringify({ candidates: count, maxDifference, originalMs, splitMs }));
