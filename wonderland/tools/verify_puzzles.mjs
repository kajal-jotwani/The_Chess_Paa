// Replay every curated puzzle through chess.js; drop any that fail.
import { Chess } from "chess.js";
import fs from "node:fs";
const path = new URL("../src/data/puzzles.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
let total = 0, bad = 0;
for (const cat of Object.keys(data)) for (const key of Object.keys(data[cat])) {
  const keep = [];
  for (const p of data[cat][key]) {
    total++;
    try {
      const c = new Chess(p.fen);
      for (const uci of p.moves.split(" ")) c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      keep.push(p);
    } catch (e) { bad++; }
  }
  data[cat][key] = keep;
}
fs.writeFileSync(path, JSON.stringify(data));
console.log(`checked ${total} puzzles, dropped ${bad}`);
for (const cat of Object.keys(data)) console.log(cat, Object.fromEntries(Object.entries(data[cat]).map(([k, v]) => [k, v.length])));
