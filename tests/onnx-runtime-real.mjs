import fs from "node:fs";
import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

const model = fs.readFileSync(new URL("../final_model.onnx", import.meta.url));
const session = await ort.InferenceSession.create(model, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});

const candidateCount = 2;
const outputs = await session.run({
  board: new ort.Tensor("float32", new Float32Array(18 * 4 * 8), [1, 18, 4, 8]),
  global_features: new ort.Tensor("float32", new Float32Array(54), [1, 54]),
  history: new ort.Tensor("float32", new Float32Array(8 * 79), [1, 8, 79]),
  actions: new ort.Tensor("float32", new Float32Array(candidateCount * 106), [1, candidateCount, 106]),
});

for (const name of ["policy_logits", "candidate_values", "state_value"]) {
  if (!outputs[name]) throw new Error(`模型缺少輸出：${name}`);
  if (!Array.from(outputs[name].data).every(Number.isFinite)) throw new Error(`模型輸出含非有限值：${name}`);
}

console.log(JSON.stringify({
  status: "ok",
  modelBytes: model.byteLength,
  inputs: session.inputNames,
  outputs: session.outputNames,
  policy: Array.from(outputs.policy_logits.data),
  values: Array.from(outputs.candidate_values.data),
  stateValue: Array.from(outputs.state_value.data),
}));
