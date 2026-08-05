import { JSDOM, VirtualConsole } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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
const startedAt = performance.now();
document.getElementById("openSettingsBtn").click();
const settingsClickMs = performance.now() - startedAt;
if (settingsClickMs > 50 || !document.getElementById("settingsView").classList.contains("active")) {
  throw new Error(`同步模型資產仍阻塞設定按鈕：${settingsClickMs.toFixed(1)}ms`);
}

let status = "loading";
for (let retry = 0; retry < 400; retry += 1) {
  status = document.getElementById("learningModelStatus")?.dataset.status || "loading";
  if (dom.window.tf && ["base-ready", "ready", "degraded", "error"].includes(status)) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
if (!dom.window.tf) {
  throw new Error(`延後載入模型失敗：status=${status}；stats=${JSON.stringify(dom.window.DarkChessLearning?.getStats?.())}；${errors.join(" | ")}`);
}

console.log(JSON.stringify({ settingsClickMs: Math.round(settingsClickMs), tensorflowLoadedLater: true }));
dom.window.close();
await new Promise((resolve) => server.close(resolve));
