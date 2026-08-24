"use client";

import * as THREE from "three";
import { Effect, BlendFunction } from "postprocessing";
import { PALETTE } from "../palette";

/**
 * INTERIOR LINES — the second of our two line systems.
 *
 * The inverted hull draws silhouettes. It cannot draw the lines INSIDE a
 * form: the fold of ChessPaa's coat, the seam of a plank, the crease of a
 * smile. Those come from here — a screen-space Sobel filter run over the
 * scene's normal and depth, tuned to find interior discontinuities only.
 *
 * The two systems must COOPERATE, not double up into muddy doubled strokes:
 * we bias this pass toward normal-discontinuities (creases) and keep the
 * depth term weak, because depth edges are exactly what the hull already ate.
 */
const SOBEL_FRAG = /* glsl */ `
uniform sampler2D uNormalDepth;
uniform vec3  uInk;
uniform float uNormalStrength;
uniform float uDepthStrength;
uniform float uThreshold;
uniform vec2  uTexel;
uniform float uFalloff;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // 3x3 Sobel over the packed normal (rgb) and depth (a).
  vec3 n[9];
  float d[9];
  int k = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * uTexel;
      vec4 s = texture2D(uNormalDepth, uv + o);
      n[k] = s.rgb * 2.0 - 1.0;
      d[k] = s.a;
      k++;
    }
  }

  // normal gradient — this is where creases and folds live
  vec3 gxN = (n[2] + 2.0 * n[5] + n[8]) - (n[0] + 2.0 * n[3] + n[6]);
  vec3 gyN = (n[6] + 2.0 * n[7] + n[8]) - (n[0] + 2.0 * n[1] + n[2]);
  float edgeN = length(gxN) + length(gyN);

  // depth gradient — kept weak; the inverted hull already owns silhouettes
  float gxD = (d[2] + 2.0 * d[5] + d[8]) - (d[0] + 2.0 * d[3] + d[6]);
  float gyD = (d[6] + 2.0 * d[7] + d[8]) - (d[0] + 2.0 * d[1] + d[2]);
  float edgeD = abs(gxD) + abs(gyD);

  float e = edgeN * uNormalStrength + edgeD * uDepthStrength;
  e = smoothstep(uThreshold, uThreshold + 0.35, e);

  // Fade interior ink with distance so the far haze stays soft and papery.
  float depth = d[4];
  e *= 1.0 - smoothstep(uFalloff, 1.0, depth);

  outputColor = vec4(mix(inputColor.rgb, uInk, e), inputColor.a);
}
`;

export class SobelInkEffect extends Effect {
  constructor(normalDepthTarget: THREE.WebGLRenderTarget, opts: {
    ink?: number; normalStrength?: number; depthStrength?: number;
    threshold?: number; falloff?: number;
  } = {}) {
    super("SobelInkEffect", SOBEL_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["uNormalDepth", new THREE.Uniform(normalDepthTarget.texture)],
        ["uInk", new THREE.Uniform(new THREE.Color(opts.ink ?? PALETTE.ink))],
        ["uNormalStrength", new THREE.Uniform(opts.normalStrength ?? 0.9)],
        ["uDepthStrength", new THREE.Uniform(opts.depthStrength ?? 0.35)],
        ["uThreshold", new THREE.Uniform(opts.threshold ?? 0.42)],
        ["uFalloff", new THREE.Uniform(opts.falloff ?? 0.86)],
        ["uTexel", new THREE.Uniform(new THREE.Vector2(1 / 1920, 1 / 1080))],
      ]),
    });
  }

  setSize(w: number, h: number) {
    const u = this.uniforms.get("uTexel");
    if (u) (u.value as THREE.Vector2).set(1 / w, 1 / h);
  }
}

/**
 * THE FINAL GRADE — our code-generated LUT, applied as the last post step.
 * Warm and cozy: ambers lifted, plums deepened, every scene unified into one
 * storybook page.
 */
const LUT_FRAG = /* glsl */ `
uniform sampler3D uLut;
uniform float uAmount;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  // pull the LUT slightly inside its edges to avoid clamp artefacts
  vec3 scaled = c * (15.0 / 16.0) + (0.5 / 16.0);
  vec3 graded = texture(uLut, scaled).rgb;
  outputColor = vec4(mix(inputColor.rgb, graded, uAmount), inputColor.a);
}
`;

export class WarmLUTEffect extends Effect {
  constructor(lut: THREE.Data3DTexture, amount = 1.0) {
    super("WarmLUTEffect", LUT_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["uLut", new THREE.Uniform(lut)],
        ["uAmount", new THREE.Uniform(amount)],
      ]),
    });
  }
}

/**
 * Layer 2 is the "no-ink" layer: anything on it is skipped by the normal+depth
 * prepass, so the Sobel never draws interior lines on it. Particles, glows,
 * sprites and the sky all live here — inking a firefly turns it into a black
 * square, which is exactly the defect this layer exists to prevent.
 */
export const NO_INK_LAYER = 2;

/**
 * The normal+depth prepass material. Renders world normals into rgb and
 * linear view depth into a, for the Sobel pass to read.
 */
export function createNormalDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    fog: false,
    uniforms: {
      uNear: { value: 0.1 },
      uFar: { value: 400 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying float vDepth;
      uniform float uNear, uFar;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = clamp((-mv.z - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying float vDepth;
      void main() {
        gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, vDepth);
      }
    `,
  });
}
