import * as THREE from "three";
import { loadSky } from "../core/Assets";
import { ThemeId } from "../core/WeatherDetect";
import { glow } from "../core/Textures";
import { heightAt } from "./Ground";
import { rnd } from "./Geo";

interface ThemeSpec {
  sun: { color: number; intensity: number; dir: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  fog: { color: number; near: number; far: number };
  env: number; background: number; exposure: number; bloom: number;
  bulbs: number;          // emissive intensity of ride/lamp bulbs
  lamps: number;          // point-light intensity at night
  wet: number;            // 0..1 wet-ground look
  rain: boolean; fireflies: boolean; sunGlow: number; saturation: number;
}

const SPECS: Record<ThemeId, ThemeSpec> = {
  dawn: { sun: { color: 0xffc9a0, intensity: 2.6, dir: [110, 32, 40] }, hemi: { sky: 0xffd6c8, ground: 0xc9b39a, intensity: 0.45 }, fog: { color: 0xf2d9d0, near: 200, far: 640 }, env: 0.7, background: 1.0, exposure: 1.05, bloom: 0.6, bulbs: 1.6, lamps: 0.6, wet: 0, rain: false, fireflies: false, sunGlow: 1.0, saturation: 0.1 },
  day: { sun: { color: 0xffe2bd, intensity: 3.6, dir: [90, 70, 60] }, hemi: { sky: 0xcfe6ff, ground: 0xd9c39a, intensity: 0.4 }, fog: { color: 0xdceeff, near: 220, far: 620 }, env: 0.75, background: 1.0, exposure: 1.12, bloom: 0.55, bulbs: 1.2, lamps: 0.0, wet: 0, rain: false, fireflies: false, sunGlow: 0.9, saturation: 0.12 },
  dusk: { sun: { color: 0xffb36b, intensity: 3.0, dir: [-120, 22, 50] }, hemi: { sky: 0xffc7a8, ground: 0xb08a68, intensity: 0.4 }, fog: { color: 0xf4c9a8, near: 180, far: 600 }, env: 0.7, background: 1.0, exposure: 1.08, bloom: 0.7, bulbs: 2.0, lamps: 1.2, wet: 0, rain: false, fireflies: true, sunGlow: 1.3, saturation: 0.18 },
  night: { sun: { color: 0x9fb8ff, intensity: 0.55, dir: [-60, 80, -40] }, hemi: { sky: 0x2a3c6e, ground: 0x1a1a24, intensity: 0.35 }, fog: { color: 0x0f1630, near: 120, far: 520 }, env: 0.35, background: 1.0, exposure: 1.0, bloom: 1.1, bulbs: 4.0, lamps: 3.5, wet: 0, rain: false, fireflies: true, sunGlow: 0.0, saturation: 0.05 },
  cloudy: { sun: { color: 0xe8ecf2, intensity: 1.5, dir: [60, 90, 40] }, hemi: { sky: 0xd8dde6, ground: 0xb8b2a6, intensity: 0.55 }, fog: { color: 0xd6dbe2, near: 160, far: 560 }, env: 0.8, background: 1.0, exposure: 1.05, bloom: 0.45, bulbs: 1.6, lamps: 0.5, wet: 0.15, rain: false, fireflies: false, sunGlow: 0.0, saturation: 0.0 },
  rain: { sun: { color: 0xd9dfe8, intensity: 1.0, dir: [40, 90, 30] }, hemi: { sky: 0xb9c2cf, ground: 0x8e8f94, intensity: 0.55 }, fog: { color: 0xb7c0cc, near: 90, far: 420 }, env: 0.7, background: 0.95, exposure: 1.0, bloom: 0.5, bulbs: 2.2, lamps: 1.5, wet: 1, rain: true, fireflies: false, sunGlow: 0.0, saturation: -0.05 },
  rain_night: { sun: { color: 0x6f86c2, intensity: 0.3, dir: [-40, 90, -30] }, hemi: { sky: 0x1e2942, ground: 0x111118, intensity: 0.4 }, fog: { color: 0x0b1020, near: 70, far: 380 }, env: 0.3, background: 1.0, exposure: 1.0, bloom: 1.2, bulbs: 4.0, lamps: 3.8, wet: 1, rain: true, fireflies: false, sunGlow: 0.0, saturation: 0.0 },
};

export interface AtmosphereHost {
  scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sunGlow: THREE.Sprite; renderer: THREE.WebGLRenderer;
  setBloom(intensity: number): void; setSaturation(v: number): void;
  worldGroup: THREE.Group; wetMaterials: THREE.MeshStandardMaterial[]; lampSpots: THREE.Vector3[];
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
  private fireflies: THREE.Sprite[] = [];
  private rain: THREE.InstancedMesh;
  private rainData: Float32Array;
  private rainOn = false;
  private t = 0;
  private wet = 0;
  private lampTarget = 0;
  private busy = false;
  private queued: ThemeId | null = null;

  constructor(private host: AtmosphereHost) {
    host.worldGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as any).emissive && (m as any).emissive.getHex() !== 0 && !this.bulbMats.includes(m)) this.bulbMats.push(m);
    });
    for (const p of host.lampSpots) {
      const l = new THREE.PointLight(0xffd08a, 0, 24, 1.5);
      l.position.copy(p);
      this.lamps.push(l);
    }
    const fmat = new THREE.SpriteMaterial({ map: glow("#d8ff9a"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const r = rnd(9001);
    for (let i = 0; i < 80; i++) {
      const s = new THREE.Sprite(fmat.clone());
      const a = r() * Math.PI * 2, d = 10 + r() * 90;
      s.position.set(Math.cos(a) * d, 1 + r() * 3, 8 + Math.sin(a) * d * 0.9);
      s.userData.base = s.position.clone(); s.userData.phase = r() * 10;
      s.scale.setScalar(0.5 + r() * 0.5);
      this.fireflies.push(s); host.scene.add(s);
    }
    const streak = new THREE.PlaneGeometry(0.03, 0.9);
    const rmat = new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.0, depthWrite: false });
    this.rain = new THREE.InstancedMesh(streak, rmat, 1800);
    this.rainData = new Float32Array(1800 * 4);
    for (let i = 0; i < 1800; i++) { this.rainData[i * 4] = (r() - 0.5) * 70; this.rainData[i * 4 + 1] = r() * 40; this.rainData[i * 4 + 2] = (r() - 0.5) * 70; this.rainData[i * 4 + 3] = 12 + r() * 6; }
    this.rain.frustumCulled = false; this.rain.visible = false;
    host.scene.add(this.rain);
  }

  async apply(theme: ThemeId, skipSky = false) {
    if (this.busy) { this.queued = theme; return; }
    if (theme === this.current) return;
    this.busy = true;
    const h = this.host, spec = SPECS[theme];
    if (!skipSky) try {
      const sky = await loadSky(h.renderer, theme);
      const oldBg = h.scene.background as THREE.Texture | null, oldEnv = h.scene.environment;
      h.scene.background = sky.skyMap; h.scene.environment = sky.envMap;
      if (oldBg && oldBg !== sky.skyMap) oldBg.dispose();
      if (oldEnv && oldEnv !== sky.envMap) oldEnv.dispose();
    } catch (e) { console.warn("sky load failed", e); }
    h.scene.environmentIntensity = spec.env; h.scene.backgroundIntensity = spec.background;
    h.sun.color.setHex(spec.sun.color); h.sun.intensity = spec.sun.intensity;
    (h.sun as any).userData.dir = new THREE.Vector3(...spec.sun.dir);
    h.sun.position.copy(h.sun.target.position).add(new THREE.Vector3(...spec.sun.dir));
    h.hemi.color.setHex(spec.hemi.sky); h.hemi.groundColor.setHex(spec.hemi.ground); h.hemi.intensity = spec.hemi.intensity;
    const fog = h.scene.fog as THREE.Fog; fog.color.setHex(spec.fog.color); fog.near = spec.fog.near; fog.far = spec.fog.far;
    h.renderer.toneMappingExposure = spec.exposure;
    h.setBloom(spec.bloom); h.setSaturation(spec.saturation);
    for (const m of this.bulbMats) m.emissiveIntensity = spec.bulbs;
    this.lampTarget = spec.lamps;
    for (const l of this.lamps) { if (spec.lamps > 0 && !l.parent) h.scene.add(l); else if (spec.lamps === 0 && l.parent) { h.scene.remove(l); l.intensity = 0; } }
    h.sunGlow.position.copy(new THREE.Vector3(...spec.sun.dir).normalize().multiplyScalar(420));
    (h.sunGlow.material as THREE.SpriteMaterial).opacity = spec.sunGlow * 0.9;
    this.wet = spec.wet;
    for (const m of h.wetMaterials) { m.roughness = 1 - 0.6 * spec.wet; m.envMapIntensity = 0.6 + 1.2 * spec.wet; }
    this.rainOn = spec.rain; this.rain.visible = spec.rain;
    (this.rain.material as THREE.MeshBasicMaterial).opacity = spec.rain ? 0.5 : 0;
    for (const f of this.fireflies) (f.material as THREE.SpriteMaterial).opacity = spec.fireflies ? 0.85 : 0;
    this.current = theme;
    this.busy = false;
    if (this.queued && this.queued !== theme) { const q = this.queued; this.queued = null; this.apply(q); }
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    for (const l of this.lamps) l.intensity = THREE.MathUtils.damp(l.intensity, this.lampTarget * 60, 2, dt);
    if (this.fireflies.length && (this.fireflies[0].material as THREE.SpriteMaterial).opacity > 0) {
      for (const f of this.fireflies) {
        const b = f.userData.base as THREE.Vector3, ph = f.userData.phase as number;
        f.position.set(b.x + Math.sin(this.t * 0.7 + ph) * 2.5, b.y + Math.sin(this.t * 1.1 + ph * 2) * 0.8, b.z + Math.cos(this.t * 0.5 + ph) * 2.5);
        (f.material as THREE.SpriteMaterial).opacity = 0.35 + 0.5 * Math.max(0, Math.sin(this.t * 2.2 + ph * 3));
      }
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
