import "../style.css";
import "./style3d.css";
import { Scene3D, type Display3, type ViewDir } from "./scene.ts";
import { defaultGrid, generateBuilding, type GridParams, type WindLevel3 } from "./generator.ts";
import { runAll3, storeyDrifts, type Run3 } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import { IMPORTANCE, ZONES, type Importance, type WindZone } from "../loads/windTH.ts";
import { defaultDesign3, design3d, type Design3Settings, type MemberDesign3 } from "../design/design3d.ts";
import { totalBarsBiax } from "../design/rcColumnBiaxial.ts";
import { defaultFoundation, type FoundationSettings } from "../design/footing.ts";
import { designFoundations3 } from "../design/foundation3d.ts";
import type { FootingResult3 } from "../design/footing3d.ts";
import { footingPlanSvg3 } from "./plan3d.ts";
import { openReport3, type Report3Scope } from "./report3d.ts";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : v.toFixed(dp)) : "-");
const KEY = "structlab.3d.params.v1";
const SET_KEY = "structlab.3d.settings.v1"; // ตั้งค่าออกแบบ + ฐานราก (แยกจากหน้า 2D)
/** อัตราส่วน drift แบบ 1/n (ไม่แสดงเมื่อเล็กกว่า 1/100,000 ซึ่งเป็นเศษทศนิยม) */
const ratio = (d: number) => (Math.abs(d) < 1e-5 ? "–" : `1/${Math.round(1 / Math.abs(d)).toLocaleString()}`);

function loadParams(): GridParams {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); return { ...defaultGrid, ...p, wind: { ...defaultGrid.wind, ...(p.wind ?? {}) } }; }
  } catch { /* ไม่มี storage */ }
  return structuredClone(defaultGrid);
}

function loadSettings(): { dset: Design3Settings; fset: FoundationSettings } {
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw) { const o = JSON.parse(raw); return { dset: { ...defaultDesign3, ...(o.dset ?? {}) }, fset: { ...defaultFoundation, ...(o.fset ?? {}) } }; }
  } catch { /* ไม่มี storage */ }
  return { dset: { ...defaultDesign3 }, fset: { ...defaultFoundation } };
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify({ dset: st.dset, fset: st.fset })); } catch { /* ไม่มี storage */ }
}
const saved = loadSettings();

const st = {
  params: loadParams(),
  model: null as Model3 | null,
  wind: [] as WindLevel3[],
  run: null as Run3 | null,
  error: null as string | null,
  display: "model" as Display3,
  resultKey: "combo:U1",
  scale: 1,
  selection: null as string | null,
  level: null as number | null,
  dset: saved.dset,
  fset: saved.fset,
  design: null as Record<string, MemberDesign3> | null,
  footings: null as Record<string, FootingResult3> | null,
  footSel: null as string | null,
};

const scene = new Scene3D($("#view3d"));

// ---------- สร้างโมเดลและวิเคราะห์ ----------
function rebuild() {
  try {
    const { model, wind } = generateBuilding(st.params);
    st.model = model; st.wind = wind; st.error = null;
  } catch (e) {
    st.error = (e as Error).message;
    renderAll();
    return;
  }
  try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
  st.selection = null;
  st.footSel = null;
  st.footings = null;
  st.run = null;
  scene.setModel(st.model, st.level);
  scene.setView("iso");
  renderAll();
  $("#busy").hidden = false;
  setTimeout(() => {
    try { st.run = runAll3(st.model!); st.error = null; } catch (e) { st.error = (e as Error).message; }
    renderAll();
    runDesign();
  }, 30);
}

function runDesign() {
  st.design = null;
  st.footings = null;
  saveSettings();
  if (!st.run || !st.model) { $("#busy").hidden = true; return; }
  $("#busy").textContent = "กำลังออกแบบ…";
  $("#busy").hidden = false;
  setTimeout(() => {
    try { st.design = design3d(st.model!, st.run!, st.dset); } catch (e) { st.error = (e as Error).message; }
    try { st.footings = designFoundations3(st.model!, st.run!, st.fset, st.dset.code).footings; } catch (e) { st.error = `ฐานราก: ${(e as Error).message}`; }
    $("#busy").hidden = true;
    $("#busy").textContent = "กำลังคำนวณ…";
    renderAll();
  }, 20);
}

const current = () => st.run?.results[st.resultKey] ?? null;

function renderAll() {
  syncToolbar();
  renderLeft();
  renderRight();
  renderStatus();
  scene.setResult(current(), st.display, st.scale);
  scene.setRatioColors(st.display === "design" && st.design ? Object.fromEntries(Object.entries(st.design).map(([k, v]) => [k, v.ratio])) : null);
  scene.setSelection(st.selection);
  scene.setFootings(st.footings ? Object.entries(st.footings).map(([node, ft]) => ({ node, L: ft.L, B: ft.B, t: ft.t, ok: ft.ok, piles: ft.piles?.coords ?? null, D: st.fset.pileSize })) : [], st.footSel);
}

// ---------- แถบเครื่องมือ ----------
function syncToolbar() {
  $<HTMLButtonElement>("#btn-report3d").disabled = !st.design;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) b.classList.toggle("active", b.dataset.display === st.display);
  const m = st.model;
  const sel = $<HTMLSelectElement>("#sel-result");
  const opts = m ? [...m.combos.map((c) => [`combo:${c.id}`, `ชุดผสม: ${c.name}`]), ...m.loadCases.map((c) => [`case:${c.id}`, `Load case: ${c.name}`])] : [];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === st.resultKey ? "selected" : ""}>${esc(l)}</option>`).join("");
  const lv = $<HTMLSelectElement>("#sel-level");
  const zs = m ? [...new Set(m.nodes.map((n) => +n.z.toFixed(3)))].sort((a, b) => a - b).slice(1) : [];
  lv.innerHTML = `<option value="">ทั้งหมด</option>` + zs.map((z, k) => `<option value="${z}" ${st.level === z ? "selected" : ""}>ชั้น ${k + 1} (z = ${f(z)})</option>`).join("");
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) {
  b.onclick = () => { st.display = b.dataset.display as Display3; renderAll(); };
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.onclick = () => scene.setView(b.dataset.view as ViewDir);
$<HTMLSelectElement>("#sel-result").onchange = (e) => { st.resultKey = (e.target as HTMLSelectElement).value; renderAll(); };
$<HTMLInputElement>("#scale").oninput = (e) => { st.scale = parseFloat((e.target as HTMLInputElement).value); scene.setResult(current(), st.display, st.scale); };
$<HTMLSelectElement>("#sel-level").onchange = (e) => {
  const v = (e.target as HTMLSelectElement).value;
  st.level = v === "" ? null : parseFloat(v);
  if (st.model) scene.setModel(st.model, st.level);
  renderAll();
};

// คลิกเลือก (แยกจากการลากหมุนกล้อง)
let down: { x: number; y: number } | null = null;
const canvas = scene.renderer.domElement;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  st.selection = scene.pick(e);
  st.footSel = st.selection ? null : scene.pickFooting(e);
  renderAll();
});

// ---------- แผงซ้าย: ตัวสร้างโมเดล ----------
function renderLeft() {
  const p = st.params;
  const w = p.wind;
  const opt = <T extends string>(cur: T, list: [T, string][]) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#left-body").innerHTML = `
    <div class="card"><div class="card-h">สร้างอาคารจากกริด</div>
      <div class="form g3">
        <label class="span3">ชื่อโปรเจกต์<input id="g-name" type="text" value="${esc(p.name)}"/></label>
        <label title="เช่น 3@5 หรือ 5,4,5">ช่วงแกน X (m)<input id="g-x" type="text" value="${esc(p.xSpacing)}"/></label>
        <label>ช่วงแกน Y (m)<input id="g-y" type="text" value="${esc(p.ySpacing)}"/></label>
        <label title="ความสูงชั้น ล่างสุดก่อน เช่น 4,3@3.5">ความสูงชั้น (m)<input id="g-z" type="text" value="${esc(p.storeys)}"/></label>
        <label>เสา b (m)<input id="g-cb" type="number" step="0.05" value="${p.col.b}"/></label>
        <label>เสา h (m)<input id="g-ch" type="number" step="0.05" value="${p.col.h}"/></label>
        <label>fc' (ksc)<input id="g-fc" type="number" step="10" value="${p.fcKsc}"/></label>
        <label>คาน b (m)<input id="g-bb" type="number" step="0.05" value="${p.beam.b}"/></label>
        <label>คาน h (m)<input id="g-bh" type="number" step="0.05" value="${p.beam.h}"/></label>
        <label>fy (ksc)<input id="g-fy" type="number" step="100" value="${p.fyKsc}"/></label>
      </div>
      <div class="sub-h">น้ำหนักบนคาน (kN/m)</div>
      <div class="form g3">
        <label>SDL พื้น<input id="g-sdl" type="number" step="1" value="${p.sdl}"/></label>
        <label>LL พื้น<input id="g-ll" type="number" step="1" value="${p.ll}"/></label>
        <label><span><input id="g-dia" type="checkbox" ${p.diaphragm ? "checked" : ""}/> พื้นแข็ง</span></label>
        <label>SDL หลังคา<input id="g-sdlr" type="number" step="1" value="${p.sdlRoof}"/></label>
        <label>LL หลังคา<input id="g-llr" type="number" step="1" value="${p.llRoof}"/></label>
      </div>
      <div class="sub-h">แรงลม มยผ. 1311-50 (วิธีอย่างง่าย)</div>
      <div class="form g3">
        <label class="span2">พื้นที่<select id="g-zone">${opt(w.zone, Object.entries(ZONES).map(([k, v]) => [k as WindZone, v.label]))}</select></label>
        <label>ภูมิประเทศ<select id="g-exp">${opt(w.exposure, [["A", "A โล่ง"], ["B", "B เมือง"]])}</select></label>
        <label class="span2">ความสำคัญ<select id="g-imp">${opt(w.importance, Object.entries(IMPORTANCE).map(([k, v]) => [k as Importance, v.label]))}</select></label>
        <label>Cg<input id="g-cg" type="number" step="0.1" value="${w.Cg}"/></label>
      </div>
      <div class="sub-h">การวิเคราะห์</div>
      <div class="form g3">
        <label title="วิเคราะห์อันดับสอง (P-Δ ทั้งอาคาร + P-δ ตามความยาวชิ้นส่วน) — ACI 6.7"><span><input id="g-pd" type="checkbox" ${p.pDelta ? "checked" : ""}/> P-Δ</span></label>
        <label class="span2" title="ACI 6.6.3.1.1: เสา 0.70Ig, คาน 0.35Ig"><span><input id="g-cr" type="checkbox" ${p.cracked ? "checked" : ""}/> หน้าตัดแตกร้าว</span></label>
      </div>
      <button id="g-build" class="primary wide">สร้างโมเดลและวิเคราะห์</button>
      ${st.error ? `<p class="warn">${esc(st.error)}</p>` : ""}
    </div>
    <div class="card"><div class="card-h">ตั้งค่าการออกแบบ</div><div class="form g3">
      <label class="span2">มาตรฐาน<select id="d-code"><option value="EIT" ${st.dset.code === "EIT" ? "selected" : ""}>วสท. 1008-38</option><option value="ACI" ${st.dset.code === "ACI" ? "selected" : ""}>ACI 318-19</option></select></label>
      <label>หุ้ม (mm)<input id="d-cover" type="number" value="${st.dset.cover}"/></label>
      <label>ปลอก Ø<select id="d-sd">${[6, 9, 10, 12].map((d) => `<option ${d === st.dset.stirrupDia ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>จำนวนขา<input id="d-legs" type="number" min="2" value="${st.dset.stirrupLegs}"/></label>
    </div></div>
    ${foundationCard()}
    ${st.wind.length ? `<div class="card"><div class="card-h">แรงลมรายชั้น (kN)</div>
      <table class="mini"><thead><tr><th>ชั้น</th><th>z (m)</th><th>WX</th><th>WY</th></tr></thead><tbody>
      ${st.wind.map((l, k) => `<tr><td>${k + 1}</td><td>${f(l.z)}</td><td>${f(l.FX)}</td><td>${f(l.FY)}</td></tr>`).join("")}
      <tr><td colspan="2"><b>แรงเฉือนฐาน</b></td><td><b>${f(st.wind.reduce((a, l) => a + l.FX, 0))}</b></td><td><b>${f(st.wind.reduce((a, l) => a + l.FY, 0))}</b></td></tr>
      </tbody></table>
      <p class="muted small">กระทำที่จุดอ้างอิงพื้นแข็งแต่ละชั้น (ยังไม่คิดการเยื้องศูนย์โดยบังเอิญ)</p></div>` : ""}`;

  const setD = (patch: Partial<Design3Settings>) => { st.dset = { ...st.dset, ...patch }; runDesign(); };
  $<HTMLSelectElement>("#d-code").onchange = (e) => setD({ code: (e.target as HTMLSelectElement).value as "EIT" | "ACI" });
  $<HTMLInputElement>("#d-cover").onchange = (e) => setD({ cover: parseFloat((e.target as HTMLInputElement).value) || 40 });
  $<HTMLSelectElement>("#d-sd").onchange = (e) => setD({ stirrupDia: parseFloat((e.target as HTMLSelectElement).value) });
  $<HTMLInputElement>("#d-legs").onchange = (e) => setD({ stirrupLegs: Math.max(2, parseInt((e.target as HTMLInputElement).value) || 2) });
  bindFoundation();
  const num = (id: string) => parseFloat($<HTMLInputElement>(`#${id}`).value);
  $("#g-build").onclick = () => {
    const z = $<HTMLSelectElement>("#g-zone").value as WindZone;
    const imp = $<HTMLSelectElement>("#g-imp").value as Importance;
    st.params = {
      ...st.params,
      name: $<HTMLInputElement>("#g-name").value,
      xSpacing: $<HTMLInputElement>("#g-x").value, ySpacing: $<HTMLInputElement>("#g-y").value, storeys: $<HTMLInputElement>("#g-z").value,
      col: { b: num("g-cb"), h: num("g-ch") }, beam: { b: num("g-bb"), h: num("g-bh") },
      fcKsc: num("g-fc"), fyKsc: num("g-fy"),
      sdl: num("g-sdl"), ll: num("g-ll"), sdlRoof: num("g-sdlr"), llRoof: num("g-llr"),
      diaphragm: $<HTMLInputElement>("#g-dia").checked,
      pDelta: $<HTMLInputElement>("#g-pd").checked,
      cracked: $<HTMLInputElement>("#g-cr").checked,
      wind: { ...st.params.wind, zone: z, V50: ZONES[z].V50, TF: ZONES[z].TF, importance: imp, Iw: IMPORTANCE[imp].Iw, exposure: $<HTMLSelectElement>("#g-exp").value as "A" | "B", Cg: num("g-cg") },
    };
    rebuild();
  };
}

// ---------- แผงขวา ----------
function renderRight() {
  const m = st.model, r = current();
  const parts: string[] = [];
  if (st.selection && m && r) {
    const mem = m.members.find((x) => x.id === st.selection)!;
    const mr = r.members[mem.id];
    const sec = m.sections.find((s) => s.id === mem.section);
    const ax = (v: number[]) => `(${v.map((x) => f(x, 2)).join(", ")})`;
    const end = (o: number) => mr.endForces.slice(o, o + 6);
    const [Ni, Vyi, Vzi, Ti, Myi, Mzi] = end(0), [Nj, Vyj, Vzj, Tj, Myj, Mzj] = end(6);
    parts.push(`<div class="card"><div class="card-h">${esc(mem.id)} <span class="tag">${mem.kind === "beam" ? "คาน" : mem.kind === "column" ? "เสา" : mem.kind}</span></div>
      <table class="mini"><tbody>
        <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td></tr>
        <tr><td>หน้าตัด</td><td>${esc(sec?.name ?? "-")} (h ตามแกน 2)</td></tr>
        <tr><td>ความยาว</td><td>${f(mr.L)} m</td></tr>
        <tr><td>แกน 2 / แกน 3</td><td><small>${ax(mr.axes.ey)} / ${ax(mr.axes.ez)}</small></td></tr>
        <tr><td colspan="2" class="sub">ค่าสูงสุดตามความยาว</td></tr>
        <tr><td>|N| / |T|</td><td>${f(mr.maxAbs.N)} kN / ${f(mr.maxAbs.T)} kN·m</td></tr>
        <tr><td>|V2| / |V3|</td><td>${f(mr.maxAbs.Vy)} / ${f(mr.maxAbs.Vz)} kN</td></tr>
        <tr><td>|M33| / |M22|</td><td>${f(mr.maxAbs.Mz)} / ${f(mr.maxAbs.My)} kN·m</td></tr>
      </tbody></table>
      <table class="mini ends"><thead><tr><th></th><th>N</th><th>V2</th><th>V3</th><th>T</th><th>M22</th><th>M33</th></tr></thead><tbody>
        <tr><td>i</td><td>${f(-Ni)}</td><td>${f(Vyi)}</td><td>${f(Vzi)}</td><td>${f(-Ti)}</td><td>${f(Myi)}</td><td>${f(-Mzi)}</td></tr>
        <tr><td>j</td><td>${f(Nj)}</td><td>${f(-Vyj)}</td><td>${f(-Vzj)}</td><td>${f(Tj)}</td><td>${f(-Myj)}</td><td>${f(Mzj)}</td></tr>
      </tbody></table>
      <p class="muted small">แรงภายในที่ปลาย (N ดึงบวก, M33 บวก = ท้องช้างสำหรับคาน)</p></div>`);
    const dz = st.design?.[mem.id];
    if (dz) parts.push(designCard(dz));
  }
  if (st.footSel && st.footings?.[st.footSel]) parts.push(footingCard(st.footSel, st.footings[st.footSel]));
  if (st.design) parts.push(designSummary(st.design));
  if (st.footings) parts.push(footingSummary(st.footings));
  if (m && r) {
    const drifts = storeyDrifts(m, r);
    const Rx = Object.values(r.reactions).reduce((a, x) => a + x.fx, 0), Ry = Object.values(r.reactions).reduce((a, x) => a + x.fy, 0), Rz = Object.values(r.reactions).reduce((a, x) => a + x.fz, 0);
    parts.push(`<div class="card"><div class="card-h">แรงปฏิกิริยารวม</div><table class="mini"><tbody>
      <tr><td>ΣRx / ΣRy</td><td>${f(Rx)} / ${f(Ry)} kN</td></tr><tr><td>ΣRz</td><td>${f(Rz)} kN</td></tr>
      <tr><td>ตรวจสมดุล</td><td>${f(Math.abs(Rx + r.appliedTotal.fx) + Math.abs(Ry + r.appliedTotal.fy) + Math.abs(Rz + r.appliedTotal.fz), 6)} kN</td></tr>
    </tbody></table></div>`);
    if (drifts.length) {
      parts.push(`<div class="card"><div class="card-h">การเคลื่อนตัวรายชั้น</div><table class="mini drift"><thead><tr><th>ชั้น</th><th>ux (mm)</th><th>uy (mm)</th><th>Δ/h X</th><th>Δ/h Y</th></tr></thead><tbody>
        ${drifts.map((d, k) => `<tr><td>${k + 1}</td><td>${f(d.ux * 1000)}</td><td>${f(d.uy * 1000)}</td><td>${ratio(d.driftX)}</td><td>${ratio(d.driftY)}</td></tr>`).reverse().join("")}
      </tbody></table><p class="muted small">ที่จุดอ้างอิงพื้นแข็ง (ผลจากแรงประลัยถ้าเลือกชุดผสม — ตรวจ drift ด้วย load case ลมใช้งาน)</p></div>`);
    }
  }
  if (!st.selection && !st.footSel) parts.unshift(`<p class="muted">คลิกชิ้นส่วนหรือฐานรากเพื่อดูรายละเอียด · ลากเพื่อหมุน, คลิกขวาลากเพื่อเลื่อน, ล้อเมาส์เพื่อซูม</p>`);
  $("#right-body").innerHTML = parts.join("");
  for (const b of document.querySelectorAll<HTMLButtonElement>("#right-body [data-report]")) b.onclick = () => showReport(b.dataset.report as Report3Scope);
  for (const tr of document.querySelectorAll<HTMLTableRowElement>("#right-body tr[data-node]")) {
    tr.onclick = () => { st.footSel = tr.dataset.node!; st.selection = null; renderAll(); };
  }
}

const ratioCls = (r: number) => (r > 1 ? "badc" : r > 0.85 ? "warnc" : "okc");

function designCard(d: MemberDesign3): string {
  const warn = d.warnings.map((w) => `<p class="warn small">${esc(w)}</p>`).join("");
  if (d.kind === "beam") {
    const b = d.result;
    const bar = (x: typeof b.bottom) => (x.bars ? `${x.bars.n}DB${x.bars.dia}` : "—");
    return `<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบคาน <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
      <table class="mini"><tbody>
        <tr><td>เหล็กล่าง</td><td>${bar(b.bottom)} <small>(Mu+ ${f(b.bottom.Mu)} / φMn ${f(b.bottom.phiMn)})</small></td></tr>
        <tr><td>เหล็กบน</td><td>${bar(b.top)} <small>(Mu− ${f(b.top.Mu)} / φMn ${f(b.top.phiMn)})</small></td></tr>
        <tr><td>ปลอก</td><td>${esc(b.shear.message.replace("เหล็กปลอก ", ""))} <small>(Vu ${f(b.shear.Vu)} kN)</small></td></tr>
        <tr><td>แรงบิด</td><td>${f(d.Tu)} / เกณฑ์ ${f(d.Tth)} kN·m</td></tr>
        <tr><td>อัตราส่วน</td><td><b class="${ratioCls(d.ratio)}">${f(d.ratio, 2)}</b></td></tr>
      </tbody></table>${warn}<button class="primary wide" data-report="member:${esc(st.selection ?? "")}">รายการคำนวณคานนี้</button></div>`;
  }
  const c = d.result;
  return `<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบเสา (P–M33–M22) <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
    <table class="mini"><tbody>
      <tr><td>เหล็กยืน</td><td>${c.layout ? `${totalBarsBiax(c.layout)}DB${c.layout.dia} <small>(${c.layout.n2}×${c.layout.n3})</small>` : "—"}</td></tr>
      <tr><td>ρg</td><td>${f(c.rho * 100)} %</td></tr>
      <tr><td>ปลอก</td><td>${esc(d.ties)}</td></tr>
      ${c.crit ? `<tr><td>กรณีวิกฤต</td><td>${esc(c.crit.combo)} (ปลาย ${c.crit.end})</td></tr>
      <tr><td>Pu / M33 / M22</td><td>${f(c.crit.Pu)} / ${f(Math.abs(c.crit.M3))} / ${f(Math.abs(c.crit.M2))}</td></tr>
      <tr><td>φMn (ทิศเดียวกัน)</td><td>${f(c.crit.phiMn)} kN·m</td></tr>` : ""}
      <tr><td>อัตราส่วน</td><td><b class="${ratioCls(d.ratio)}">${f(d.ratio, 2)}</b></td></tr>
    </tbody></table>${warn}${c.ok ? "" : `<p class="warn">${esc(c.message)}</p>`}<button class="primary wide" data-report="member:${esc(st.selection ?? "")}">รายการคำนวณเสานี้</button></div>`;
}

function designSummary(ds: Record<string, MemberDesign3>): string {
  const v = Object.values(ds);
  const grp = (k: "beam" | "column") => {
    const a = v.filter((x) => x.kind === k);
    return { n: a.length, fail: a.filter((x) => !x.ok).length, max: Math.max(0, ...a.map((x) => x.ratio)), warn: a.filter((x) => x.warnings.length).length };
  };
  const b = grp("beam"), c = grp("column");
  return `<div class="card"><div class="card-h">สรุปการออกแบบ</div><table class="mini"><thead><tr><th></th><th>จำนวน</th><th>ไม่ผ่าน</th><th>อัตราส่วนสูงสุด</th><th>เตือน</th></tr></thead><tbody>
    <tr><td>คาน</td><td>${b.n}</td><td>${b.fail}</td><td class="${ratioCls(b.max)}">${f(b.max, 2)}</td><td>${b.warn}</td></tr>
    <tr><td>เสา</td><td>${c.n}</td><td>${c.fail}</td><td class="${ratioCls(c.max)}">${f(c.max, 2)}</td><td>${c.warn}</td></tr>
  </tbody></table><div class="legend"><span class="sw ok"></span>≤ 0.5 <span class="sw mid"></span>≈ 0.85–1.0 <span class="sw bad"></span>&gt; 1.0</div>
  <p class="muted small">กดปุ่ม "ออกแบบ" บนแถบเครื่องมือเพื่อระบายสีตามอัตราส่วนกำลัง</p></div>`;
}

// ---------- ฐานราก ----------
function foundationCard(): string {
  const fs = st.fset;
  return `<div class="card"><div class="card-h">ตั้งค่าฐานราก</div><div class="form g3">
    <label class="span2">ชนิด<select id="fd-type"><option value="spread" ${fs.type === "spread" ? "selected" : ""}>ฐานแผ่บนดิน</option><option value="pile" ${fs.type === "pile" ? "selected" : ""}>ฐานเสาเข็ม</option></select></label>
    <label title="ระดับท้องฐานจากผิวดิน">Df (m)<input id="fd-df" type="number" step="0.1" value="${fs.Df}"/></label>
    ${fs.type === "spread"
      ? `<label title="หน่วยแรงแบกทานยอมให้ (gross)">qa (t/m²)<input id="fd-qa" type="number" step="0.5" value="${fs.qaTon}"/></label>
         <label title="อัตราส่วน L/B (L ตามแกน X)">L/B<input id="fd-ratio" type="number" step="0.1" min="0.5" max="3" value="${fs.ratio}"/></label>`
      : `<label title="น้ำหนักบรรทุกปลอดภัยต่อต้น">Ra (ตัน)<input id="fd-pile" type="number" step="1" value="${fs.pileTon}"/></label>
         <label>ขนาดเข็ม (m)<input id="fd-psize" type="number" step="0.01" value="${fs.pileSize}"/></label>
         <label title="ระยะห่างเข็ม = k × ขนาดเข็ม">ระยะห่าง (×D)<input id="fd-psp" type="number" step="0.5" min="2.5" value="${fs.pileSpacingFactor}"/></label>`}
    <label title="หน่วยน้ำหนักดินถม">γดิน<input id="fd-gs" type="number" step="0.5" value="${fs.gammaSoil}"/></label>
    <label title="เพิ่มค่ายอมให้ 33% สำหรับกรณีที่มีแรงลม"><span><input id="fd-wind" type="checkbox" ${fs.windIncrease ? "checked" : ""}/> ลม ×1.33</span></label>
  </div></div>`;
}

function bindFoundation() {
  const set = (patch: Partial<FoundationSettings>) => { st.fset = { ...st.fset, ...patch }; renderLeft(); runDesign(); };
  const num = (id: string, key: keyof FoundationSettings, min = 0) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.onchange = () => { const v = parseFloat(el.value); if (Number.isFinite(v) && v > min) set({ [key]: v } as Partial<FoundationSettings>); };
  };
  $<HTMLSelectElement>("#fd-type").onchange = (e) => set({ type: (e.target as HTMLSelectElement).value as "spread" | "pile" });
  num("fd-df", "Df"); num("fd-qa", "qaTon"); num("fd-ratio", "ratio"); num("fd-pile", "pileTon");
  num("fd-psize", "pileSize"); num("fd-psp", "pileSpacingFactor", 2); num("fd-gs", "gammaSoil");
  $<HTMLInputElement>("#fd-wind").onchange = (e) => set({ windIncrease: (e.target as HTMLInputElement).checked });
}

function footingPlan(node: string, ft: FootingResult3): string {
  const col = st.model?.members.find((m) => m.kind === "column" && (m.i === node || m.j === node));
  const sec = col && st.model?.sections.find((x) => x.id === col.section);
  return footingPlanSvg3(ft, sec?.h ?? 0.3, sec?.b ?? 0.3, st.fset.pileSize);
}

function footingCard(node: string, ft: FootingResult3): string {
  const worst = ft.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), ft.service[0]);
  const unit = ft.type === "pile" ? "kN/ต้น" : "kN/m²";
  return `<div class="card ${ft.ok ? "ok" : "bad"}"><div class="card-h">ฐานราก${ft.type === "pile" ? "เสาเข็ม" : "แผ่"} ${esc(node)} <span class="tag ${ft.ok ? "ok" : "bad"}">${ft.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
    <div class="pm-wrap">${footingPlan(node, ft)}</div>
    <table class="mini"><tbody>
      <tr><td>ขนาด L×B×t</td><td>${f(ft.L)} × ${f(ft.B)} × ${f(ft.t)} m</td></tr>
      ${ft.piles ? `<tr><td>เสาเข็ม</td><td>${ft.piles.coords.length} ต้น (${ft.piles.nx}×${ft.piles.ny}) @ ${f(ft.piles.s)} m</td></tr>` : ""}
      ${worst ? `<tr><td>${ft.type === "pile" ? "แรงเข็มสูงสุด" : "qmax"}</td><td>${f(worst.qmax)} / ${f(worst.allow)} ${unit}</td></tr>
      <tr><td>กรณีวิกฤต</td><td>${esc(worst.name)}${worst.note ? ` <small>(${esc(worst.note)})</small>` : ""}</td></tr>` : ""}
      <tr><td>เฉือนทะลุ / ทางเดียว X / Y</td><td>${f(ft.crit.punch)} / ${f(ft.crit.oneWayX)} / ${f(ft.crit.oneWayY)}</td></tr>
      <tr><td>เหล็กแนว X</td><td>${esc(ft.barsX)}</td></tr>
      <tr><td>เหล็กแนว Y</td><td>${esc(ft.barsY)}</td></tr>
    </tbody></table>
    ${ft.ok ? "" : `<p class="warn">${esc(ft.message)}</p>`}
    <details class="steps3"><summary>ขั้นตอนคำนวณ</summary><table class="mini"><tbody>
      ${ft.steps.map((x) => `<tr class="${x.ok === false ? "bad" : ""}"><td>${esc(x.label)}<br/><small>${esc(x.expr)}</small></td><td>${esc(x.value)}</td></tr>`).join("")}
    </tbody></table></details>
    <button class="primary wide" data-report="footing:${esc(node)}">รายการคำนวณฐานรากนี้</button></div>`;
}

function footingSummary(fts: Record<string, FootingResult3>): string {
  const rows = Object.entries(fts);
  const fail = rows.filter(([, x]) => !x.ok).length;
  return `<div class="card"><div class="card-h">ฐานราก (${st.fset.type === "pile" ? "เสาเข็ม" : "แผ่"}) <span class="tag ${fail ? "bad" : "ok"}">${fail ? `ไม่ผ่าน ${fail}` : "ผ่านทั้งหมด"}</span></div>
    <table class="mini summary"><thead><tr><th>จุด</th><th>L×B×t (m)</th><th>${st.fset.type === "pile" ? "เข็ม" : "qmax/qa"}</th><th></th></tr></thead><tbody>
    ${rows.map(([id, ft]) => {
      const w = ft.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), ft.service[0]);
      return `<tr data-node="${esc(id)}" class="${st.footSel === id ? "selected" : ""}"><td>${esc(id)}</td><td>${f(ft.L)}×${f(ft.B)}×${f(ft.t)}</td><td>${ft.piles ? `${ft.piles.coords.length} ต้น` : w ? f(w.qmax / w.allow, 2) : "-"}</td><td>${ft.ok ? "✓" : "✗"}</td></tr>`;
    }).join("")}
    </tbody></table><p class="muted small">คลิกแถวหรือกล่องฐานในฉาก 3D เพื่อดูแปลนและขั้นตอนคำนวณ</p></div>`;
}

// ---------- รายการคำนวณ ----------
function showReport(scope: Report3Scope) {
  if (!st.model || !st.run || !st.design) return;
  openReport3({ model: st.model, params: st.params, run: st.run, wind: st.wind, design: st.design, footings: st.footings, dset: st.dset, fset: st.fset }, scope);
}
$("#btn-report3d").onclick = () => showReport("summary");

// ---------- บันทึก / เปิดไฟล์โปรเจกต์ 3D ----------
function saveProject() {
  const data = { app: "structlab-3d", version: 1, params: st.params, design: st.dset, foundation: st.fset };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${st.params.name.replace(/[\\/:*?"<>|]/g, "_") || "project"}.3d.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function openProject(file: File) {
  try {
    const o = JSON.parse(await file.text());
    if (o.app !== "structlab-3d" || !o.params) throw new Error("ไม่ใช่ไฟล์โปรเจกต์ 3D ของ StructLab");
    st.params = { ...defaultGrid, ...o.params, wind: { ...defaultGrid.wind, ...(o.params.wind ?? {}) } };
    st.dset = { ...defaultDesign3, ...(o.design ?? {}) };
    st.fset = { ...defaultFoundation, ...(o.foundation ?? {}) };
    saveSettings();
    rebuild();
  } catch (e) {
    alert(`เปิดไฟล์ไม่ได้: ${(e as Error).message}`);
  }
}
$("#btn-save3d").onclick = saveProject;
$("#btn-open3d").onclick = () => $<HTMLInputElement>("#file3d").click();
$<HTMLInputElement>("#file3d").onchange = (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void openProject(file);
  (e.target as HTMLInputElement).value = "";
};

function renderStatus() {
  const s = $("#status");
  const m = st.model;
  if (st.error) { s.className = "status error"; s.textContent = `⚠ ${st.error}`; return; }
  s.className = "status";
  if (!m) { s.textContent = ""; return; }
  const r = current();
  s.textContent = `จุดต่อ ${m.nodes.length} · ชิ้นส่วน ${m.members.length} · พื้นแข็ง ${m.diaphragms?.length ?? 0} ชั้น` +
    (st.run && r ? ` · ${r.info.neq.toLocaleString()} สมการ · วิเคราะห์ ${Object.keys(st.run.results).length} กรณีใน ${f(st.run.ms / 1000, 2)} s` +
      (r.info.pDelta ? ` · P-Δ ลู่เข้าใน ${r.info.iterations} รอบ` : " · อันดับหนึ่ง") + (m.analysis?.cracked ? " · หน้าตัดแตกร้าว" : "") : " · กำลังคำนวณ…");
}

rebuild();
