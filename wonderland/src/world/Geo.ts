import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Frame { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3; s: number; }

/**
 * Parallel-transport frames along a curve (no twisting), with optional banking
 * driven by lateral curvature, so coaster turns lean into the corner.
 */
export function frames(curve: THREE.Curve<THREE.Vector3>, count: number, closed: boolean, bank = 0): Frame[] {
  const out: Frame[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const len = curve.getLength();
  let n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = closed ? i / count : i / (count - 1);
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    if (i === 0) {
      n = up.clone().sub(t.clone().multiplyScalar(up.dot(t)));
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      n.normalize();
    } else {
      n = n.clone().sub(t.clone().multiplyScalar(n.dot(t))).normalize();
    }
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    out.push({ p, t, n: n.clone(), b, s: u * len });
  }
  // keep "up" preferring world up: rotate frames so n is as close to up as possible while staying perpendicular to t
  for (const f of out) {
    const projUp = up.clone().sub(f.t.clone().multiplyScalar(up.dot(f.t)));
    if (projUp.lengthSq() > 1e-4) {
      projUp.normalize();
      f.n.copy(projUp);
      f.b.crossVectors(f.t, f.n).normalize();
    }
  }
  if (bank > 0) {
    const N = out.length;
    for (let i = 0; i < N; i++) {
      const prev = out[(i - 3 + N) % N], next = out[(i + 3) % N];
      const lateral = next.t.clone().sub(prev.t).dot(out[i].b); // turning toward +b
      const angle = THREE.MathUtils.clamp(lateral * bank, -0.75, 0.75);
      const q = new THREE.Quaternion().setFromAxisAngle(out[i].t, angle);
      out[i].n.applyQuaternion(q);
      out[i].b.applyQuaternion(q);
    }
    // smooth banking
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const a = out[(i - 1 + N) % N].n, c = out[(i + 1) % N].n;
        out[i].n.add(a).add(c).multiplyScalar(1 / 3);
        out[i].n.sub(out[i].t.clone().multiplyScalar(out[i].n.dot(out[i].t))).normalize();
        out[i].b.crossVectors(out[i].t, out[i].n).normalize();
      }
    }
  }
  return out;
}

/** A tube that follows precomputed frames, offset in the frame's (n, b) plane. */
export function tubeAlong(fr: Frame[], radius: number, offsetN: number, offsetB: number, closed: boolean, radial = 8): THREE.BufferGeometry {
  const N = fr.length;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = fr[i];
    const c = f.p.clone().addScaledVector(f.n, offsetN).addScaledVector(f.b, offsetB);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const d = f.n.clone().multiplyScalar(Math.cos(a)).addScaledVector(f.b, Math.sin(a));
      pos.push(c.x + d.x * radius, c.y + d.y * radius, c.z + d.z * radius);
      nor.push(d.x, d.y, d.z);
      uv.push(j / radial, f.s / 2);
    }
  }
  const rings = closed ? N : N - 1;
  for (let i = 0; i < rings; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = i * radial + j, b = i * radial + j2, c = i2 * radial + j2, d = i2 * radial + j;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flat ribbon (e.g. a path) along frames, lying in the (t, b) plane. */
export function ribbonAlong(fr: Frame[], width: number, lift = 0.02, closed = false): THREE.BufferGeometry {
  const N = fr.length;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = fr[i];
    const l = f.p.clone().addScaledVector(f.b, -width / 2), r = f.p.clone().addScaledVector(f.b, width / 2);
    pos.push(l.x, l.y + lift, l.z, r.x, r.y + lift, r.z);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, f.s / width, 1, f.s / width);
  }
  const segs = closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % N;
    const a = i * 2, b = i * 2 + 1, c = i2 * 2 + 1, d = i2 * 2;
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function frameMatrix(f: Frame, out = new THREE.Matrix4()) {
  return out.makeBasis(f.b, f.n, f.t.clone().negate()).setPosition(f.p);
}

/** Find the frame index for arc length s (frames uniformly spaced). */
export function frameAt(fr: Frame[], s: number, length: number): Frame {
  const N = fr.length;
  const u = ((s % length) + length) % length / length;
  const fi = u * N;
  const i0 = Math.floor(fi) % N, i1 = (i0 + 1) % N;
  const k = fi - Math.floor(fi);
  const a = fr[i0], b = fr[i1];
  return {
    p: a.p.clone().lerp(b.p, k), t: a.t.clone().lerp(b.t, k).normalize(), n: a.n.clone().lerp(b.n, k).normalize(), b: a.b.clone().lerp(b.b, k).normalize(), s,
  };
}

export function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[]) {
  const m = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
  if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false; // bounds of instanced sets are unreliable; they're all in view anyway
  return m;
}

export function merge(geos: THREE.BufferGeometry[]) {
  const g = mergeGeometries(geos, false);
  if (!g) throw new Error("merge failed");
  return g;
}

export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rot?: THREE.Euler, scale?: THREE.Vector3 | number) {
  const c = g.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion(); if (rot) q.setFromEuler(rot);
  const s = typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : (scale ?? new THREE.Vector3(1, 1, 1));
  m.compose(new THREE.Vector3(x, y, z), q, s);
  c.applyMatrix4(m);
  return c;
}

export const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};

export function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
  return o;
}
