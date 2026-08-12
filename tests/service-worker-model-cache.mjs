import fs from "node:fs";
import vm from "node:vm";

const listeners = new Map();
const stored = new Map();
const cache = {
  async match(key) {
    const response = stored.get(String(key));
    return response ? response.clone() : undefined;
  },
  async put(key, response) {
    stored.set(String(key), response.clone());
  },
  async addAll() {},
};

let fetchImpl = async () => new Response("missing", { status: 404 });
const context = vm.createContext({
  AbortController,
  Request,
  Response,
  URL,
  caches: {
    async open() { return cache; },
    async keys() { return []; },
    async delete() { return true; },
  },
  fetch: (...args) => fetchImpl(...args),
  setTimeout,
  clearTimeout,
});
context.self = {
  clients: { async claim() {} },
  async skipWaiting() {},
  addEventListener(type, handler) { listeners.set(type, handler); },
};

vm.runInContext(fs.readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context, {
  filename: "service-worker.js",
});

const fetchHandler = listeners.get("fetch");
if (!fetchHandler) throw new Error("服務工作程式沒有 fetch 處理器");

const modelUrl = "https://example.test/chess/final_model.onnx?v=pytorch-onnx-v2-20260812";
const request = new Request(modelUrl, { cache: "no-store" });

async function dispatch() {
  let responsePromise = null;
  fetchHandler({
    request,
    respondWith(value) { responsePromise = Promise.resolve(value); },
  });
  if (!responsePromise) throw new Error("模型請求沒有交給 respondWith");
  return responsePromise;
}

const missing = await dispatch();
if (missing.status !== 404) throw new Error(`首次 404 狀態被改寫：${missing.status}`);
await new Promise((resolve) => setTimeout(resolve, 0));
if (stored.has(modelUrl)) throw new Error("404 模型回應不應寫入快取");

fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
const loaded = await dispatch();
if (loaded.status !== 200) throw new Error(`成功模型回應異常：${loaded.status}`);
await new Promise((resolve) => setTimeout(resolve, 0));
if (!stored.has(modelUrl)) throw new Error("成功模型回應沒有寫入快取");

fetchImpl = async () => { throw new Error("offline"); };
const offline = await dispatch();
if (offline.status !== 200) throw new Error(`離線時沒有取用成功快取：${offline.status}`);

console.log(JSON.stringify({
  status: "ok",
  cachedOnlyAfterSuccess: true,
  offlineFallback: true,
}));
