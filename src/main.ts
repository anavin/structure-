import "./style.css";
import { concreteE, isLateralCase, type Combo, type Load, type MemberUDL, type MemberPoint, type NodalLoad, type Model, type Support } from "./core/model.ts";
import { app, currentResult, modelChanged, nextId, normalizeModel, recompute, resultLabel, setModel, subscribe, viewChanged, type Display } from "./ui/state.ts";
import { View, deleteSelection } from "./ui/view.ts";
import { renderTable } from "./ui/tables.ts";
import { openReport } from "./ui/report.ts";
import { sampleModel } from "./ui/sample.ts";
import { EXAMPLES_2D } from "./ui/samples2d.ts";
import { pmChartSvg } from "./ui/pmChart.ts";
import { renderWindTab } from "./ui/windUi.ts";
import { convertDom, units, type UnitSys } from "./app3d/units.ts";
import { emptyInfo, onSharedChange, type ProjectInfo } from "./shared/shared.ts";
import { applyShared2D, sharedFrom2D } from "./ui/state.ts";
import { BACKUP_KEY, defaultFrame, frameFrom3D, frameKey, frameLabel, listFrames, PARAMS3D_KEY, parseParams3D, readParams3DRaw, refreshFrameFrom3D, sameGeometry, takeFrameFrom3D, type FrameRef } from "./shared/frameFrom3d.ts";
import { freshStart } from "./ui/state.ts";
import { bindFoundationSettings, footingCardHtml, footingSummaryHtml, foundationSettingsHtml } from "./ui/footingUi.ts";
import { barLayers, totalBars, type ColumnDesignResult } from "./design/rcColumn.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Math.abs(v) < 1e-9 ? "0.00" : v.toFixed(dp));

const view = new View($<SVGSVGElement & HTMLElement>("#canvas") as unknown as SVGSVGElement);
let tab = "nodes";

// ---------- แถบเครื่องมือ ----------
function bindToolbar() {
  $("#btn-new").onclick = () => {
    if (!confirm("เริ่มโปรเจกต์ใหม่? ข้อมูลที่ยังไม่ได้บันทึกเป็นไฟล์จะหายไป")) return;
    const m: Model = sampleModel();
    m.name = "โปรเจกต์ใหม่";
    m.nodes = []; m.members = []; m.supports = [];
    for (const lc of m.loadCases) lc.loads = [];
    setModel(m);
    app.mode = "draw";
    syncToolbar();
  };
  {
    const sel = $<HTMLSelectElement>("#sel-example");
    sel.innerHTML += EXAMPLES_2D.map((e) => `<option value="${e.id}">${esc(e.label)} — ${esc(e.desc)}</option>`).join("");
    sel.onchange = () => {
      const ex = EXAMPLES_2D.find((e) => e.id === sel.value);
      sel.value = "";
      if (!ex || !confirm(`เปิดตัวอย่าง "${ex.label}" แทนโมเดลปัจจุบัน?`)) return;
      const m = ex.make();
      m.info = app.model.info; // คงข้อมูลโครงการ
      setModel(m);
      view.fit();
    };
  }
  $("#btn-save").onclick = () => {
    const blob = new Blob([JSON.stringify(app.model, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${app.model.name.replace(/[\\/:*?"<>|]/g, "_") || "project"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("#btn-open").onclick = () => $<HTMLInputElement>("#file").click();
  $<HTMLInputElement>("#file").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const m = normalizeModel(JSON.parse(await file.text())); // ตรวจ/เติมข้อมูลก่อนแทนโมเดลเดิม
      setModel(m);
      view.fit();
    } catch (err) {
      alert(`เปิดไฟล์ไม่ได้: ${(err as Error).message}`);
    }
    (e.target as HTMLInputElement).value = "";
  };
  $("#btn-fit").onclick = () => view.fit();
  $("#btn-report").onclick = () => openReport();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    b.onclick = () => { app.mode = b.dataset.mode as "select" | "draw"; view.cancelDraw(); syncToolbar(); };
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) {
    b.onclick = () => { app.display = b.dataset.display as Display; viewChanged(); };
  }
  $<HTMLSelectElement>("#sel-result").onchange = (e) => { app.resultKey = (e.target as HTMLSelectElement).value; viewChanged(); };
  $<HTMLInputElement>("#scale").oninput = (e) => { app.scale = parseFloat((e.target as HTMLInputElement).value); view.render(); };
  $<HTMLInputElement>("#grid").onchange = (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (v > 0) { app.grid = v; view.render(); }
  };
  $<HTMLInputElement>("#labels").onchange = (e) => { app.showLabels = (e.target as HTMLInputElement).checked; view.render(); };
  $<HTMLSelectElement>("#sec-beam").onchange = (e) => { app.drawSection.beam = (e.target as HTMLSelectElement).value; };
  $<HTMLSelectElement>("#sec-col").onchange = (e) => { app.drawSection.column = (e.target as HTMLSelectElement).value; };
  const setAnalysis = () => {
    const pDelta = $<HTMLInputElement>("#opt-pdelta").checked;
    const cracked = $<HTMLInputElement>("#opt-cracked").checked;
    app.model.analysis = { pDelta, cracked };
    modelChanged();
  };
  $<HTMLInputElement>("#opt-pdelta").onchange = () => {
    // ACI §6.7.1.2: การวิเคราะห์อันดับสองสำหรับกำลังต้องใช้ความแข็งแตกร้าว — เปิดให้อัตโนมัติ
    if ($<HTMLInputElement>("#opt-pdelta").checked) $<HTMLInputElement>("#opt-cracked").checked = true;
    setAnalysis();
  };
  $<HTMLInputElement>("#opt-cracked").onchange = setAnalysis;
  $<HTMLInputElement>("#proj-name").onchange = (e) => { app.model.name = (e.target as HTMLInputElement).value; modelChanged(); };
  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    t.onclick = () => { tab = t.dataset.tab!; renderLeft(); };
  }
}

function syncToolbar() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-units]")) b.classList.toggle("active", b.dataset.units === units.sys);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) b.classList.toggle("active", b.dataset.mode === app.mode);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) b.classList.toggle("active", b.dataset.display === app.display);
  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) t.classList.toggle("active", t.dataset.tab === tab);
  const sel = $<HTMLSelectElement>("#sel-result");
  const opts = [
    ...app.model.combos.map((c) => ({ v: `combo:${c.id}`, l: `ชุดผสม: ${c.name}` })),
    ...app.model.loadCases.map((c) => ({ v: `case:${c.id}`, l: `Load case: ${c.name}` })),
  ];
  sel.innerHTML = opts.map((o) => `<option value="${esc(o.v)}" ${o.v === app.resultKey ? "selected" : ""}>${esc(o.l)}</option>`).join("");
  sel.disabled = app.display === "model";
  // สเกลมีผลเฉพาะการเสียรูปและแผนภาพ N/V/M
  const sc = $<HTMLInputElement>("#scale");
  const scaleOn = ["deformed", "N", "V", "M"].includes(app.display);
  sc.disabled = !scaleOn;
  sc.closest("label")!.style.opacity = scaleOn ? "" : "0.45";
  sc.closest("label")!.title = scaleOn ? "สเกลแผนภาพ" : "สเกลใช้กับ การเสียรูป และแผนภาพ N/V/M — เลือกปุ่มเหล่านั้นก่อน";
  const secOpts = (cur: string) => app.model.sections.map((s) => `<option value="${esc(s.id)}" ${s.id === cur ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  $<HTMLSelectElement>("#sec-beam").innerHTML = secOpts(app.drawSection.beam);
  $<HTMLSelectElement>("#sec-col").innerHTML = secOpts(app.drawSection.column);
  $("#draw-opts").hidden = app.mode !== "draw";
  $<HTMLInputElement>("#opt-pdelta").checked = !!app.model.analysis?.pDelta;
  $<HTMLInputElement>("#opt-cracked").checked = !!app.model.analysis?.cracked;
  const pn = $<HTMLInputElement>("#proj-name");
  if (document.activeElement !== pn) pn.value = app.model.name;
  $("#canvas").classList.toggle("drawing", app.mode === "draw");
  $<HTMLButtonElement>("#btn-report").disabled = !app.run || Object.keys(app.designs).length + Object.keys(app.colDesigns).length === 0;
}

// ---------- แผงซ้าย: ตารางข้อมูล ----------
type SupportKind = "none" | "fixed" | "pinned" | "rollerY" | "rollerX";
function supportKind(s?: Support): SupportKind {
  if (!s) return "none";
  if (s.ux && s.uy && s.rz) return "fixed";
  if (s.ux && s.uy) return "pinned";
  if (s.uy) return "rollerY";
  if (s.ux) return "rollerX";
  return "none";
}
function setSupport(nodeId: string, k: SupportKind) {
  const m = app.model;
  m.supports = m.supports.filter((s) => s.node !== nodeId);
  const map: Record<SupportKind, [boolean, boolean, boolean] | null> = {
    none: null, fixed: [true, true, true], pinned: [true, true, false], rollerY: [false, true, false], rollerX: [true, false, false],
  };
  const v = map[k];
  if (v) m.supports.push({ node: nodeId, ux: v[0], uy: v[1], rz: v[2] });
}

function renderLeft() {
  const host = $("#left-body");
  host.innerHTML = "";
  const m = app.model;
  const changed = () => modelChanged();
  const isSel = (kind: "node" | "member") => (r: { id: string }) => app.selection?.kind === kind && app.selection.id === r.id;
  const select = (kind: "node" | "member") => (r: { id: string }) => { app.selection = { kind, id: r.id }; viewChanged(); };
  const nodeOpts = m.nodes.map((n) => ({ value: n.id, label: n.id }));
  const memberOpts = m.members.map((x) => ({ value: x.id, label: x.id }));
  const secOpts = m.sections.map((s) => ({ value: s.id, label: s.name }));

  if (tab === "nodes") {
    renderTable(host, "จุดต่อและจุดรองรับ", m.nodes, [
      { key: "id", label: "ID", type: "readonly", width: "48px", get: (r) => r.id },
      { key: "x", label: "X (m)", type: "number", get: (r) => r.x, set: (r, v) => { r.x = v as number; } },
      { key: "y", label: "Y (m)", type: "number", get: (r) => r.y, set: (r, v) => { r.y = v as number; } },
      {
        key: "sup", label: "จุดรองรับ", type: "select", width: "110px",
        options: [
          { value: "none", label: "—" }, { value: "fixed", label: "ยึดแน่น" }, { value: "pinned", label: "หมุด" },
          { value: "rollerY", label: "ลูกกลิ้ง (ดิ่ง)" }, { value: "rollerX", label: "ลูกกลิ้ง (ราบ)" },
        ],
        get: (r) => supportKind(m.supports.find((s) => s.node === r.id)),
        set: (r, v) => setSupport(r.id, v as SupportKind),
      },
    ], {
      onChange: changed,
      onAdd: () => { m.nodes.push({ id: nextId("N", m.nodes), x: 0, y: 0 }); changed(); },
      onDelete: (r) => { app.selection = { kind: "node", id: r.id }; deleteSelection(); },
      onRowClick: select("node"), isSelected: isSel("node"),
    });
  }

  if (tab === "members") {
    renderTable(host, "ชิ้นส่วน", m.members, [
      { key: "id", label: "ID", type: "readonly", width: "44px", get: (r) => r.id },
      { key: "i", label: "ต้น", type: "select", options: nodeOpts, get: (r) => r.i, set: (r, v) => { r.i = v as string; } },
      { key: "j", label: "ปลาย", type: "select", options: nodeOpts, get: (r) => r.j, set: (r, v) => { r.j = v as string; } },
      { key: "sec", label: "หน้าตัด", type: "select", options: secOpts, get: (r) => r.section, set: (r, v) => { r.section = v as string; } },
      {
        key: "kind", label: "ประเภท", type: "select",
        options: [{ value: "beam", label: "คาน" }, { value: "column", label: "เสา" }, { value: "other", label: "อื่นๆ" }],
        get: (r) => r.kind, set: (r, v) => { r.kind = v as "beam" | "column" | "other"; },
      },
      { key: "ri", label: "ปลด i", type: "checkbox", width: "44px", get: (r) => !!r.releaseI, set: (r, v) => { r.releaseI = (v as boolean) || undefined; } },
      { key: "rj", label: "ปลด j", type: "checkbox", width: "44px", get: (r) => !!r.releaseJ, set: (r, v) => { r.releaseJ = (v as boolean) || undefined; } },
    ], {
      onChange: changed,
      onAdd: m.nodes.length >= 2 ? () => {
        m.members.push({ id: nextId("B", m.members), i: m.nodes[0].id, j: m.nodes[1].id, section: m.sections[0]?.id ?? "", kind: "beam" });
        changed();
      } : undefined,
      onDelete: (r) => { app.selection = { kind: "member", id: r.id }; deleteSelection(); },
      onRowClick: select("member"), isSelected: isSel("member"),
    });
  }

  if (tab === "sections") {
    renderTable(host, "วัสดุคอนกรีต (Ec = 15,100√fc')", m.materials, [
      { key: "name", label: "ชื่อ", type: "text", get: (r) => r.name, set: (r, v) => { r.name = v as string; } },
      { key: "fc", label: "fc' (ksc)", type: "number", get: (r) => r.fc ?? 0, set: (r, v) => { r.fc = v as number; r.E = concreteE(v as number); } },
      { key: "fy", label: "fy (ksc)", type: "number", get: (r) => r.fy ?? 0, set: (r, v) => { r.fy = v as number; } },
      { key: "fyt", label: "fyt (ksc)", type: "number", get: (r) => r.fyt ?? 0, set: (r, v) => { r.fyt = v as number; } },
      { key: "g", label: "γ (kN/m³)", type: "number", get: (r) => r.gamma, set: (r, v) => { r.gamma = v as number; } },
    ], {
      onChange: changed,
      onAdd: () => { m.materials.push({ id: nextId("MAT", m.materials), name: "คอนกรีต fc' 240 ksc", E: concreteE(240), gamma: 24, fc: 240, fy: 4000, fyt: 2400 }); changed(); },
      onDelete: (r) => {
        if (m.sections.some((s) => s.material === r.id)) { alert("วัสดุนี้ยังถูกใช้อยู่ในหน้าตัด"); return; }
        m.materials = m.materials.filter((x) => x !== r); changed();
      },
    });
    renderTable(host, "หน้าตัดสี่เหลี่ยม", m.sections, [
      { key: "name", label: "ชื่อ", type: "text", get: (r) => r.name, set: (r, v) => { r.name = v as string; } },
      { key: "mat", label: "วัสดุ", type: "select", options: m.materials.map((x) => ({ value: x.id, label: x.name })), get: (r) => r.material, set: (r, v) => { r.material = v as string; } },
      { key: "b", label: "b (m)", type: "number", get: (r) => r.b, set: (r, v) => { r.b = v as number; } },
      { key: "h", label: "h (m)", type: "number", get: (r) => r.h, set: (r, v) => { r.h = v as number; } },
    ], {
      onChange: changed,
      onAdd: () => { m.sections.push({ id: nextId("S", m.sections), name: "คาน 20×40", material: m.materials[0]?.id ?? "", b: 0.2, h: 0.4 }); changed(); },
      onDelete: (r) => {
        if (m.members.some((x) => x.section === r.id)) { alert("หน้าตัดนี้ยังถูกใช้อยู่"); return; }
        m.sections = m.sections.filter((x) => x !== r); changed();
      },
    });
  }

  if (tab === "loads") {
    const caseBar = document.createElement("div");
    caseBar.className = "case-bar";
    caseBar.innerHTML = `<label>Load case <select id="lc-sel">${m.loadCases.map((c) => `<option value="${esc(c.id)}" ${c.id === app.activeCase ? "selected" : ""}>${esc(c.id)} — ${esc(c.name)}</option>`).join("")}</select></label>
      <button class="small" id="lc-add">+ case</button><button class="small" id="lc-del">ลบ case</button>`;
    host.appendChild(caseBar);
    caseBar.querySelector<HTMLSelectElement>("#lc-sel")!.onchange = (e) => { app.activeCase = (e.target as HTMLSelectElement).value; app.display = "model"; viewChanged(); };
    caseBar.querySelector<HTMLButtonElement>("#lc-add")!.onclick = () => {
      const id = prompt("ชื่อย่อ load case ใหม่ (เช่น SDL)")?.trim();
      if (!id || m.loadCases.some((c) => c.id === id)) return;
      m.loadCases.push({ id, name: id, selfWeight: false, loads: [] });
      app.activeCase = id;
      changed();
    };
    caseBar.querySelector<HTMLButtonElement>("#lc-del")!.onclick = () => {
      if (m.loadCases.length <= 1 || !confirm(`ลบ load case ${app.activeCase}?`)) return;
      m.loadCases = m.loadCases.filter((c) => c.id !== app.activeCase);
      for (const c of m.combos) delete c.factors[app.activeCase];
      changed();
    };
    const lc = m.loadCases.find((c) => c.id === app.activeCase);
    if (lc) {
      renderTable(host, "ข้อมูล load case", [lc], [
        { key: "name", label: "ชื่อ", type: "text", get: (r) => r.name, set: (r, v) => { r.name = v as string; } },
        { key: "sw", label: "คิดน้ำหนักตัวเอง", type: "checkbox", width: "100px", get: (r) => r.selfWeight, set: (r, v) => { r.selfWeight = v as boolean; } },
        { key: "lat", label: "แรงด้านข้าง (sway)", type: "checkbox", width: "110px", get: (r) => isLateralCase(r), set: (r, v) => { r.lateral = v as boolean; } },
      ], { onChange: changed });
      const memLoads = lc.loads.filter((l): l is MemberUDL | MemberPoint => l.type === "udl" || l.type === "point");
      const nDist = lc.loads.filter((l) => l.type === "dist").length;
      const dirOpts = [{ value: "globalY", label: "แนวดิ่ง Y" }, { value: "globalX", label: "แนวราบ X" }, { value: "local", label: "ตั้งฉากชิ้นส่วน" }];
      renderTable(host, "แรงบนชิ้นส่วน (ลบ = ลง/ซ้าย)", memLoads, [
        { key: "mem", label: "ชิ้นส่วน", type: "select", options: memberOpts, get: (r) => r.member, set: (r, v) => { r.member = v as string; } },
        {
          key: "type", label: "ชนิด", type: "select", options: [{ value: "udl", label: "แผ่ (kN/m)" }, { value: "point", label: "จุด (kN)" }],
          get: (r) => r.type,
          set: (r, v) => {
            const idx = lc.loads.indexOf(r);
            const val = r.type === "udl" ? r.w : r.P;
            const nl: Load = v === "udl" ? { type: "udl", member: r.member, dir: r.dir, w: val } : { type: "point", member: r.member, dir: r.dir, P: val, a: 0 };
            lc.loads[idx] = nl;
          },
        },
        { key: "dir", label: "ทิศ", type: "select", options: dirOpts, get: (r) => r.dir, set: (r, v) => { r.dir = v as MemberUDL["dir"]; } },
        { key: "val", label: "ค่า", type: "number", get: (r) => (r.type === "udl" ? r.w : r.P), set: (r, v) => { if (r.type === "udl") r.w = v as number; else r.P = v as number; } },
        { key: "a", label: "a (m)", type: "number", get: (r) => (r.type === "point" ? r.a : "—"), set: (r, v) => { if (r.type === "point") r.a = v as number; } },
      ], {
        onChange: changed,
        onAdd: m.members.length ? () => { lc.loads.push({ type: "udl", member: (app.selection?.kind === "member" ? app.selection.id : m.members[0].id), dir: "globalY", w: -10 }); changed(); } : undefined,
        onDelete: (r) => { lc.loads = lc.loads.filter((x) => x !== r); changed(); },
      });
      if (nDist) host.insertAdjacentHTML("beforeend", `<p class="muted small">+ แรงแผ่จากพื้น ${nDist} รายการ (สามเหลี่ยม/คางหมูตามเส้น 45° จากอาคาร 3D — แก้ที่หน้า 3D)</p>`);
      const nodLoads = lc.loads.filter((l): l is NodalLoad => l.type === "nodal");
      renderTable(host, "แรงที่จุดต่อ (kN, kN·m)", nodLoads, [
        { key: "node", label: "จุดต่อ", type: "select", options: nodeOpts, get: (r) => r.node, set: (r, v) => { r.node = v as string; } },
        { key: "fx", label: "Fx", type: "number", get: (r) => r.fx, set: (r, v) => { r.fx = v as number; } },
        { key: "fy", label: "Fy", type: "number", get: (r) => r.fy, set: (r, v) => { r.fy = v as number; } },
        { key: "mz", label: "Mz", type: "number", get: (r) => r.mz, set: (r, v) => { r.mz = v as number; } },
      ], {
        onChange: changed,
        onAdd: m.nodes.length ? () => { lc.loads.push({ type: "nodal", node: (app.selection?.kind === "node" ? app.selection.id : m.nodes[0].id), fx: 0, fy: -10, mz: 0 }); changed(); } : undefined,
        onDelete: (r) => { lc.loads = lc.loads.filter((x) => x !== r); changed(); },
      });
    }
  }

  if (tab === "wind") renderWindTab(host);

  if (tab === "combos") {
    const presets = document.createElement("div");
    presets.className = "case-bar";
    presets.innerHTML = `<span>ชุดสำเร็จรูป:</span><button class="small" data-preset="EIT">วสท. (SDM)</button><button class="small" data-preset="ACI">ACI 318-19</button>`;
    host.appendChild(presets);
    presets.onclick = (e) => {
      const p = (e.target as HTMLElement).dataset.preset;
      if (!p) return;
      const ids = m.loadCases.map((c) => c.id);
      // แรงแนวดิ่ง: ชื่อขึ้นต้นด้วย L = น้ำหนักจร, ที่เหลือ = น้ำหนักคงที่ · แรงด้านข้าง: ทุก load case ที่ติ๊ก sway
      const grav = m.loadCases.filter((c) => !isLateralCase(c));
      const Ls = grav.filter((c) => /^L/i.test(c.id)).map((c) => c.id);
      const Ds = grav.filter((c) => !/^L/i.test(c.id)).map((c) => c.id);
      const Ws = m.loadCases.filter((c) => isLateralCase(c)).map((c) => c.id);
      // ลมกรณีเดียว → คิดทั้ง ±; หลายกรณี (เช่น WX/WXN) → ใช้ทีละกรณีด้วยเครื่องหมายบวก
      const wTerms = Ws.length === 1 ? [{ id: Ws[0], sg: 1, tag: `+${Ws[0]}` }, { id: Ws[0], sg: -1, tag: `−${Ws[0]}` }] : Ws.map((id) => ({ id, sg: 1, tag: `+${id}` }));
      let n = 0;
      const mk = (name: string, fd: number, fl: number, w?: { id: string; sg: number }, fw = 0): Combo => {
        const factors: Record<string, number> = {};
        for (const d of Ds) factors[d] = fd;
        for (const l of Ls) factors[l] = fl;
        if (w) factors[w.id] = w.sg * fw;
        return { id: `U${++n}`, name, factors };
      };
      const list: Combo[] = p === "EIT"
        ? [mk("1.4D + 1.7L", 1.4, 1.7),
           ...wTerms.map((w) => mk(`0.75(1.4D + 1.7L ${w.sg > 0 ? "+" : "−"} 1.7${w.id})`, 1.05, 1.275, w, 1.275)),
           ...wTerms.map((w) => mk(`0.9D ${w.sg > 0 ? "+" : "−"} 1.3${w.id}`, 0.9, 0, w, 1.3))]
        : [mk("1.4D", 1.4, 0), mk("1.2D + 1.6L", 1.2, 1.6),
           // แรงลม มยผ. 1311-50 เป็นระดับใช้งาน → 1.6W (ACI 318-08) แทน 1.0W ของ ASCE 7 ระดับกำลัง
           ...wTerms.map((w) => mk(`1.2D ${w.sg > 0 ? "+" : "−"} 1.6${w.id} + 1.0L`, 1.2, 1.0, w, 1.6)),
           ...wTerms.map((w) => mk(`0.9D ${w.sg > 0 ? "+" : "−"} 1.6${w.id}`, 0.9, 0, w, 1.6))];
      m.combos = list;
      app.design.code = p as "EIT" | "ACI";
      changed();
    };
    renderTable(host, "ชุดผสมน้ำหนัก (ตัวคูณ)", m.combos, [
      { key: "name", label: "ชื่อ", type: "text", width: "150px", get: (r) => r.name, set: (r, v) => { r.name = v as string; } },
      ...m.loadCases.map((lc) => ({
        key: lc.id, label: lc.id, type: "number" as const,
        get: (r: Combo) => r.factors[lc.id] ?? 0,
        set: (r: Combo, v: string | number | boolean) => { r.factors[lc.id] = v as number; },
      })),
    ], {
      onChange: changed,
      onAdd: () => { m.combos.push({ id: nextId("U", m.combos), name: "ชุดผสมใหม่", factors: Object.fromEntries(m.loadCases.map((c) => [c.id, 1])) }); changed(); },
      onDelete: (r) => { m.combos = m.combos.filter((x) => x !== r); changed(); },
    });
  }
  syncToolbar();
}

// ---------- แผงขวา: คุณสมบัติและผลออกแบบ ----------
function renderRight() {
  const host = $("#right-body");
  const m = app.model;
  const res = currentResult();
  const parts: string[] = [];

  parts.push(`<div class="card"><div class="card-h">ตั้งค่าการออกแบบ</div>
    <div class="form">
      <label>มาตรฐาน<select id="d-code"><option value="EIT" ${app.design.code === "EIT" ? "selected" : ""}>วสท. 1008-38 (SDM)</option><option value="ACI" ${app.design.code === "ACI" ? "selected" : ""}>ACI 318-19</option></select></label>
      <label>ระยะหุ้ม (mm)<input id="d-cover" type="number" value="${app.design.cover}"/></label>
      <label>เหล็กปลอก Ø (mm)<select id="d-sd">${[6, 9, 10, 12].map((d) => `<option ${d === app.design.stirrupDia ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>จำนวนขา<input id="d-legs" type="number" min="2" value="${app.design.stirrupLegs}"/></label>
      <label title="ตัวคูณความยาวประสิทธิผลของเสา (โครงค้ำยัน ≤ 1.0)">k เสา<input id="d-k" type="number" step="0.05" min="0.5" value="${app.design.colK}"/></label>
      <label title="อัตราส่วนน้ำหนักคงที่ค้างนาน ใช้ลด EI ประสิทธิผล">βdns<input id="d-bdns" type="number" step="0.1" min="0" max="1" value="${app.design.betaDns}"/></label>
      <label title="คิดการขยายโมเมนต์จากการเซของโครง (ACI §6.6.4.6)"><span><input id="d-sway" type="checkbox" ${app.design.sway ? "checked" : ""}/> คิดผลการเซ</span></label>
      <label title="อัตราส่วนแรงเฉือนค้างนานต่อแรงเฉือนทั้งหมดในชั้น (ลม/แผ่นดินไหว = 0)">βds<input id="d-bds" type="number" step="0.1" min="0" max="1" value="${app.design.betaDs}"/></label>
    </div></div>`);

  const sel = app.selection;
  if (sel?.kind === "member") {
    const mem = m.members.find((x) => x.id === sel.id);
    const mr = res?.members[sel.id];
    const env = app.run?.envelope[sel.id];
    const d = app.designs[sel.id];
    if (mem) {
      const sec = m.sections.find((s) => s.id === mem.section);
      parts.push(`<div class="card"><div class="card-h">ชิ้นส่วน ${esc(mem.id)} <span class="tag">${mem.kind === "beam" ? "คาน" : mem.kind === "column" ? "เสา" : "อื่นๆ"}</span></div>
        <table class="mini"><tbody>
        <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td></tr>
        <tr><td>หน้าตัด</td><td>${esc(sec?.name ?? "-")}</td></tr>
        <tr><td>ปลดโมเมนต์</td><td>${mem.releaseI || mem.releaseJ ? [mem.releaseI ? `ปลาย i (${esc(mem.i)})` : "", mem.releaseJ ? `ปลาย j (${esc(mem.j)})` : ""].filter(Boolean).join(", ") : "—"}</td></tr>
        ${mr ? `<tr><td>ความยาว</td><td>${f(mr.L)} m</td></tr>
        <tr><td colspan="2" class="sub">${esc(resultLabel(app.resultKey))}</td></tr>
        <tr><td>M สูงสุด / ต่ำสุด</td><td>${f(mr.maxM)} / ${f(mr.minM)} kN·m</td></tr>
        <tr><td>|V| สูงสุด</td><td>${f(mr.maxAbsV)} kN</td></tr>
        <tr><td>N ช่วง</td><td>${f(mr.minN)} … ${f(mr.maxN)} kN</td></tr>` : ""}
        ${env ? `<tr><td colspan="2" class="sub">ค่าสุดขีดทุกชุดผสม</td></tr>
        <tr><td>M+ / M−</td><td>${f(env.maxM)} / ${f(env.minM)} kN·m</td></tr>
        <tr><td>|V|</td><td>${f(env.maxAbsV)} kN</td></tr>
        <tr><td>แรงอัดสูงสุด</td><td>${f(env.maxComp)} kN</td></tr>` : ""}
        </tbody></table></div>`);
      if (d) {
        const bar = (x: typeof d.bottom) => (x.bars ? `${x.bars.n}DB${x.bars.dia}` : "—");
        parts.push(`<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบคาน ค.ส.ล. <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
          <div class="beam-sketch">${beamSketch(d)}</div>
          <table class="mini"><tbody>
            <tr><td>เหล็กล่าง</td><td>${bar(d.bottom)} <small>(As ${f(d.bottom.AsProv, 0)} ≥ ${f(d.bottom.AsReq, 0)} mm²)</small></td></tr>
            <tr><td>เหล็กบน</td><td>${bar(d.top)} <small>${d.top.Mu > 0 ? `(As ${f(d.top.AsProv, 0)} ≥ ${f(d.top.AsReq, 0)} mm²)` : ""}</small></td></tr>
            <tr><td>ปลอก</td><td>${esc(d.shear.message.replace("เหล็กปลอก ", ""))}</td></tr>
            <tr><td>φMn+ / Mu+</td><td>${f(d.bottom.phiMn)} / ${f(d.bottom.Mu)}</td></tr>
            <tr><td>φMn− / Mu−</td><td>${f(d.top.phiMn)} / ${f(d.top.Mu)}</td></tr>
          </tbody></table>
          ${[d.bottom, d.top, d.shear].filter((x) => !x.ok).map((x) => `<p class="warn">${esc(x.message)}</p>`).join("")}
          <button id="btn-member-report" class="primary wide">รายการคำนวณคานนี้</button></div>`);
      } else if (app.colDesigns[sel.id]) {
        const c = app.colDesigns[sel.id];
        const lay = c.layout;
        const crit = c.checks.reduce((a, x) => (x.ratio > a.ratio ? x : a), c.checks[0]);
        parts.push(`<div class="card ${c.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบเสา ค.ส.ล. <span class="tag ${c.ok ? "ok" : "bad"}">${c.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
          <div class="col-top"><div class="beam-sketch">${columnSketch(c)}</div>
          <table class="mini"><tbody>
            <tr><td>เหล็กยืน</td><td>${lay ? `${totalBars(lay)}DB${lay.dia}` : "—"}</td></tr>
            <tr><td>ρg</td><td>${f(c.rho * 100)} %</td></tr>
            <tr><td>ปลอก</td><td>${esc(c.ties.note)}</td></tr>
            <tr><td>อัตราส่วน</td><td><b class="${c.maxRatio <= 1 ? "okc" : "badc"}">${f(c.maxRatio, 2)}</b></td></tr>
          </tbody></table></div>
          <div class="pm-wrap">${pmChartSvg(c)}<div class="pm-legend"><span class="l-des"></span>φPn–φMn <span class="l-nom"></span>Pn–Mn <span class="l-dem"></span>แรงจากชุดผสม</div></div>
          <table class="mini"><tbody>
            <tr><td>kLu/r</td><td>${f(c.slender.klu_r, 1)} ${c.slender.slender ? `&gt; ${f(c.slender.limit, 1)} <b class="badc">ชะลูด</b>` : `≤ ${f(c.slender.limit, 1)} (เสาสั้น)`}</td></tr>
            <tr><td>φPn,max</td><td>${f(c.phiPnMax)} kN</td></tr>
            ${crit ? `<tr><td>กรณีวิกฤต</td><td>${esc(crit.combo)}</td></tr>
            <tr><td>Pu / Mc</td><td>${f(crit.Pu)} kN / ${f(crit.Mc)} kN·m${crit.delta > 1.0001 ? ` <small>(δ=${f(crit.delta, 2)})</small>` : ""}</td></tr>
            <tr><td>φMn ที่ Pu</td><td>${f(crit.phiMnAtPu)} kN·m</td></tr>` : ""}
          </tbody></table>
          ${c.ok ? "" : `<p class="warn">${esc(c.message)}</p>`}
          ${swayCardHtml(sel.id)}
          <button id="btn-member-report" class="primary wide">รายการคำนวณเสานี้</button></div>`);
      }
    }
  } else if (sel?.kind === "node") {
    const n = m.nodes.find((x) => x.id === sel.id);
    const dsp = res?.disp[sel.id];
    const rx = res?.reactions[sel.id];
    if (n) {
      parts.push(`<div class="card"><div class="card-h">จุดต่อ ${esc(n.id)}</div><table class="mini"><tbody>
        <tr><td>พิกัด</td><td>(${f(n.x)}, ${f(n.y)}) m</td></tr>
        ${dsp ? `<tr><td colspan="2" class="sub">${esc(resultLabel(app.resultKey))}</td></tr>
        <tr><td>ux</td><td>${f(dsp.ux * 1000, 3)} mm</td></tr><tr><td>uy</td><td>${f(dsp.uy * 1000, 3)} mm</td></tr><tr><td>rz</td><td>${f(dsp.rz * 1000, 4)} mrad</td></tr>` : ""}
        ${rx ? `<tr><td>Rx / Ry</td><td>${f(rx.fx)} / ${f(rx.fy)} kN</td></tr><tr><td>Mz</td><td>${f(rx.mz)} kN·m</td></tr>` : ""}
      </tbody></table></div>`);
      parts.push(footingCardHtml(n.id));
    }
  }

  // ตารางสรุปคาน
  const rows = Object.entries(app.designs);
  if (rows.length) {
    parts.push(`<div class="card"><div class="card-h">สรุปการออกแบบคาน</div><table class="mini summary"><thead><tr><th>คาน</th><th>ล่าง</th><th>บน</th><th>ปลอก</th><th></th></tr></thead><tbody>
      ${rows.map(([id, d]) => `<tr data-member="${esc(id)}" class="${app.selection?.id === id ? "selected" : ""}"><td>${esc(id)}</td><td>${d.bottom.bars ? `${d.bottom.bars.n}DB${d.bottom.bars.dia}` : "—"}</td><td>${d.top.bars ? `${d.top.bars.n}DB${d.top.bars.dia}` : "—"}</td><td>${d.shear.spacing ? `@${(d.shear.spacing / 1000).toFixed(2)}` : "—"}</td><td>${d.ok ? "✓" : "✗"}</td></tr>`).join("")}
    </tbody></table></div>`);
  }
  const cols = Object.entries(app.colDesigns);
  if (cols.length) {
    parts.push(`<div class="card"><div class="card-h">สรุปการออกแบบเสา</div><table class="mini summary"><thead><tr><th>เสา</th><th>เหล็กยืน</th><th>ρ</th><th>อัตราส่วน</th><th></th></tr></thead><tbody>
      ${cols.map(([id, c]) => `<tr data-member="${esc(id)}" class="${app.selection?.id === id ? "selected" : ""}"><td>${esc(id)}</td><td>${c.layout ? `${totalBars(c.layout)}DB${c.layout.dia}` : "—"}</td><td>${f(c.rho * 100, 1)}%</td><td>${f(c.maxRatio, 2)}</td><td>${c.ok ? "✓" : "✗"}</td></tr>`).join("")}
    </tbody></table></div>`);
  }
  parts.push(projectInfoCard2D());
  parts.push(footingSummaryHtml());
  parts.push(foundationSettingsHtml());
  if (!sel && !rows.length && !cols.length) parts.push(`<p class="muted">คลิกชิ้นส่วนหรือจุดต่อเพื่อดูรายละเอียด</p>`);
  host.innerHTML = parts.join("");

  $<HTMLSelectElement>("#d-code").onchange = (e) => { app.design.code = (e.target as HTMLSelectElement).value as "EIT" | "ACI"; recomputeView(); };
  $<HTMLInputElement>("#d-cover").onchange = (e) => { app.design.cover = parseFloat((e.target as HTMLInputElement).value) || 40; recomputeView(); };
  $<HTMLSelectElement>("#d-sd").onchange = (e) => { app.design.stirrupDia = parseFloat((e.target as HTMLSelectElement).value); recomputeView(); };
  $<HTMLInputElement>("#d-legs").onchange = (e) => { app.design.stirrupLegs = Math.max(2, parseInt((e.target as HTMLInputElement).value) || 2); recomputeView(); };
  $<HTMLInputElement>("#d-k").onchange = (e) => { app.design.colK = Math.max(0.5, parseFloat((e.target as HTMLInputElement).value) || 1); recomputeView(); };
  $<HTMLInputElement>("#d-sway").onchange = (e) => { app.design.sway = (e.target as HTMLInputElement).checked; recomputeView(); };
  $<HTMLInputElement>("#d-bds").onchange = (e) => { app.design.betaDs = Math.min(1, Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0)); recomputeView(); };
  $<HTMLInputElement>("#d-bdns").onchange = (e) => { app.design.betaDns = Math.min(1, Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0)); recomputeView(); };
  bindFoundationSettings(host);
  for (const el of host.querySelectorAll<HTMLInputElement>("[data-info]")) {
    el.onchange = () => { app.model.info = { ...emptyInfo, ...(app.model.info ?? {}), [el.dataset.info!]: el.value }; modelChanged(); };
  }
  const fb = document.getElementById("btn-footing-report");
  if (fb && sel) fb.onclick = () => openReport(`footing:${sel.id}`);
  for (const tr of host.querySelectorAll<HTMLTableRowElement>("tr[data-node]")) {
    tr.onclick = () => { app.selection = { kind: "node", id: tr.dataset.node! }; viewChanged(); };
  }
  const br = document.getElementById("btn-member-report");
  if (br && sel) br.onclick = () => openReport(sel.id);
  for (const tr of host.querySelectorAll<HTMLTableRowElement>("tr[data-member]")) {
    tr.onclick = () => { app.selection = { kind: "member", id: tr.dataset.member! }; viewChanged(); };
  }
}

function projectInfoCard2D(): string {
  const i = { ...emptyInfo, ...(app.model.info ?? {}) };
  const fld = (id: keyof ProjectInfo, label: string) => `<label>${label}<input data-info="${id}" type="text" value="${esc(i[id])}"/></label>`;
  return `<details class="card"><summary class="card-h">ข้อมูลโครงการ <span class="tag">ใช้ร่วมกับ 3D</span></summary><div class="form">
    ${fld("owner", "เจ้าของโครงการ")}${fld("location", "สถานที่")}${fld("company", "บริษัท")}${fld("engineer", "วิศวกรผู้ออกแบบ")}${fld("license", "เลขใบอนุญาต")}
  </div></details>`;
}

function recomputeView() { recompute(); viewChanged(); }

function beamSketch(d: ReturnType<typeof Object.values<typeof app.designs[string]>>[number]) {
  const W = 120, H = 120;
  const { b, h } = d.input;
  const s = Math.min((W - 20) / b, (H - 20) / h);
  const bw = b * s, hh = h * s, x0 = (W - bw) / 2, y0 = (H - hh) / 2;
  const cov = (d.input.cover + d.input.stirrupDia) * s;
  const dots = (n: number, dia: number, y: number) => {
    if (n <= 0) return "";
    const r = Math.max(2, (dia * s) / 2);
    const xs = n === 1 ? [W / 2] : Array.from({ length: n }, (_, k) => x0 + cov + r + ((bw - 2 * cov - 2 * r) * k) / (n - 1));
    return xs.map((x) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
  };
  const bot = d.bottom.bars, top = d.top.bars;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect class="conc" x="${x0}" y="${y0}" width="${bw}" height="${hh}"/>
    <rect class="stir" x="${x0 + d.input.cover * s}" y="${y0 + d.input.cover * s}" width="${bw - 2 * d.input.cover * s}" height="${hh - 2 * d.input.cover * s}" rx="3"/>
    <g class="bar">${bot ? dots(bot.n, bot.dia, y0 + hh - cov - (bot.dia * s) / 2) : ""}${top ? dots(top.n, top.dia, y0 + cov + (top.dia * s) / 2) : ""}</g>
    <text x="${W / 2}" y="${H - 2}" text-anchor="middle">${b}×${h}</text></svg>`;
}

function swayCardHtml(id: string) {
  const sw = app.sway?.columns[id];
  if (app.model.analysis?.pDelta) return `<p class="muted small">โมเมนต์มาจากการวิเคราะห์อันดับสอง (P-Δ) แล้ว จึงไม่ขยายโมเมนต์ซ้ำ (ACI §6.7)${app.model.analysis.cracked ? "" : " — <b class=\"badc\">ควรเปิดหน้าตัดแตกร้าว</b>"}</p>`;
  if (!app.design.sway) return `<p class="muted small">ปิดการคิดผลการเซอยู่ — ใช้การขยายโมเมนต์แบบโครงค้ำยันเท่านั้น</p>`;
  if (!sw) return `<p class="muted small">ไม่มีชุดผสมน้ำหนัก จึงไม่ได้คิดผลการเซ</p>`;
  const st = app.sway!.storeys.find((x) => x.key === sw.storey);
  const worst = st?.combos.reduce((a, c) => (c.Q > a.Q ? c : a), st.combos[0]);
  const dmax = Math.max(1, ...sw.combos.map((c) => c.deltaS));
  return `<div class="sub-h">การเซของโครง (ชั้น ${st ? `${f(st.yBot)}–${f(st.yTop)} m` : "-"})</div>
    <table class="mini"><tbody>
      <tr><td>ψ บน / ล่าง</td><td>${f(sw.psiTop, 2)} / ${f(sw.psiBot, 2)}</td></tr>
      <tr><td>k (เซ)</td><td>${f(sw.kSway, 2)} → kLu/r = ${f(sw.kLuR, 1)}${sw.neglect ? " ≤ 22" : ""}</td></tr>
      ${worst ? `<tr><td>Q สูงสุด</td><td>${f(worst.Q, 3)} <small>(${esc(worst.combo)})</small> ${worst.sway ? `<b class="badc">เซ</b>` : `<span class="okc">ไม่เซ</span>`}</td></tr>` : ""}
      <tr><td>δs ที่ใช้</td><td>${Number.isFinite(dmax) ? f(dmax, 3) : "∞"}${sw.neglect && worst?.sway ? " <small>(ไม่ต้องขยาย kLu/r ≤ 22)</small>" : ""}</td></tr>
    </tbody></table>`;
}

function columnSketch(c: ColumnDesignResult) {
  const W = 110, H = 110;
  const { b, h, cover, tieDia } = c.section;
  // แสดง h ในแนวนอน (ระนาบดัด) เพื่อให้ตรงกับทิศโมเมนต์ในโครง 2D
  const s = Math.min((W - 16) / h, (H - 22) / b);
  const ww = h * s, hh = b * s, x0 = (W - ww) / 2, y0 = (H - 12 - hh) / 2;
  const parts = [`<rect class="conc" x="${x0}" y="${y0}" width="${ww}" height="${hh}"/>`,
    `<rect class="stir" x="${x0 + cover * s}" y="${y0 + cover * s}" width="${ww - 2 * cover * s}" height="${hh - 2 * cover * s}" rx="2"/>`];
  if (c.layout) {
    const lay = c.layout;
    const r = Math.max(1.8, (lay.dia * s) / 2);
    const inset = (cover + tieDia) * s + r;
    for (const l of barLayers(c.section, lay)) {
      const n = Math.round(l.As / ((Math.PI * lay.dia * lay.dia) / 4));
      const px = x0 + l.d * s;
      for (let k = 0; k < n; k++) {
        const py = n === 1 ? y0 + hh / 2 : y0 + inset + ((hh - 2 * inset) * k) / (n - 1);
        parts.push(`<circle cx="${px}" cy="${py}" r="${r}"/>`);
      }
    }
  }
  parts.push(`<text x="${W / 2}" y="${H - 2}" text-anchor="middle">${h}(ระนาบดัด)×${b}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g class="bar">${parts.join("")}</g></svg>`;
}

// ---------- แถบสถานะ ----------
function renderStatus() {
  const st = $("#status");
  const m = app.model;
  if (app.error) {
    st.className = "status error";
    st.textContent = `⚠ ${app.error}`;
    return;
  }
  const res = currentResult();
  let eq = "";
  if (res) {
    const rx = Object.values(res.reactions).reduce((s, r) => s + r.fx, 0);
    const ry = Object.values(res.reactions).reduce((s, r) => s + r.fy, 0);
    const err = Math.abs(rx + res.appliedTotal.fx) + Math.abs(ry + res.appliedTotal.fy);
    eq = res.info?.pDelta
      ? ` · P-Δ ลู่เข้าใน ${res.info.iterations} รอบ`
      : ` · ตรวจสมดุล ΣF = ${err.toExponential(1)} kN ${err < 1e-6 ? "✓" : "⚠"}`;
    if (m.analysis?.cracked) eq += " · หน้าตัดแตกร้าว";
  }
  const fails = Object.values(app.designs).filter((d) => !d.ok).length;
  const colFails = Object.values(app.colDesigns).filter((d) => !d.ok).length;
  const ftFails = Object.values(app.footings).filter((d) => !d.ok).length;
  st.className = `status ${fails + colFails + ftFails ? "warn" : ""}`;
  st.textContent = `จุดต่อ ${m.nodes.length} · ชิ้นส่วน ${m.members.length} · วิเคราะห์แล้ว${eq}${fails ? ` · คานไม่ผ่าน ${fails} ตัว` : ""}${colFails ? ` · เสาไม่ผ่าน ${colFails} ต้น` : ""}${ftFails ? ` · ฐานรากไม่ผ่าน ${ftFails}` : ""}` +
    (app.mode === "draw" ? " · โหมดวาด: คลิกจุดเริ่ม–จุดปลาย, Esc เพื่อหยุด" : " · ลากเพื่อเลื่อน, ล้อเมาส์เพื่อซูม, Delete เพื่อลบ");
}

subscribe(() => { syncToolbar(); renderLeft(); renderRight(); convertDom($("#right-body")); renderStatus(); view.render(); });

// หน่วยที่แสดง (ใช้ร่วมกับหน้า 3D) — ตารางป้อนข้อมูลด้านซ้ายยังเป็น kN
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-units]")) {
  b.onclick = () => { units.set(b.dataset.units as UnitSys); modelChanged(); };
}
// หน้า 3D (หรืออีกแท็บ) เปลี่ยนค่าร่วม → ใช้ค่าใหม่แล้วคำนวณใหม่
onSharedChange((sh) => { applyShared2D(sh); modelChanged(); }, sharedFrom2D);
bindToolbar();

// ---------- โครงที่เชื่อมกับหน้า 3D ----------
// คลิกชิ้นส่วนใน 3D แล้วกด "2D" → เปิดโครงตามแนวกริด · แก้หน้าตัด/น้ำหนักบนคานที่นี่ → ส่งกลับ 3D
// อาคาร 3D เปลี่ยน → สร้างโครงนี้ใหม่อัตโนมัติ
function frameBanner(html: string, opts: { restore?: boolean; unlink?: boolean } = {}) {
  document.querySelector(".from3d-banner")?.remove();
  const el = document.createElement("div");
  el.className = "from3d-banner";
  el.innerHTML = `<span>${html}</span>${opts.restore ? `<button data-act="restore">กู้โมเดล 2D เดิม</button>` : ""}${opts.unlink ? `<button data-act="unlink" title="เลิกเชื่อม: แก้ไขต่อในหน้า 2D อย่างอิสระ">เลิกเชื่อม</button>` : ""}<a href="./3d.html">ไปหน้า 3D</a><button data-act="close" title="ปิด">×</button>`;
  el.querySelector<HTMLButtonElement>('[data-act="close"]')!.onclick = () => el.remove();
  el.querySelector<HTMLButtonElement>('[data-act="restore"]')?.addEventListener("click", () => {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (raw) { setModel(JSON.parse(raw)); requestAnimationFrame(() => view.fit()); }
    } catch { /* ไฟล์สำรองเสีย */ }
    el.remove();
  });
  el.querySelector<HTMLButtonElement>('[data-act="unlink"]')?.addEventListener("click", () => {
    delete app.model.link3d;
    modelChanged();
    el.remove();
  });
  document.body.appendChild(el);
}
const linkNote = "แก้หน้าตัด/น้ำหนักคานที่นี่ = แก้ใน 3D ด้วย และกลับกัน";
function receiveFrame() {
  if (location.hash !== "#from3d") return false;
  history.replaceState(null, "", location.pathname + location.search);
  const fr = takeFrameFrom3D();
  if (!fr) return false;
  // สำรองเฉพาะโมเดล 2D ของผู้ใช้เอง — โครงที่มาจาก 3D ก่อนหน้าไม่ทับไฟล์สำรอง
  if (!app.model.link3d && !app.model.name.includes(" — โครงแนวกริด")) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(app.model)); } catch { /* ไม่มี storage */ }
  }
  app.model = fr.model;
  app.selection = fr.select && fr.model.members.some((m) => m.id === fr.select) ? { kind: "member", id: fr.select } : null;
  app.display = "model";
  modelChanged();
  frameBanner(`🔗 โครง${esc(fr.label)}${fr.select ? ` · เลือก <b>${esc(fr.select)}</b>` : ""} — ${linkNote}`, { restore: !!localStorage.getItem(BACKUP_KEY), unlink: true });
  return true;
}
/** อาคาร 3D เปลี่ยน → สร้างโครงใหม่ (ถามก่อนถ้ารูปทรงในหน้า 2D ถูกแก้เอง) */
function refreshLinkedFrame(): boolean {
  const cur = app.model;
  if (!cur.link3d) return false;
  const r = refreshFrameFrom3D(cur);
  if (!r) return false;
  if ("error" in r) {
    delete cur.link3d;
    modelChanged();
    frameBanner(`เลิกเชื่อมกับ 3D: ${esc(r.error)}`);
    return true;
  }
  const next = r.model;
  const strip = (m: typeof cur) => JSON.stringify({ ...m, link3d: undefined });
  if (strip(next) === strip(cur)) { cur.link3d.sig = next.link3d!.sig; modelChanged(); return false; }
  // รูปทรงที่สร้างจาก 3D รุ่นก่อน — ถ้าโมเดลปัจจุบันไม่ตรง แปลว่าผู้ใช้แก้รูปทรงในหน้า 2D
  let edited = false;
  try { edited = !sameGeometry(cur, frameFrom3D(parseParams3D(cur.link3d.sig || null), cur.link3d)); } catch { edited = true; }
  if (edited && !confirm("อาคารในหน้า 3D เปลี่ยน — สร้างโครง 2D ใหม่ตาม 3D?\n(การแก้รูปทรงที่ทำในหน้า 2D เช่น ย้าย/เพิ่มชิ้นส่วน จะหายไป · กดยกเลิก = เลิกเชื่อมกับ 3D)")) {
    delete cur.link3d;
    modelChanged();
    frameBanner("เลิกเชื่อมกับ 3D แล้ว — โครงนี้แก้ไขต่อได้อิสระ");
    return true;
  }
  const sel = app.selection;
  app.model = next;
  app.selection = sel && (sel.kind === "member" ? next.members : next.nodes).some((x) => x.id === sel.id) ? sel : null;
  modelChanged();
  frameBanner(`🔗 อัปเดตโครงตามหน้า 3D แล้ว — ${linkNote}`, { unlink: true });
  requestAnimationFrame(() => view.fit());
  return true;
}
/** เปิดโครงตามแนวกริดของอาคาร 3D ที่บันทึกไว้ (สำรองโมเดล 2D เดิมของผู้ใช้ก่อน) */
function openFrame(f: FrameRef, backup = true) {
  const raw = readParams3DRaw();
  if (!raw) return;
  let m;
  try { m = frameFrom3D(parseParams3D(raw), f, raw); } catch (e) { alert(`เปิดโครงไม่ได้: ${(e as Error).message}`); return; }
  if (backup && !app.model.link3d && !app.model.name.includes(" — โครงแนวกริด")) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(app.model)); } catch { /* ไม่มี storage */ }
  }
  app.model = m;
  app.selection = null;
  modelChanged();
  requestAnimationFrame(() => view.fit());
  frameBanner(`🔗 โครง${esc(frameLabel(f))} — ${linkNote}`, { restore: backup && !!localStorage.getItem(BACKUP_KEY), unlink: true });
}
/** ช่องเลือกโครงจากอาคาร 3D (ซ่อนถ้ายังไม่มีอาคาร 3D) */
function syncFrameSelect() {
  const sel = document.querySelector<HTMLSelectElement>("#sel-frame3d");
  if (!sel) return;
  const raw = readParams3DRaw();
  if (!raw) { sel.hidden = true; return; }
  let frames: FrameRef[] = [];
  try { frames = listFrames(parseParams3D(raw)); } catch { sel.hidden = true; return; }
  const cur = app.model.link3d ? frameKey(app.model.link3d) : "";
  const html = `<option value="">${cur ? "โครงจาก 3D" : "โครงจาก 3D… (โมเดลนี้ไม่ได้เชื่อม)"}</option>` +
    frames.map((f) => `<option value="${frameKey(f)}" ${frameKey(f) === cur ? "selected" : ""}>🔗 ${esc(frameLabel(f))}</option>`).join("");
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = cur;
  sel.hidden = false;
  sel.classList.toggle("linked", !!cur);
}
document.querySelector<HTMLSelectElement>("#sel-frame3d")?.addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (!v) { syncFrameSelect(); return; }
  const [dir, line] = v.split(":");
  openFrame({ dir: dir as "X" | "Y", line: +line });
});
subscribe(syncFrameSelect);

if (!receiveFrame()) {
  // เปิดหน้า 2D ครั้งแรก (ยังไม่มีงาน 2D) และมีอาคาร 3D อยู่ → แสดงโครงแนวกลางของอาคารนั้นแทนตัวอย่าง
  const raw3d = readParams3DRaw();
  if (freshStart && raw3d) { try { openFrame(defaultFrame(parseParams3D(raw3d)), false); } catch { /* ใช้ตัวอย่าง */ } }
  const shown = refreshLinkedFrame() || (freshStart && !!app.model.link3d);
  modelChanged();
  if (!shown && app.model.link3d) frameBanner(`🔗 โครงนี้เชื่อมกับหน้า 3D — ${linkNote}`, { unlink: true });
}
window.addEventListener("hashchange", () => { if (receiveFrame()) requestAnimationFrame(() => view.fit()); });
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  if (receiveFrame()) requestAnimationFrame(() => view.fit()); else refreshLinkedFrame();
});
window.addEventListener("storage", (e) => { if (e.key === PARAMS3D_KEY) { refreshLinkedFrame(); syncFrameSelect(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshLinkedFrame(); });
requestAnimationFrame(() => view.fit());
