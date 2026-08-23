"use client";

/**
 * ChessPaa's voice. Every line is attached to a fact the engine actually
 * found — the words are warm, the truth is Stockfish's.
 */

import type { CoachFacts, Grade } from "./coach";

const GRADE_META: Record<Grade, { sticker: string; label: string; color: string }> = {
  sparkle: { sticker: "🌟", label: "Sparkle move!", color: "#facc15" },
  great:   { sticker: "🎉", label: "Great move!",  color: "#22c55e" },
  good:    { sticker: "👍", label: "Good move",    color: "#25A9B4" },
  okay:    { sticker: "🤔", label: "Hmm, okay…",   color: "#94a3b8" },
  oops:    { sticker: "😬", label: "Oops-a-daisy", color: "#fb923c" },
  blunder: { sticker: "🙈", label: "Banana peel!", color: "#ef4444" },
};

export function gradeMeta(g: Grade) { return GRADE_META[g]; }

const BANK: Record<string, string[]> = {
  sparkle: [
    "Oho! {played} — that's the exact move I was whispering to myself. Sparkle move, my dear!",
    "{played}! You found my favorite move on the whole board. My beard is tingling!",
    "Sweet strawberries — {played} is PERFECT. Even the pigeons on the Ferris wheel are clapping.",
    "That's it! {played}! If I had a gold star sticker, I'd put it right on your forehead.",
  ],
  great: [
    "{played} — lovely! Strong and smart, like a rook with good manners.",
    "Very nice, {played}. You're steering this game like a coaster with your hands in the air!",
    "{played}! ChessPaa approves. Keep playing like this and I'll need a bigger trophy shelf.",
  ],
  good: [
    "{played} is a fine, sensible move. Nothing broken, nothing burnt.",
    "Good thinking with {played}. The board still likes you.",
    "{played} — steady as the Puzzle Train. Chug chug, onward we go.",
  ],
  okay: [
    "{played} is… okay-dokey. But peek again — {best} would have been extra tasty.",
    "Hmm, {played} works, but my old whiskers twitched. {best} was the shinier path.",
    "Not bad! Though between you and me, {best} was the move with sprinkles on top.",
  ],
  oops: [
    "Oops-a-daisy! {played} lets some trouble sneak in. {best} was the safer bridge.",
    "Careful, little champion — {played} wobbles. I'd have tried {best} instead.",
    "Eee, {played} made me spill my tea a little. {best} keeps everything cosy.",
  ],
  blunder: [
    "Banana peel! {played} slips big time — but every blunder is a teacher wearing a silly hat. {best} was the way.",
    "Oh my whiskers! {played} gives away too much. Next time, {best} keeps your team safe.",
    "Whoopsie! {played} opens the castle gates. Don't worry — even grandmasters step on rakes. {best} was the move.",
  ],

  // pattern add-ons (appended after the grade line)
  missedMate: [
    "And here's the secret: there was CHECKMATE in {mateN}! {best} would have ended the whole show with fireworks.",
    "Psst — {best} was checkmate in {mateN}! The king was standing right under the dunk tank.",
  ],
  missedCapture: [
    "You could have munched the {capPiece} on {capSq} for free. Yum yum!",
    "The {capPiece} on {capSq} was sitting there like free popcorn — {best} grabs it.",
  ],
  missedFork: [
    "There was a fork hiding! {best} attacks two big pieces at once — one of them was going home in your pocket.",
    "Sneaky secret: {best} makes a fork — two targets, one move. Like winning two prizes with one ring toss!",
  ],
  hungMovedPiece: [
    "Watch out — the {hungPiece} you just moved can be gobbled by their {byPiece}! Pieces need safe parking spots.",
    "Careful! Your {hungPiece} is standing in the rain on {hungSq}, and their {byPiece} has an umbrella and a fork.",
  ],
  hungPiece: [
    "Uh oh — that leaves your {hungPiece} on {hungSq} unguarded. Their {byPiece} is licking its lips.",
    "Peek at {hungSq}! Your {hungPiece} got left alone at the fair, and their {byPiece} noticed.",
  ],
  castled: [
    "You castled! A safe king is a happy king — now he's home with cocoa and a blanket.",
    "Castle sweet castle! Your king just moved into the safest cabin in the park.",
  ],
  promoted: [
    "A pawn reached the very end and became a QUEEN! Tiny legs, giant dreams. I'm not crying, YOU'RE crying.",
    "PROMOTION! Your little pawn remembered every step it took. Welcome, new queen!",
  ],
  goodCheck: [
    "Check! You made their king hiccup.",
    "A royal hello! Their king has to answer you right now.",
  ],
  goodCapture: [
    "Nom nom — a tasty capture, and a safe one too.",
    "Snack acquired! And you kept your own pieces cosy. That's how it's done.",
  ],
  developed: [
    "I love it — bringing your team out to play! Pieces work best when they help each other.",
    "Another helper joins the adventure! Develop, castle, and the board starts listening to you.",
  ],
  earlyQueen: [
    "One grandpa tip: don't rush the queen out while it's early — let the little pieces warm up first.",
    "Your queen came out very early — brave lady! But baddies will chase her. Knights and bishops first, remember?",
  ],
  matingSoon: [
    "And now you have checkmate in {kidMateN} coming — the fireworks are loaded!",
    "Smell that? Victory pancakes. You've got mate in {kidMateN} if you keep your eyes open.",
  ],
  dangerMate: [
    "Big careful now: if we snooze, THEY have checkmate in {oppMateN}. Guard the king!",
    "Red alert, little knight — their team threatens mate in {oppMateN}. King safety first!",
  ],
  stalemate: [
    "Oh no — stalemate! Their king had NO moves but wasn't in check, so it's a draw. Remember: leave the enemy king one little square until you're ready to pounce.",
  ],
  checkmateWin: [
    "CHECKMATE! You did it! Ring the bells, start the fireworks, free ice cream for everyone!",
    "That's CHECKMATE, my friend! The whole wonderland is cheering your name!",
  ],
};

const recentPicks = new Map<string, number[]>();

function pick(key: string): string {
  const options = BANK[key];
  if (!options?.length) return "";
  const used = recentPicks.get(key) ?? [];
  const fresh = options.map((_, i) => i).filter((i) => !used.includes(i));
  const idx = fresh.length
    ? fresh[Math.floor(Math.random() * fresh.length)]
    : Math.floor(Math.random() * options.length);
  recentPicks.set(key, [...used.slice(-1), idx]);
  return options[idx];
}

function fill(tpl: string, facts: CoachFacts): string {
  return tpl
    .replace(/{played}/g, facts.playedSan)
    .replace(/{best}/g, facts.bestSan)
    .replace(/{mateN}/g, String(facts.missedMateIn ?? ""))
    .replace(/{kidMateN}/g, String(facts.mateForKidIn ?? ""))
    .replace(/{oppMateN}/g, String(facts.mateAgainstKidIn ?? ""))
    .replace(/{capPiece}/g, facts.missedCapture?.piece ?? "piece")
    .replace(/{capSq}/g, facts.missedCapture?.square ?? "")
    .replace(/{hungPiece}/g, facts.hangs?.piece ?? "piece")
    .replace(/{hungSq}/g, facts.hangs?.square ?? "")
    .replace(/{byPiece}/g, facts.hangs?.capturedBy ?? "piece");
}

/** Compose ChessPaa's spoken reaction to a move from its facts. */
export function chessPaaSays(facts: CoachFacts): string {
  if (facts.mate) return fill(pick("checkmateWin"), facts);
  if (facts.stalemate) return fill(pick("stalemate"), facts);

  const parts: string[] = [fill(pick(facts.grade), facts)];

  const addOns: string[] = [];
  if (facts.patterns.includes("missedMate")) addOns.push("missedMate");
  else if (facts.patterns.includes("missedCapture")) addOns.push("missedCapture");
  else if (facts.patterns.includes("missedFork")) addOns.push("missedFork");

  if (facts.patterns.includes("hungMovedPiece")) addOns.push("hungMovedPiece");
  else if (facts.patterns.includes("hungPiece")) addOns.push("hungPiece");

  if (facts.patterns.includes("castled")) addOns.push("castled");
  if (facts.patterns.includes("promoted")) addOns.push("promoted");
  if (facts.patterns.includes("earlyQueen")) addOns.push("earlyQueen");
  if (facts.patterns.includes("developed") && (facts.grade === "sparkle" || facts.grade === "great"))
    addOns.push("developed");
  if (facts.patterns.includes("goodCheck")) addOns.push("goodCheck");
  else if (facts.patterns.includes("goodCapture")) addOns.push("goodCapture");
  if (facts.patterns.includes("matingSoon")) addOns.push("matingSoon");
  if (facts.patterns.includes("dangerMate")) addOns.push("dangerMate");

  for (const key of addOns.slice(0, 2)) parts.push(fill(pick(key), facts));
  return parts.join(" ");
}

/** Short cheers for puzzle rides. */
export const PUZZLE_CHEERS = {
  right: [
    "That's it! My beard did a little dance!",
    "Correct! You've got eagle eyes, little champion!",
    "Yes! Exactly right! Next one, quick, while you're hot!",
    "Bullseye! The carnival bell goes DING DING DING!",
  ],
  wrong: [
    "Not quite — but wrong turns teach us the map. Look again!",
    "Almost! Take a breath, look at checks, captures, and threats.",
    "Hmm, the board says no — but I say try again, brave one!",
  ],
  hint: [
    "Little whisper: look at the piece on {sq}…",
    "Grandpa hint: something wonderful starts from {sq}.",
  ],
  solvedSet: [
    "You solved them ALL! Somewhere a confetti cannon just went off!",
  ],
};

export function cheer(kind: keyof typeof PUZZLE_CHEERS, sub?: Record<string, string>): string {
  const arr = PUZZLE_CHEERS[kind];
  let s = arr[Math.floor(Math.random() * arr.length)];
  for (const [k, v] of Object.entries(sub ?? {})) s = s.replace(`{${k}}`, v);
  return s;
}

/** Welcome lines for rides. */
export const RIDE_WELCOME: Record<string, string> = {
  play: "Climb up here next to me! You play, and after every move I'll tell you what I see — the good, the wobbly, and the sneaky.",
  tactics: "Welcome to the Tactics Rollercoaster! Forks, pins, and sneaky checks ahead. Hands inside the cart at all times!",
  train: "All aboard the Puzzle Train! Solve puzzles to keep us chugging — three wrong answers and we pull into the station.",
  ferris: "Ah, the Endgame Ferris Wheel. Nice and slow up here. Endgames are the bedtime stories of chess — quiet, deep, and full of magic.",
  carousel: "Round and round the Opening Carousel! Openings are like morning stretches — do them right and the whole day goes better.",
  pieces: "Welcome to the Castle of Pieces! Every hero on my board has a song and a secret. Come meet the team!",
};
