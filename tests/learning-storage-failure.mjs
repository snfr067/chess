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

globalThis.window = globalThis;
globalThis.tf = testTf;
globalThis.indexedDB = { open() { throw new Error("injected storage failure"); } };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { storage: { persisted: async () => false, persist: async () => false } },
});

vm.runInThisContext(fs.readFileSync(new URL("../model-core.js", import.meta.url), "utf8"), { filename: "model-core.js" });
vm.runInThisContext(fs.readFileSync(new URL("../learning.js", import.meta.url), "utf8"), { filename: "learning.js" });

const stats = await DarkChessLearning.init();
if (stats.status !== "degraded" || !stats.error.includes("injected storage failure")) {
  throw new Error(`儲存失敗狀態不符：${JSON.stringify(stats)}`);
}

const observation = {
  boardChannels: Array(4 * 8 * 25).fill(0),
  belief: Array(14).fill(1 / 14),
  turnEvents: [],
  historyEvents: [],
  ownActor: "self",
};
const candidates = [
  { action: ["flip", 0, 0], targetHidden: true, consequence: Array(24).fill(0) },
  { action: ["flip", 0, 1], targetHidden: true, consequence: Array(24).fill(0) },
];
const choice = await DarkChessLearning.chooseAction(observation, candidates);
if (!choice || !Array.isArray(choice.action)) throw new Error("儲存失敗後基礎模型無法下棋");

const session = DarkChessLearning.createSession();
const recorded = await DarkChessLearning.recordChoice(session, choice.context, choice.action);
if (recorded !== true) throw new Error("無資料庫時記錄流程不應中斷遊戲");

console.log(JSON.stringify({ status: stats.status, inferenceAvailable: true, storageWriteSkipped: true }));
