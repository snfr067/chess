import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import "../model-core.js";

const require = createRequire(import.meta.url);
const tf = require("@tensorflow/tfjs");

const core = globalThis.DarkChessModelCore;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROWS = 4;
const COLS = 8;
const KINDS = ["K", "A", "E", "R", "N", "C", "P"];
const COUNTS = { K: 1, A: 2, E: 2, R: 2, N: 2, C: 2, P: 5 };
const RANK = { K: 7, A: 6, E: 5, R: 4, N: 3, C: 2, P: 1 };
const VALUE = { K: 950, A: 650, E: 520, R: 420, N: 340, C: 480, P: 220 };
const TARGET_ROWS = 900;
const rng = mulberry32(0x7a11c0de);

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(rows) {
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [rows[index], rows[target]] = [rows[target], rows[index]];
  }
}

function createGame() {
  const pieces = [];
  let id = 0;
  for (const color of ["red", "black"]) {
    for (const kind of KINDS) {
      for (let count = 0; count < COUNTS[kind]; count += 1) pieces.push({ color, kind, faceUp: false, id: `${color}-${id++}` });
    }
  }
  shuffle(pieces);
  const board = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => pieces[r * COLS + c]));
  const first = [Math.floor(rng() * ROWS), Math.floor(rng() * COLS)];
  board[first[0]][first[1]].faceUp = true;
  return {
    board,
    captured: [],
    colors: [board[first[0]][first[1]].color, opposite(board[first[0]][first[1]].color)],
    player: 0,
    combo: null,
    comboStep: 0,
    turnEvents: [{ actor: "self", kind: "flip", action: ["flip", ...first], destination: { r: first[0], c: first[1] }, moverKind: board[first[0]][first[1]].kind }],
    historyEvents: [],
  };
}

function opposite(color) { return color === "red" ? "black" : "red"; }
function neighbors(r, c) {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dr, dc]) => ({ r: r + dr, c: c + dc }))
    .filter((pos) => pos.r >= 0 && pos.r < ROWS && pos.c >= 0 && pos.c < COLS);
}

function cannonPath(board, source, destination) {
  if (source.r !== destination.r && source.c !== destination.c) return false;
  let screens = 0;
  if (source.r === destination.r) {
    const step = destination.c > source.c ? 1 : -1;
    for (let c = source.c + step; c !== destination.c; c += step) if (board[source.r][c]) screens += 1;
  } else {
    const step = destination.r > source.r ? 1 : -1;
    for (let r = source.r + step; r !== destination.r; r += step) if (board[r][source.c]) screens += 1;
  }
  return screens === 1;
}

function normalCapture(attacker, defender) {
  if (attacker.kind === "K" && defender.kind === "P") return false;
  if (attacker.kind === "P" && defender.kind === "K") return true;
  return RANK[attacker.kind] >= RANK[defender.kind];
}

function canCapture(board, source, destination) {
  const attacker = board[source.r][source.c];
  const defender = board[destination.r][destination.c];
  if (!attacker || !defender || !attacker.faceUp || !defender.faceUp || attacker.color === defender.color) return false;
  if (attacker.kind === "C") return cannonPath(board, source, destination);
  return Math.abs(source.r - destination.r) + Math.abs(source.c - destination.c) === 1 && normalCapture(attacker, defender);
}

function canTryHidden(board, source, destination) {
  const attacker = board[source.r][source.c];
  const defender = board[destination.r][destination.c];
  if (!attacker || !attacker.faceUp || !defender || defender.faceUp) return false;
  if (attacker.kind === "C") return cannonPath(board, source, destination);
  return Math.abs(source.r - destination.r) + Math.abs(source.c - destination.c) === 1;
}

function captureActions(board, color, source, includeDark = true) {
  const actions = [];
  const attacker = board[source.r][source.c];
  if (!attacker || !attacker.faceUp || attacker.color !== color) return actions;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (r === source.r && c === source.c) continue;
      const target = board[r][c];
      if (!target) continue;
      if (!target.faceUp && includeDark && canTryHidden(board, source, { r, c })) actions.push(["darkCapture", source.r, source.c, r, c]);
      if (target.faceUp && target.color !== color && canCapture(board, source, { r, c })) actions.push(["capture", source.r, source.c, r, c]);
    }
  }
  return actions;
}

function legalActions(game) {
  const color = game.colors[game.player];
  if (game.combo) return [["stop"], ...captureActions(game.board, color, game.combo, true)];
  const actions = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = game.board[r][c];
      if (!piece) continue;
      if (!piece.faceUp) {
        actions.push(["flip", r, c]);
        continue;
      }
      if (piece.color !== color) continue;
      for (const destination of neighbors(r, c)) if (!game.board[destination.r][destination.c]) actions.push(["move", r, c, destination.r, destination.c]);
      actions.push(...captureActions(game.board, color, { r, c }, true));
    }
  }
  return actions;
}

function cloneBoard(board) { return board.map((row) => row.map((piece) => piece ? { ...piece } : null)); }

function unseenCounts(board, captured) {
  const counts = {
    red: { ...COUNTS },
    black: { ...COUNTS },
  };
  for (const row of board) for (const piece of row) if (piece && piece.faceUp) counts[piece.color][piece.kind] -= 1;
  for (const piece of captured) counts[piece.color][piece.kind] -= 1;
  return counts;
}

function publicOutcomes(game) {
  const counts = unseenCounts(game.board, game.captured);
  const rows = [];
  let total = 0;
  for (const color of ["red", "black"]) for (const kind of KINDS) total += Math.max(0, counts[color][kind]);
  for (const color of ["red", "black"]) for (const kind of KINDS) {
    const count = Math.max(0, counts[color][kind]);
    if (count) rows.push({ color, kind, probability: count / Math.max(1, total) });
  }
  return rows;
}

function attackCount(board, color) {
  let count = 0;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) count += captureActions(board, color, { r, c }, false).length;
  return count;
}

function moveCount(board, color) {
  let count = attackCount(board, color);
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (!piece || !piece.faceUp || piece.color !== color) continue;
    for (const destination of neighbors(r, c)) if (!board[destination.r][destination.c]) count += 1;
  }
  return count;
}

function exposedValue(board, position, color) {
  const piece = position && board[position.r][position.c];
  if (!piece || piece.color !== color || !piece.faceUp) return 0;
  const enemy = opposite(color);
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const attacker = board[r][c];
    if (attacker && attacker.faceUp && attacker.color === enemy && canCapture(board, { r, c }, position)) return VALUE[piece.kind];
  }
  return 0;
}

function supportCount(board, position, color) {
  const target = position && board[position.r][position.c];
  if (!target) return 0;
  let count = 0;
  const hypothetical = { ...target, color: opposite(color), faceUp: true };
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (!piece || !piece.faceUp || piece.color !== color || (r === position.r && c === position.c)) continue;
    const original = board[position.r][position.c];
    board[position.r][position.c] = hypothetical;
    if (canCapture(board, { r, c }, position)) count += 1;
    board[position.r][position.c] = original;
  }
  return count;
}

function applyKnown(board, action) {
  const next = cloneBoard(board);
  if (action[0] === "flip") next[action[1]][action[2]].faceUp = true;
  if (action[0] === "move") { next[action[3]][action[4]] = next[action[1]][action[2]]; next[action[1]][action[2]] = null; }
  if (action[0] === "capture") { next[action[3]][action[4]] = next[action[1]][action[2]]; next[action[1]][action[2]] = null; }
  return next;
}

function consequence(game, action) {
  const color = game.colors[game.player];
  const enemy = opposite(color);
  const source = core.actionSource(action);
  const destination = core.actionDestination(action);
  const beforeOwnMobility = moveCount(game.board, color);
  const beforeEnemyMobility = moveCount(game.board, enemy);
  const beforeOwnAttack = attackCount(game.board, color);
  const beforeEnemyAttack = attackCount(game.board, enemy);
  const target = destination ? game.board[destination.r][destination.c] : null;
  const branches = [];

  if (action[0] === "darkCapture") {
    for (const outcome of publicOutcomes(game)) {
      const board = cloneBoard(game.board);
      board[destination.r][destination.c] = { ...target, color: outcome.color, kind: outcome.kind, faceUp: true };
      const success = canCapture(board, source, destination);
      let capturedValue = 0;
      let final = source;
      if (success) {
        capturedValue = VALUE[outcome.kind];
        board[destination.r][destination.c] = board[source.r][source.c];
        board[source.r][source.c] = null;
        final = destination;
      }
      branches.push({ probability: outcome.probability, board, success, capturedValue, final });
    }
  } else {
    const board = applyKnown(game.board, action);
    branches.push({
      probability: 1,
      board,
      success: action[0] === "capture",
      capturedValue: action[0] === "capture" && target ? VALUE[target.kind] : 0,
      final: destination || source,
    });
  }

  if (action[0] === "stop") branches.splice(0, branches.length, { probability: 1, board: cloneBoard(game.board), success: false, capturedValue: 0, final: game.combo });
  const vector = new Float32Array(24);
  for (const branch of branches) {
    const weight = branch.probability;
    const nextCombo = branch.success && branch.final ? captureActions(branch.board, color, branch.final, true) : [];
    const loss = branch.final ? exposedValue(branch.board, branch.final, color) : 0;
    const ownAttack = attackCount(branch.board, color);
    const enemyAttack = attackCount(branch.board, enemy);
    const ownMobility = moveCount(branch.board, color);
    const enemyMobility = moveCount(branch.board, enemy);
    vector[0] += weight * (branch.success ? 1 : action[0] === "capture" ? 1 : 0);
    vector[1] += weight * (action[0] === "darkCapture" && !branch.success ? 1 : 0);
    vector[2] += weight * branch.capturedValue / 1000;
    vector[3] += weight * loss / 1000;
    vector[4] += weight * (branch.final ? branch.final.r / 3 : 0);
    vector[5] += weight * (branch.final ? branch.final.c / 7 : 0);
    vector[6] += weight * ownAttack / 16;
    vector[7] += weight * (branch.final ? supportCount(branch.board, branch.final, color) / 8 : 0);
    vector[8] += weight * (loss > 0 ? 1 : 0);
    vector[9] += weight * nextCombo.filter((row) => row[0] === "capture").length / 16;
    vector[10] += weight * nextCombo.filter((row) => row[0] === "darkCapture").length / 16;
    vector[11] += weight * (nextCombo.length > 0 ? 1 : 0);
    vector[12] += weight * (ownMobility - beforeOwnMobility) / 32;
    vector[13] += weight * (enemyMobility - beforeEnemyMobility) / 32;
    vector[14] += weight * (ownAttack - beforeOwnAttack) / 16;
    vector[15] += weight * (enemyAttack - beforeEnemyAttack) / 16;
    vector[16] += weight * ownAttack / 16;
    vector[17] += weight * (branch.final ? supportCount(branch.board, branch.final, color) / 8 : 0);
    vector[18] += weight * enemyAttack / 16;
    vector[19] += weight * (branch.capturedValue - loss) / 1000;
    vector[20] += weight * publicValue(branch.board, color);
    vector[21] += weight * terminalValue(branch.board, color);
    vector[22] += 0;
    vector[23] += weight * (action[0] === "capture" ? 1 : 0);
  }
  return vector;
}

function terminalValue(board, color) {
  let own = 0;
  let enemy = 0;
  for (const row of board) for (const piece of row) if (piece) {
    if (piece.color === color) own += 1;
    else enemy += 1;
  }
  if (!enemy && own) return 1;
  if (!own && enemy) return -1;
  return 0;
}

function publicValue(board, color) {
  let score = 0;
  for (const row of board) for (const piece of row) if (piece && piece.faceUp) score += (piece.color === color ? 1 : -1) * VALUE[piece.kind] / 5000;
  return Math.max(-1, Math.min(1, score));
}

function boardChannels(game, color) {
  const result = new Float32Array(ROWS * COLS * 25);
  const enemy = opposite(color);
  const kindIndex = Object.fromEntries(KINDS.map((kind, index) => [kind, index]));
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = game.board[r][c];
    const offset = (r * COLS + c) * 25;
    if (!piece) result[offset + 15] = 1;
    else if (!piece.faceUp) result[offset + 14] = 1;
    else result[offset + (piece.color === color ? 0 : 7) + kindIndex[piece.kind]] = 1;
    result[offset + 16] = squareAttacked(game.board, { r, c }, color) ? 1 : 0;
    result[offset + 17] = squareAttacked(game.board, { r, c }, enemy) ? 1 : 0;
    result[offset + 18] = supportCount(game.board, { r, c }, color) > 0 ? 1 : 0;
    result[offset + 19] = supportCount(game.board, { r, c }, enemy) > 0 ? 1 : 0;
    result[offset + 20] = game.combo && game.combo.r === r && game.combo.c === c ? 1 : 0;
    const last = game.turnEvents[game.turnEvents.length - 1];
    result[offset + 21] = last && last.source && last.source.r === r && last.source.c === c ? 1 : 0;
    result[offset + 22] = last && last.destination && last.destination.r === r && last.destination.c === c ? 1 : 0;
    result[offset + 23] = r / 3;
    result[offset + 24] = c / 7;
  }
  return result;
}

function squareAttacked(board, destination, color) {
  const target = board[destination.r][destination.c];
  if (!target) return false;
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const piece = board[r][c];
    if (piece && piece.faceUp && piece.color === color && canCapture(board, { r, c }, destination)) return true;
  }
  return false;
}

function makeObservation(game) {
  const counts = unseenCounts(game.board, game.captured);
  const total = ["red", "black"].flatMap((side) => KINDS.map((kind) => Math.max(0, counts[side][kind]))).reduce((sum, value) => sum + value, 0) || 1;
  return {
    boardChannels: boardChannels(game, game.colors[game.player]),
    belief: [game.colors[game.player], opposite(game.colors[game.player])].flatMap((side) => KINDS.map((kind) => Math.max(0, counts[side][kind]) / total)),
    turnEvents: game.turnEvents,
    historyEvents: game.historyEvents,
    ownActor: "self",
  };
}

function candidate(game, action) {
  const source = core.actionSource(action);
  const destination = core.actionDestination(action);
  const mover = source ? game.board[source.r][source.c] : null;
  const target = destination ? game.board[destination.r][destination.c] : null;
  return {
    action,
    moverKind: mover && mover.faceUp ? mover.kind : null,
    targetKind: target && target.faceUp ? target.kind : null,
    targetHidden: Boolean(target && !target.faceUp),
    consequence: consequence(game, action),
  };
}

function oracleScore(row) {
  const c = row.consequence;
  const kind = row.action[0];
  return 2.2 * c[0] - 2.8 * c[1] + 4.2 * c[2] - 6.8 * c[3] - 4.5 * c[8]
    + 2.0 * c[9] + 0.8 * c[10] + 0.7 * c[11] + 1.2 * c[12] - 0.9 * c[13]
    + 1.1 * c[14] - 1.0 * c[15] + 2.4 * c[19] + 1.6 * c[20] + 8 * c[21]
    + (kind === "stop" ? 0.15 : 0) + (kind === "flip" ? 0.08 : 0);
}

function applyGameAction(game, action) {
  const color = game.colors[game.player];
  const source = core.actionSource(action);
  const destination = core.actionDestination(action);
  const mover = source ? game.board[source.r][source.c] : null;
  let success = false;
  let revealed = null;
  let captured = null;
  if (action[0] === "stop") return endTurn(game, { actor: "self", kind: "stop", action, turnBoundary: true });
  if (action[0] === "flip") {
    game.board[action[1]][action[2]].faceUp = true;
    revealed = game.board[action[1]][action[2]];
  }
  if (action[0] === "move") {
    game.board[action[3]][action[4]] = game.board[action[1]][action[2]];
    game.board[action[1]][action[2]] = null;
  }
  if (action[0] === "capture") {
    captured = game.board[action[3]][action[4]];
    game.captured.push({ ...captured, faceUp: true });
    game.board[action[3]][action[4]] = game.board[action[1]][action[2]];
    game.board[action[1]][action[2]] = null;
    success = true;
  }
  if (action[0] === "darkCapture") {
    game.board[destination.r][destination.c].faceUp = true;
    revealed = game.board[destination.r][destination.c];
    if (canCapture(game.board, source, destination)) {
      captured = game.board[destination.r][destination.c];
      game.captured.push({ ...captured, faceUp: true });
      game.board[destination.r][destination.c] = game.board[source.r][source.c];
      game.board[source.r][source.c] = null;
      success = true;
    }
  }
  const event = {
    actor: "self",
    kind: action[0],
    action,
    source,
    destination,
    moverKind: mover ? mover.kind : null,
    successCapture: success,
    revealSide: revealed ? (revealed.color === color ? "own" : "opponent") : null,
  };
  game.turnEvents.push(event);
  if (success && destination && captureActions(game.board, color, destination, true).length && game.comboStep < 14) {
    game.combo = destination;
    game.comboStep += 1;
    return;
  }
  endTurn(game, { ...event, turnBoundary: true }, true);
}

function endTurn(game, event, alreadyAdded = false) {
  if (!alreadyAdded) game.turnEvents.push(event);
  const completed = game.turnEvents.map((row) => ({ ...row, actor: game.player === 0 ? "self" : "opponent" }));
  if (completed.length) completed[completed.length - 1].turnBoundary = true;
  game.historyEvents.push(...completed);
  if (game.historyEvents.length > 32) game.historyEvents.splice(0, game.historyEvents.length - 32);
  game.turnEvents = [];
  game.combo = null;
  game.comboStep = 0;
  game.player = game.player === 0 ? 1 : 0;
}

async function buildDataset() {
  const boardRows = [];
  const turnRows = [];
  const historyRows = [];
  const candidateRows = [];
  const beliefRows = [];
  const policyRows = [];
  const valueRows = [];
  const auxRows = [];
  while (policyRows.length < TARGET_ROWS) {
    const game = createGame();
    for (let ply = 0; ply < 72 && policyRows.length < TARGET_ROWS; ply += 1) {
      const actions = legalActions(game);
      if (!actions.length) break;
      const observation = makeObservation(game);
      const candidates = actions.map((action) => candidate(game, action));
      const scores = candidates.map(oracleScore);
      const maxScore = Math.max(...scores);
      for (let index = 0; index < candidates.length && policyRows.length < TARGET_ROWS; index += 1) {
        boardRows.push(Array.from(core.boardTensor(observation)));
        turnRows.push(Array.from(core.eventTensor(observation.turnEvents, core.TURN_STEPS, "self")));
        historyRows.push(Array.from(core.eventTensor(observation.historyEvents, core.HISTORY_STEPS, "self")));
        beliefRows.push(Array.from(core.beliefVector(observation)));
        candidateRows.push(Array.from(core.candidateVector(candidates[index])));
        policyRows.push([Math.max(-8, Math.min(8, scores[index] - maxScore))]);
        valueRows.push([publicValue(game.board, game.colors[game.player])]);
        auxRows.push(Array.from(candidates[index].consequence));
      }
      const temperature = 0.55;
      const weights = scores.map((score) => Math.exp(Math.max(-20, (score - maxScore) / temperature)));
      const total = weights.reduce((sum, value) => sum + value, 0);
      let pick = rng() * total;
      let chosen = 0;
      for (let index = 0; index < weights.length; index += 1) { pick -= weights[index]; if (pick <= 0) { chosen = index; break; } }
      applyGameAction(game, actions[chosen]);
    }
    if (policyRows.length % 1000 < 30) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { boardRows, turnRows, historyRows, beliefRows, candidateRows, policyRows, valueRows, auxRows };
}

async function saveModel(model, metadata) {
  let saved;
  await model.save(tf.io.withSaveHandler(async (artifacts) => {
    saved = artifacts;
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON", weightDataBytes: artifacts.weightData.byteLength } };
  }));
  const json = {
    format: saved.format || "layers-model",
    generatedBy: saved.generatedBy || "TensorFlow.js",
    convertedBy: null,
    modelTopology: saved.modelTopology,
    weightsManifest: [{ paths: ["base-model.weights.bin"], weights: saved.weightSpecs }],
    userDefinedMetadata: metadata,
  };
  await fs.writeFile(path.join(ROOT, "base-model.json"), JSON.stringify(json));
  await fs.writeFile(path.join(ROOT, "base-model.weights.bin"), Buffer.from(saved.weightData));
}

const dataset = await buildDataset();
const base = core.createBaseModel(tf);
const trainingModel = tf.model({ inputs: base.inputs, outputs: [base.outputs[1], base.outputs[2], base.outputs[3]] });
trainingModel.compile({
  optimizer: tf.train.adam(0.0008),
  loss: ["meanSquaredError", "meanSquaredError", "meanSquaredError"],
  lossWeights: [1, 0.25, 0.35],
});
const inputs = [
  tf.tensor4d(dataset.boardRows.flat(), [TARGET_ROWS, ROWS, COLS, core.BOARD_CHANNELS]),
  tf.tensor3d(dataset.turnRows.flat(), [TARGET_ROWS, core.TURN_STEPS, core.EVENT_DIM]),
  tf.tensor3d(dataset.historyRows.flat(), [TARGET_ROWS, core.HISTORY_STEPS, core.EVENT_DIM]),
  tf.tensor2d(dataset.beliefRows.flat(), [TARGET_ROWS, core.BELIEF_DIM]),
  tf.tensor2d(dataset.candidateRows.flat(), [TARGET_ROWS, core.CANDIDATE_DIM]),
];
const labels = [
  tf.tensor2d(dataset.policyRows, [TARGET_ROWS, 1]),
  tf.tensor2d(dataset.valueRows, [TARGET_ROWS, 1]),
  tf.tensor2d(dataset.auxRows.flat(), [TARGET_ROWS, core.CONSEQUENCE_DIM]),
];
const history = await trainingModel.fit(inputs, labels, { epochs: 1, batchSize: 64, shuffle: true, validationSplit: 0.08, verbose: 1 });
await saveModel(base, {
  version: "tactical-backbone-v2.0.0",
  generatedAt: new Date().toISOString(),
  trainingRows: TARGET_ROWS,
  epochs: 1,
  architecture: "conv32-res3-gru32-gru32-dense128-dense64",
  publicInformationOnly: true,
  objectiveHeads: ["policy", "continuation", "consequence"],
  finalLoss: history.history.loss.at(-1),
  finalValidationLoss: history.history.val_loss.at(-1),
});
for (const tensor of [...inputs, ...labels]) tensor.dispose();
base.dispose();
console.log(JSON.stringify({ rows: TARGET_ROWS, finalLoss: history.history.loss.at(-1), validationLoss: history.history.val_loss.at(-1) }));
