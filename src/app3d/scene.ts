// ฉาก 3D ด้วย Three.js: โมเดล, การเสียรูป, แผนภาพแรงภายใน, การเลือกชิ้นส่วน
// แกน: Z ขึ้น (ตรงกับตัววิเคราะห์)

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { AnalysisResult3 } from "../core3d/frame3d.ts";
import { memberAxes, type Model3, type Vec3 } from "../core3d/model3d.ts";

export type Display3 = "model" | "deformed" | "Mz" | "My" | "N" | "T" | "design";
export type ViewDir = "iso" | "plan" | "x" | "y";
export type Projection = "perspective" | "orthographic";

const css = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/** สีแกนมาตรฐาน X แดง, Y เขียว, Z น้ำเงิน */
const AXIS_COLORS: Record<"X" | "Y" | "Z", string> = { X: "#e5484d", Y: "#2fa56a", Z: "#3e7bfa" };

/** ลูกศรแบบทรงกระบอก + กรวย (หนากว่าเส้น 1 px ของ WebGL) */
function makeArrow(dir: THREE.Vector3, color: string, length: number, radius: number, depthTest = true): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, depthTest });
  const head = length * 0.14;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length - head, 10), mat);
  shaft.position.y = (length - head) / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(length * 0.04, head, 20), mat);
  cone.position.y = length - head / 2;
  g.add(shaft, cone);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return g;
}

/** ป้ายตัวอักษร (sprite) */
function makeLabel(text: string, color: string, size: number, depthTest = true): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 84px 'IBM Plex Sans Thai', system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color; ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest, transparent: true }));
  sp.scale.set(size, size, 1);
  return sp;
}

/** วงกลมชื่อกริด (แบบแบบโครงสร้าง) */
function makeBubble(text: string, size: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = "#2b3440"; ctx.stroke();
  ctx.fillStyle = "#1d2430";
  ctx.font = `600 ${text.length > 2 ? 46 : 62}px 'IBM Plex Sans Thai', system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(size, size, 1);
  sp.renderOrder = 950;
  return sp;
}

/** ป้ายข้อความแนวนอน (ระดับชั้น/ค่าแผนภาพ) — anchor ซ้าย หรือกึ่งกลาง */
export function makeTextSprite(text: string, height: number, opts: { color?: string; bg?: string; align?: "left" | "center" } = {}): THREE.Sprite {
  const font = "600 44px 'IBM Plex Sans Thai', system-ui, sans-serif";
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  const w = Math.ceil(m.measureText(text).width) + 28;
  const c = document.createElement("canvas");
  c.width = w; c.height = 64;
  const ctx = c.getContext("2d")!;
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.beginPath(); ctx.roundRect(1, 4, w - 2, 56, 10); ctx.fill(); }
  ctx.font = font; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillStyle = opts.color ?? "#1d2430";
  ctx.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set((height * w) / 64, height, 1);
  if (opts.align === "left") sp.center.set(0, 0.5);
  sp.renderOrder = 960;
  return sp;
}

/** ชุดแกน X Y Z (ลูกศร + ป้าย) */
function makeAxes(length: number, radius: number, labelSize: number, depthTest = true): THREE.Group {
  const g = new THREE.Group();
  const dirs: [keyof typeof AXIS_COLORS, THREE.Vector3][] = [["X", new THREE.Vector3(1, 0, 0)], ["Y", new THREE.Vector3(0, 1, 0)], ["Z", new THREE.Vector3(0, 0, 1)]];
  for (const [name, d] of dirs) {
    g.add(makeArrow(d, AXIS_COLORS[name], length, radius, depthTest));
    const lb = makeLabel(name, AXIS_COLORS[name], labelSize, depthTest);
    lb.position.copy(d.clone().multiplyScalar(length + labelSize * 0.55));
    g.add(lb);
  }
  return g;
}

/** มุมของกล่องหน่วย (บิต x,y,z) และขอบ 12 เส้น */
const BOX_EDGES: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** กล้องที่ใช้อยู่ (สลับได้ระหว่าง perspective / orthographic) */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  private host: HTMLElement;
  private modelGroup = new THREE.Group();
  private resultGroup = new THREE.Group();
  private selGroup = new THREE.Group();
  private gridGroup = new THREE.Group();
  private footGroup = new THREE.Group();
  private slabGroup = new THREE.Group();
  private loadGroup = new THREE.Group();
  private roofGroup = new THREE.Group();
  private memberLines: LineSegments2 | null = null;
  private memberIds: string[] = [];
  private materials: LineMaterial[] = [];
  private model: Model3 | null = null;
  private visible = new Set<string>();
  private extent = 10;
  private center = new THREE.Vector3();
  private dirty = true;
  /** ตัวบอกทิศที่มุมล่างซ้าย (SVG) — หมุนตามกล้อง คลิกปลายแกนเพื่อมองตามแกนนั้น */
  private gizmo: SVGSVGElement;
  private baseColors: number[] = [];
  /** วาดชิ้นส่วนเป็นแท่งตามหน้าตัดจริง (b × h ตามแกน local) */
  private solid = false;
  private solidMesh: THREE.InstancedMesh | null = null;
  private solidGroup = new THREE.Group();
  private plainDisplay = true;
  /** สีคอนกรีตเทาแทนสีตามชนิดในโหมดขนาดจริง */
  private concrete = false;
  private solidEdges: THREE.LineSegments | null = null;
  /** แกน X Y Z ที่จุดกำเนิดกริด (เปิด/ปิดได้) */
  private originAxes: THREE.Object3D | null = null;
  private showAxes = true;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(this.renderer.domElement);
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -5000, 5000);
    this.ortho.up.set(0, 0, 1);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => { this.dirty = true; });
    this.scene.add(this.gridGroup, this.modelGroup, this.solidGroup, this.footGroup, this.slabGroup, this.roofGroup, this.loadGroup, this.resultGroup, this.selGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(1, -2, 3);
    this.scene.add(dl);
    new ResizeObserver(() => this.resize()).observe(host);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    this.applyTheme();
    this.gizmo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.gizmo.setAttribute("class", "axis-gizmo");
    this.gizmo.setAttribute("viewBox", "0 0 120 120"); // แสดงที่ 136 px (CSS)
    host.appendChild(this.gizmo);
    this.gizmo.addEventListener("click", (e) => {
      const a = (e.target as Element).closest("[data-axis]")?.getAttribute("data-axis");
      if (!a) return;
      const sg = a[0] === "-" ? -1 : 1, k = a.slice(-1);
      this.lookAlong(new THREE.Vector3(k === "X" ? sg : 0, k === "Y" ? sg : 0, k === "Z" ? sg : 0));
    });
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.dirty) { this.renderFrame(); this.dirty = false; }
    };
    loop();
  }

  private renderFrame() {
    const r = this.renderer;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.camera);
    this.updateGizmo();
  }

  /** วาดตัวบอกทิศ: ปลายแกนบวกเป็นวงกลมสีพร้อมตัวอักษร แกนลบเป็นวงกลมจาง เรียงจากไกลไปใกล้ */
  private updateGizmo() {
    const inv = this.camera.quaternion.clone().invert();
    const C = 60, R = 42;
    const axes = (["X", "Y", "Z"] as const).flatMap((k) => [1, -1].map((sg) => {
      const v = new THREE.Vector3(k === "X" ? sg : 0, k === "Y" ? sg : 0, k === "Z" ? sg : 0).applyQuaternion(inv);
      return { k, sg, x: C + v.x * R, y: C - v.y * R, z: v.z };
    }));
    axes.sort((a, b) => a.z - b.z);
    const parts = [`<circle class="gz-bg" cx="${C}" cy="${C}" r="56"/>`];
    for (const a of axes) {
      const col = AXIS_COLORS[a.k];
      const id = `${a.sg < 0 ? "-" : ""}${a.k}`;
      const title = `มองตามแกน ${id === "Z" ? "Z (แปลน)" : id}`;
      if (a.sg > 0) {
        parts.push(`<line x1="${C}" y1="${C}" x2="${a.x}" y2="${a.y}" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`);
        parts.push(`<g class="gz-end" data-axis="${id}"><title>${title}</title><circle cx="${a.x}" cy="${a.y}" r="10" fill="${col}"/>` +
          `<text x="${a.x}" y="${a.y + 0.5}" text-anchor="middle" dominant-baseline="central">${a.k}</text></g>`);
      } else {
        parts.push(`<g class="gz-end neg" data-axis="${id}"><title>${title}</title><circle cx="${a.x}" cy="${a.y}" r="7.5" fill="${col}" fill-opacity="0.28" stroke="${col}" stroke-width="1.5"/>` +
          `<text x="${a.x}" y="${a.y + 0.5}" text-anchor="middle" dominant-baseline="central" fill="${col}">−${a.k}</text></g>`);
      }
    }
    this.gizmo.innerHTML = parts.join("");
  }

  /** หมุนกล้องไปมองตามแกน (ทิศจากจุดเป้าหมายไปหากล้อง = dir) คงระยะเดิม */
  lookAlong(dir: THREE.Vector3) {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const v = dir.clone().normalize();
    if (Math.abs(v.z) > 0.999) v.set(0, -0.001 * Math.sign(v.z), Math.sign(v.z)).normalize(); // กันเวกเตอร์ขึ้นชนแกนมอง
    this.camera.position.copy(t).addScaledVector(v, d);
    this.controls.update();
    this.dirty = true;
  }

  private applyTheme() {
    this.scene.background = new THREE.Color(css("--canvas", "#ffffff"));
    this.dirty = true;
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.setOrthoFrustum(this.orthoHalf);
    for (const m of this.materials) m.resolution.set(w, h);
    this.dirty = true;
  }

  private lineMat(color: string, width: number, opts: Partial<{ dashed: boolean; opacity: number }> = {}) {
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, dashed: !!opts.dashed, dashSize: 0.3, gapSize: 0.2 });
    m.resolution.set(this.host.clientWidth || 800, this.host.clientHeight || 600);
    this.materials.push(m);
    return m;
  }

  private clear(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((obj) => {
        const o = obj as THREE.Mesh;
        o.geometry?.dispose?.();
        const mat = o.material as (THREE.Material & { map?: THREE.Texture | null }) | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) { mat.map?.dispose(); mat.dispose(); }
        if (mat instanceof LineMaterial) this.materials = this.materials.filter((x) => x !== mat);
      });
    }
  }

  /** ระดับ z ที่ให้แสดง (null = ทั้งหมด): แสดงคานที่ระดับนั้นและเสาที่อยู่ใต้ */
  setModel(model: Model3, levelZ: number | null) {
    this.model = model;
    this.clear(this.modelGroup);
    this.clear(this.gridGroup);
    const nodes = new Map(model.nodes.map((n) => [n.id, n]));
    const zs = model.nodes.map((n) => n.z);
    const zBase = Math.min(...zs);
    // ช่วงที่แสดง
    this.visible = new Set(model.members.filter((m) => {
      if (levelZ === null) return true;
      const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
      const top = Math.max(a.z, b.z), bot = Math.min(a.z, b.z);
      if (m.kind === "column") return Math.abs(top - levelZ) < 1e-3;
      return Math.abs(top - levelZ) < 1e-3 && Math.abs(bot - levelZ) < 1e-3;
    }).map((m) => m.id));

    const pos: number[] = [], col: number[] = [];
    this.memberIds = [];
    const colors: Record<string, THREE.Color> = {
      beam: new THREE.Color(css("--beam", "#2f6fd6")), column: new THREE.Color(css("--column", "#7a4cc2")),
      brace: new THREE.Color(css("--warn", "#b7791f")), other: new THREE.Color(css("--other", "#59636e")),
      wall: new THREE.Color("#12a58e"), link: new THREE.Color("#8a939e"),
    };
    for (const m of model.members) {
      if (!this.visible.has(m.id)) continue;
      const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const c = colors[m.kind] ?? colors.other;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      this.memberIds.push(m.id);
    }
    this.baseColors = col;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = this.lineMat("#ffffff", 2.5);
    mat.vertexColors = true;
    this.memberLines = new LineSegments2(geo, mat);
    this.modelGroup.add(this.memberLines);
    this.buildSolids();

    // จุดต่อ
    const used = new Set(model.members.filter((m) => this.visible.has(m.id)).flatMap((m) => [m.i, m.j]));
    const pts = model.nodes.filter((n) => used.has(n.id)).flatMap((n) => [n.x, n.y, n.z]);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.modelGroup.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: css("--node", "#1d2430"), size: 4, sizeAttenuation: false })));

    // จุดรองรับ (พีระมิดใต้จุด)
    const span = Math.max(...model.nodes.map((n) => n.x)) - Math.min(...model.nodes.map((n) => n.x)) || 10;
    const sz = Math.max(0.15, span * 0.015);
    const cone = new THREE.ConeGeometry(sz, sz * 1.4, 4);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, -sz * 0.7);
    const sm = new THREE.MeshLambertMaterial({ color: css("--reaction", "#0d8a5f") });
    for (const s of model.supports) {
      const n = nodes.get(s.node);
      if (!n || !used.has(n.id)) continue;
      const mesh = new THREE.Mesh(cone, sm);
      mesh.position.set(n.x, n.y, n.z);
      this.modelGroup.add(mesh);
    }

    // พื้น (เส้นกริดที่ฐาน)
    const xs = [...new Set(model.nodes.map((n) => +n.x.toFixed(3)))].sort((a, b) => a - b);
    const ys = [...new Set(model.nodes.map((n) => +n.y.toFixed(3)))].sort((a, b) => a - b);
    const gp: number[] = [];
    const pad = sz * 6;
    for (const x of xs) gp.push(x, ys[0] - pad, zBase, x, ys[ys.length - 1] + pad, zBase);
    for (const y of ys) gp.push(xs[0] - pad, y, zBase, xs[xs.length - 1] + pad, y, zBase);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
    this.gridGroup.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: css("--grid-major", "#dde2e8") })));
    // วงกลมชื่อกริด: เส้นตามแกน X ใช้ตัวเลข (1, 2, …), เส้นตามแกน Y ใช้ตัวอักษร (A, B, …) ทั้งสองปลาย
    const bub = Math.max(0.55, sz * 4.2);
    const off = pad + bub * 0.75;
    xs.forEach((x, i) => {
      for (const y of [ys[0] - off, ys[ys.length - 1] + off]) { const b = makeBubble(String(i + 1), bub); b.position.set(x, y, zBase); this.gridGroup.add(b); }
    });
    ys.forEach((y, j) => {
      const name = j < 26 ? String.fromCharCode(65 + j) : `A${String.fromCharCode(65 + j - 26)}`;
      for (const x of [xs[0] - off, xs[xs.length - 1] + off]) { const b = makeBubble(name, bub); b.position.set(x, y, zBase); this.gridGroup.add(b); }
    });
    // ป้ายระดับชั้น + เส้นระดับประที่มุมหน้าซ้าย
    const levels = [...new Set(model.nodes.map((n) => +n.z.toFixed(3)))].sort((a, b) => a - b);
    const lvColor = css("--muted", "#6b7584");
    const lp: number[] = [];
    levels.forEach((z, k) => {
      const t = makeTextSprite(`${k === 0 ? "ฐาน" : `ชั้น ${k}`}  ${z >= 0 ? "+" : ""}${z.toFixed(2)}`, bub * 0.55, { color: "#ffffff", bg: "rgba(43,52,64,0.82)", align: "left" });
      t.position.set(xs[xs.length - 1] + off * 1.1, ys[0] - off, z);
      this.gridGroup.add(t);
      lp.push(xs[xs.length - 1], ys[0], z, xs[xs.length - 1] + off * 1.05, ys[0] - off, z);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    const lm = new THREE.LineDashedMaterial({ color: lvColor, dashSize: bub * 0.25, gapSize: bub * 0.18 });
    const ll = new THREE.LineSegments(lg, lm);
    ll.computeLineDistances();
    this.gridGroup.add(ll);
    // แกน X Y Z ที่จุดกำเนิดของกริด (มุมล่างซ้ายของอาคาร)
    const span3 = Math.max(xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0], 4);
    const axLen = Math.max(1.5, span3 * 0.2);
    const origin = makeAxes(axLen, axLen * 0.007, axLen * 0.17, false); // เส้นบาง หัวลูกศรเล็ก แสดงทับกล่องฐาน/ชิ้นส่วน
    origin.position.set(xs[0], ys[0], zBase);
    origin.traverse((o) => { o.renderOrder = 900; });
    origin.visible = this.showAxes;
    this.originAxes = origin;
    this.gridGroup.add(origin);

    const box = new THREE.Box3().setFromArray(model.nodes.flatMap((n) => [n.x, n.y, n.z]));
    box.getCenter(this.center);
    this.extent = box.getSize(new THREE.Vector3()).length() || 10;
    this.dirty = true;
  }

  setView(v: ViewDir) {
    const d = this.extent * 1.5;
    const c = this.center;
    const dir = v === "plan" ? new THREE.Vector3(0, -0.001, 1) : v === "x" ? new THREE.Vector3(0, -1, 0.05) : v === "y" ? new THREE.Vector3(1, 0, 0.05) : new THREE.Vector3(1.1, -1.4, 0.9);
    dir.normalize();
    this.camera.position.copy(c).addScaledVector(dir, d);
    if (this.camera === this.ortho) {
      // ขนาดภาพเท่ากับ perspective ที่ระยะเดียวกัน
      this.ortho.zoom = 1;
      this.setOrthoFrustum(d * Math.tan(((this.persp.fov / 2) * Math.PI) / 180));
    }
    this.controls.target.copy(c);
    this.controls.update();
    this.dirty = true;
  }

  private orthoHalf = 10;
  private setOrthoFrustum(halfH: number) {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    const a = w / h;
    this.orthoHalf = halfH;
    this.ortho.left = -halfH * a; this.ortho.right = halfH * a;
    this.ortho.top = halfH; this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }

  get projection(): Projection { return this.camera === this.ortho ? "orthographic" : "perspective"; }

  /** สลับ perspective ↔ orthographic โดยคงทิศมองและขนาดภาพที่จุดเป้าหมาย */
  setProjection(p: Projection) {
    if (p === this.projection) return;
    const target = this.controls.target;
    const tanH = Math.tan(((this.persp.fov / 2) * Math.PI) / 180);
    if (p === "orthographic") {
      const dist = this.persp.position.distanceTo(target);
      this.ortho.position.copy(this.persp.position);
      this.ortho.quaternion.copy(this.persp.quaternion);
      this.ortho.zoom = 1;
      this.setOrthoFrustum(dist * tanH);
      this.camera = this.ortho;
    } else {
      const halfH = this.orthoHalf / this.ortho.zoom;
      const dir = this.ortho.position.clone().sub(target).normalize();
      this.persp.position.copy(target).addScaledVector(dir, halfH / tanH);
      this.persp.quaternion.copy(this.ortho.quaternion);
      this.persp.updateProjectionMatrix();
      this.camera = this.persp;
    }
    this.controls.object = this.camera;
    this.controls.update();
    this.dirty = true;
  }

  /** ตัวคูณการเสียรูปที่ใช้วาด (ตรงกับ setResult "deformed") */
  deformFactor(res: AnalysisResult3, scale: number): number {
    if (!this.model) return 0;
    let maxD = 0;
    for (const m of this.model.members) if (this.visible.has(m.id)) for (const s of res.members[m.id]?.stations ?? []) maxD = Math.max(maxD, Math.hypot(s.v, s.w));
    for (const d of Object.values(res.disp)) maxD = Math.max(maxD, Math.hypot(d.ux, d.uy, d.uz));
    return maxD > 0 ? ((this.extent * 0.05) / maxD) * scale : 0;
  }

  private markerGroup = new THREE.Group();
  /** จุดเครื่องหมาย (เช่น จุดหมุนพลาสติก) — ขนาดสัมพันธ์กับขนาดอาคาร */
  setMarkers(list: { x: number; y: number; z: number; color: string; big?: boolean }[]) {
    if (!this.markerGroup.parent) this.scene.add(this.markerGroup);
    this.clear(this.markerGroup);
    const r = Math.max(0.12, this.extent * 0.009);
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    for (const m of list) {
      let mat = mats.get(m.color);
      if (!mat) { mat = new THREE.MeshBasicMaterial({ color: m.color, depthTest: false }); mats.set(m.color, mat); }
      const s = new THREE.Mesh(geo, mat);
      s.scale.setScalar(m.big ? r * 1.8 : r);
      s.position.set(m.x, m.y, m.z);
      s.renderOrder = 950;
      this.markerGroup.add(s);
    }
    this.dirty = true;
  }

  /** ผลการวิเคราะห์: การเสียรูปหรือแผนภาพ */
  setResult(res: AnalysisResult3 | null, display: Display3, scale: number) {
    this.clear(this.resultGroup);
    const plain = display === "model" || display === "design" || !res;
    this.plainDisplay = plain;
    this.applySolidOpacity();
    if (this.memberLines) (this.memberLines.material as LineMaterial).opacity = plain ? 1 : 0.35;
    if (this.memberLines) (this.memberLines.material as LineMaterial).transparent = !plain;
    if (plain || !this.model || !res) { this.dirty = true; return; }
    const nodes = new Map(this.model.nodes.map((n) => [n.id, n]));
    const members = this.model.members.filter((m) => this.visible.has(m.id));

    if (display === "deformed") {
      let maxD = 0;
      for (const m of members) for (const s of res.members[m.id].stations) maxD = Math.max(maxD, Math.hypot(s.v, s.w));
      for (const d of Object.values(res.disp)) maxD = Math.max(maxD, Math.hypot(d.ux, d.uy, d.uz));
      const k = maxD > 0 ? ((this.extent * 0.05) / maxD) * scale : 0;
      const pos: number[] = [];
      for (const m of members) {
        const mr = res.members[m.id];
        const a = nodes.get(m.i)!;
        const { ex, ey, ez } = mr.axes;
        const di = res.disp[m.i], dj = res.disp[m.j];
        const ui = ex[0] * di.ux + ex[1] * di.uy + ex[2] * di.uz, uj = ex[0] * dj.ux + ex[1] * dj.uy + ex[2] * dj.uz;
        const P = mr.stations.map((s) => {
          const u = ui + ((uj - ui) * s.x) / mr.L;
          return [0, 1, 2].map((c) => [a.x, a.y, a.z][c] + ex[c] * s.x + k * (ex[c] * u + ey[c] * s.v + ez[c] * s.w));
        });
        for (let i = 0; i < P.length - 1; i++) pos.push(...P[i], ...P[i + 1]);
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(pos);
      this.resultGroup.add(new LineSegments2(g, this.lineMat(css("--load", "#d6452f"), 2)));
      this.dirty = true;
      return;
    }

    // แผนภาพ: Mz ในระนาบ 1-2 (วาดด้านรับแรงดึง: −ey), My ในระนาบ 1-3 (+ez), N/T ใน ey
    const key = display;
    let maxAbs = 0;
    for (const m of members) for (const s of res.members[m.id].stations) maxAbs = Math.max(maxAbs, Math.abs(s[key]));
    const k = maxAbs > 0 ? ((this.extent * 0.06) / maxAbs) * scale : 0;
    const tri: number[] = [], outline: number[] = [];
    for (const m of members) {
      const mr = res.members[m.id];
      const a = nodes.get(m.i)!;
      const { ex, ey, ez } = mr.axes;
      const dir: Vec3 = key === "Mz" ? [-ey[0], -ey[1], -ey[2]] : key === "My" ? ez : ey;
      const base = (x: number) => [a.x + ex[0] * x, a.y + ex[1] * x, a.z + ex[2] * x];
      const tips = mr.stations.map((s) => { const b = base(s.x); const o = s[key] * k; return [b[0] + dir[0] * o, b[1] + dir[1] * o, b[2] + dir[2] * o]; });
      const bases = mr.stations.map((s) => base(s.x));
      for (let i = 0; i < tips.length - 1; i++) {
        tri.push(...bases[i], ...bases[i + 1], ...tips[i + 1], ...bases[i], ...tips[i + 1], ...tips[i]);
        outline.push(...tips[i], ...tips[i + 1]);
      }
      outline.push(...bases[0], ...tips[0], ...bases[bases.length - 1], ...tips[tips.length - 1]);
    }
    const color = key === "N" ? css("--warn", "#b7791f") : key === "T" ? css("--column", "#7a4cc2") : css("--accent", "#1f6feb");
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
    this.resultGroup.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })));
    const og = new LineSegmentsGeometry();
    og.setPositions(outline);
    this.resultGroup.add(new LineSegments2(og, this.lineMat(color, 1.5)));

    // ตัวเลขที่ค่าสูงสุด/ต่ำสุดของแต่ละชิ้น (≥ 25% ของค่าสูงสุดรวม, ไม่เกิน 120 ป้าย)
    if (this.showValues && maxAbs > 0) {
      const cand: { v: number; p: number[] }[] = [];
      for (const m of members) {
        const mr = res.members[m.id];
        const a = nodes.get(m.i)!;
        const { ex, ey, ez } = mr.axes;
        const dir: Vec3 = key === "Mz" ? [-ey[0], -ey[1], -ey[2]] : key === "My" ? ez : ey;
        let iMax = 0, iMin = 0;
        mr.stations.forEach((st, i) => { if (st[key] > mr.stations[iMax][key]) iMax = i; if (st[key] < mr.stations[iMin][key]) iMin = i; });
        const idx = key === "N" || key === "T" ? [Math.abs(mr.stations[iMax][key]) >= Math.abs(mr.stations[iMin][key]) ? iMax : iMin] : [iMax, iMin];
        for (const i of new Set(idx)) {
          const st = mr.stations[i];
          if (Math.abs(st[key]) < 0.25 * maxAbs) continue;
          const o = st[key] * k * 1.08;
          cand.push({ v: st[key], p: [a.x + ex[0] * st.x + dir[0] * o, a.y + ex[1] * st.x + dir[1] * o, a.z + ex[2] * st.x + dir[2] * o] });
        }
      }
      cand.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
      const h = this.extent * 0.02;
      for (const c of cand.slice(0, 120)) {
        const t = makeTextSprite(this.valueFormat(c.v, key), h, { color: "#1d2430", bg: "rgba(255,255,255,0.86)" });
        t.position.set(c.p[0], c.p[1], c.p[2]);
        this.resultGroup.add(t);
      }
    }
    this.dirty = true;
  }

  /** แสดงตัวเลขบนแผนภาพ */
  showValues = true;
  /** รูปแบบตัวเลข (ตั้งจากหน้าจอ เพื่อรองรับการเปลี่ยนหน่วย) */
  valueFormat: (v: number, key: Display3) => string = (v) => v.toFixed(1);

  get solidView() { return this.solid; }
  get axesVisible() { return this.showAxes; }

  setShowAxes(on: boolean) {
    this.showAxes = on;
    if (this.originAxes) this.originAxes.visible = on;
    this.dirty = true;
  }

  setSolid(on: boolean) {
    this.solid = on;
    this.buildSolids();
  }

  /** แท่งตามขนาดจริง: กล่องหน่วยถูกย่อขยายเป็น L × h × b และหมุนตามแกน local (1, 2, 3) */
  private buildSolids() {
    this.clear(this.solidGroup);
    this.solidMesh = null;
    if (this.memberLines) this.memberLines.visible = !this.solid; // เส้นยังใช้คลิกเลือกได้แม้ซ่อนอยู่
    if (!this.solid || !this.model) { this.dirty = true; return; }
    const m = this.model;
    const nodes = new Map(m.nodes.map((n) => [n.id, n]));
    const secs = new Map(m.sections.map((x) => [x.id, x]));
    const mems = new Map(m.members.map((x) => [x.id, x]));
    const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.memberIds.length);
    const M = new THREE.Matrix4(), S = new THREE.Matrix4(), c = new THREE.Color();
    const edge: number[] = [];
    const v = new THREE.Vector3();
    const corner = (i: number, mat: THREE.Matrix4) => { v.set(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(mat); return [v.x, v.y, v.z]; };
    this.memberIds.forEach((id, k) => {
      const mem = mems.get(id)!, sec = secs.get(mem.section);
      const a = nodes.get(mem.i)!, b = nodes.get(mem.j)!;
      const ax = memberAxes(a, b, mem.beta);
      M.makeBasis(new THREE.Vector3(...ax.ex), new THREE.Vector3(...ax.ey), new THREE.Vector3(...ax.ez));
      // แขนแข็งของผนังไม่วาดเป็นแท่ง (อยู่ในเนื้อผนัง)
      M.multiply(mem.kind === "link" ? S.makeScale(1e-6, 1e-6, 1e-6) : S.makeScale(ax.L, sec?.h ?? 0.3, sec?.b ?? 0.3));
      M.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      mesh.setMatrixAt(k, M);
      c.setRGB(this.baseColors[6 * k], this.baseColors[6 * k + 1], this.baseColors[6 * k + 2]);
      if (this.concrete) c.set("#b9bcc0");
      mesh.setColorAt(k, c);
      // ขอบแท่ง 12 เส้น
      for (const [p, q] of BOX_EDGES) {
        edge.push(...corner(p, M), ...corner(q, M));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.solidMesh = mesh;
    this.solidGroup.add(mesh);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(edge, 3));
    this.solidEdges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: "#1d2430", transparent: true, opacity: 0.45 }));
    this.solidGroup.add(this.solidEdges);
    // ขอบแท่งบางๆ ให้เห็นรูปทรงชัด
    this.applySolidOpacity();
    this.dirty = true;
  }

  get concreteColor() { return this.concrete; }
  setConcrete(on: boolean) { this.concrete = on; this.buildSolids(); }

  private applySolidOpacity() {
    if (this.solidEdges) (this.solidEdges.material as THREE.LineBasicMaterial).opacity = this.plainDisplay ? 0.45 : 0.12;
    if (!this.solidMesh) return;
    const mat = this.solidMesh.material as THREE.MeshLambertMaterial;
    mat.transparent = !this.plainDisplay;
    mat.opacity = this.plainDisplay ? 1 : 0.25;
    mat.depthWrite = this.plainDisplay;
    mat.needsUpdate = true;
  }

  private setSolidColors(col: number[]) {
    if (!this.solidMesh) return;
    const gray = this.concrete && col === this.baseColors; // สีตามชนิด → ใช้สีคอนกรีตแทน
    const c = new THREE.Color();
    for (let k = 0; k < this.memberIds.length; k++) {
      if (gray) c.set("#b9bcc0"); else c.setRGB(col[6 * k], col[6 * k + 1], col[6 * k + 2]);
      this.solidMesh.setColorAt(k, c);
    }
    if (this.solidMesh.instanceColor) this.solidMesh.instanceColor.needsUpdate = true;
  }

  /** ระบายสีชิ้นส่วนตามอัตราส่วนกำลัง (null = สีตามชนิด) */
  setRatioColors(ratios: Record<string, number> | null) {
    if (!this.memberLines) return;
    const geo = this.memberLines.geometry as LineSegmentsGeometry;
    if (!ratios) { geo.setColors(this.baseColors); this.setSolidColors(this.baseColors); this.dirty = true; return; }
    const ok = new THREE.Color(css("--ok", "#0d8a5f")), warn = new THREE.Color(css("--warn", "#b7791f")), bad = new THREE.Color(css("--bad", "#c9302c")), none = new THREE.Color(css("--muted", "#6b7584"));
    const col: number[] = [];
    for (const id of this.memberIds) {
      const r = ratios[id];
      const c = r === undefined ? none : r > 1 ? bad : r > 0.85 ? warn : ok.clone().lerp(warn, Math.max(0, (r - 0.5) / 0.35));
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    geo.setColors(col);
    this.setSolidColors(col);
    this.dirty = true;
  }

  private hoverGroup = new THREE.Group();
  /** เน้นชิ้นส่วนใต้เมาส์ (เส้นส้มบาง) */
  setHover(id: string | null) {
    if (!this.hoverGroup.parent) this.scene.add(this.hoverGroup);
    this.clear(this.hoverGroup);
    const m = id && this.model?.members.find((x) => x.id === id);
    if (m && this.model) {
      const a = this.model.nodes.find((n) => n.id === m.i)!, b = this.model.nodes.find((n) => n.id === m.j)!;
      const g = new LineSegmentsGeometry();
      g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const mat = this.lineMat("#ff9f1a", 5);
      mat.depthTest = false;
      const line = new LineSegments2(g, mat);
      line.renderOrder = 990;
      this.hoverGroup.add(line);
    }
    this.dirty = true;
  }

  /** เน้นชิ้นส่วนที่เลือก: เส้นเหลืองสดมีขอบเข้ม แสดงทับทุกอย่าง (มองเห็นได้ทั้งโหมดสว่าง/มืด) */
  setSelection(id: string | null) {
    this.clear(this.selGroup);
    if (id && this.model) {
      const m = this.model.members.find((x) => x.id === id);
      const nodes = new Map(this.model.nodes.map((n) => [n.id, n]));
      if (m) {
        const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
        const pos = [a.x, a.y, a.z, b.x, b.y, b.z];
        const layer = (color: string, width: number, order: number) => {
          const g = new LineSegmentsGeometry();
          g.setPositions(pos);
          const mat = this.lineMat(color, width);
          mat.depthTest = false;
          const line = new LineSegments2(g, mat);
          line.renderOrder = order;
          this.selGroup.add(line);
        };
        layer("#1a1a1a", 11, 998); // ขอบเข้ม
        layer("#ffd400", 7, 999); // เหลืองสด
        // จุดปลายทั้งสอง
        const pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: "#ffd400", size: 11, sizeAttenuation: false, depthTest: false }));
        pts.renderOrder = 1000;
        this.selGroup.add(pts);
      }
    }
    this.dirty = true;
  }

  /** ฐานราก: กล่องใต้จุดรองรับ (ยอดฐานที่ระดับจุดรองรับ) และเข็มยาว 2 m — เน้นฐานที่เลือกด้วยสีเหลือง */
  setFootings(list: { node: string; L: number; B: number; t: number; ok: boolean; piles: { x: number; y: number }[] | null; D: number }[], selected: string | null) {
    this.clear(this.footGroup);
    if (!this.model) return;
    const nodes = new Map(this.model.nodes.map((n) => [n.id, n]));
    const okC = css("--muted", "#6b7584"), badC = css("--bad", "#c9302c");
    for (const ft of list) {
      const n = nodes.get(ft.node);
      if (!n || !ft.L) continue;
      const sel = ft.node === selected;
      const color = sel ? "#ffd400" : ft.ok ? okC : badC;
      const box = new THREE.BoxGeometry(ft.L, ft.B, ft.t);
      const mesh = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: sel ? 0.75 : 0.35, depthWrite: false }));
      mesh.position.set(n.x, n.y, n.z - ft.t / 2);
      mesh.userData.node = ft.node;
      this.footGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: sel ? "#1a1a1a" : color }));
      edges.position.copy(mesh.position);
      this.footGroup.add(edges);
      if (ft.piles) {
        const pg = new THREE.BoxGeometry(ft.D, ft.D, 2);
        const pm = new THREE.MeshLambertMaterial({ color: sel ? "#ffd400" : okC, transparent: true, opacity: 0.5, depthWrite: false });
        for (const p of ft.piles) {
          const pile = new THREE.Mesh(pg, pm);
          pile.position.set(n.x + p.x, n.y + p.y, n.z - ft.t - 1);
          this.footGroup.add(pile);
        }
      }
    }
    this.dirty = true;
  }

  /** แผ่นพื้น (สีตามแบบ S-1, S-2 …) */
  setSlabs(list: { x0: number; y0: number; x1: number; y1: number; z: number; color: string; label?: string }[]) {
    this.clear(this.slabGroup);
    const lbl = Math.max(0.25, this.extent * 0.012);
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const s of list) {
      let m = mats.get(s.color);
      if (!m) { m = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }); mats.set(s.color, m); }
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.set(s.x1 - s.x0, s.y1 - s.y0, 1);
      mesh.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, s.z - 0.005);
      this.slabGroup.add(mesh);
      if (s.label) {
        const t = makeTextSprite(s.label, lbl, { color: "#1d2430", bg: "rgba(255,255,255,0.78)" });
        t.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, s.z + 0.02);
        this.slabGroup.add(t);
      }
    }
    this.dirty = true;
  }

  /** หลังคาโครงเหล็ก: เส้นโครงถัก/แป และผิวหลังคาโปร่งแสง (สามเหลี่ยม) */
  setRoof(data: { lines: number[][]; tris: number[][]; ok: boolean } | null) {
    this.clear(this.roofGroup);
    if (data) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(data.lines.flat(), 3));
      this.roofGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: data.ok ? 0xb45309 : 0xef4444 })));
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.Float32BufferAttribute(data.tris.flat(), 3));
      this.roofGroup.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })));
    }
    this.dirty = true;
  }

  /** น้ำหนักบรรทุก: แรงแผ่บนคาน (ลูกศรเรียง) และแรงที่จุด */
  setLoads(data: { udl: { a: number[]; b: number[]; w: number; dir: number[] }[]; nodal: { p: number[]; f: number[] }[]; label?: (v: number) => string } | null) {
    this.clear(this.loadGroup);
    if (!data) { this.dirty = true; return; }
    const wMax = Math.max(1e-9, ...data.udl.map((u) => Math.abs(u.w)));
    const fMax = Math.max(1e-9, ...data.nodal.map((n) => Math.hypot(n.f[0], n.f[1], n.f[2])));
    const unit = this.extent * 0.035, step = Math.max(this.extent * 0.025, 0.35);
    const udlColor = "#ff7a59", nodColor = "#2fb3ff";
    const lineMat = new THREE.LineBasicMaterial({ color: udlColor });
    for (const u of data.udl) {
      const A = new THREE.Vector3(...u.a), B = new THREE.Vector3(...u.b);
      const L = A.distanceTo(B);
      const n = Math.max(2, Math.round(L / step));
      const len = unit * (0.35 + 0.65 * Math.abs(u.w) / wMax);
      const dir = new THREE.Vector3(...u.dir).normalize().multiplyScalar(Math.sign(u.w) || 1);
      const tails: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k++) {
        const tip = A.clone().lerp(B, k / n);
        const tail = tip.clone().addScaledVector(dir, -len);
        const ar = makeArrow(dir, udlColor, len, len * 0.025);
        ar.position.copy(tail);
        this.loadGroup.add(ar);
        tails.push(tail);
      }
      this.loadGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tails), lineMat));
      if (data.label && data.udl.length <= 160) {
        const t = makeTextSprite(data.label(Math.abs(u.w)), Math.max(0.22, this.extent * 0.011), { color: "#ffffff", bg: "rgba(201,74,44,0.85)" });
        t.position.copy(tails[Math.floor(tails.length / 2)]).addScaledVector(dir, -len * 0.25);
        this.loadGroup.add(t);
      }
    }
    for (const q of data.nodal) {
      const F = new THREE.Vector3(...q.f);
      const mag = F.length();
      if (mag < 1e-9) continue;
      const len = this.extent * 0.09 * (0.35 + 0.65 * mag / fMax);
      const tip = new THREE.Vector3(...q.p);
      const ar = makeArrow(F, nodColor, len, len * 0.03);
      ar.position.copy(tip.clone().addScaledVector(F.clone().normalize(), -len));
      this.loadGroup.add(ar);
      if (data.label) {
        const t = makeTextSprite(data.label(mag), Math.max(0.22, this.extent * 0.012), { color: "#ffffff", bg: "rgba(20,110,170,0.88)" });
        t.position.copy(tip.clone().addScaledVector(F.clone().normalize(), -len * 1.1));
        this.loadGroup.add(t);
      }
    }
    this.dirty = true;
  }

  /** หาฐานรากใต้ตำแหน่งเมาส์ */
  pickFooting(ev: MouseEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.footGroup.children.filter((c) => c.userData.node), false)[0];
    return (hit?.object.userData.node as string) ?? null;
  }

  /** หาชิ้นส่วนใต้ตำแหน่งเมาส์ */
  pick(ev: MouseEvent): string | null {
    if (!this.memberLines) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // โหมดขนาดจริง: ชี้ที่ผิวแท่งได้เลย
    if (this.solid && this.solidMesh) {
      const hs = ray.intersectObject(this.solidMesh);
      if (hs.length && hs[0].instanceId !== undefined) return this.memberIds[hs[0].instanceId] ?? null;
    }
    (ray.params as { Line2?: { threshold: number } }).Line2 = { threshold: 6 };
    const hits = ray.intersectObject(this.memberLines);
    if (!hits.length) return null;
    const idx = (hits[0] as THREE.Intersection & { faceIndex?: number }).faceIndex;
    return idx !== undefined ? this.memberIds[idx] ?? null : null;
  }

  /** ตำแหน่งจอของจุดใน 3D (ใช้วางป้าย) */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.host.clientWidth, y: ((1 - v.y) / 2) * this.host.clientHeight };
  }
}
