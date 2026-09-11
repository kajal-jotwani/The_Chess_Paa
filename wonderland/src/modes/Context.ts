import * as THREE from "three";
import { Renderer } from "../core/Renderer";
import { World } from "../world/World";
import { CameraRig } from "../app/CameraRig";
import { UI, Progress } from "../ui/UI";
import { Sound } from "../audio/Sound";
import { Engine } from "../chess/Engine";
import { Board3D } from "../chess/Board3D";
import { BoardSession } from "./BoardSession";
import { AttractionId } from "../world/Layout";

export interface ModeContext {
  r: Renderer;
  world: World;
  rig: CameraRig;
  ui: UI;
  sound: Sound;
  engine: Engine;
  progress: Progress;
  boards: Record<AttractionId, Board3D>;
  session: (id: AttractionId) => BoardSession;
  /** leave the current mode and go back to the park (or the ride, if we came from it) */
  exit: () => void;
  base: string;
}

export interface Mode {
  enter(): Promise<void> | void;
  exit(): void;
  update?(dt: number, t: number): void;
}

export const wait = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
export const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
