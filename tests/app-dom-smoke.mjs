import { JSDOM, VirtualConsole } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".bin": "application/octet-stream", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relative === "learning.js") {
      const stats = { status: "loading", baseVersion: "test", personalVersion: 0, activeSlot: "a", metrics: {} };
      const mock = `(()=>{const stats=${JSON.stringify(stats)};window.DarkChessLearning={init:async()=>{await new Promise(resolve=>setTimeout(resolve,900));stats.status="base-ready";return stats},createSession:()=>({id:"test-game",status:"active",decisionIds:[],turnIds:[],sequence:0}),subscribe:(callback)=>{callback(stats);return()=>{}},getStats:()=>stats,getInferenceSnapshot:()=>null,recordPositionChoice:async()=>{await new Promise(resolve=>setTimeout(resolve,1200));return true},recordRawChoice:async()=>true,finishGame:async()=>true,recordTurn:async()=>true,setGameplayActive:()=>{},exportArchive:async()=>new Blob(["{}"]),importArchive:async()=>true,rollbackModel:async()=>false};})();`;
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(mock);
      return;
    }
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root)) throw new Error("invalid path");
    const data = await fs.readFile(filename);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filename)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error.message));
virtualConsole.on("error", (message) => errors.push(String(message)));

const dom = await JSDOM.fromURL(baseUrl, {
  resources: "usable",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.indexedDB = indexedDB;
    window.IDBKeyRange = IDBKeyRange;
    window.fetch = (input, options) => fetch(new URL(String(input), window.location.href), options);
    window.Math.random = () => 0.1;
    window.Worker = class {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, handler) { this.listeners.set(type, handler); }
      terminate() {}
      postMessage(message) {
        if (message.type !== "think") return;
        const index = message.snapshot.board.flat().findIndex((piece) => piece && !piece.faceUp);
        const action = ["flip", Math.floor(index / 8), index % 8];
        const candidate = { action, targetHidden: true, consequence: Array(24).fill(0) };
        const context = { observation: {}, candidates: [candidate], embeddings: [Array(64).fill(0)], baseLogits: [0], continuationValues: [0], scores: [0], probabilities: [1], order: [0], modelVersion: 0 };
        setTimeout(() => this.listeners.get("message")?.({ data: { type: "result", id: message.id, choice: { action, confidence: 1, context } } }), 0);
      }
    };
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: { persisted: async () => true, persist: async () => true },
    });
  },
});

const document = dom.window.document;
for (let retry = 0; retry < 100; retry += 1) {
  if (document.querySelectorAll("#board .piece-btn").length === 32) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
const navigationStartedAt = performance.now();
document.getElementById("openSettingsBtn").click();
const navigationMs = performance.now() - navigationStartedAt;
if (navigationMs > 50 || !document.getElementById("settingsView").classList.contains("active")) {
  throw new Error(`模型初始化阻塞設定按鈕：${navigationMs.toFixed(1)}ms`);
}
if (!dom.window.DarkChessLearning || !dom.window.DarkChessModelCore) throw new Error("頁面缺少模型全域元件");
if (!document.getElementById("correctionModeCheckbox").checked) throw new Error("糾正模式預設值不符");
document.getElementById("settingsBackBtn").click();
document.getElementById("startGameBtn").click();
if (!document.getElementById("gameView").classList.contains("active")) throw new Error("遊戲頁無法開啟");
if (document.querySelectorAll("#board .piece-btn").length !== 32) throw new Error("棋盤格數不符");
const humanClickStartedAt = performance.now();
document.querySelector("#board .piece-btn.hidden-piece").click();
const humanClickDispatchMs = performance.now() - humanClickStartedAt;
if (humanClickDispatchMs > 50) throw new Error(`玩家點擊被學習流程阻塞：${humanClickDispatchMs.toFixed(1)}ms`);
await new Promise((resolve) => setTimeout(resolve, 180));
const visibleAfterHumanClick = [...document.querySelectorAll("#board .piece-btn")].filter((button) => !button.classList.contains("hidden-piece")).length;
if (visibleAfterHumanClick < 1) throw new Error("玩家動作仍被背景學習寫入阻塞");
if (errors.length) throw new Error(`頁面錯誤：${errors.join(" | ")}`);

console.log(JSON.stringify({
  modelStatus: document.getElementById("learningModelStatus")?.dataset.status,
  boardCells: document.querySelectorAll("#board .piece-btn").length,
  correctionMode: document.getElementById("correctionModeCheckbox").checked,
  navigationMs: Math.round(navigationMs),
  humanClickDispatchMs: Math.round(humanClickDispatchMs),
  visibleAfterHumanClick,
  version: document.querySelector('meta[name="app-version"]')?.content,
}));
dom.window.close();
await new Promise((resolve) => server.close(resolve));
