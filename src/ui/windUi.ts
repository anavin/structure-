// แท็บแรงลม มยผ. 1311-50

import { applyWindLinked } from "../shared/frameFrom3d.ts";
import { applyWind, defaultWind, IMPORTANCE, windForces, ZONES, type Importance, type WindResult, type WindSettings, type WindZone } from "../loads/windTH.ts";
import { app, modelChanged } from "./state.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");
const KG = 101.97; // kN/m² → kg/m²

let draft: WindSettings | null = null;
export function windSettings(): WindSettings { return draft ?? { ...defaultWind, ...(app.model.wind ?? {}) }; }

export function windTableHtml(r: WindResult, w: WindSettings): string {
  return `<table class="grid wind"><thead><tr><th>ระดับ y (m)</th><th>z (m)</th><th>ช่วงรับลม (m)</th><th>Ce</th><th>p ต้นลม</th><th>p ท้ายลม</th><th>F (kN)</th></tr></thead><tbody>
    ${r.levels.map((l) => `<tr><td>${f(l.y)}</td><td>${f(l.z)}</td><td>${f(l.zBot)}–${f(l.zTop)}</td><td>${f(l.CeW, 3)}</td><td>${f(l.pW, 3)}</td><td>${f(l.pL, 3)}</td><td><b>${f(l.F)}</b></td></tr>`).join("")}
    <tr><td colspan="6" style="text-align:right">แรงเฉือนที่ฐาน (ต่อโครง ระยะห่าง ${f(w.spacing)} m)</td><td><b>${f(r.baseShear)}</b></td></tr>
  </tbody></table>`;
}

export function renderWindTab(host: HTMLElement) {
  const w = windSettings();
  const r = windForces(app.model, w);
  const applied = app.model.loadCases.some((c) => c.id === "WX");
  const opt = <T extends string>(cur: T, list: [T, string][]) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  host.insertAdjacentHTML("beforeend", `<div class="wind-tab">
    <p class="muted small">มยผ. 1311-50 วิธีการอย่างง่าย: p = Iw·q·Ce·Cg·Cp — ค่าตั้งต้นแก้ได้ ผู้ออกแบบต้องตรวจกับมาตรฐานฉบับจริง</p>
    <div class="form wform">
      <label>พื้นที่ (กลุ่มความเร็วลม)<select id="w-zone">${opt(w.zone, Object.entries(ZONES).map(([k, v]) => [k as WindZone, v.label]))}</select></label>
      <label>V₅₀ (m/s)<input id="w-v" type="number" step="0.5" value="${w.V50}"/></label>
      <label>TF (ไต้ฝุ่น)<input id="w-tf" type="number" step="0.01" value="${w.TF}"/></label>
      <label>ความสำคัญ<select id="w-imp">${opt(w.importance, Object.entries(IMPORTANCE).map(([k, v]) => [k as Importance, v.label]))}</select></label>
      <label>Iw<input id="w-iw" type="number" step="0.05" value="${w.Iw}"/></label>
      <label>สภาพภูมิประเทศ<select id="w-exp">${opt(w.exposure, [["A", "A — โล่ง"], ["B", "B — ชานเมือง/เมือง"]])}</select></label>
      <label>Cg<input id="w-cg" type="number" step="0.1" value="${w.Cg}"/></label>
      <label>Cp ต้นลม<input id="w-cpw" type="number" step="0.05" value="${w.CpW}"/></label>
      <label>Cp ท้ายลม<input id="w-cpl" type="number" step="0.05" value="${w.CpL}"/></label>
      <label title="ระยะห่างโครงข้อแข็ง = ความกว้างที่รับลมต่อโครง">ระยะห่างโครง (m)<input id="w-sp" type="number" step="0.5" value="${w.spacing}"/></label>
      <label title="ผนังกันตก/หลังคาเหนือระดับบนสุด">ส่วนเหนือหลังคา (m)<input id="w-par" type="number" step="0.1" value="${w.parapet}"/></label>
    </div>
    <table class="mini wsum"><tbody>
      <tr><td>q</td><td>${f(r.q, 4)} kN/m² (${f(r.q * KG, 1)} kg/m²)</td></tr>
      <tr><td>H / D</td><td>${f(r.H)} m / ${f(r.D)} m</td></tr>
      <tr><td>Ce ท้ายลม (0.5H)</td><td>${f(r.CeL, 3)}</td></tr>
    </tbody></table>
    ${r.warnings.map((x) => `<p class="warn">${esc(x)}</p>`).join("")}
    <div class="tbl-head" style="margin-top:8px"><span>แรงลมรายชั้น (kN/m², kN)</span></div>
    <div class="tbl-scroll">${windTableHtml(r, w)}</div>
    <button id="w-apply" class="primary wide">${applied ? "อัปเดต" : "สร้าง"} load case ลม WX (+X) และ WXN (−X)</button>
    <p class="muted small">แรงกระทำที่จุดต่อด้านต้นลมของแต่ละชั้น (สมมติพื้นแข็งในระนาบ) · จากนั้นกดชุดผสมสำเร็จรูปในแท็บชุดผสม</p>
    ${app.model.link3d ? `<p class="small"><b>โครงนี้เชื่อมกับอาคาร 3D:</b> แรงลมใน WX/WXN คือส่วนที่โครงนี้รับจริงในอาคาร 3D (พื้นแข็งกระจายแรงตามความแข็งของแต่ละแนว) — ตารางด้านบนเป็นวิธีความกว้างรับลมไว้อ้างอิง</p>` : ""}
  </div>`);

  const root = host.querySelector(".wind-tab") as HTMLElement;
  // แก้ค่าแล้วมีผลทันที: บันทึกลงโมเดล (ใช้ร่วมกับหน้า 3D) และสร้าง WX/WXN ใหม่ถ้ามีอยู่แล้ว
  const upd = (patch: Partial<WindSettings>) => {
    const w = { ...windSettings(), ...patch };
    draft = null;
    app.model.wind = w;
    if (app.model.loadCases.some((c) => c.id === "WX")) applyWindLinked(app.model, w);
    modelChanged();
  };
  const num = (id: string, key: keyof WindSettings) => {
    const el = root.querySelector<HTMLInputElement>(`#${id}`)!;
    el.onchange = () => { const v = parseFloat(el.value); if (Number.isFinite(v)) upd({ [key]: v } as Partial<WindSettings>); };
  };
  root.querySelector<HTMLSelectElement>("#w-zone")!.onchange = (e) => {
    const z = (e.target as HTMLSelectElement).value as WindZone;
    upd({ zone: z, V50: ZONES[z].V50, TF: ZONES[z].TF });
  };
  root.querySelector<HTMLSelectElement>("#w-imp")!.onchange = (e) => {
    const k = (e.target as HTMLSelectElement).value as Importance;
    upd({ importance: k, Iw: IMPORTANCE[k].Iw });
  };
  root.querySelector<HTMLSelectElement>("#w-exp")!.onchange = (e) => upd({ exposure: (e.target as HTMLSelectElement).value as "A" | "B" });
  num("w-v", "V50"); num("w-tf", "TF"); num("w-iw", "Iw"); num("w-cg", "Cg"); num("w-cpw", "CpW"); num("w-cpl", "CpL"); num("w-sp", "spacing"); num("w-par", "parapet");
  root.querySelector<HTMLButtonElement>("#w-apply")!.onclick = () => {
    applyWindLinked(app.model, windSettings());
    draft = null;
    modelChanged();
  };
}
