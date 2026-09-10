declare module "n8ao" {
  import { Pass } from "postprocessing";
  import * as THREE from "three";
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; aoSamples: number; denoiseSamples: number; denoiseRadius: number;
      halfRes: boolean; screenSpaceRadius: boolean; gammaCorrection: boolean; color: THREE.Color; depthAwareUpsampling: boolean; transparencyAware: boolean;
      accumulate: boolean; biasOffset: number; biasMultiplier: number; renderMode: number; logarithmicDepthBuffer: boolean;
    };
    setSize(width: number, height: number): void;
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
  }
}
