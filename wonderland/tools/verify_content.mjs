// Verify every rhyme beat / try-it position loads and every acted-out move is legal.
import { Chess } from "chess.js";
const { LESSONS } = await import("../src/content/Rhymes.ts");
let bad = 0;
for (const L of LESSONS) {
  if (L.beats.length !== L.rhyme.length) { console.log(`${L.name}: ${L.beats.length} beats vs ${L.rhyme.length} lines`); bad++; }
  L.beats.forEach((b, i) => {
    let c; try { c = new Chess(b.fen); } catch (e) { console.log(`${L.name} beat ${i}: bad fen ${b.fen}`); bad++; return; }
    if (b.from && b.to) { try { c.move({ from: b.from, to: b.to, promotion: "q" }); } catch { console.log(`${L.name} beat ${i}: illegal ${b.from}-${b.to} in ${b.fen}`); bad++; } }
  });
  const t = new Chess(L.tryIt.fen);
  const legal = t.moves({ square: L.tryIt.piece, verbose: true }).map((m) => m.to);
  for (const tg of L.tryIt.targets) if (!legal.includes(tg)) { console.log(`${L.name} try-it: ${L.tryIt.piece}->${tg} not legal (legal: ${legal.join(",")})`); bad++; }
}
console.log(bad ? `${bad} problems` : "all rhyme beats and try-its are legal ✔");
