import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

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
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { storage: { persisted: async () => true, persist: async () => true } },
});

const legacyDatabase = await new Promise((resolve, reject) => {
  const request = indexedDB.open("taiwan-dark-chess-learning", 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore("games", { keyPath: "id" });
    database.createObjectStore("models", { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
{
  const transaction = legacyDatabase.transaction(["games", "models"], "readwrite");
  transaction.objectStore("games").put({ id: "legacy-corrupt-game", status: "active", decisions: [{ broken: true }] });
  transaction.objectStore("models").put({ id: "player-style-v1", weights: [NaN, Infinity] });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

vm.runInThisContext(fs.readFileSync(new URL("../model-core.js", import.meta.url), "utf8"), { filename: "model-core.js" });
vm.runInThisContext(fs.readFileSync(new URL("../learning.js", import.meta.url), "utf8"), { filename: "learning.js" });

await DarkChessLearning.init();
const initialStats = DarkChessLearning.getStats();
if (initialStats.status !== "base-ready" || initialStats.learnedGames !== 0 || initialStats.learnedDecisions !== 0) {
  throw new Error(`新版資料庫未隔離舊模型：${JSON.stringify(initialStats)}`);
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
if (!choice || !Array.isArray(choice.action) || choice.context.embeddings.length !== 2) throw new Error("基礎推論失敗");
const stressCandidates = Array.from({ length: 32 }, (_, index) => ({
  action: ["flip", Math.floor(index / 8), index % 8],
  targetHidden: true,
  consequence: Array(24).fill(0),
}));
const stressStartedAt = performance.now();
const stressChoice = await DarkChessLearning.chooseAction(observation, stressCandidates);
const stressInferenceMs = performance.now() - stressStartedAt;
if (!stressChoice || stressInferenceMs > 1500) throw new Error(`32 候選推論超時：${Math.round(stressInferenceMs)}ms`);

const session = DarkChessLearning.createSession();
await DarkChessLearning.recordRawChoice(session, observation, candidates, candidates[1].action, {
  labelType: "correction",
  rejectedAction: candidates[0].action,
  turnId: `${session.id}-turn-0`,
  sequenceIndex: 0,
});
await DarkChessLearning.recordTurn(session, {
  id: `${session.id}-turn-0`,
  actor: "self",
  actions: [{ kind: "flip", action: candidates[1].action }],
});
DarkChessLearning.setGameplayActive(true);
await DarkChessLearning.finishGame(session, "interrupted", "interrupted");
await new Promise((resolve) => setTimeout(resolve, 750));
if (DarkChessLearning.getStats().learnedGames !== 0) throw new Error("對局進行中仍啟動背景訓練");
DarkChessLearning.setGameplayActive(false);

for (let retry = 0; retry < 240; retry += 1) {
  const stats = DarkChessLearning.getStats();
  if (stats.status === "ready" && stats.learnedGames >= 1) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
const stats = DarkChessLearning.getStats();
if (stats.learnedGames !== 1 || stats.learnedDecisions !== 1 || stats.corrections !== 1) {
  throw new Error(`訓練統計不符：${JSON.stringify(stats)}`);
}
const archive = await DarkChessLearning.exportArchive();
if (!(archive instanceof Blob) || archive.size < 100) throw new Error("匯出檔案失敗");

console.log(JSON.stringify({
  status: stats.status,
  learnedGames: stats.learnedGames,
  learnedDecisions: stats.learnedDecisions,
  corrections: stats.corrections,
  modelBytes: stats.modelBytes,
  inferenceMs: stats.averageInferenceMs,
  stressInferenceMs,
}));
legacyDatabase.close();
