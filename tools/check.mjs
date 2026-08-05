import fs from "node:fs";
import vm from "node:vm";

const files = ["app.js", "learning.js", "model-core.js", "tools/train-base.mjs"];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (file.endsWith(".mjs")) continue;
  new vm.Script(source, { filename: file });
}

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const idBlock = app.match(/for \(const id of \[([\s\S]*?)\]\) dom/);
if (!idBlock) throw new Error("找不到 DOM ID 清單");
const ids = [...idBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const optional = new Set(["difficultySelect", "difficultyHelp"]);
const missing = ids.filter((id) => !optional.has(id) && !html.includes(`id="${id}"`));
if (missing.length) throw new Error(`HTML 缺少元件：${missing.join(", ")}`);

for (const asset of ["vendor/tf.min.js", "model-core.js", "base-model.json", "base-model.weights.bin", "learning.js", "app.js"]) {
  if (!fs.existsSync(asset)) throw new Error(`缺少應用資產：${asset}`);
}

console.log(`checked ${files.length} scripts, ${ids.length - optional.size} required DOM ids, and 6 model assets`);
