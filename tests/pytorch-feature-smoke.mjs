import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console });
context.globalThis = context;
context.DarkChessWorkerGame = {
  movePolicy: () => ({ forbidden: false, penalty: 3200 }),
  publicActionScore: (action) => action[0] === "move" ? -32 : null,
};
vm.runInContext(fs.readFileSync(new URL("../pytorch-model-core.js", import.meta.url), "utf8"), context);
const core = context.DarkChessPyTorchModelCore;

const kinds = [["K", 1], ["A", 2], ["E", 2], ["R", 2], ["N", 2], ["C", 2], ["P", 5]];
const pieces = [];
for (const color of ["red", "black"]) for (const [kind, count] of kinds) {
  for (let index = 0; index < count; index += 1) pieces.push({ color, kind, faceUp: false, id: `${color}-${kind}-${index}` });
}
const board = Array.from({ length: 4 }, (_, row) => pieces.slice(row * 8, row * 8 + 8));
board[0][0].faceUp = true;
const state = {
  board,
  playerColor: { ai: "red", human: "black" },
  currentPlayer: "ai",
  combo: { active: false, r: null, c: null },
  captured: [],
  turnHistory: [],
  completedTurns: 3,
  atomicPly: 5,
};
const candidates = [
  { action: ["flip", 0, 1] },
  { action: ["move", 0, 0, 1, 0] },
  { action: ["darkCapture", 0, 0, 0, 1] },
];
const encoded = core.encode(state, candidates);
if (encoded.board.length !== 18 * 4 * 8) throw new Error("board shape mismatch");
if (encoded.global.length !== 54) throw new Error("global shape mismatch");
if (encoded.history.length !== 8 * 79) throw new Error("history shape mismatch");
if (encoded.actions.length !== candidates.length * 106) throw new Error("actions shape mismatch");
if (encoded.board[2 * 32] !== 1) throw new Error("visible red K channel mismatch");
if (encoded.board[1 * 32 + 1] !== 1) throw new Error("hidden channel mismatch");
if (encoded.actions[0] !== 1) throw new Error("flip action mismatch");
if (encoded.actions[106 + 1] !== 1) throw new Error("move action mismatch");
if (encoded.actions[212 + 3] !== 1) throw new Error("dark_capture action mismatch");
console.log(JSON.stringify({
  board: encoded.board.length,
  global: encoded.global.length,
  history: encoded.history.length,
  actions: encoded.actions.length,
}));
