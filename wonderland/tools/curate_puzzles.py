#!/usr/bin/env python3
"""
Curate kid-friendly puzzles from the Lichess open puzzle database (CC0).
  zstdcat lichess_db_puzzle.csv.zst | python3 tools/curate_puzzles.py > src/data/puzzles.json
Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
"""
import csv, json, random, sys
random.seed(7)
TACTICS = {"mateIn1": 220, "mateIn2": 220, "fork": 220, "pin": 200, "skewer": 200, "discoveredAttack": 200, "hangingPiece": 220, "backRankMate": 200}
ENDGAMES = {"queenEndgame": 160, "rookEndgame": 160, "pawnEndgame": 160, "promotion": 160, "endgameMate": 160}
BANDS = [(600, 850), (850, 1050), (1050, 1250), (1250, 1450), (1450, 1650)]
BAND_N = 200
MAX_PLIES = 6  # <= 3 kid moves

out = {"tactics": {k: [] for k in TACTICS}, "endgames": {k: [] for k in ENDGAMES}, "train": {f"band{i+1}": [] for i in range(5)}}
pools = {("tactics", k): [] for k in TACTICS} | {("endgames", k): [] for k in ENDGAMES} | {("train", f"band{i+1}"): [] for i in range(5)}

reader = csv.reader(sys.stdin)
header = next(reader)
n = 0
for row in reader:
    n += 1
    try:
        pid, fen, moves, rating, rd, pop, plays, themes = row[0], row[1], row[2], int(row[3]), int(row[4]), int(row[5]), int(row[6]), row[7]
    except Exception:
        continue
    if pop < 90 or plays < 800 or rd > 90 or rating > 1700 or rating < 550:
        continue
    plies = len(moves.split())
    if plies - 1 > MAX_PLIES:
        continue
    th = set(themes.split())
    rec = {"id": pid, "fen": fen, "moves": moves, "rating": rating, "themes": " ".join(sorted(th & {"mateIn1", "mateIn2", "fork", "pin", "skewer", "discoveredAttack", "hangingPiece", "backRankMate", "promotion", "endgame", "queenEndgame", "rookEndgame", "pawnEndgame", "knightEndgame", "bishopEndgame", "advantage", "crushing", "short", "oneMove", "mate"}))}
    if rating <= 1400:
        for k in TACTICS:
            if k in th:
                pools[("tactics", k)].append(rec)
        if "endgame" in th:
            for k in ENDGAMES:
                if k == "endgameMate":
                    if "mateIn1" in th or "mateIn2" in th:
                        pools[("endgames", k)].append(rec)
                elif k in th:
                    pools[("endgames", k)].append(rec)
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= rating < hi and plies - 1 <= 4:
            pools[("train", f"band{i+1}")].append(rec)

for (cat, k), pool in pools.items():
    want = TACTICS.get(k) or ENDGAMES.get(k) or BAND_N
    # prefer the most-played (well-tested) puzzles, then shuffle a wider slice for variety
    pool.sort(key=lambda r: -r["rating"] if False else 0)
    random.shuffle(pool)
    sel = pool[:want]
    sel.sort(key=lambda r: r["rating"])
    out[cat][k] = sel
    print(f"{cat}/{k}: {len(sel)} (pool {len(pool)})", file=sys.stderr)
print(f"scanned {n} rows", file=sys.stderr)
json.dump(out, sys.stdout, separators=(",", ":"))
