import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tf = require("@tensorflow/tfjs");
const modelJson = JSON.parse(fs.readFileSync(new URL("../base-model.json", import.meta.url), "utf8"));
const weights = fs.readFileSync(new URL("../base-model.weights.bin", import.meta.url));
const originalLoadLayersModel = tf.loadLayersModel.bind(tf);
const testTf = { ...tf };
testTf.loadLayersModel = async () => originalLoadLayersModel(tf.io.fromMemory({
  modelTopology: modelJson.modelTopology,
  weightSpecs: modelJson.weightsManifest[0].weights,
  weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
  userDefinedMetadata: modelJson.userDefinedMetadata,
}));

const emitted = [];
let messageHandler = null;
const context = vm.createContext({
  console,
  performance,
  setTimeout,
  clearTimeout,
  tf: testTf,
});
context.self = context;
context.postMessage = (message) => emitted.push(message);
context.addEventListener = (type, handler) => {
  if (type === "message") messageHandler = handler;
};
context.importScripts = (...urls) => {
  for (const sourceUrl of urls) {
    const relative = String(sourceUrl).replace(/^\.\//, "").split("?")[0];
    if (relative === "vendor/tf.min.js") continue;
    const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename: relative });
  }
};

vm.runInContext(fs.readFileSync(new URL("../ai-worker.js", import.meta.url), "utf8"), context, { filename: "ai-worker.js" });
for (let retry = 0; retry < 200 && !emitted.some((row) => row.type === "ready"); retry += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
if (!messageHandler || !emitted.some((row) => row.type === "ready")) throw new Error("AI 背景模型未完成預熱");

const definitions = [
  ["K", 1], ["A", 2], ["E", 2], ["R", 2], ["N", 2], ["C", 2], ["P", 5],
];
const pieces = [];
for (const color of ["red", "black"]) {
  for (const [kind, count] of definitions) {
    for (let index = 0; index < count; index += 1) {
      pieces.push({ color, kind, faceUp: false, id: `${color}-${kind}-${index}` });
    }
  }
}
const board = Array.from({ length: 4 }, (_, row) => pieces.slice(row * 8, row * 8 + 8));
const snapshot = {
  board,
  turnColor: null,
  playerColor: { human: null, ai: null },
  currentPlayer: "ai",
  comboRule: true,
  combo: { active: false, r: null, c: null },
  captured: [],
  turnActions: [],
  turnHistory: [],
  positionHistory: [],
  positionCounts: {},
};
const requestStartedAt = performance.now();
await messageHandler({ data: {
  type: "think",
  id: 1,
  snapshot,
  comboPos: null,
  learningSnapshot: null,
} });
const response = emitted.find((row) => row.id === 1);
if (!response || response.type !== "result") throw new Error(`AI 背景推論失敗：${JSON.stringify(response)}`);
const choice = response.choice;
if (!choice || choice.context.candidates.length !== 32) throw new Error("AI 未評估完整 32 個合法候選");
if (choice.context.candidates.some((candidate) => candidate.featureMode === "fast")) throw new Error("AI 使用了簡化候選特徵");
const firstWallMs = performance.now() - requestStartedAt;
if (firstWallMs > 1500) throw new Error(`預熱後完整推論超過 1.5 秒：${Math.round(firstWallMs)}ms`);

const blackPieces = pieces.filter((piece) => piece.color === "black").map((piece) => ({ ...piece, faceUp: true }));
const redPieces = pieces.filter((piece) => piece.color === "red").map((piece) => ({ ...piece, faceUp: false }));
let blackIndex = 0;
let redIndex = 0;
const tacticalBoard = Array.from({ length: 4 }, (_, row) => Array.from({ length: 8 }, (_, col) => {
  if ((row + col) % 2 === 0) return blackPieces[blackIndex++];
  return redPieces[redIndex++];
}));
const tacticalStartedAt = performance.now();
await messageHandler({ data: {
  type: "think",
  id: 2,
  snapshot: {
    ...snapshot,
    board: tacticalBoard,
    turnColor: "black",
    playerColor: { human: "red", ai: "black" },
  },
  comboPos: null,
  learningSnapshot: null,
} });
const tacticalResponse = emitted.find((row) => row.id === 2);
if (!tacticalResponse || tacticalResponse.type !== "result") throw new Error(`AI 戰術推論失敗：${JSON.stringify(tacticalResponse)}`);
const tacticalWallMs = performance.now() - tacticalStartedAt;
if (tacticalWallMs > 1500) throw new Error(`完整戰術推論超過 1.5 秒：${Math.round(tacticalWallMs)}ms`);
console.log(JSON.stringify({
  candidates: choice.context.candidates.length,
  featureMs: choice.featureElapsedMs,
  inferenceMs: choice.elapsedMs,
  wallMs: firstWallMs,
  tacticalCandidates: tacticalResponse.choice.context.candidates.length,
  tacticalFeatureMs: tacticalResponse.choice.featureElapsedMs,
  tacticalInferenceMs: tacticalResponse.choice.elapsedMs,
  tacticalWallMs,
}));
