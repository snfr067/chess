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
      const stats = { status: "base-ready", baseVersion: "test", personalVersion: 0, activeSlot: "a", metrics: {} };
      const mock = `window.DarkChessLearning={init:async()=>(${JSON.stringify(stats)}),createSession:()=>({id:"test-game",status:"active",decisionIds:[],turnIds:[]}),subscribe:(callback)=>{callback(${JSON.stringify(stats)});return()=>{}},getStats:()=>(${JSON.stringify(stats)}),finishGame:async()=>true,recordTurn:async()=>true,exportArchive:async()=>new Blob(["{}"]),importArchive:async()=>true,rollbackModel:async()=>false};`;
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
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: { persisted: async () => true, persist: async () => true },
    });
  },
});

for (let retry = 0; retry < 400; retry += 1) {
  const status = dom.window.document.getElementById("learningModelStatus")?.dataset.status;
  if (["base-ready", "ready", "error"].includes(status)) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}

const document = dom.window.document;
const status = document.getElementById("learningModelStatus")?.dataset.status;
if (status === "error") throw new Error(`頁面模型載入失敗：${JSON.stringify(dom.window.DarkChessLearning?.getStats?.())}；${errors.join(" | ")}`);
if (!dom.window.DarkChessLearning || !dom.window.tf || !dom.window.DarkChessModelCore) throw new Error("頁面缺少模型全域元件");
document.getElementById("openSettingsBtn").click();
if (!document.getElementById("settingsView").classList.contains("active")) throw new Error("設定頁無法開啟");
if (!document.getElementById("correctionModeCheckbox").checked) throw new Error("糾正模式預設值不符");
document.getElementById("settingsBackBtn").click();
document.getElementById("startGameBtn").click();
if (!document.getElementById("gameView").classList.contains("active")) throw new Error("遊戲頁無法開啟");
if (document.querySelectorAll("#board .piece-btn").length !== 32) throw new Error("棋盤格數不符");
if (errors.length) throw new Error(`頁面錯誤：${errors.join(" | ")}`);

console.log(JSON.stringify({
  modelStatus: status,
  boardCells: document.querySelectorAll("#board .piece-btn").length,
  correctionMode: document.getElementById("correctionModeCheckbox").checked,
  version: document.querySelector('meta[name="app-version"]')?.content,
}));
dom.window.close();
await new Promise((resolve) => server.close(resolve));
