import * as THREE from "three";
import { Assets } from "../core/Assets";

export interface PieceMaterials { white: THREE.MeshPhysicalMaterial; black: THREE.MeshPhysicalMaterial; }

/** Lacquered boxwood and ebony for the turned pieces (shared by every board). */
export function pieceMaterials(assets: Assets): PieceMaterials {
  const mk = (set: Assets["tex"]["wood_light"], color: number, rough: number) => {
    const clone = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(1.0, 1.6); c.needsUpdate = true; return c; };
    return new THREE.MeshPhysicalMaterial({
      map: clone(set.map), normalMap: clone(set.normalMap), roughnessMap: clone(set.armMap), aoMap: clone(set.armMap),
      color, roughness: rough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.0,
    });
  };
  return { white: mk(assets.tex.wood_light, 0xf1dfb8, 0.55), black: mk(assets.tex.wood_dark, 0x6a4a34, 0.5) };
}

export function pieceGeometries(pieces: THREE.Group): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  const KINDS = ["king", "queen", "bishop", "knight", "rook", "pawn"];
  pieces.traverse((o) => {
    const m = o as THREE.Mesh;
    // gltfpack parks each mesh in an unnamed child of the named node
    const name = KINDS.includes(m.name) ? m.name : (m.parent && KINDS.includes(m.parent.name) ? m.parent.name : "");
    if (m.isMesh && name) {
      m.name = name;
      const g = m.geometry;
      if (!g.attributes.uv2 && g.attributes.uv) g.setAttribute("uv2", g.attributes.uv);
      g.computeBoundingBox();
      out[m.name] = g;
    }
  });
  return out;
}
