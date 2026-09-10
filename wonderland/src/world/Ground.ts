import * as THREE from "three";
import { Assets, pbr } from "../core/Assets";
import { groundMask } from "../core/Textures";
import { PARK, pathNetwork } from "./Layout";

const SIZE = 520;

/**
 * One draw call of terrain: grass everywhere, blended to warm sand inside the
 * park and along the walkways using a mask painted at boot.  The lake sits in
 * a dip carved by the same height function that raises the distant hills.
 */
export function heightAt(x: number, z: number) {
  const d = Math.hypot(x, z);
  let h = 0;
  if (d > 120) {
    const k = (d - 120) / 140;
    h += k * k * 14 * (0.7 + 0.3 * Math.sin(x * 0.05) * Math.cos(z * 0.04));
  }
  const L = PARK.lake;
  const e = Math.hypot((x - L.center.x) / L.rx, (z - L.center.z) / L.rz);
  if (e < 1.15) {
    const k = THREE.MathUtils.smoothstep(1.15 - e, 0, 0.35);
    h -= k * 2.2;
  }
  return h;
}

export function buildGround(assets: Assets) {
  const group = new THREE.Group();
  group.name = "ground";
  const segs = 180;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  geo.setAttribute("uv2", geo.attributes.uv);

  const mat = pbr(assets.tex.grass, { repeat: SIZE / 4.5, color: 0xffffff, roughness: 1, metalness: 0, normalScale: 0.7, envMapIntensity: 0.7 });
  const sand = assets.tex.sand;
  const sandMap = sand.map.clone(); sandMap.needsUpdate = true;
  const sandNor = sand.normalMap.clone(); sandNor.needsUpdate = true;
  const sandArm = sand.armMap.clone(); sandArm.needsUpdate = true;

  const mask = groundMask(SIZE, 1024, (ctx, toPx, scale) => {
    ctx.save();
    ctx.filter = "blur(10px)";
    // the park plaza
    ctx.fillStyle = "#fff";
    const [cx, cz] = toPx(0, -6);
    ctx.beginPath(); ctx.ellipse(cx, cz, PARK.sandRadius * scale, PARK.sandRadius * 0.86 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // grass islands inside the plaza for trees and lawns
    ctx.save(); ctx.filter = "blur(8px)"; ctx.fillStyle = "#000";
    const lawns: [number, number, number, number][] = [[-30, -30, 14, 10], [34, 8, 10, 12], [-70, 30, 10, 8], [60, -10, 9, 14], [-10, -30, 8, 6], [20, -60, 8, 6], [-40, 52, 9, 6]];
    for (const [x, z, rx, rz] of lawns) { const [px, pz] = toPx(x, z); ctx.beginPath(); ctx.ellipse(px, pz, rx * scale, rz * scale, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // walkways: bright sand
    ctx.save(); ctx.filter = "blur(3px)"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 5 * scale; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const path of pathNetwork()) {
      ctx.beginPath();
      path.forEach((v, i) => { const [px, pz] = toPx(v.x, v.z); if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz); });
      ctx.stroke();
    }
    ctx.restore();
    // lake bed: keep sandy
    ctx.save(); ctx.fillStyle = "#fff"; ctx.filter = "blur(6px)";
    const [lx, lz] = toPx(PARK.lake.center.x, PARK.lake.center.z);
    ctx.beginPath(); ctx.ellipse(lx, lz, PARK.lake.rx * 1.2 * scale, PARK.lake.rz * 1.2 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.sandMap = { value: sandMap };
    shader.uniforms.sandNormal = { value: sandNor };
    shader.uniforms.sandArm = { value: sandArm };
    shader.uniforms.maskMap = { value: mask };
    shader.uniforms.sandScale = { value: 0.62 };
    shader.uniforms.sandTint = { value: new THREE.Color(1.55, 1.22, 0.78) };
    shader.uniforms.grassTint = { value: new THREE.Color(1.05, 1.28, 0.72) };
    shader.uniforms.worldSize = { value: SIZE };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWorldXZ;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 vWorldXZ;
        uniform sampler2D sandMap; uniform sampler2D sandNormal; uniform sampler2D sandArm; uniform sampler2D maskMap;
        uniform float sandScale; uniform vec3 sandTint; uniform vec3 grassTint; uniform float worldSize;
        float groundMix() { return texture2D(maskMap, vWorldXZ / worldSize + 0.5).r; }`)
      .replace("#include <map_fragment>", `
        float gm = groundMix();
        vec4 gTex = texture2D(map, vMapUv);
        vec4 sTex = texture2D(sandMap, vMapUv * sandScale);
        vec3 col = mix(gTex.rgb * grassTint, sTex.rgb * sandTint, gm);
        diffuseColor.rgb *= col;`)
      .replace("vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;", `
        vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz, texture2D( sandNormal, vNormalMapUv * sandScale ).xyz, groundMix()) * 2.0 - 1.0;`)
      .replace("vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );", `
        vec4 texelRoughness = mix(texture2D( roughnessMap, vRoughnessMapUv ), texture2D( sandArm, vRoughnessMapUv * sandScale ), groundMix());`)
      .replace("float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;", `
        float ambientOcclusion = ( mix(texture2D( aoMap, vAoMapUv ).r, texture2D( sandArm, vAoMapUv * sandScale ).r, groundMix()) - 1.0 ) * aoMapIntensity + 1.0;`);
  };
  mat.customProgramCacheKey = () => "ground-blend";
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.name = "terrain";
  group.add(ground);

  // lake water
  const L = PARK.lake;
  const waterGeo = new THREE.CircleGeometry(1, 64).scale(L.rx * 1.02, L.rz * 1.02, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const n1 = assets.waterNormals.clone(); n1.needsUpdate = true; n1.repeat.set(6, 6);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshPhysicalMaterial({
    color: 0x2e8ec4, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: n1, normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.FrontSide,
  }));
  water.position.set(L.center.x, -0.35, L.center.z);
  water.receiveShadow = true;
  water.name = "water";
  group.add(water);

  return {
    group,
    update(dt: number, t: number) {
      n1.offset.x = t * 0.012; n1.offset.y = t * 0.008;
    },
  };
}
