import * as THREE from "three";
import type { Chess, Square, Color, PieceSymbol } from "chess.js";
import { Assets, pbr } from "../core/Assets";
import { boardLabels } from "../core/Textures";
import { PieceMaterials } from "./Materials";
import { tween, Easing } from "../core/Tween";
import { merge, placed } from "../world/Geo";

const FILES = "abcdefgh";
const TYPE_NAME: Record<PieceSymbol, string> = { k: "king", q: "queen", b: "bishop", n: "knight", r: "rook", p: "pawn" };

interface PieceMesh { mesh: THREE.Mesh; type: PieceSymbol; color: Color; square: Square; }

/**
 * A giant park chessboard.  Shares the Blender piece geometry with every other
 * board (only materials and transforms are per-piece), animates moves, shows
 * legal-move dots, and turns pointer taps into squares.
 */
export class Board3D {
  readonly group = new THREE.Group();
  readonly squareSize: number;
  private pieces = new Map<Square, PieceMesh>();
  private geos: Record<string, THREE.BufferGeometry>;
  private mats: PieceMaterials;
  private picker: THREE.Mesh;
  private dots: THREE.InstancedMesh;
  private captureDots: THREE.InstancedMesh;
  private selectRing: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private lastFrom: THREE.Mesh; private lastTo: THREE.Mesh;
  private checkGlow: THREE.Mesh;
  private hintRing: THREE.Mesh;
  private glows: THREE.InstancedMesh;
  private glowColor = new THREE.Color();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downPos: [number, number] | null = null;
  private dom: HTMLElement | null = null;
  private camera: THREE.Camera | null = null;
  private pieceScale: number;
  interactive = false;
  onSquare?: (sq: Square) => void;
  onHover?: (sq: Square | null) => void;
  private handlers: { down: (e: PointerEvent) => void; up: (e: PointerEvent) => void; move: (e: PointerEvent) => void } | null = null;

  constructor(assets: Assets, geos: Record<string, THREE.BufferGeometry>, mats: PieceMaterials, squareSize = 0.6) {
    this.squareSize = squareSize;
    this.geos = geos; this.mats = mats;
    this.pieceScale = squareSize / 0.6;
    const s = squareSize, half = 4 * s;
    // squares: two merged meshes (light, dark)
    const light: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
      const g = new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2);
      // vary the grain per square
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const ox = (f * 0.23) % 1, oy = (r * 0.37) % 1;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25 + ox, uv.getY(i) * 0.25 + oy);
      const p = this.squareToLocal(FILES[f] + (r + 1) as Square);
      const pg = placed(g, p.x, 0, p.z);
      ((f + r) % 2 === 1 ? light : dark).push(pg);
    }
    const lightMat = new THREE.MeshPhysicalMaterial({ map: assets.tex.wood_light.map, normalMap: assets.tex.wood_light.normalMap, roughnessMap: assets.tex.wood_light.armMap, color: 0xf5e6c4, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3, normalScale: new THREE.Vector2(0.5, 0.5) });
    const darkMat = new THREE.MeshPhysicalMaterial({ map: assets.tex.wood_dark.map, normalMap: assets.tex.wood_dark.normalMap, roughnessMap: assets.tex.wood_dark.armMap, color: 0x7d5a3f, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3, normalScale: new THREE.Vector2(0.5, 0.5) });
    const lm = new THREE.Mesh(merge(light), lightMat), dm = new THREE.Mesh(merge(dark), darkMat);
    lm.receiveShadow = dm.receiveShadow = true;
    lm.position.y = dm.position.y = 0.121;
    this.group.add(lm, dm);
    // frame
    const frameMat = pbr(assets.tex.wood_frame, { repeat: [2, 2], roughness: 1, metalness: 0, color: 0xc99a6b });
    const fw = half + s * 0.55;
    const frameGeo = merge([
      placed(new THREE.BoxGeometry(fw * 2, 0.12, s * 0.55), 0, 0, -half - s * 0.275), placed(new THREE.BoxGeometry(fw * 2, 0.12, s * 0.55), 0, 0, half + s * 0.275),
      placed(new THREE.BoxGeometry(s * 0.55, 0.12, half * 2), -half - s * 0.275, 0, 0), placed(new THREE.BoxGeometry(s * 0.55, 0.12, half * 2), half + s * 0.275, 0, 0),
      placed(new THREE.BoxGeometry(fw * 2, 0.12, fw * 2), 0, -0.01, 0),
    ]);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 0.06; frame.castShadow = true; frame.receiveShadow = true;
    this.group.add(frame);
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(fw * 2, fw * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: boardLabels(), transparent: true, depthWrite: false }));
    labels.position.y = 0.125;
    this.group.add(labels);
    // picker
    this.picker = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.picker.position.y = 0.13;
    this.group.add(this.picker);
    // highlights
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x35d07f, transparent: true, opacity: 0.85, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(s * 0.14, 20).rotateX(-Math.PI / 2), dotMat, 32);
    this.dots.count = 0; this.dots.position.y = 0.135;
    this.captureDots = new THREE.InstancedMesh(new THREE.RingGeometry(s * 0.36, s * 0.46, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5e5e, transparent: true, opacity: 0.85, depthWrite: false }), 32);
    this.captureDots.count = 0; this.captureDots.position.y = 0.135;
    this.selectRing = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.55, depthWrite: false }));
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(s * 0.42, s * 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    this.lastFrom = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.35, depthWrite: false }));
    this.lastTo = this.lastFrom.clone();
    this.checkGlow = new THREE.Mesh(new THREE.CircleGeometry(s * 0.55, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.55, depthWrite: false }));
    this.hintRing = new THREE.Mesh(new THREE.RingGeometry(s * 0.4, s * 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2ec4c6, transparent: true, opacity: 0.9, depthWrite: false }));
    for (const m of [this.selectRing, this.hoverRing, this.lastFrom, this.lastTo, this.checkGlow, this.hintRing]) { m.position.y = 0.134; m.visible = false; this.group.add(m); }
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(s * 0.92, s * 0.92).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 40);
    this.glows.count = 0; this.glows.position.y = 0.1335;
    this.group.add(this.dots, this.captureDots, this.glows);
    this.group.name = "board3d";
  }

  /* ---------------- geometry helpers ---------------- */
  squareToLocal(sq: Square): THREE.Vector3 {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    const s = this.squareSize;
    return new THREE.Vector3((f - 3.5) * s, 0.13, (3.5 - r) * s);
  }
  squareToWorld(sq: Square) { return this.group.localToWorld(this.squareToLocal(sq)); }
  private localToSquare(p: THREE.Vector3): Square | null {
    const s = this.squareSize;
    const f = Math.floor(p.x / s + 4), r = Math.floor(4 - p.z / s);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return (FILES[f] + (r + 1)) as Square;
  }

  /* ---------------- pieces ---------------- */
  private makePiece(type: PieceSymbol, color: Color, sq: Square): PieceMesh {
    const mesh = new THREE.Mesh(this.geos[TYPE_NAME[type]], color === "w" ? this.mats.white : this.mats.black);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.scale.setScalar(this.pieceScale);
    mesh.position.copy(this.squareToLocal(sq)).setY(0.13);
    mesh.rotation.y = type === "n" ? (color === "w" ? Math.PI : 0) : 0;
    mesh.userData.square = sq;
    this.group.add(mesh);
    return { mesh, type, color, square: sq };
  }

  /** Make the board match a chess.js position instantly (no animation). */
  sync(chess: Chess) {
    const want = new Map<Square, { type: PieceSymbol; color: Color }>();
    for (const row of chess.board()) for (const cell of row) if (cell) want.set(cell.square, { type: cell.type, color: cell.color });
    for (const [sq, p] of [...this.pieces]) {
      const w = want.get(sq);
      if (!w || w.type !== p.type || w.color !== p.color) { this.group.remove(p.mesh); this.pieces.delete(sq); }
    }
    for (const [sq, w] of want) if (!this.pieces.has(sq)) this.pieces.set(sq, this.makePiece(w.type, w.color, sq));
    this.showCheck(chess);
  }

  clearPieces() { for (const p of this.pieces.values()) this.group.remove(p.mesh); this.pieces.clear(); this.clearHighlights(); }

  /** Animate a move already validated by chess.js; then sync to be safe. */
  async animateMove(move: { from: Square; to: Square; piece: PieceSymbol; color: Color; captured?: PieceSymbol; promotion?: PieceSymbol; flags: string }, chessAfter: Chess) {
    const p = this.pieces.get(move.from);
    const target = this.pieces.get(move.to);
    const s = this.squareSize;
    let captured: PieceMesh | undefined = target;
    if (move.flags.includes("e")) { // en passant: captured pawn sits beside
      const epSq = (move.to[0] + move.from[1]) as Square;
      captured = this.pieces.get(epSq);
    }
    this.setLastMove(move.from, move.to);
    const anims: Promise<void>[] = [];
    if (p) {
      this.pieces.delete(move.from);
      const from = this.squareToLocal(move.from), to = this.squareToLocal(move.to);
      const hop = move.piece === "n" ? s * 1.4 : s * 0.5;
      anims.push(tween(0.5, (k) => {
        p.mesh.position.lerpVectors(from, to, k);
        p.mesh.position.y = 0.13 + Math.sin(k * Math.PI) * hop;
      }, Easing.inOut).promise.then(() => { p.mesh.position.copy(to).setY(0.13); }));
      p.square = move.to;
      if (captured && captured !== p) {
        this.pieces.delete(captured.square);
        const cm = captured.mesh;
        anims.push(tween(0.55, (k) => { cm.scale.setScalar(this.pieceScale * (1 - Easing.in(k))); cm.position.y = 0.13 + k * 0.6; cm.rotation.y += 0.2; }).promise.then(() => { this.group.remove(cm); }));
      }
      this.pieces.set(move.to, p);
      if (move.flags.includes("k") || move.flags.includes("q")) {
        const rank = move.from[1];
        const rf = (move.flags.includes("k") ? "h" : "a") + rank as Square, rt = (move.flags.includes("k") ? "f" : "d") + rank as Square;
        const rook = this.pieces.get(rf);
        if (rook) {
          this.pieces.delete(rf); rook.square = rt; this.pieces.set(rt, rook);
          const a = this.squareToLocal(rf), b = this.squareToLocal(rt);
          anims.push(tween(0.5, (k) => { rook.mesh.position.lerpVectors(a, b, k); rook.mesh.position.y = 0.13 + Math.sin(k * Math.PI) * s * 0.3; }).promise);
        }
      }
    }
    await Promise.all(anims);
    if (move.promotion && p) {
      this.group.remove(p.mesh);
      this.pieces.set(move.to, this.makePiece(move.promotion, move.color, move.to));
    }
    this.sync(chessAfter);
  }

  /* ---------------- highlights ---------------- */
  showLegal(moves: { to: Square; captured?: PieceSymbol; flags: string }[]) {
    let d = 0, c = 0;
    const m = new THREE.Matrix4();
    for (const mv of moves) {
      const p = this.squareToLocal(mv.to);
      m.setPosition(p.x, 0, p.z);
      if (mv.captured || mv.flags.includes("e")) { this.captureDots.setMatrixAt(c++, m); } else { this.dots.setMatrixAt(d++, m); }
    }
    this.dots.count = d; this.captureDots.count = c;
    this.dots.instanceMatrix.needsUpdate = true; this.captureDots.instanceMatrix.needsUpdate = true;
  }
  select(sq: Square | null) {
    this.selectRing.visible = !!sq;
    if (sq) this.selectRing.position.copy(this.squareToLocal(sq)).setY(0.134);
    if (!sq) { this.dots.count = 0; this.captureDots.count = 0; }
  }
  hover(sq: Square | null) {
    this.hoverRing.visible = !!sq && this.interactive;
    if (sq) this.hoverRing.position.copy(this.squareToLocal(sq)).setY(0.136);
  }
  hint(sq: Square | null) {
    this.hintRing.visible = !!sq;
    if (sq) this.hintRing.position.copy(this.squareToLocal(sq)).setY(0.137);
  }
  /** Soft coloured squares for lessons ("look here"). */
  glow(squares: Square[], color: number = 0xffd23c) {
    const m = new THREE.Matrix4();
    this.glowColor.set(color);
    squares.slice(0, 40).forEach((sq, i) => { const p = this.squareToLocal(sq); m.setPosition(p.x, 0, p.z); this.glows.setMatrixAt(i, m); this.glows.setColorAt(i, this.glowColor); });
    this.glows.count = Math.min(40, squares.length);
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
  }
  setLastMove(from: Square | null, to: Square | null) {
    this.lastFrom.visible = !!from; this.lastTo.visible = !!to;
    if (from) this.lastFrom.position.copy(this.squareToLocal(from)).setY(0.132);
    if (to) this.lastTo.position.copy(this.squareToLocal(to)).setY(0.132);
  }
  showCheck(chess: Chess) {
    let kingSq: Square | null = null;
    if (chess.isCheck()) for (const p of this.pieces.values()) if (p.type === "k" && p.color === chess.turn()) kingSq = p.square;
    this.checkGlow.visible = !!kingSq;
    if (kingSq) this.checkGlow.position.copy(this.squareToLocal(kingSq)).setY(0.133);
  }
  clearHighlights() { this.select(null); this.hover(null); this.hint(null); this.setLastMove(null, null); this.checkGlow.visible = false; this.glow([]); }
  pulse(t: number) {
    const k = 0.85 + Math.sin(t * 5) * 0.15;
    (this.hintRing.material as THREE.MeshBasicMaterial).opacity = k;
    this.hintRing.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    (this.dots.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(t * 4) * 0.2;
  }
  pieceAt(sq: Square) { return this.pieces.get(sq); }

  /* ---------------- input ---------------- */
  attach(dom: HTMLElement, camera: THREE.Camera) {
    this.detach();
    this.dom = dom; this.camera = camera;
    const toSquare = (e: PointerEvent): Square | null => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera!);
      const hit = this.raycaster.intersectObject(this.picker, false)[0];
      if (!hit) return null;
      return this.localToSquare(this.group.worldToLocal(hit.point.clone()));
    };
    const down = (e: PointerEvent) => { this.downPos = [e.clientX, e.clientY]; };
    const up = (e: PointerEvent) => {
      if (!this.downPos || !this.interactive) return;
      const moved = Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]);
      this.downPos = null;
      if (moved > 8) return;
      const sq = toSquare(e);
      if (sq) this.onSquare?.(sq);
    };
    const move = (e: PointerEvent) => { if (!this.interactive) return; const sq = toSquare(e); this.hover(sq); this.onHover?.(sq); };
    dom.addEventListener("pointerdown", down); dom.addEventListener("pointerup", up); dom.addEventListener("pointermove", move);
    this.handlers = { down, up, move };
  }
  detach() {
    if (this.dom && this.handlers) {
      this.dom.removeEventListener("pointerdown", this.handlers.down); this.dom.removeEventListener("pointerup", this.handlers.up); this.dom.removeEventListener("pointermove", this.handlers.move);
    }
    this.handlers = null; this.dom = null;
  }
}
