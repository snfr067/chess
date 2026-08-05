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
      const mock = `
        (()=>{
          const stats={status:"base-ready",baseVersion:"fault-test",personalVersion:0,activeSlot:"a",learnedGames:0,learnedDecisions:0,metrics:{}};
          const context=(candidates)=>({candidates:candidates.map(row=>({action:[...row.action]})),order:candidates.map((_,i)=>i),probabilities:candidates.map(()=>1/candidates.length),embeddings:candidates.map(()=>Array(64).fill(0)),baseLogits:candidates.map(()=>0),modelVersion:0});
          window.__choiceMode="throw";
          window.DarkChessLearning={
            init:async()=>stats,
            createSession:()=>({id:"fault-game",status:"active",decisionIds:[],turnIds:[],sequence:0}),
            subscribe:(callback)=>{callback(stats);return()=>{}},
            getStats:()=>stats,
            prepareDecision:async(_observation,candidates)=>context(candidates),
            chooseAction:async(_observation,candidates)=>{
              if(window.__choiceMode==="throw") throw new Error("injected inference failure");
              if(window.__choiceMode==="null") return null;
              return {action:[...candidates[0].action],confidence:1,elapsedMs:1,context:context(candidates),candidateIndex:0};
            },
            recordChoice:async()=>true,
            recordRawChoice:async()=>true,
            finishGame:async()=>true,
            recordTurn:async()=>true,
            setGameplayActive:()=>{},
            exportArchive:async()=>new Blob(["{}"]),
            importArchive:async()=>true,
            rollbackModel:async()=>false
          };
        })();`;
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
const jsErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => jsErrors.push(error.message));

const dom = await JSDOM.fromURL(baseUrl, {
  resources: "usable",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.indexedDB = indexedDB;
    window.IDBKeyRange = IDBKeyRange;
    window.fetch = (input, options) => fetch(new URL(String(input), window.location.href), options);
    window.Math.random = () => 0.9;
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: { persisted: async () => true, persist: async () => true },
    });
  },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const document = dom.window.document;
for (let retry = 0; retry < 300; retry += 1) {
  if (dom.window.DarkChessLearning && document.getElementById("learningModelStatus")?.dataset.status === "base-ready") break;
  await wait(20);
}
document.getElementById("startGameBtn").click();
await wait(1800);

let visible = [...document.querySelectorAll("#board .piece-btn")].filter((button) => !button.classList.contains("hidden-piece"));
if (visible.length !== 1 || document.getElementById("turnOrb").textContent !== "您") {
  throw new Error(`推論失敗後 AI 沒有自動復原：visible=${visible.length}, turn=${document.getElementById("turnOrb").textContent}`);
}

dom.window.Math.random = () => 0.1;
dom.window.__choiceMode = "normal";
dom.window.localStorage.setItem("darkChessCorrectionMode", "false");
document.getElementById("newGameBtn").click();
await wait(100);
visible = [...document.querySelectorAll("#board .piece-btn")].filter((button) => !button.classList.contains("hidden-piece"));
if (visible.length !== 0) throw new Error("玩家先手局面初始化失敗");
document.querySelector("#board .piece-btn.hidden-piece").click();
await wait(1800);
visible = [...document.querySelectorAll("#board .piece-btn")].filter((button) => !button.classList.contains("hidden-piece"));
if (visible.length !== 2 || document.getElementById("turnOrb").textContent !== "您") {
  throw new Error(`玩家先手後 AI 沒有完成回合：visible=${visible.length}, turn=${document.getElementById("turnOrb").textContent}`);
}

dom.window.Math.random = () => 0.9;
dom.window.__choiceMode = "null";
document.getElementById("newGameBtn").click();
await wait(1800);
visible = [...document.querySelectorAll("#board .piece-btn")].filter((button) => !button.classList.contains("hidden-piece"));
if (visible.length !== 1 || document.getElementById("turnOrb").textContent !== "您") {
  throw new Error(`空模型輸出後 AI 沒有完成回合：visible=${visible.length}, turn=${document.getElementById("turnOrb").textContent}`);
}

if (jsErrors.length) throw new Error(`頁面執行錯誤：${jsErrors.join(" | ")}`);
console.log(JSON.stringify({ inferenceFailureRecovered: true, humanFirstAiMoved: true, nullChoiceRecovered: true }));
dom.window.close();
await new Promise((resolve) => server.close(resolve));
