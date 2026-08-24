"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, mix } from "../core/palette";
import { stripeTexture, rng } from "../core/textures/procedural";
import { mergeGeometries } from "../world/terrain";
import { NO_INK_LAYER } from "../core/postfx/effects";

import {
  TOON,
  plushMaterial,
  plushCapsule,
  blob,
  lathe,
  smoothed,
  toonPart,
  buildBreath,
  type BreathBits,
} from "./ChessPaa";
import {
  Spring,
  SpringVec3,
  VerletChain,
  solveTwoBoneIK,
  fbmSin,
  parkWind,
  type ChainCollider,
} from "./chessPaaRig";

/**
 * THE GRANDCHILDREN.
 *
 * Two small riders, about 1.05 units tall, built from exactly the same plush
 * vocabulary as ChessPaa so the three of them read as one family carved by
 * one hand.
 *
 * Their whole job is REACTION. A child watching this game should see their
 * own delight mirrored back: arms up on the drop, hands clapping when the
 * puzzle cracks, a proper hands-to-cheeks gasp at the reveal. Everything
 * below is in service of those four beats.
 *
 * The two of them are deliberately NOT in lockstep. Different seeds, a
 * slightly different size, and one of them is always about a tenth of a
 * second late — because two children reacting in perfect unison reads as one
 * child mirrored, which is the exact opposite of alive.
 */

export type GrandchildReaction = "idle" | "lean" | "clap" | "gasp";

/* ================================================================== *
 * PROPORTIONS
 * ================================================================== */

const KID = {
  height: 1.05,
  hipY: 0.4,
  spineY: 0.09,
  chestY: 0.11,
  neckY: 0.145,
  headY: 0.02,
  /** World heights, kept here so geometry and rig can never disagree. */
  chestW: 0.6,
  shoulderW: 0.7,
  shoulderX: 0.155,
  shoulderYOff: 0.1,
  upperArm: 0.185,
  foreArm: 0.165,
  mittenR: 0.075,
  hipX: 0.078,
  headR: 0.142,
} as const;

/** Body + head stand-in, so a streaming hat tail cannot saw through a skull. */
const KID_COLLIDER: ChainCollider = {
  a: new THREE.Vector3(0, 0.38, 0),
  b: new THREE.Vector3(0, 0.92, 0),
  ra: 0.24,
  rb: 0.17,
};

/** Root-local hand targets. `s` is -1 for his/her left, +1 for the right. */
function handAnchor(kind: "rest" | "up" | "clapOpen" | "clapShut" | "cheeks", s: number, out: THREE.Vector3) {
  switch (kind) {
    case "up":
      return out.set(s * 0.26, 0.98, -0.1);
    case "clapOpen":
      return out.set(s * 0.2, 0.6, 0.19);
    case "clapShut":
      return out.set(s * 0.042, 0.62, 0.235);
    case "cheeks":
      return out.set(s * 0.118, 0.83, 0.155);
    default:
      return out.set(s * 0.2, 0.42, 0.1);
  }
}

/** Scratch for the hand blends. Module scope: the frame loop allocates nothing. */
const _blend = /* @__PURE__ */ new THREE.Vector3();

/* ================================================================== *
 * THE KID RIG
 * ================================================================== */

interface KidPose {
  bob: number;
  lean: number;
  side: number;
  twist: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  breathScale: number;
  eyeOpen: number;
  browRaise: number;
  smile: number;
  mouthOpen: number;
  twinkle: number;
  /** Coaster rattle, 0..1. */
  shiver: number;
  /** 0..1 spike on the frame the hands meet. */
  clapHit: number;
  legSwing: number;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  /** Extra acceleration for the hat tail — this is what makes it stream. */
  tailForce: THREE.Vector3;
  exhaled: boolean;
  exhaleAge: number;
}

/**
 * A small, opinionated performance rig.
 *
 * Same principles as ChessPaa's: springs carry amplitudes, oscillators are
 * evaluated straight from elapsed time, and the rest pose is a good pose.
 * The one addition is a PHASE CLOCK — the gasp is a timed beat, not a state,
 * and it only works if the hold in the middle is honoured.
 */
class KidRig {
  readonly pose: KidPose;

  private rnd: () => number;
  private seedN: number;
  /** Seconds this kid lags the group. Nobody reacts at exactly the same moment. */
  private delay: number;
  private pending: GrandchildReaction = "idle";
  private pendingIn = 0;
  private current: GrandchildReaction = "idle";
  private phase = 0;

  private sLean = new Spring(0, 0.16, 0.62);
  private sSide = new Spring(0, 0.3);
  private sEye = new Spring(1, 0.09);
  private sBrow = new Spring(0.1, 0.1);
  private sSmile = new Spring(0.45, 0.16);
  private sMouth = new Spring(0.03, 0.1);
  private sTwinkle = new Spring(1, 0.3);
  private sShiver = new Spring(0, 0.18);
  private sBobAmp = new Spring(0, 0.2);
  private sHeadPitch = new Spring(0, 0.16);
  // Gaze SPRINGS. Assigning a new gaze angle straight onto the head yaw makes
  // the head teleport every couple of seconds, which is the loudest possible
  // way to read as a puppet — and idle is the state a child watches longest.
  private sGaze = new Spring(0, 0.22);
  // Head roll is the one channel that also carries per-reaction oscillators at
  // very different frequencies, so it goes through a fast spring rather than
  // straight through: switching into a clap mid-cycle would otherwise inject
  // up to 0.13 rad of roll on a single frame.
  private sRoll = new Spring(0, 0.06);
  // Arms fly. Under-damped so they overshoot and settle, like real limbs.
  private hL = new SpringVec3(0.13, 0.55);
  private hR = new SpringVec3(0.13, 0.55);

  private blinkIn = 1.1;
  private blinkT = -1;
  private gazeIn = 1.7;
  private gazeYaw = 0;
  private exhaleIn = 2.5;

  private readonly tmp = new THREE.Vector3();

  constructor(seed: number, delay: number) {
    this.seedN = seed;
    this.rnd = rng(seed);
    this.delay = delay;
    const l = new THREE.Vector3();
    const r = new THREE.Vector3();
    this.hL.snap(handAnchor("rest", -1, l));
    this.hR.snap(handAnchor("rest", 1, r));
    this.pose = {
      bob: 0, lean: 0, side: 0, twist: 0,
      headPitch: 0, headYaw: 0, headRoll: 0, breathScale: 1,
      eyeOpen: 1, browRaise: 0.1, smile: 0.45, mouthOpen: 0.03, twinkle: 1,
      shiver: 0, clapHit: 0, legSwing: 0,
      handL: this.hL.value, handR: this.hR.value,
      tailForce: new THREE.Vector3(),
      exhaled: false, exhaleAge: 99,
    };
  }

  update(dtRaw: number, t: number, want: GrandchildReaction, lookAt: THREE.Vector3 | null): KidPose {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    const p = this.pose;
    const sd = this.seedN;

    /* ---- the late reaction ---- */
    if (want !== this.pending) {
      this.pending = want;
      this.pendingIn = this.delay;
    }
    if (this.pending !== this.current) {
      this.pendingIn -= dt;
      if (this.pendingIn <= 0) {
        this.current = this.pending;
        this.phase = 0; // a fresh beat, so the gasp timeline restarts
      }
    }
    this.phase += dt;
    const react = this.current;
    const ph = this.phase;

    /* ---- blink ---- */
    this.blinkIn -= dt;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.15) this.blinkT = -1;
    } else if (this.blinkIn <= 0) {
      this.blinkT = 0;
      this.blinkIn = 1.6 + this.rnd() * 3.2; // children blink more than adults
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      const bp = this.blinkT / 0.15;
      blink = bp < 0.34 ? bp / 0.34 : 1 - (bp - 0.34) / 0.66;
    }

    /* ---- gaze ---- */
    this.gazeIn -= dt;
    if (lookAt) {
      this.gazeYaw = Math.atan2(lookAt.x, Math.max(0.3, lookAt.z));
      this.gazeIn = 1.0;
    } else if (this.gazeIn <= 0) {
      // Half the time they glance at each other. That glance is the single
      // cheapest thing that makes two characters read as siblings.
      this.gazeYaw = this.rnd() < 0.5 ? (this.rnd() - 0.5) * 1.1 : -Math.sign(sd % 2 ? 1 : -1) * 0.85;
      this.gazeIn = 1.2 + this.rnd() * 2.6;
    }

    /* ---- defaults, then per-reaction overrides ---- */
    let lean = 0.02;
    let eye = 1;
    let brow = 0.12;
    let smile = 0.45;
    let mouth = 0.03;
    let twinkle = 1;
    let shiver = 0;
    let bobAmp = 0;
    let headPitch = 0.02;
    let headRoll = fbmSin(t * 0.5, sd) * 0.035;
    let breathRate = 0.42;
    let handKindL: Parameters<typeof handAnchor>[0] = "rest";
    let handKindR: Parameters<typeof handAnchor>[0] = "rest";
    let handMix = 0;
    p.clapHit = 0;
    p.tailForce.set(0, 0, 0);

    if (react === "lean") {
      // ARMS UP. Nothing else says roller-coaster drop as loudly, and it is
      // the pose every child in the world already knows how to make.
      // Retune explicitly: the gasp leaves these springs at its own half-lives
      // and a face spring must never inherit its speed from the beat before.
      this.sEye.tune(0.09);
      this.sMouth.tune(0.1);
      this.sBrow.tune(0.1);
      lean = 0.4;
      eye = 1.12 + Math.sin(t * 13.5) * 0.1; // wind in the eyes
      brow = 0.9;
      smile = 1;
      mouth = 0.72 + Math.sin(t * 7.3) * 0.14; // WHEEEE
      twinkle = 1.35;
      shiver = 1;
      headPitch = -0.24;
      headRoll += Math.sin(t * 2.3) * 0.06;
      breathRate = 1.1;
      handKindL = "up";
      handKindR = "up";
      // Streaming hat tail: hard backward push plus a little lift.
      p.tailForce.set(fbmSin(t * 3.1, sd) * 1.2, 2.2, -7.5);
    } else if (react === "clap") {
      this.sEye.tune(0.09);
      this.sMouth.tune(0.1);
      this.sBrow.tune(0.1);
      // 5.2 Hz, offset per kid so they are never metronomes together.
      const cp = t * 5.2 + sd * 0.31;
      const c = Math.sin(cp * Math.PI * 2) * 0.5 + 0.5;
      // Sharpened so the hands SNAP together and drift apart — an even sine
      // reads as a machine wiping a window.
      handMix = c * c * (3 - 2 * c);
      handKindL = "clapOpen";
      handKindR = "clapOpen";
      p.clapHit = Math.max(0, (handMix - 0.82) / 0.18);
      lean = 0.07;
      eye = 0.34; // squeezed-shut happy crescents
      brow = 0.75;
      smile = 1;
      mouth = 0.3 + p.clapHit * 0.3;
      twinkle = 1.25;
      // A hop on every second clap.
      bobAmp = 1;
      headRoll += Math.sin(cp * Math.PI) * 0.13;
      headPitch = -0.08;
      breathRate = 0.9;
      p.tailForce.set(0, 0, -1.6);
    } else if (react === "gasp") {
      // A GASP IS A BEAT, NOT A FACE. Anticipation, snap, HOLD, settle.
      if (ph < 0.1) {
        // anticipation: a tiny sink before the pop
        lean = 0.09;
        eye = 0.86;
        brow = 0.05;
        smile = 0.3;
        mouth = 0.02;
        this.sEye.tune(0.05);
        this.sMouth.tune(0.05);
        this.sBrow.tune(0.05);
      } else if (ph < 0.3) {
        // the inhale — everything opens at once
        lean = -0.22;
        eye = 1.5;
        brow = 1;
        smile = 0.15;
        mouth = 0.95;
        twinkle = 1.5;
        headPitch = 0.1;
        handKindL = "cheeks";
        handKindR = "cheeks";
        breathRate = 3;
      } else if (ph < 1.15) {
        // THE HOLD. Almost nothing moves. This silence is the whole gasp.
        lean = -0.2;
        eye = 1.46;
        brow = 1;
        smile = 0.2;
        mouth = 0.88;
        twinkle = 1.5;
        headPitch = 0.09;
        handKindL = "cheeks";
        handKindR = "cheeks";
        breathRate = 0.2;
      } else {
        // ...and then it turns into pure delight.
        const s = Math.min(1, (ph - 1.15) / 1.1);
        this.sEye.tune(0.22);
        this.sMouth.tune(0.24);
        this.sBrow.tune(0.2);
        lean = -0.2 + s * 0.24;
        eye = 1.46 - s * 0.6;
        brow = 1 - s * 0.25;
        smile = 0.2 + s * 0.8;
        mouth = 0.88 - s * 0.62;
        twinkle = 1.5 - s * 0.2;
        headPitch = 0.09 - s * 0.12;
        headRoll += Math.sin(t * 3.1) * 0.07 * s; // a happy little head-shake
        handKindL = "cheeks";
        handKindR = "cheeks";
        handMix = s * 0.45; // hands drift down but stay near the face
        breathRate = 0.7;
      }
    } else {
      // IDLE: waiting, wriggling, never still. Kids do not stand still.
      this.sEye.tune(0.09);
      this.sMouth.tune(0.1);
      this.sBrow.tune(0.1);
      lean = 0.02 + fbmSin(t * 0.7, sd + 3) * 0.03;
      headPitch = 0.02 + fbmSin(t * 0.6, sd + 5) * 0.05;
      p.tailForce.set(0, 0, 0);
    }

    /* ---- targets ---- */
    this.sLean.to(lean);
    this.sSide.to(fbmSin(t * 0.55, sd + 7) * 0.05);
    this.sEye.to(eye * (1 - blink * 0.96));
    this.sBrow.to(brow);
    this.sSmile.to(smile);
    this.sMouth.to(mouth);
    this.sTwinkle.to(twinkle);
    this.sShiver.to(shiver);
    this.sBobAmp.to(bobAmp);
    this.sHeadPitch.to(headPitch);
    this.sGaze.to(this.gazeYaw);
    this.sRoll.to(headRoll);

    handAnchor(handKindL, -1, this.tmp);
    if (react === "clap") {
      this.tmp.lerp(handAnchor("clapShut", -1, _blend), handMix);
    } else if (react === "gasp" && handMix > 0) {
      this.tmp.lerp(handAnchor("rest", -1, _blend), handMix);
    }
    this.tmp.x += fbmSin(t * 1.3, sd + 11) * 0.018;
    this.tmp.y += fbmSin(t * 1.7, sd + 13) * 0.02;
    this.hL.to(this.tmp);

    handAnchor(handKindR, 1, this.tmp);
    if (react === "clap") {
      this.tmp.lerp(handAnchor("clapShut", 1, _blend), handMix);
    } else if (react === "gasp" && handMix > 0) {
      this.tmp.lerp(handAnchor("rest", 1, _blend), handMix);
    }
    this.tmp.x += fbmSin(t * 1.3, sd + 17) * 0.018;
    this.tmp.y += fbmSin(t * 1.7, sd + 19) * 0.02;
    this.hR.to(this.tmp);

    /* ---- integrate ---- */
    const H = 1 / 120;
    let acc = dt;
    let guard = 0;
    while (acc > 1e-5 && guard < 12) {
      const h = Math.min(H, acc);
      this.sLean.step(h); this.sSide.step(h); this.sEye.step(h); this.sBrow.step(h);
      this.sSmile.step(h); this.sMouth.step(h); this.sTwinkle.step(h);
      this.sShiver.step(h); this.sBobAmp.step(h); this.sHeadPitch.step(h);
      this.sGaze.step(h); this.sRoll.step(h);
      this.hL.step(h); this.hR.step(h);
      acc -= h;
      guard++;
    }

    /* ---- breath fog ---- */
    this.exhaleIn -= dt * (react === "lean" ? 2.4 : 1);
    p.exhaled = false;
    if (this.exhaleIn <= 0) {
      this.exhaleIn = 3.2 + this.rnd() * 2.4;
      p.exhaleAge = 0;
      p.exhaled = true;
    }
    p.exhaleAge += dt;

    /* ---- compose ---- */
    const breath = Math.sin(t * breathRate * Math.PI * 2 + sd);
    p.breathScale = 1 + breath * 0.026 + 0.004;
    p.lean = this.sLean.value;
    p.side = this.sSide.value;
    const gaze = this.sGaze.value;
    p.twist = fbmSin(t * 0.4, sd + 23) * 0.05 + gaze * 0.12;
    p.headPitch = this.sHeadPitch.value + breath * 0.01;
    p.headYaw = THREE.MathUtils.clamp(gaze * 0.55, -0.7, 0.7) + fbmSin(t * 0.9, sd + 29) * 0.04;
    p.headRoll = this.sRoll.value;
    p.eyeOpen = this.sEye.value;
    p.browRaise = this.sBrow.value;
    p.smile = this.sSmile.value;
    p.mouthOpen = this.sMouth.value;
    p.twinkle = this.sTwinkle.value * (0.94 + Math.sin(t * 2.7 + sd) * 0.06);
    p.shiver = this.sShiver.value;

    const bob = this.sBobAmp.value;
    // hop on every second clap, plus the ever-present fidget bounce
    p.bob =
      breath * 0.005 +
      Math.max(0, Math.sin((t * 5.2 + sd * 0.31) * Math.PI)) * 0.045 * bob +
      fbmSin(t * 1.1, sd + 31) * 0.006 +
      p.shiver * Math.sin(t * 41) * 0.006;
    // Legs never stop. A still leg on a child reads as a mannequin.
    p.legSwing = fbmSin(t * 1.4, sd + 37) * 0.06 + p.shiver * Math.sin(t * 29) * 0.05;

    return p;
  }
}

/* ================================================================== *
 * THE BODY
 * ================================================================== */

export interface GrandchildLook {
  coat: number;
  hat: number;
  mitten: number;
  scarf: number;
  hair: number;
}

/** Two looks, chosen so neither child ever borrows ChessPaa's red. */
export const GRANDCHILD_LOOKS: [GrandchildLook, GrandchildLook] = [
  {
    coat: PALETTE.plum,
    hat: PALETTE.teal,
    mitten: PALETTE.honeyDeep,
    scarf: PALETTE.tealDeep,
    hair: PALETTE.walnutLight,
  },
  {
    coat: PALETTE.tealDeep,
    hat: PALETTE.plumDeep,
    mitten: PALETTE.cream,
    scarf: PALETTE.honeyDeep,
    hair: PALETTE.cocoa,
  },
];

interface KidBuilt {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  upperL: THREE.Group;
  upperR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  mittenL: THREE.Group;
  mittenR: THREE.Group;
  coatBody: THREE.Mesh;
  eyeRig: THREE.Group;
  eyeBalls: THREE.Mesh;
  lids: THREE.Mesh;
  catchlights: THREE.Mesh;
  brows: THREE.Group;
  smileMesh: THREE.Mesh;
  mouthMesh: THREE.Mesh;
  tailAnchor: THREE.Object3D;
  tailSegs: THREE.Object3D[];
  mouthAnchor: THREE.Object3D;
  breath: BreathBits;
  dispose(): void;
}

const SKIN = mix(PALETTE.cream, PALETTE.honey, 0.2);
const RUDDY = mix(SKIN, PALETTE.scarfRed, 0.4);
const DARK = mix(PALETTE.ink, PALETTE.cocoa, 0.3);

function buildKid(look: GrandchildLook, seed: number): KidBuilt {
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const knit = stripeTexture(look.hat, mix(look.hat, PALETTE.ink, 0.3), 12);

  const mCoat = keep(plushMaterial(look.coat, TOON.hero));
  const mHat = keep(plushMaterial(0xffffff, TOON.plush, { map: knit, rim: 0.75 }));
  const mScarf = keep(plushMaterial(look.scarf, TOON.plush));
  const mMitten = keep(plushMaterial(look.mitten, TOON.plush));
  const mHair = keep(plushMaterial(look.hair, TOON.plush, { rim: 0.7 }));
  const mSkin = keep(plushMaterial(SKIN, TOON.hero, { rimColor: PALETTE.honey }));
  const mRuddy = keep(plushMaterial(RUDDY, TOON.hero, { rim: 0.6 }));
  const mBoot = keep(plushMaterial(mix(PALETTE.cocoa, PALETTE.walnut, 0.2), TOON.woody));
  const mDark = keep(plushMaterial(DARK, TOON.deep));
  const mEye = keep(plushMaterial(mix(PALETTE.ink, PALETTE.walnut, 0.2), TOON.deep, { rim: 0.5 }));
  const mCatch = keep(new THREE.MeshBasicMaterial({ color: 0xfff6de, toneMapped: false, fog: false }));

  /* ---- skeleton ---- */
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = KID.hipY;
  body.add(hips);
  const spine = new THREE.Group();
  spine.position.y = KID.spineY;
  hips.add(spine);
  const chest = new THREE.Group();
  chest.position.y = KID.chestY;
  spine.add(chest);
  const neck = new THREE.Group();
  neck.position.y = KID.neckY;
  chest.add(neck);
  const head = new THREE.Group();
  head.position.y = KID.headY;
  neck.add(head);

  /* ---- legs ---- */
  const legGeo = (side: -1 | 1) =>
    smoothed(
      mergeGeometries([
        plushCapsule(0.072, 0.064, 0.14, 8),
        (() => {
          const g = plushCapsule(0.064, 0.056, 0.12, 8);
          g.translate(0, -0.15, 0);
          return g;
        })(),
        blob(0.07, [1.0, 0.8, 1.25], [0, -0.325, 0.02], [0, side * 0.16, 0], 10),
        blob(0.06, [1.0, 0.6, 0.95], [side * 0.012, -0.35, 0.085], [0, 0, 0], 10),
        blob(0.062, [1.12, 0.3, 1.35], [0, -0.378, 0.025], [0, side * 0.16, 0], 10),
      ])
    );
  const legL = new THREE.Group();
  legL.position.x = -KID.hipX;
  legL.add(toonPart(legGeo(-1), mBoot, 2.0));
  hips.add(legL);
  const legR = new THREE.Group();
  legR.position.x = KID.hipX;
  legR.add(toonPart(legGeo(1), mBoot, 2.0));
  hips.add(legR);

  /* ---- coat ---- */
  const skirt = toonPart(
    smoothed(
      lathe(
        [
          [0.001, -0.104],
          [0.16, -0.108],
          [0.222, -0.112],
          [0.238, -0.09],
          [0.232, -0.05],
          [0.222, 0.01],
          [0.212, 0.07],
          [0.196, 0.13],
          [0.166, 0.185],
          [0.001, 0.195],
        ],
        18
      )
    ),
    mCoat,
    2.4
  );
  hips.add(skirt);

  const coatBody = toonPart(
    smoothed(
      mergeGeometries([
        lathe(
          [
            [0.001, -0.06],
            [0.13, -0.058],
            [0.17, -0.04],
            [0.182, 0.0],
            [0.178, 0.05],
            [0.162, 0.095],
            [0.13, 0.13],
            [0.104, 0.155],
            [0.095, 0.17],
            [0.001, 0.176],
          ],
          18
        ),
        blob(0.062, [1, 0.9, 1], [-0.148, 0.095, 0], [0, 0, 0], 10),
        blob(0.062, [1, 0.9, 1], [0.148, 0.095, 0], [0, 0, 0], 10),
        blob(0.02, [1, 1, 0.6], [0, 0.02, 0.178], [0, 0, 0], 8),
        blob(0.02, [1, 1, 0.6], [0, -0.04, 0.174], [0, 0, 0], 8),
      ])
    ),
    mCoat,
    2.4
  );
  chest.add(coatBody);

  /* ---- scarf: one wrap and a short static end ---- */
  const scarf = toonPart(
    smoothed(
      mergeGeometries([
        (() => {
          const g = new THREE.TorusGeometry(0.115, 0.042, 8, 18);
          g.rotateX(Math.PI / 2);
          g.scale(1, 1, 0.92);
          g.translate(0, 0.155, 0);
          return g;
        })(),
        blob(0.036, [1.35, 1.0, 0.5], [-0.068, 0.09, 0.108], [0.25, 0, 0.1], 8),
        blob(0.032, [1.3, 1.0, 0.5], [-0.078, 0.02, 0.118], [0.15, 0, 0.15], 8),
      ])
    ),
    mScarf,
    2.2
  );
  chest.add(scarf);

  /* ---- arms ---- */
  function arm(side: -1 | 1) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * KID.shoulderX, KID.shoulderYOff, 0);
    const upper = new THREE.Group();
    upper.add(toonPart(plushCapsule(0.062, 0.055, KID.upperArm, 8), mCoat, 2.0));
    shoulder.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -KID.upperArm;
    // Forearm and mitten carry ink too. The upper arm is outlined, so leaving
    // these bare stops the silhouette line dead at the elbow — in a cel park
    // a line that quits halfway down a limb reads as a rendering fault, and
    // the arms are the whole point of the arms-up and the clap.
    fore.add(toonPart(plushCapsule(0.055, 0.062, KID.foreArm, 8), mCoat, 2.0));
    upper.add(fore);
    const mitten = new THREE.Group();
    mitten.position.y = -KID.foreArm;
    mitten.add(
      toonPart(
        smoothed(
          mergeGeometries([
            blob(KID.mittenR, [1.0, 1.12, 0.92], [0, -0.04, 0.004], [0, 0, 0], 10),
            blob(0.032, [1, 1.15, 1], [side * -0.05, -0.02, 0.024], [0.3, 0, 0], 8),
          ])
        ),
        mMitten,
        2.0
      )
    );
    fore.add(mitten);
    chest.add(shoulder);
    return { upper, fore, mitten };
  }
  const armL = arm(-1);
  const armR = arm(1);

  /* ---- head ---- */
  head.add(
    toonPart(
      smoothed(
        mergeGeometries([
          blob(KID.headR, [1.03, 1.08, 1.02], [0, 0.088, 0], [0, 0, 0], 18),
          blob(0.104, [1.0, 0.8, 0.98], [0, 0.03, 0.022], [0, 0, 0], 12),
          blob(0.038, [0.5, 1.0, 0.85], [-0.146, 0.082, -0.004], [0, 0, 0], 10),
          blob(0.038, [0.5, 1.0, 0.85], [0.146, 0.082, -0.004], [0, 0, 0], 10),
        ])
      ),
      mSkin,
      2.4
    )
  );

  // button nose and two big apple cheeks — the whole reason they read young
  head.add(
    toonPart(
      smoothed(
        mergeGeometries([
          blob(0.027, [1, 0.95, 1.1], [0, 0.072, 0.138], [0, 0, 0], 10),
          blob(0.048, [1.05, 0.8, 0.6], [-0.092, 0.056, 0.108], [0, 0, 0], 12),
          blob(0.048, [1.05, 0.8, 0.6], [0.092, 0.056, 0.108], [0, 0, 0], 12),
        ])
      ),
      mRuddy,
      false
    )
  );

  // Eyes are proportionally much bigger than ChessPaa's. Eye-to-head ratio is
  // the single strongest cue for "child", and it does the work for free.
  const eyeRig = new THREE.Group();
  eyeRig.position.set(0, 0.105, 0);
  head.add(eyeRig);

  const eyeBalls = new THREE.Mesh(
    mergeGeometries([
      blob(0.042, [1, 1, 1], [-0.062, 0, 0.112], [0, 0, 0], 12),
      blob(0.042, [1, 1, 1], [0.062, 0, 0.112], [0, 0, 0], 12),
    ]),
    mEye
  );
  eyeBalls.castShadow = false;
  eyeRig.add(eyeBalls);

  const catchlights = new THREE.Mesh(
    mergeGeometries([
      blob(0.016, [1, 1, 1], [-0.052, 0.021, 0.144], [0, 0, 0], 8),
      blob(0.016, [1, 1, 1], [0.052, 0.021, 0.144], [0, 0, 0], 8),
      // a second, smaller sparkle low on the eye — twice the twinkle
      blob(0.008, [1, 1, 1], [-0.074, -0.014, 0.142], [0, 0, 0], 6),
      blob(0.008, [1, 1, 1], [0.074, -0.014, 0.142], [0, 0, 0], 6),
    ]),
    mCatch
  );
  catchlights.layers.set(NO_INK_LAYER);
  catchlights.castShadow = false;
  catchlights.renderOrder = 4;
  eyeBalls.add(catchlights);

  const lids = new THREE.Mesh(
    mergeGeometries([
      blob(0.05, [1.06, 0.95, 0.62], [-0.062, -0.0475, 0.114], [0, 0, 0], 12),
      blob(0.05, [1.06, 0.95, 0.62], [0.062, -0.0475, 0.114], [0, 0, 0], 12),
    ]),
    mSkin
  );
  lids.position.y = 0.042;
  lids.scale.y = 0.02;
  lids.castShadow = false;
  eyeRig.add(lids);

  const brows = new THREE.Group();
  brows.position.y = 0.142;
  brows.add(
    toonPart(
      smoothed(
        mergeGeometries([
          blob(0.024, [1.75, 0.5, 0.6], [-0.058, 0, 0.128], [0, 0.2, 0.1], 8),
          blob(0.024, [1.75, 0.5, 0.6], [0.058, 0, 0.128], [0, -0.2, -0.1], 8),
        ])
      ),
      mHair,
      false
    )
  );
  head.add(brows);

  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, 0.032, 0.148);
  head.add(mouthGroup);
  const smileGeo = new THREE.TorusGeometry(0.038, 0.011, 6, 14, Math.PI);
  smileGeo.rotateZ(Math.PI);
  const smileMesh = new THREE.Mesh(smileGeo, mDark);
  smileMesh.castShadow = false;
  mouthGroup.add(smileMesh);
  const mouthMesh = new THREE.Mesh(blob(0.05, [1.0, 1.0, 0.4], [0, -0.012, -0.014], [0, 0, 0], 12), mDark);
  mouthMesh.castShadow = false;
  mouthMesh.scale.y = 0.02;
  mouthGroup.add(mouthMesh);

  // fringe escaping from under the hat
  const fringe: THREE.BufferGeometry[] = [];
  const fr: Array<[number, number, number]> = [
    [-0.088, 0.15, 0.098],
    [-0.032, 0.156, 0.122],
    [0.032, 0.156, 0.122],
    [0.088, 0.15, 0.098],
    [-0.135, 0.128, 0.03],
    [0.135, 0.128, 0.03],
    [0, 0.152, -0.128],
  ];
  for (const [x, y, z] of fr) {
    fringe.push(blob(0.042, [1.15, 0.72, 0.9], [x, y, z], [0, Math.atan2(x, z), 0], 8));
  }
  head.add(toonPart(smoothed(mergeGeometries(fringe)), mHair, 2.0));

  /* ---- bobble hat ---- */
  const hat = new THREE.Group();
  hat.rotation.x = -0.05;
  head.add(hat);
  hat.add(
    toonPart(
      smoothed(
        mergeGeometries([
          lathe(
            [
              [0.112, 0.13],
              [0.146, 0.15],
              [0.158, 0.182],
              [0.153, 0.218],
              [0.134, 0.248],
              [0.098, 0.268],
              [0.052, 0.278],
              [0.001, 0.282],
            ],
            18
          ),
          (() => {
            const g = new THREE.TorusGeometry(0.142, 0.033, 8, 20);
            g.rotateX(Math.PI / 2);
            g.translate(0, 0.19, 0);
            return g;
          })(),
        ])
      ),
      mHat,
      2.4
    )
  );

  /* ---- the knitted tail: the star of every drop ---- */
  const tailAnchor = new THREE.Object3D();
  tailAnchor.position.set(0.02, 0.245, -0.082);
  head.add(tailAnchor);

  const TAIL_SEGS = 3;
  const tailSegs: THREE.Object3D[] = [];
  for (let i = 0; i < TAIL_SEGS; i++) {
    const g = new THREE.Group();
    const w = 1 - i * 0.14;
    g.add(toonPart(plushCapsule(0.03 * w, 0.027 * w, 0.1, 8), mHat, 2.0));
    root.add(g);
    tailSegs.push(g);
  }
  // pom-pom on the end
  tailSegs[TAIL_SEGS - 1].add(
    toonPart(blob(0.052, [1, 0.95, 1], [0, -0.125, 0], [0, 0, 0], 12), mScarf, 2.2)
  );

  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.position.set(0, 0.03, 0.17);
  head.add(mouthAnchor);

  const breath = buildBreath(seed + 17);
  root.add(breath.points);

  /* ---- rest pose: arms down, never a T-pose ---- */
  armL.upper.rotation.set(0.14, 0, 0.22);
  armL.fore.rotation.set(-0.32, 0, 0.08);
  armR.upper.rotation.set(0.14, 0, -0.22);
  armR.fore.rotation.set(-0.32, 0, -0.08);

  return {
    root, body, hips, spine, chest, neck, head,
    legL, legR,
    upperL: armL.upper, upperR: armR.upper,
    foreL: armL.fore, foreR: armR.fore,
    mittenL: armL.mitten, mittenR: armR.mitten,
    coatBody,
    eyeRig, eyeBalls, lids, catchlights, brows, smileMesh, mouthMesh,
    tailAnchor, tailSegs, mouthAnchor, breath,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      for (const d of disposables) d.dispose();
      breath.material.dispose();
    },
  };
}

/* ================================================================== *
 * ONE CHILD
 * ================================================================== */

export interface GrandchildProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  reaction?: GrandchildReaction;
  scale?: number;
  /** 0 or 1 — which of the two looks. */
  which?: 0 | 1;
  /** World point they follow with their eyes. */
  lookAt?: [number, number, number] | null;
  /** Seconds this child lags the group's reaction. Keep the pair different. */
  delay?: number;
  seed?: number;
  breathFog?: boolean;
}

const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _bufSize = new THREE.Vector2();
const TAIL_REST = /* @__PURE__ */ new THREE.Vector3(0.06, -0.72, -0.7).normalize();

/** One child's mutable world: body, rig, hat-tail physics. See ChessPaaStore. */
interface KidStore {
  built: KidBuilt;
  rig: KidRig;
  tail: VerletChain;
  look: THREE.Vector3;
  force: THREE.Vector3;
  poleL: THREE.Vector3;
  poleR: THREE.Vector3;
  dispose(): void;
}

function createKidStore(which: 0 | 1, seed: number, delay: number): KidStore {
  const built = buildKid(GRANDCHILD_LOOKS[which], seed);
  const tail = new VerletChain({
    segments: 3,
    length: 0.3,
    gravity: 5.5,
    damping: 0.95,
    restPull: 5.5,
    maxAngle: 0.8,
  });
  tail.collider = KID_COLLIDER;
  return {
    built,
    rig: new KidRig(seed, delay),
    tail,
    look: new THREE.Vector3(),
    force: new THREE.Vector3(),
    poleL: new THREE.Vector3(-0.62, 0.32, -0.36),
    poleR: new THREE.Vector3(0.62, 0.32, -0.36),
    dispose() {
      built.dispose();
    },
  };
}

/**
 * A single grandchild. Use this to seat one in a coaster car or a Ferris
 * gondola; use `<Grandchildren/>` for the pair.
 *
 * `which`, `seed` and `delay` are read once on mount — pass a `key` to rebuild.
 */
export function Grandchild({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  reaction = "idle",
  scale = 1,
  which = 0,
  lookAt = null,
  delay = 0,
  seed = 7,
  breathFog = true,
}: GrandchildProps) {
  const hostRef = useRef<THREE.Group>(null);
  const storeRef = useRef<KidStore | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = createKidStore(which, seed, delay);
    storeRef.current = s;
    host.add(s.built.root);
    return () => {
      host.remove(s.built.root);
      s.dispose();
      storeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, dtRaw) => {
    const sim = storeRef.current;
    if (!sim) return;
    const dt = Math.min(0.05, dtRaw);
    const t = state.clock.elapsedTime;
    const b = sim.built;
    const root = b.root;
    root.updateWorldMatrix(true, false);

    let look: THREE.Vector3 | null = null;
    if (lookAt) {
      sim.look.set(lookAt[0], lookAt[1], lookAt[2]);
      root.worldToLocal(sim.look);
      look = sim.look;
    }

    const p = sim.rig.update(dt, t, reaction, look);

    /* torso */
    b.body.position.y = p.bob;
    b.body.position.x = p.shiver * Math.sin(t * 38) * 0.005;
    b.hips.rotation.set(p.lean * 0.28, p.twist * 0.35, p.side * 0.5);
    b.spine.rotation.set(p.lean * 0.4, p.twist * 0.3, -p.side * 0.25);
    b.chest.rotation.set(p.lean * 0.32, p.twist * 0.35, p.side * 0.35);
    b.neck.rotation.set(p.lean * 0.12, 0, 0);
    b.head.rotation.set(p.headPitch - p.lean * 0.5, p.headYaw, p.headRoll);

    const cs = p.breathScale;
    b.coatBody.scale.set(1 + (cs - 1) * 0.6, cs, cs);

    // Feet swing. It costs one line and it is the difference between a child
    // and a doll on a stand.
    b.legL.rotation.x = p.legSwing;
    b.legR.rotation.x = -p.legSwing * 0.8;

    /* arms */
    _w.copy(p.handL);
    root.localToWorld(_w);
    _w2.copy(sim.poleL);
    root.localToWorld(_w2);
    solveTwoBoneIK(b.upperL, b.foreL, _w, _w2, {
      upperLength: KID.upperArm,
      lowerLength: KID.foreArm,
      maxExtend: 0.96,
    });

    _w.copy(p.handR);
    root.localToWorld(_w);
    _w2.copy(sim.poleR);
    root.localToWorld(_w2);
    solveTwoBoneIK(b.upperR, b.foreR, _w, _w2, {
      upperLength: KID.upperArm,
      lowerLength: KID.foreArm,
      maxExtend: 0.96,
    });

    // Mittens squash on the clap. Impact without squash reads as a puppet.
    const sq = p.clapHit;
    b.mittenL.scale.set(1 + sq * 0.22, 1 - sq * 0.16, 1 + sq * 0.12);
    b.mittenR.scale.set(1 + sq * 0.22, 1 - sq * 0.16, 1 + sq * 0.12);

    /* face */
    const open = THREE.MathUtils.clamp(p.eyeOpen, 0.05, 1.6);
    b.eyeBalls.scale.set(1 + (open - 1) * 0.2, open, 1);
    b.lids.scale.y = THREE.MathUtils.clamp(1.04 - open, 0.02, 1.2);
    b.catchlights.scale.setScalar(0.7 + p.twinkle * 0.5);
    b.brows.position.y = 0.142 + p.browRaise * 0.026;
    b.brows.rotation.x = -p.browRaise * 0.1;
    b.smileMesh.scale.set(0.6 + p.smile * 0.55, 0.4 + p.smile * 0.8, 1);
    b.mouthMesh.scale.set(0.55 + p.mouthOpen * 0.35, 0.02 + p.mouthOpen * 1.15, 1);

    /* the hat tail */
    b.tailAnchor.getWorldPosition(_w);
    root.worldToLocal(_w);
    b.tailAnchor.getWorldQuaternion(_q);
    root.getWorldQuaternion(_rq);
    _dir.copy(TAIL_REST).applyQuaternion(_q).applyQuaternion(_rq.invert());
    sim.force.copy(parkWind(t, 0.5)).add(p.tailForce);
    sim.tail.step(dt, _w, _dir, sim.force);
    sim.tail.applyToSegments(b.tailSegs);

    /* breath */
    if (breathFog) {
      const u = b.breath.material.uniforms;
      if (p.exhaled) {
        b.mouthAnchor.getWorldPosition(_w);
        root.worldToLocal(_w);
        b.breath.points.position.copy(_w);
        b.mouthAnchor.getWorldQuaternion(_q);
        root.getWorldQuaternion(_rq);
        b.breath.points.quaternion.copy(_rq.invert()).multiply(_q);
      }
      state.gl.getDrawingBufferSize(_bufSize);
      u.uPixelScale.value = _bufSize.y * 0.5;
      u.uAge.value = p.exhaleAge;
      // A short, small puff — a child's lungs, not a grandfather's.
      u.uLife.value = 1.5;
      b.breath.points.visible = p.exhaleAge < 1.5;
    } else {
      b.breath.points.visible = false;
    }
  });

  return <group ref={hostRef} position={position} rotation={rotation} scale={scale} />;
}

/* ================================================================== *
 * THE PAIR
 * ================================================================== */

export interface GrandchildrenProps {
  /** World position of the ground between the two of them. */
  position?: [number, number, number];
  /** Euler XYZ. They face +Z at rotation 0. */
  rotation?: [number, number, number];
  /** The beat they are playing. Transitions are sprung, and one lags. */
  reaction?: GrandchildReaction;
  /** Uniform scale applied to the pair. 1 makes them ~1.05 units tall. */
  scale?: number;
  /** World point they both look at — ChessPaa, the board, the reveal. */
  lookAt?: [number, number, number] | null;
  /** Visible breath in the cold. Default true. */
  breathFog?: boolean;
  seed?: number;
}

/**
 * Two grandchildren, side by side.
 *
 * They are deliberately mismatched: different sizes, different coats, turned
 * slightly toward each other, and the younger one always reacts a beat late.
 */
export default function Grandchildren({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  reaction = "idle",
  scale = 1,
  lookAt = null,
  breathFog = true,
  seed = 7,
}: GrandchildrenProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* the older one: bigger, squarer to the front, reacts first */}
      <Grandchild
        position={[-0.34, 0, 0.05]}
        rotation={[0, 0.14, 0]}
        which={0}
        reaction={reaction}
        lookAt={lookAt}
        breathFog={breathFog}
        delay={0}
        seed={seed}
        scale={1}
      />
      {/* the little one: smaller, turned in toward her sibling, a beat late */}
      <Grandchild
        position={[0.32, 0, -0.03]}
        rotation={[0, -0.2, 0]}
        which={1}
        reaction={reaction}
        lookAt={lookAt}
        breathFog={breathFog}
        delay={0.11}
        seed={seed + 53}
        scale={0.92}
      />
    </group>
  );
}
