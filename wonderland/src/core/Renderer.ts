import * as THREE from "three";
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, VignetteEffect, BlendFunction, KernelSize, SMAAPreset, HueSaturationEffect, BrightnessContrastEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";

export type Quality = "low" | "medium" | "high";

/**
 * WebGL renderer + post-processing stack with three quality tiers so the park
 * stays smooth on a laptop.  The adaptive governor drops a tier when the frame
 * rate sags for a few seconds.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  quality: Quality;
  private aoPass: N8AOPostPass | null = null;
  private bloom: BloomEffect | null = null;
  private hueSat: HueSaturationEffect | null = null;
  private bloomIntensity = 0.55;
  private saturation = 0.12;
  private fpsSamples: number[] = [];
  private governorLocked = false;
  private frame = 0;
  /**
   * Re-render the 2048² shadow map every N frames.  Almost every caster is
   * static scenery, so the hub gets away with 2 (halves ~446 shadow draws per
   * frame on average); views that ride a moving caster set 1.
   */
  shadowEveryN = 2;
  onQualityChange?: (q: Quality) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoftShadowMap (it warned and fell back to this every shadow pass)
    this.renderer.shadowMap.autoUpdate = false; // render() decides when the map refreshes (see shadowEveryN)
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
    const saved = localStorage.getItem("cw.quality") as Quality | null;
    this.quality = saved ?? (navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 8 ? "medium" : "medium");
    if (saved) this.governorLocked = true;
    this.buildComposer();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private pixelRatioFor(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    if (q === "high") return Math.min(dpr, 2);
    if (q === "medium") return Math.min(dpr, 1.25);
    return 1;
  }

  private buildComposer() {
    if (this.composer) this.composer.dispose();
    const q = this.quality;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    this.bloom = null;
    if (q !== "low") {
      const size = this.renderer.getSize(new THREE.Vector2());
      const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
      // Keep n8ao from auto-enabling its transparency-aware path: the scene holds ~300
      // transparent objects (signs, water, sprites, board decals) and that path re-renders
      // every one of them twice per frame (+279 draws, two extra scene traversals) for an
      // AO nuance that is invisible here (measured 0.01% differing pixels).  Assigning
      // configuration.transparencyAware = false is a no-op (same value → proxy ignores it),
      // so the auto-detect flag itself must be cleared.  Opt individual objects in with
      // userData.treatAsOpaque if one ever needs it.
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      ao.configuration.aoRadius = 2.5;
      ao.configuration.distanceFalloff = 2.0;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = q === "medium";
      ao.configuration.screenSpaceRadius = false;
      ao.configuration.gammaCorrection = false;
      ao.configuration.denoiseRadius = 8;
      ao.configuration.denoiseSamples = 4;
      ao.configuration.aoSamples = q === "high" ? 16 : 8;
      this.composer.addPass(ao);
      this.aoPass = ao;
    }
    const effects: any[] = [];
    if (q !== "low") {
      this.bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, intensity: this.bloomIntensity, radius: 0.6, kernelSize: KernelSize.MEDIUM });
      effects.push(this.bloom);
    }
    this.hueSat = new HueSaturationEffect({ saturation: this.saturation });
    effects.push(this.hueSat);
    effects.push(new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.07 }));
    effects.push(new VignetteEffect({ eskil: false, offset: 0.35, darkness: 0.26 }));
    effects.push(new SMAAEffect({ preset: q === "high" ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    this.renderer.setPixelRatio(this.pixelRatioFor(q));
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Force the shadow map to redraw on the next render (e.g. right after a shadow refocus). */
  requestShadowUpdate() { this.renderer.shadowMap.needsUpdate = true; }

  setBloom(intensity: number) { this.bloomIntensity = intensity; if (this.bloom) this.bloom.intensity = intensity; }
  setSaturation(v: number) { this.saturation = v; if (this.hueSat) this.hueSat.saturation = v; }

  setQuality(q: Quality, lock = true) {
    if (q === this.quality) return;
    this.quality = q;
    if (lock) { localStorage.setItem("cw.quality", q); this.governorLocked = true; }
    this.buildComposer();
    this.resize();
    this.onQualityChange?.(q);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  private lastW = 0; private lastH = 0;

  /** Call once per frame. Returns the (clamped) frame delta in seconds. */
  render(dt: number) {
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 2 || h < 2) return; // pane not laid out yet — nothing sensible to draw
    if (w !== this.lastW || h !== this.lastH) { this.lastW = w; this.lastH = h; this.resize(); }
    if (this.shadowEveryN <= 1 || this.frame++ % this.shadowEveryN === 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    if (!this.governorLocked) this.govern(dt);
  }

  private govern(dt: number) {
    if (dt <= 0 || dt > 0.5) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length < 180) return; // ~3 s of frames
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    if (avg < 34 && this.quality !== "low") {
      this.setQuality(this.quality === "high" ? "medium" : "low", false);
    } else if (avg > 58 && this.quality === "low") {
      this.setQuality("medium", false);
    }
  }
}
