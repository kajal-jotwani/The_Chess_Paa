"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { Grandchild } from "../characters/Grandchildren";
import { terrainHeight } from "../world/terrain";
import { director, input, resolveCollisions, STATIONS, stationFor } from "./gameState";
import { STOP_T, stopFrame } from "../world/coasterSpine";

/**
 * THE PLAYER IS A CHILD IN THE PARK.
 *
 * Third person, because a kid wants to SEE themselves in the wonderland —
 * bobble hat, mittens and all. The rig does three jobs every frame:
 *
 *   1. move the kid: camera-relative walk, clamped to the terrain, sliding
 *      around the round colliders so nothing ever traps them
 *   2. follow with the camera: a soft orbit that drifts in behind the
 *      direction of travel when the child isn't steering it
 *   3. offer doors: when the kid is near a station platform or the gate
 *      train, surface a prompt; the interact press walks through it
 *
 * Movement feel targets a small child's hands: generous acceleration, no
 * momentum puzzles, no fall damage, nothing to fail.
 */

const WALK_SPEED = 5.2;
const ACCEL = 14;
const CAM_MIN = 3.6, CAM_MAX = 12, CAM_START = 7.2;

/** Where a station's walk-up prompt lives (platform side of the track). */
function stationDoor(stop: keyof typeof STOP_T): THREE.Vector3 {
  const f = stopFrame(stop);
  return new THREE.Vector3(
    f.pos.x + f.binormal.x * 2.4,
    f.pos.y,
    f.pos.z + f.binormal.z * 2.4
  );
}

export default function PlayerRig() {
  const { camera, gl } = useThree();
  const kidRef = useRef<THREE.Group>(null);

  // camera orbit state
  const yaw = useRef(Math.PI + 0.3);
  const pitch = useRef(0.38);
  const dist = useRef(CAM_START);
  const vel = useRef(new THREE.Vector3());
  const camPos = useRef(new THREE.Vector3());
  const lookTmp = useRef(new THREE.Vector2());
  const moving = useRef(false);
  const lastSteer = useRef(0);

  const doors = useMemo(
    () =>
      STATIONS.map((s) => ({
        station: s,
        pos: stationDoor(s.stop),
      })),
    []
  );

  /* ---- keyboard (desktop) ---- */
  useEffect(() => {
    const down = new Set<string>();
    const apply = () => {
      const x = (down.has("d") || down.has("arrowright") ? 1 : 0) - (down.has("a") || down.has("arrowleft") ? 1 : 0);
      const y = (down.has("w") || down.has("arrowup") ? 1 : 0) - (down.has("s") || down.has("arrowdown") ? 1 : 0);
      input.move.set(x, y);
    };
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        down.add(k); apply(); director.cancelCine();
      }
      if (k === "e" || k === "enter") { input.interact = true; director.cancelCine(); }
    };
    const onUp = (e: KeyboardEvent) => { down.delete(e.key.toLowerCase()); apply(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  /* ---- mouse-drag look on the canvas (touch handled by the HUD stick) ---- */
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false, lx = 0, ly = 0;
    const downH = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // HUD owns touch
      dragging = true; lx = e.clientX; ly = e.clientY;
      director.cancelCine();
    };
    const moveH = (e: PointerEvent) => {
      if (!dragging || e.pointerType === "touch") return;
      input.look.x += e.clientX - lx;
      input.look.y += e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
    };
    const upH = () => { dragging = false; };
    const wheelH = (e: WheelEvent) => { input.zoomDelta += e.deltaY * 0.01; director.cancelCine(); };
    el.addEventListener("pointerdown", downH);
    window.addEventListener("pointermove", moveH);
    window.addEventListener("pointerup", upH);
    el.addEventListener("wheel", wheelH, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", downH);
      window.removeEventListener("pointermove", moveH);
      window.removeEventListener("pointerup", upH);
      el.removeEventListener("wheel", wheelH);
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const active = director.mode === "explore";
    const kid = kidRef.current;
    if (!kid) return;
    kid.visible = director.mode !== "riding" && director.mode !== "lesson";
    if (!active) return;

    /* ---- steer the camera ---- */
    const look = input.consumeLook(lookTmp.current);
    if (look.lengthSq() > 0) {
      yaw.current -= look.x * 0.0052;
      pitch.current = THREE.MathUtils.clamp(pitch.current + look.y * 0.0038, 0.12, 0.95);
      lastSteer.current = 0;
    } else {
      lastSteer.current += dt;
    }
    dist.current = THREE.MathUtils.clamp(dist.current + input.consumeZoom(), CAM_MIN, CAM_MAX);

    /* ---- move the kid, camera-relative ---- */
    const mv = input.move;
    const wish = new THREE.Vector3();
    if (mv.lengthSq() > 0.001) {
      const sin = Math.sin(yaw.current), cos = Math.cos(yaw.current);
      // forward = away from the camera
      wish.set(-sin * mv.y + cos * mv.x, 0, -cos * mv.y - sin * mv.x);
      wish.normalize().multiplyScalar(WALK_SPEED * Math.min(1, mv.length()));
    }
    vel.current.lerp(wish, 1 - Math.exp(-dt * ACCEL));
    moving.current = vel.current.lengthSq() > 0.4;

    const p = director.playerPos;
    p.x += vel.current.x * dt;
    p.z += vel.current.z * dt;
    resolveCollisions(p);
    p.y = terrainHeight(p.x, p.z);

    if (moving.current) {
      const face = Math.atan2(vel.current.x, vel.current.z);
      let d = face - director.playerYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      director.playerYaw += d * Math.min(1, dt * 10);
      // the camera drifts in behind travel once the child stops steering it
      if (lastSteer.current > 1.2) {
        let cd = face + Math.PI - yaw.current;
        while (cd > Math.PI) cd -= Math.PI * 2;
        while (cd < -Math.PI) cd += Math.PI * 2;
        yaw.current += cd * Math.min(1, dt * 0.9);
      }
    }

    /* ---- pose the kid (walk bob lives on the group; the rig idles inside) ---- */
    kid.position.set(p.x, p.y, p.z);
    kid.rotation.set(0, director.playerYaw, 0);
    const t = performance.now() / 1000;
    if (moving.current) {
      const step = Math.sin(t * 9.4);
      kid.position.y = p.y + Math.abs(step) * 0.085;
      kid.rotation.z = Math.sin(t * 4.7) * 0.045;
      kid.rotation.x = 0.06;
    } else {
      kid.rotation.z = 0;
      kid.rotation.x = 0;
    }

    /* ---- third-person camera ---- */
    const cp = Math.cos(pitch.current), sp = Math.sin(pitch.current);
    const desired = new THREE.Vector3(
      p.x + Math.sin(yaw.current) * cp * dist.current,
      p.y + 1.3 + sp * dist.current,
      p.z + Math.cos(yaw.current) * cp * dist.current
    );
    // never let the camera sink under the snow
    desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 0.6);
    camPos.current.lerp(desired, 1 - Math.exp(-dt * 7));
    camera.position.copy(camPos.current);
    camera.lookAt(p.x, p.y + 1.35, p.z);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov += (52 - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();

    /* ---- doors: the gate train + the station lessons ---- */
    let best: { id: string; label: string; icon: string } | null = null;
    const gate = stationDoor("gate");
    if (p.distanceTo(gate) < 6.5) {
      best = { id: "ride", label: "Ride with ChessPaa", icon: "🚂" };
    } else {
      for (const d of doors) {
        const st = d.station;
        if (!st.lesson) continue;
        if (p.distanceTo(d.pos) < 6) {
          best = {
            id: `lesson:${st.lesson}`,
            label: `${st.level ? `Level ${st.level} — ` : ""}${st.name}`,
            icon: st.icon,
          };
          break;
        }
      }
    }
    director.setPrompt(best);

    if (input.consumeInteract() && best) {
      if (best.id === "ride") {
        director.startRide();
      } else if (best.id.startsWith("lesson:")) {
        const kind = best.id.slice(7) as NonNullable<(typeof STATIONS)[number]["lesson"]>;
        const st = STATIONS.find((s) => s.lesson === kind) ?? null;
        director.openLesson(kind, st);
      }
    }
  });

  return (
    <group ref={kidRef} position={[6.5, terrainHeight(6.5, 68), 68]}>
      {/* look 0 = the bigger kid; this IS the player, so no breath-fog spam */}
      <Grandchild which={0} reaction="idle" breathFog={false} seed={5} />
    </group>
  );
}

export { stationDoor, stationFor };
