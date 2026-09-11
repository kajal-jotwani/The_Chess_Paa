import * as THREE from "three";
import { loadSky } from "../core/Assets";
import { ThemeId } from "../core/WeatherDetect";
import { glow } from "../core/Textures";
import { heightAt } from "./Ground";
import { rnd } from "./Geo";
import { sizedPoints } from "./Details";

interface ThemeSpec {
  sun: { color: number; intensity: number; dir: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  fog: { color: number; near: number; far: number };
  env: number; background: number; exposure: number; bloom: number;
  bulbs: number;          // emissive intensity of ride/lamp bulbs
  lamps: number;          // point-light intensity at night
  wet: number;            // 0..1 wet-ground look
  rain: boolean; fireflies: boolean; sunGlow: number; saturation: number;
  cloud: { color: number; opacity: number };   // tint for the 3D cloud sprites (they're unlit)
}

// Fog is tuned for the hub camera ~200 m from the far attractions: hero buildings
// take <= ~15% haze, the tree-lined rim at 300-450 m fades 45-90% toward the sky.
const SPECS: Record<ThemeId, ThemeSpec> = {
  dawn: { sun: { color: 0xffc9a0, intensity: 2.6, dir: [110, 32, 40] }, hemi: { sky: 0xffd6c8, ground: 0xc9b39a, intensity: 0.45 }, fog: { color: 0xf2d9d0, near: 140, far: 460 }, env: 0.7, background: 1.0, exposure: 1.05, bloom: 0.6, bulbs: 1.6, lamps: 0.6, wet: 0, rain: false, fireflies: false, sunGlow: 1.0, saturation: 0.1, cloud: { color: 0xffd8c0, opacity: 0.45 } },
  day: { sun: { color: 0xffe2bd, intensity: 3.6, dir: [90, 70, 60] }, hemi: { sky: 0xcfe6ff, ground: 0xd9c39a, intensity: 0.4 }, fog: { color: 0xdceeff, near: 160, far: 480 }, env: 0.75, background: 1.0, exposure: 1.12, bloom: 0.55, bulbs: 1.2, lamps: 0.0, wet: 0, rain: false, fireflies: false, sunGlow: 0.9, saturation: 0.12, cloud: { color: 0xffffff, opacity: 0.5 } },
  dusk: { sun: { color: 0xffb36b, intensity: 3.0, dir: [-120, 22, 50] }, hemi: { sky: 0xffc7a8, ground: 0xb08a68, intensity: 0.4 }, fog: { color: 0xf4c9a8, near: 130, far: 450 }, env: 0.7, background: 1.0, exposure: 1.08, bloom: 0.7, bulbs: 2.0, lamps: 1.2, wet: 0, rain: false, fireflies: true, sunGlow: 1.3, saturation: 0.18, cloud: { color: 0xffb890, opacity: 0.45 } },
  night: { sun: { color: 0x9fb8ff, intensity: 0.55, dir: [-60, 80, -40] }, hemi: { sky: 0x2a3c6e, ground: 0x1a1a24, intensity: 0.35 }, fog: { color: 0x0f1630, near: 110, far: 420 }, env: 0.35, background: 1.0, exposure: 1.0, bloom: 1.1, bulbs: 4.0, lamps: 2.6, wet: 0, rain: false, fireflies: true, sunGlow: 0.0, saturation: 0.05, cloud: { color: 0x1c2440, opacity: 0.35 } },
  cloudy: { sun: { color: 0xe8ecf2, intensity: 1.5, dir: [60, 90, 40] }, hemi: { sky: 0xd8dde6, ground: 0xb8b2a6, intensity: 0.55 }, fog: { color: 0xd6dbe2, near: 110, far: 400 }, env: 0.8, background: 1.0, exposure: 1.05, bloom: 0.45, bulbs: 1.6, lamps: 0.5, wet: 0.15, rain: false, fireflies: false, sunGlow: 0.0, saturation: 0.0, cloud: { color: 0xdde2e8, opacity: 0.6 } },
  rain: { sun: { color: 0xd9dfe8, intensity: 1.0, dir: [40, 90, 30] }, hemi: { sky: 0xb9c2cf, ground: 0x8e8f94, intensity: 0.55 }, fog: { color: 0xb7c0cc, near: 90, far: 420 }, env: 0.7, background: 0.95, exposure: 1.0, bloom: 0.5, bulbs: 2.2, lamps: 1.5, wet: 1, rain: true, fireflies: false, sunGlow: 0.0, saturation: -0.05, cloud: { color: 0xb8c0cc, opacity: 0.6 } },
  rain_night: { sun: { color: 0x6f86c2, intensity: 0.3, dir: [-40, 90, -30] }, hemi: { sky: 0x1e2942, ground: 0x111118, intensity: 0.4 }, fog: { color: 0x0b1020, near: 70, far: 380 }, env: 0.3, background: 1.0, exposure: 1.0, bloom: 1.2, bulbs: 4.0, lamps: 2.8, wet: 1, rain: true, fireflies: false, sunGlow: 0.0, saturation: 0.0, cloud: { color: 0x141a2c, opacity: 0.4 } },
};

const LAMP_INTENSITY = 28;   // cd per unit of spec.lamps (physical decay 2, distance 18)
const FIREFLY_COUNT = 80;
const CAMERA_FOV = 50;

export interface AtmosphereHost {
  scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sunGlow: THREE.Sprite; renderer: THREE.WebGLRenderer;
  setBloom(intensity: number): void; setSaturation(v: number): void;
  worldGroup: THREE.Group; wetMaterials: THREE.MeshStandardMaterial[]; lampSpots: THREE.Vector3[]; lampGlowSpots: THREE.Vector3[];
  sky3d: { setTint(hex: number, opacity: number): void };
}

/**
 * Time-of-day and weather.  Swaps the sky dome, re-aims the sun, fades the
 * fog and grading, brightens every bulb at night, lights lamps, releases
 * fireflies, and pours rain from a streak field that follows the camera.
 */
export class Atmosphere {
  current: ThemeId | null = null;
  private bulbMats: THREE.MeshStandardMaterial[] = [];
  private lamps: THREE.PointLight[] = [];
  private lampGlows: THREE.Sprite[] = [];
  private lampGlowTarget = 0;
  private fireflies: THREE.Points;
  private ffGeo = new THREE.BufferGeometry();
  private ffPos = new Float32Array(FIREFLY_COUNT * 3);
  private ffCol = new Float32Array(FIREFLY_COUNT * 3);
  private ffBase = new Float32Array(FIREFLY_COUNT * 3);
  private ffPhase = new Float32Array(FIREFLY_COUNT);
  private ffBaseColor: THREE.Color;
  private rain: THREE.InstancedMesh;
  private rainData: Float32Array;
  private rainOn = false;
  private t = 0;
  private wet = 0;
  private lampTarget = 0;
  private busy = false;
  private queued: ThemeId | null = null;
  /** decoded + prefiltered skies, kept for the session so toggling themes never re-downloads or re-runs PMREM */
  private skies = new Map<ThemeId, { envMap: THREE.Texture; skyMap: THREE.Texture }>();

  constructor(private host: AtmosphereHost) {
    host.worldGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as any).emissive && (m as any).emissive.getHex() !== 0 && !this.bulbMats.includes(m)) this.bulbMats.push(m);
    });
    // The lamps live in the scene permanently at intensity 0: adding/removing point
    // lights changes NUM_POINT_LIGHTS in every lit material and recompiles ~25
    // programs on the main thread (a 240 ms hitch, right in the opening fly-in).
    for (const p of host.lampSpots) {
      const l = new THREE.PointLight(0xffc98a, 0, 18, 2);
      l.position.copy(p);
      this.lamps.push(l);
      host.scene.add(l);
    }
    // cheap additive glow on every lamp post's bulb, lit or not
    const gmat = new THREE.SpriteMaterial({ map: glow("#ffd9a0"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const p of host.lampGlowSpots) {
      const s = new THREE.Sprite(gmat.clone());
      s.scale.set(2.6, 2.6, 1);
      s.position.copy(p);
      s.visible = false;
      host.scene.add(s);
      this.lampGlows.push(s);
    }
    // fireflies: one THREE.Points (was 80 sprites = 80 draw calls, submitted even in daylight at opacity 0)
    const r = rnd(9001);
    const ffSize = new Float32Array(FIREFLY_COUNT);
    const ffColor = new THREE.Color("#d8ff9a");
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const a = r() * Math.PI * 2, d = 10 + r() * 90;
      this.ffBase[i * 3] = Math.cos(a) * d; this.ffBase[i * 3 + 1] = 1 + r() * 3; this.ffBase[i * 3 + 2] = 8 + Math.sin(a) * d * 0.9;
      this.ffPhase[i] = r() * 10;
      ffSize[i] = 0.5 + r() * 0.5;
    }
    this.ffGeo.setAttribute("position", new THREE.BufferAttribute(this.ffPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ffGeo.setAttribute("color", new THREE.BufferAttribute(this.ffCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.ffGeo.setAttribute("aSize", new THREE.BufferAttribute(ffSize, 1));
    this.fireflies = new THREE.Points(this.ffGeo, sizedPoints(glow("#d8ff9a"), CAMERA_FOV, { blending: THREE.AdditiveBlending }));
    this.fireflies.frustumCulled = false; // spans ~100 m; a cached bounding sphere would go stale
    this.fireflies.visible = false;
    this.fireflies.name = "fireflies";
    this.ffBaseColor = ffColor;
    host.scene.add(this.fireflies);
    const streak = new THREE.PlaneGeometry(0.03, 0.9);
    const rmat = new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.0, depthWrite: false });
    this.rain = new THREE.InstancedMesh(streak, rmat, 1800);
    this.rainData = new Float32Array(1800 * 4);
    for (let i = 0; i < 1800; i++) { this.rainData[i * 4] = (r() - 0.5) * 70; this.rainData[i * 4 + 1] = r() * 40; this.rainData[i * 4 + 2] = (r() - 0.5) * 70; this.rainData[i * 4 + 3] = 12 + r() * 6; }
    this.rain.frustumCulled = false; this.rain.visible = false;
    host.scene.add(this.rain);
  }

  /** Register an already-loaded sky (the boot sky) so the first toggle away and back is free. */
  primeSky(theme: ThemeId, sky: { envMap: THREE.Texture; skyMap: THREE.Texture }) { this.skies.set(theme, sky); }

  async apply(theme: ThemeId, skipSky = false) {
    if (this.busy) { this.queued = theme; return; }
    if (theme === this.current) return;
    this.busy = true;
    const h = this.host, spec = SPECS[theme];
    if (!skipSky) try {
      let sky = this.skies.get(theme);
      if (!sky) { sky = await loadSky(h.renderer, theme); this.skies.set(theme, sky); }
      h.scene.background = sky.skyMap; h.scene.environment = sky.envMap;
    } catch (e) { console.warn("sky load failed", e); }
    h.scene.environmentIntensity = spec.env; h.scene.backgroundIntensity = spec.background;
    h.sun.color.setHex(spec.sun.color); h.sun.intensity = spec.sun.intensity;
    (h.sun as any).userData.dir = new THREE.Vector3(...spec.sun.dir);
    h.sun.position.copy(h.sun.target.position).add(new THREE.Vector3(...spec.sun.dir));
    h.hemi.color.setHex(spec.hemi.sky); h.hemi.groundColor.setHex(spec.hemi.ground); h.hemi.intensity = spec.hemi.intensity;
    const fog = h.scene.fog as THREE.Fog; fog.color.setHex(spec.fog.color); fog.near = spec.fog.near; fog.far = spec.fog.far;
    h.renderer.toneMappingExposure = spec.exposure;
    h.setBloom(spec.bloom); h.setSaturation(spec.saturation);
    // bulbs glow on every theme; building windows (userData.window) only light up once the lamps do —
    // dark by day, warm at dawn/dusk/night and under a rainy sky
    for (const m of this.bulbMats) m.emissiveIntensity = m.userData.window ? (spec.lamps > 0 ? spec.bulbs * 0.45 : 0) : spec.bulbs;
    this.lampTarget = spec.lamps; // update() damps every lamp toward it; day simply fades them to 0
    this.lampGlowTarget = spec.lamps > 0 ? Math.min(0.55, 0.2 + 0.1 * spec.lamps) : 0;
    for (const s of this.lampGlows) if (this.lampGlowTarget > 0) s.visible = true;
    h.sunGlow.position.copy(new THREE.Vector3(...spec.sun.dir).normalize().multiplyScalar(420));
    (h.sunGlow.material as THREE.SpriteMaterial).opacity = spec.sunGlow * 0.9;
    h.sunGlow.visible = spec.sunGlow > 0;
    h.sky3d.setTint(spec.cloud.color, spec.cloud.opacity);
    this.wet = spec.wet;
    for (const m of h.wetMaterials) { m.roughness = 1 - 0.6 * spec.wet; m.envMapIntensity = 0.6 + 1.2 * spec.wet; }
    this.rainOn = spec.rain; this.rain.visible = spec.rain;
    (this.rain.material as THREE.MeshBasicMaterial).opacity = spec.rain ? 0.5 : 0;
    this.fireflies.visible = spec.fireflies;
    this.current = theme;
    this.busy = false;
    if (this.queued && this.queued !== theme) { const q = this.queued; this.queued = null; this.apply(q); }
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    for (const l of this.lamps) l.intensity = THREE.MathUtils.damp(l.intensity, this.lampTarget * LAMP_INTENSITY, 2, dt);
    for (const s of this.lampGlows) {
      const m = s.material as THREE.SpriteMaterial;
      if (!s.visible) continue;
      m.opacity = THREE.MathUtils.damp(m.opacity, this.lampGlowTarget, 2, dt);
      if (this.lampGlowTarget === 0 && m.opacity < 0.01) { m.opacity = 0; s.visible = false; }
    }
    if (this.fireflies.visible) {
      const c = this.ffBaseColor;
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const ph = this.ffPhase[i];
        this.ffPos[i * 3] = this.ffBase[i * 3] + Math.sin(this.t * 0.7 + ph) * 2.5;
        this.ffPos[i * 3 + 1] = this.ffBase[i * 3 + 1] + Math.sin(this.t * 1.1 + ph * 2) * 0.8;
        this.ffPos[i * 3 + 2] = this.ffBase[i * 3 + 2] + Math.cos(this.t * 0.5 + ph) * 2.5;
        const a = 0.85 * (0.35 + 0.5 * Math.max(0, Math.sin(this.t * 2.2 + ph * 3)));
        this.ffCol[i * 3] = c.r * a; this.ffCol[i * 3 + 1] = c.g * a; this.ffCol[i * 3 + 2] = c.b * a;
      }
      (this.ffGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.ffGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.rainOn) {
      const cp = camera.position;
      const m = new THREE.Matrix4();
      for (let i = 0; i < 1800; i++) {
        let y = this.rainData[i * 4 + 1] - this.rainData[i * 4 + 3] * dt;
        if (y < -2) y += 42;
        this.rainData[i * 4 + 1] = y;
        const x = cp.x + this.rainData[i * 4], z = cp.z + this.rainData[i * 4 + 2];
        const gy = heightAt(x, z);
        m.setPosition(x, Math.max(gy, cp.y - 10 + y), z);
        this.rain.setMatrixAt(i, m);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
  }
}
