// ฉาก 3D ด้วย Three.js: โมเดล, การเสียรูป, แผนภาพแรงภายใน, การเลือกชิ้นส่วน
// แกน: Z ขึ้น (ตรงกับตัววิเคราะห์)

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { AnalysisResult3 } from "../core3d/frame3d.ts";
import type { Model3, Vec3 } from "../core3d/model3d.ts";

export type Display3 = "model" | "deformed" | "Mz" | "My" | "N" | "T";
export type ViewDir = "iso" | "plan" | "x" | "y";

const css = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private host: HTMLElement;
  private modelGroup = new THREE.Group();
  private resultGroup = new THREE.Group();
  private selGroup = new THREE.Group();
  private gridGroup = new THREE.Group();
  private memberLines: LineSegments2 | null = null;
  private memberIds: string[] = [];
  private materials: LineMaterial[] = [];
  private model: Model3 | null = null;
  private visible = new Set<string>();
  private extent = 10;
  private center = new THREE.Vector3();
  private dirty = true;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => { this.dirty = true; });
    this.scene.add(this.gridGroup, this.modelGroup, this.resultGroup, this.selGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(1, -2, 3);
    this.scene.add(dl);
    new ResizeObserver(() => this.resize()).observe(host);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    this.applyTheme();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
    };
    loop();
  }

  private applyTheme() {
    this.scene.background = new THREE.Color(css("--canvas", "#ffffff"));
    this.dirty = true;
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
      const o = c as THREE.Mesh;
      o.geometry?.dispose?.();
      const mat = o.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat?.dispose?.();
      if (mat instanceof LineMaterial) this.materials = this.materials.filter((x) => x !== mat);
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
    };
    for (const m of model.members) {
      if (!this.visible.has(m.id)) continue;
      const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const c = colors[m.kind] ?? colors.other;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      this.memberIds.push(m.id);
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = this.lineMat("#ffffff", 2.5);
    mat.vertexColors = true;
    this.memberLines = new LineSegments2(geo, mat);
    this.modelGroup.add(this.memberLines);

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
    this.controls.target.copy(c);
    this.controls.update();
    this.dirty = true;
  }

  /** ผลการวิเคราะห์: การเสียรูปหรือแผนภาพ */
  setResult(res: AnalysisResult3 | null, display: Display3, scale: number) {
    this.clear(this.resultGroup);
    if (this.memberLines) (this.memberLines.material as LineMaterial).opacity = display === "model" || !res ? 1 : 0.35;
    if (this.memberLines) (this.memberLines.material as LineMaterial).transparent = display !== "model" && !!res;
    if (!res || display === "model" || !this.model) { this.dirty = true; return; }
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
    this.dirty = true;
  }

  setSelection(id: string | null) {
    this.clear(this.selGroup);
    if (id && this.model) {
      const m = this.model.members.find((x) => x.id === id);
      const nodes = new Map(this.model.nodes.map((n) => [n.id, n]));
      if (m) {
        const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
        const g = new LineSegmentsGeometry();
        g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
        this.selGroup.add(new LineSegments2(g, this.lineMat(css("--accent", "#1f6feb"), 6)));
      }
    }
    this.dirty = true;
  }

  /** หาชิ้นส่วนใต้ตำแหน่งเมาส์ */
  pick(ev: MouseEvent): string | null {
    if (!this.memberLines) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
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
