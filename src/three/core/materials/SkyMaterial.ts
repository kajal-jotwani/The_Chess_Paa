"use client";

import * as THREE from "three";
import { PALETTE } from "../palette";

/**
 * THE SKY — the one deliberate exception to hard banding.
 *
 * Everything else in the park is stepped; here we PAINT. A smooth vertical
 * wash, lavender at the crown grading down to peach at the horizon.
 *
 * The tension between the sharp-stepped world and this soft-washed sky is
 * exactly what makes the world read as painted foreground against a
 * watercolour backdrop. Do not band this.
 */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(PALETTE.skyTop) },
      uMid: { value: new THREE.Color(PALETTE.skyMid) },
      uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      /** Drifts slowly deeper into dusk over a session. 0 = golden, 1 = late. */
      uDusk: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon;
      uniform float uDusk, uTime;
      varying vec3 vWorld;

      // cheap hash noise for the faintest painterly break-up
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main() {
        vec3 dir = normalize(vWorld);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

        // Two-stop wash: horizon → mid → crown, with a soft shoulder so the
        // peach sits low and wide the way a real golden hour does.
        float lowT  = smoothstep(0.42, 0.58, h);
        float highT = smoothstep(0.55, 0.9,  h);
        vec3 col = mix(uHorizon, uMid, lowT);
        col = mix(col, uTop, highT);

        // As the session drifts later, the whole sky cools and deepens.
        col = mix(col, col * vec3(0.72, 0.66, 0.86), uDusk * 0.55);

        // a warm bloom sitting right on the horizon where the sun just went
        float sun = pow(clamp(1.0 - abs(h - 0.47) * 6.0, 0.0, 1.0), 2.2);
        col += vec3(0.34, 0.19, 0.06) * sun * (1.0 - uDusk * 0.5);

        // barely-there grain so the gradient never reads as a CSS ramp
        col += (hash(dir.xz * 240.0) - 0.5) * 0.012;

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * HARD-EDGED CEL CLOUDS.
 * Two layers drifting at different parallax speeds. Deliberately hard-edged
 * so they read as cut paper against the painted wash.
 */
export function createCloudMaterial(seedOffset = 0, tint = 0xf6dcc4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(tint) },
      uSeed: { value: seedOffset },
      uSpeed: { value: 0.004 + seedOffset * 0.003 },
      uOpacity: { value: 0.34 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSeed, uSpeed, uOpacity;
      uniform vec3 uTint;
      varying vec2 vUv;

      float hash(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        uv.x += uTime * uSpeed + uSeed * 13.7;
        float n = fbm(uv * vec2(3.2, 6.0) + uSeed * 4.0);

        // HARD edge — this is the cel language, not a soft volumetric puff.
        float mask = step(0.62, n);
        // a second, tighter step gives the cloud a lit top edge
        float lit  = step(0.66, n);
        if (mask < 0.5) discard;

        // fade the cloud bank out at the top and bottom of its band
        float band = smoothstep(0.05, 0.46, vUv.y) * (1.0 - smoothstep(0.52, 0.95, vUv.y));

        vec3 col = mix(uTint * 0.94, uTint * 1.06, lit);
        gl_FragColor = vec4(col, uOpacity * band);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * BANDED FOG — depth is STEPPED, not continuous.
 *
 * This is what makes the wide reveal from the top of the coaster look like a
 * painted matte: the river's far bends and the tree line stack as flat paper
 * cards receding into honey haze.
 *
 * Applied by patching any material's fog with a quantised distance.
 */
export const BANDED_FOG_BANDS = 5;

export function patchMaterialForBandedFog(mat: THREE.Material, bands = BANDED_FOG_BANDS) {
  const prev = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      /* glsl */ `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float _fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float _fogF = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        // QUANTISE the fog into hard layers so distance stacks as paper cards.
        float _bands = ${bands.toFixed(1)};
        float _q = floor(_fogF * _bands + 0.5) / _bands;
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, _q );
      #endif
      `
    );
  };
  mat.needsUpdate = true;
}
