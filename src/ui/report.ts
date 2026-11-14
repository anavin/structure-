// รายการคำนวณ (Calculation Sheet) ขนาด A4 — พิมพ์หรือบันทึกเป็น PDF ผ่านเบราว์เซอร์

import type { BeamDesignResult, Step } from "../design/rcBeam.ts";
import { barLayers, totalBars, type ColumnDesignResult } from "../design/rcColumn.ts";
import { beamSectionSvg, columnSectionSvg, scheduleHtml, SECTION_CSS, tieShort } from "./sectionSvg.ts";
import { app, resultLabel } from "./state.ts";
import { pmChartSvg } from "./pmChart.ts";
import { footingPlanSvg } from "./footingUi.ts";
import { windTableHtml } from "./windUi.ts";
import { IMPORTANCE, ZONES, windForces } from "../loads/windTH.ts";
import { foundationSettings } from "./state.ts";
import { convertDom } from "../app3d/units.ts";
import { emptyInfo } from "../shared/shared.ts";
import type { FootingResult } from "../design/footing.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");

function stepsTable(steps: Step[]) {
  return `<table class="steps"><tbody>${steps.map((s) => `
    <tr class="${s.ok === false ? "bad" : s.ok ? "good" : ""}">
      <td class="lbl">${esc(s.label)}</td><td class="expr">${esc(s.expr)}</td><td class="val">${esc(s.value)}</td>
    </tr>`).join("")}</tbody></table>`;
}

// ---------- ภาพตัด ----------
function beamSvg(d: BeamDesignResult, title?: string, W?: number, H?: number) {
  const i = d.input;
  return beamSectionSvg({ b: i.b, h: i.h, cover: i.cover, tieDia: i.stirrupDia, bottom: d.bottom.bars, top: d.top.bars, tieLabel: tieShort(i.stirrupDia, d.shear.spacing), title }, W, H);
}
/** เหล็กเสาจากชั้นเหล็ก (ระยะ d จากผิวรับแรงอัดตามด้าน h) → พิกัด u (ตาม h), w (ตาม b) */
function columnBars2D(c: ColumnDesignResult) {
  const lay = c.layout, s = c.section;
  if (!lay) return [];
  const a = (Math.PI * lay.dia ** 2) / 4;
  const W = s.b / 2 - s.cover - s.tieDia - lay.dia / 2;
  return barLayers(s, lay).flatMap((l) => {
    const n = Math.round(l.As / a);
    return Array.from({ length: n }, (_, k) => ({ u: l.d - s.h / 2, w: n === 1 ? 0 : -W + (2 * W * k) / (n - 1) }));
  });
}
function columnSvg(c: ColumnDesignResult, title?: string, W?: number, H?: number) {
  const s = c.section;
  return columnSectionSvg({ b: s.b, h: s.h, cover: s.cover, tieDia: s.tieDia, bars: columnBars2D(c), dia: c.layout?.dia ?? 16, tieLabel: tieShort(s.tieDia, c.ties.spacing), title }, W, H);
}
function schedule2D(): string {
  const beams = Object.entries(app.designs), cols = Object.entries(app.colDesigns);
  if (!beams.length && !cols.length) return "";
  const bKey = (d: BeamDesignResult) => `${d.input.b}x${d.input.h}|${d.top.bars?.n}-${d.top.bars?.dia}|${d.bottom.bars?.n}-${d.bottom.bars?.dia}|${d.shear.spacing}`;
  const cKey = (c: ColumnDesignResult) => `${c.section.b}x${c.section.h}|${c.layout?.dia}-${c.layout?.nFace}-${c.layout?.nSide}|${c.ties.spacing}`;
  return `<section class="page">
    <header class="ph"><div><b>${esc(app.model.name)}</b><br/>ตารางหน้าตัดคานและเสา (Section Schedule)</div><div class="r">${new Date().toLocaleDateString("th-TH")}</div></header>
    ${beams.length ? `<h3>คาน (${beams.length} ตัว)</h3>${scheduleHtml("B", beams.map(([id, d]) => ({ id, key: bKey(d), svg: (t) => beamSvg(d, t, 210, 230) })), esc)}` : ""}
    ${cols.length ? `<h3>เสา (${cols.length} ต้น)</h3>${scheduleHtml("C", cols.map(([id, c]) => ({ id, key: cKey(c), svg: (t) => columnSvg(c, t, 210, 230) })), esc)}` : ""}
    <p style="font-size:10px;color:#667;margin:6px 0 0">รวมชิ้นที่มีขนาด เหล็กเสริม และเหล็กปลอกเหมือนกันเป็นแบบเดียว · ภาพตัดตามมาตราส่วน (มิติเป็น mm) · เสา: ด้านแนวนอนของภาพ = h (ระนาบโครง)</p>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</footer>
  </section>`;
}

function beamPage(memberId: string, d: BeamDesignResult) {
  const m = app.model;
  const mem = m.members.find((x) => x.id === memberId)!;
  const sec = m.sections.find((s) => s.id === mem.section)!;
  const mat = m.materials.find((x) => x.id === sec.material)!;
  const env = app.run!.envelope[memberId];
  const L = app.run!.combos[Object.keys(app.run!.combos)[0]]?.members[memberId]?.L
    ?? Object.values(app.run!.cases)[0]?.members[memberId]?.L ?? 0;
  const inp = d.input;
  const lbl = (k: string) => (k === "-" ? "-" : esc(resultLabel(app.run!.combos[k] ? `combo:${k}` : `case:${k}`)));
  const summary = (fr: BeamDesignResult["bottom"]) => (fr.bars ? `${fr.bars.n}DB${fr.bars.dia}` : "ไม่ผ่าน");
  return `<section class="page">
    <header class="ph"><div><b>${esc(m.name)}</b><br/>ออกแบบคาน ค.ส.ล. — ${esc(memberId)}</div>
      <div class="r">มาตรฐาน: ${inp.code === "EIT" ? "วสท. 1008-38 (วิธีกำลัง)" : "ACI 318-19"}<br/>${new Date().toLocaleDateString("th-TH")}</div></header>
    <h3>1. ข้อมูลชิ้นส่วน</h3>
    <table class="kv"><tbody>
      <tr><td>หน้าตัด</td><td>${esc(sec.name)} — b × h = ${inp.b} × ${inp.h} mm</td><td>ความยาว</td><td>${f(L)} m</td></tr>
      <tr><td>คอนกรีต fc'</td><td>${inp.fcKsc} ksc (${f(inp.fcKsc * 0.0980665)} MPa)</td><td>เหล็กเสริม fy</td><td>${inp.fyKsc} ksc (${f(inp.fyKsc * 0.0980665)} MPa)</td></tr>
      <tr><td>เหล็กปลอก fyt</td><td>${inp.fytKsc} ksc, Ø${inp.stirrupDia} ${inp.stirrupLegs} ขา</td><td>ระยะหุ้ม</td><td>${inp.cover} mm</td></tr>
      <tr><td>วัสดุ</td><td colspan="3">${esc(mat.name)}</td></tr>
    </tbody></table>
    <h3>ภาพตัดเหล็กเสริม</h3>
    <div class="sec-row">${beamSvg(d)}<table class="kv"><tbody>
      <tr><td>เหล็กบน</td><td>${summary(d.top)} (As ${f(d.top.AsProv, 0)} mm²)</td></tr>
      <tr><td>เหล็กล่าง</td><td>${summary(d.bottom)} (As ${f(d.bottom.AsProv, 0)} mm²)</td></tr>
      <tr><td>เหล็กปลอก</td><td>${esc(d.shear.message.replace("เหล็กปลอก ", ""))}, ${inp.stirrupLegs} ขา</td></tr>
      <tr><td>ระยะหุ้ม</td><td>${inp.cover} mm ถึงผิวเหล็กปลอก</td></tr>
    </tbody></table></div>
    <h3>2. แรงภายในออกแบบ (ค่าสุดขีดจากชุดผสมน้ำหนัก)</h3>
    <table class="kv"><tbody>
      <tr><td>Mu บวก</td><td>${f(env.maxM)} kN·m</td><td>จาก</td><td>${lbl(env.maxMCombo)}</td></tr>
      <tr><td>Mu ลบ</td><td>${f(env.minM)} kN·m</td><td>จาก</td><td>${lbl(env.minMCombo)}</td></tr>
      <tr><td>Vu</td><td>${f(env.maxAbsV)} kN</td><td>จาก</td><td>${lbl(env.maxVCombo)}</td></tr>
    </tbody></table>
    <h3>3. เหล็กเสริมรับโมเมนต์บวก (ล่าง)</h3>${stepsTable(d.bottom.steps)}<p class="msg ${d.bottom.ok ? "" : "bad"}">${esc(d.bottom.message)}</p>
    <h3>4. เหล็กเสริมรับโมเมนต์ลบ (บน)</h3>${stepsTable(d.top.steps)}<p class="msg ${d.top.ok ? "" : "bad"}">${esc(d.top.message)}</p>
    <h3>5. เหล็กปลอกรับแรงเฉือน</h3>${stepsTable(d.shear.steps)}<p class="msg ${d.shear.ok ? "" : "bad"}">${esc(d.shear.message)}</p>
    <div class="result ${d.ok ? "" : "bad"}"><b>สรุป ${esc(memberId)}:</b> ล่าง ${summary(d.bottom)} · บน ${summary(d.top)} · ${esc(d.shear.message)} — ${d.ok ? "ผ่าน" : "ไม่ผ่าน ต้องแก้ไขหน้าตัด"}</div>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</footer>
  </section>`;
}

function footingPage(nodeId: string, fr: FootingResult) {
  const m = app.model;
  const st = foundationSettings();
  const unit = fr.type === "pile" ? "kN/ต้น" : "kN/m²";
  const rows = fr.service.map((s) => `<tr class="${s.ok ? "" : "bad"}"><td>${esc(s.name)}</td><td>${f(s.Ptot)}</td><td>${f(s.Mb)}</td><td>${f(s.e, 3)}</td><td>${f(s.qmax)}</td><td>${f(s.qmin)}</td><td>${f(s.allow)}</td><td>${s.ok ? "ผ่าน" : "ไม่ผ่าน"}${s.note ? `<br/><small>${esc(s.note)}</small>` : ""}</td></tr>`).join("");
  return `<section class="page">
    <header class="ph"><div><b>${esc(m.name)}</b><br/>ออกแบบฐานราก${fr.type === "pile" ? "เสาเข็ม" : "แผ่"} — จุดต่อ ${esc(nodeId)}</div>
      <div class="r">มาตรฐาน: ${app.design.code === "EIT" ? "วสท. 1008-38" : "ACI 318-19"}<br/>${new Date().toLocaleDateString("th-TH")}</div></header>
    <h3>1. แปลนและข้อมูล</h3>
    <div class="chart-row"><div>${footingPlanSvg(fr, nodeId, 300, 260)}</div>${stepsTable(fr.steps)}</div>
    <h3>2. ตรวจแรงใช้งาน (${fr.type === "pile" ? "แรงในเข็ม" : "หน่วยแรงแบกทาน"})</h3>
    <table class="grid"><thead><tr><th>กรณี</th><th>P รวม (kN)</th><th>M ท้องฐาน (kN·m)</th><th>e (m)</th><th>max (${unit})</th><th>min</th><th>ยอมให้</th><th>ผล</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">แรงใช้งาน = ผลรวม load case แนวดิ่ง (×1.0) ± แรงด้านข้าง (×1.0)${st.windIncrease ? " โดยเพิ่มค่ายอมให้ 33% เมื่อรวมแรงลม" : ""} · P รวมน้ำหนักฐานและดินถม · M ท้องฐาน = M − H·t</p>
    <div class="result ${fr.ok ? "" : "bad"}"><b>สรุปฐานราก ${esc(nodeId)}:</b> ${f(fr.L)} × ${f(fr.B)} × ${f(fr.t)} m${fr.piles ? ` · เข็ม ${fr.piles.coords.length} ต้น` : ""} · เหล็กแนว x ${esc(fr.barsX)} · แนว y ${esc(fr.barsY)} — ${fr.ok ? "ผ่าน" : esc(fr.message)}</div>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — ต้องตรวจระยะฝังยึดเหล็ก ค่ากำลังดิน/เข็มจากผลทดสอบจริง และรับผิดชอบโดยวิศวกรผู้ออกแบบ</footer>
  </section>`;
}

function columnPage(memberId: string, c: ColumnDesignResult) {
  const m = app.model;
  const mem = m.members.find((x) => x.id === memberId)!;
  const sec = m.sections.find((s) => s.id === mem.section)!;
  const s = c.section;
  const lay = c.layout;
  const rows = c.checks.map((k) => `<tr class="${k.ratio <= 1 ? "" : "bad"}"><td>${esc(k.combo)}</td><td>${f(k.Pu)}</td><td>${f(k.Mbot)}</td><td>${f(k.Mtop)}</td>
    <td>${k.deltaS === undefined ? "-" : Number.isFinite(k.deltaS) ? f(k.deltaS, 3) : "∞"}</td><td>${Number.isFinite(k.delta) ? f(k.delta, 3) : "∞"}</td><td>${f(k.Mc)}</td><td>${f(k.phiMnAtPu)}</td><td><b>${Number.isFinite(k.ratio) ? f(k.ratio, 3) : "∞"}</b>${k.note ? `<br/><small>${esc(k.note)}</small>` : ""}</td></tr>`).join("");
  return `<section class="page">
    <header class="ph"><div><b>${esc(m.name)}</b><br/>ออกแบบเสา ค.ส.ล. — ${esc(memberId)}</div>
      <div class="r">มาตรฐาน: ${s.code === "EIT" ? "วสท. 1008-38 (วิธีกำลัง)" : "ACI 318-19"}<br/>${new Date().toLocaleDateString("th-TH")}</div></header>
    <h3>1. ข้อมูลชิ้นส่วน</h3>
    <table class="kv"><tbody>
      <tr><td>หน้าตัด</td><td>${esc(sec.name)} — b × h = ${s.b} × ${s.h} mm (h ในระนาบดัด)</td><td>ความยาว Lu</td><td>${f(c.slender.Lu / 1000)} m</td></tr>
      <tr><td>คอนกรีต fc'</td><td>${s.fcKsc} ksc (${f(s.fcKsc * 0.0980665)} MPa)</td><td>เหล็กยืน fy</td><td>${s.fyKsc} ksc (${f(s.fyKsc * 0.0980665)} MPa)</td></tr>
      <tr><td>เหล็กปลอก</td><td>Ø${s.tieDia}, fyt ${s.fytKsc} ksc</td><td>ระยะหุ้ม</td><td>${s.cover} mm</td></tr>
    </tbody></table>
    <h3>ภาพตัดเหล็กเสริม</h3>
    <div class="sec-row">${columnSvg(c)}<table class="kv"><tbody>
      <tr><td>เหล็กยืน</td><td>${lay ? `${totalBars(lay)}-DB${lay.dia} (As ${f(c.Ast, 0)} mm², ρg ${f(c.rho * 100)}%)` : "—"}</td></tr>
      <tr><td>การวาง</td><td>${lay ? `ด้านตั้งฉากระนาบดัด ด้านละ ${lay.nFace} เส้น + ข้างละ ${lay.nSide} เส้น` : "—"}</td></tr>
      <tr><td>เหล็กปลอก</td><td>${esc(c.ties.note)}</td></tr>
      <tr><td>ระยะหุ้ม</td><td>${s.cover} mm ถึงผิวเหล็กปลอก</td></tr>
    </tbody></table></div>
    <h3>2. กำลังหน้าตัดและความชะลูด</h3>
    <div class="chart-row"><div>${pmChartSvg(c, 300, 270)}</div>${stepsTable(c.steps)}</div>
    <h3>3. ตรวจสอบทุกชุดผสมน้ำหนัก (kN, kN·m)</h3>
    <table class="grid"><thead><tr><th>ชุดผสม</th><th>Pu (kN)</th><th>M ล่าง* (kN·m)</th><th>M บน* (kN·m)</th><th>δs</th><th>δns</th><th>Mc (kN·m)</th><th>φMn ที่ Pu (kN·m)</th><th>อัตราส่วน</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="font-size:10px;margin-top:4px">* โมเมนต์ปลายตามอนุสัญญาคาน หลังรวมผลการเซ M = Mns + δs·Ms (ACI §6.6.4.6) · Mc = δns·max(|M2|, M2,min) เมื่อเป็นเสาชะลูดตามความยาว (§6.6.4.5)</p>
    <div class="result ${c.ok ? "" : "bad"}"><b>สรุป ${esc(memberId)}:</b> ${lay ? `${totalBars(lay)}DB${lay.dia} (ρg = ${f(c.rho * 100)}%)` : "—"} · ปลอก ${esc(c.ties.note)} · อัตราส่วนสูงสุด ${f(c.maxRatio, 3)} — ${c.ok ? "ผ่าน" : "ไม่ผ่าน ต้องแก้ไขหน้าตัด"}</div>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</footer>
  </section>`;
}

function storeyTable() {
  const sw = app.sway;
  if (!sw || !sw.storeys.length) return "";
  const rows = sw.storeys.map((st) => st.combos.map((c, i) => `<tr class="${c.unstable || c.deltaS > 1.4 ? "bad" : ""}">
    ${i === 0 ? `<td rowspan="${st.combos.length}">${f(st.yBot)}–${f(st.yTop)}</td>` : ""}<td>${esc(c.combo)}</td><td>${f(c.sumPu, 1)}</td><td>${f(c.Vus, 2)}</td>
    <td>${f(c.drift * 1000, 2)}</td><td>${f(c.Q, 4)}</td><td>${c.sway ? "เซ" : "ไม่เซ"}</td><td>${c.method}</td><td>${Number.isFinite(c.deltaS) ? f(c.deltaS, 3) : "∞"}</td></tr>`).join("")).join("");
  return `<h3>ดัชนีเสถียรภาพของชั้น (ACI §6.6.4.4.1)</h3>
    <table class="grid"><thead><tr><th>ชั้น (m)</th><th>ชุดผสม</th><th>ΣPu (kN)</th><th>Vus (kN)</th><th>Δo (mm)</th><th>Q</th><th>สถานะ</th><th>วิธี</th><th>δs</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">Q = ΣPu·Δo/(Vus·lc), Δo จากแรงด้านข้างด้วยความแข็งแตกร้าว (เสา 0.70Ig/(1+βds), คาน 0.35Ig) · Q ≤ 0.05 ถือเป็นชั้นไม่เซ · δs = 1/(1−Q) ถ้า ≤ 1.5 มิฉะนั้นใช้ 1/(1 − ΣPu/0.75ΣPc)</p>`;
}

function windPage() {
  const m = app.model;
  const w = m.wind;
  if (!w || !m.loadCases.some((c) => c.id === "WX")) return "";
  const r = windForces(m, w);
  const step = (label: string, expr: string, value: string) => `<tr><td class="lbl">${esc(label)}</td><td class="expr">${esc(expr)}</td><td class="val">${esc(value)}</td></tr>`;
  return `<section class="page">
    <header class="ph"><div><b>${esc(m.name)}</b><br/>แรงลมตาม มยผ. 1311-50 (วิธีการอย่างง่าย)</div><div class="r">${new Date().toLocaleDateString("th-TH")}</div></header>
    <h3>1. ค่าพารามิเตอร์</h3>
    <table class="steps"><tbody>
      ${step("พื้นที่", ZONES[w.zone].label, `V₅₀ = ${w.V50} m/s, TF = ${w.TF}`)}
      ${step("ความดันลมอ้างอิง q", "½ρV₅₀²·TF, ρ = 1.25 kg/m³", `${f(r.q, 4)} kN/m² (${f(r.q * 101.97, 1)} kg/m²)`)}
      ${step("ค่าประกอบความสำคัญ", IMPORTANCE[w.importance].label, `Iw = ${w.Iw}`)}
      ${step("สภาพภูมิประเทศ", w.exposure === "A" ? "A: Ce = (z/10)^0.2 ≥ 0.9" : "B: Ce = 0.7(z/12)^0.3 ≥ 0.7", w.exposure)}
      ${step("ค่าประกอบเชิงพลศาสตร์", "Cg (ระบบโครงสร้างหลัก)", f(w.Cg))}
      ${step("สัมประสิทธิ์ความดัน", "Cp ด้านต้นลม / ด้านท้ายลม", `${f(w.CpW)} / ${f(w.CpL)}`)}
      ${step("ขนาดอาคาร", "H (รวมส่วนเหนือหลังคา) / D", `${f(r.H)} / ${f(r.D)} m`)}
      ${step("Ce ด้านท้ายลม", "ที่ความสูง 0.5H", f(r.CeL, 3))}
      ${step("ความกว้างรับลมต่อโครง", "ระยะห่างโครงข้อแข็ง", `${f(w.spacing)} m`)}
    </tbody></table>
    ${r.warnings.map((x) => `<p class="msg bad">${esc(x)}</p>`).join("")}
    <h3>2. แรงลมรายชั้น</h3>
    ${windTableHtml(r, w)}
    <p style="font-size:10px;color:#667;margin:4px 0 0">p = Iw·q·Ce·Cg·Cp · แรงต่อชั้น F = s·[∫p_ต้นลม dz + |p_ท้ายลม|·Δz] ในช่วงกึ่งกลางชั้นล่าง–บน · load case WX (+X) กระทำที่จุดต่อซ้ายสุด, WXN (−X) ที่จุดต่อขวาสุดของแต่ละชั้น</p>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — ค่าสัมประสิทธิ์ต้องตรวจกับ มยผ. 1311-50 ฉบับจริงโดยวิศวกรผู้ออกแบบ</footer>
  </section>`;
}

function summaryPage() {
  const m = app.model;
  const run = app.run!;
  const rows = Object.entries(app.designs).map(([id, d]) => `<tr class="${d.ok ? "" : "bad"}"><td>${esc(id)}</td>
    <td>${d.input.b}×${d.input.h}</td><td>${d.bottom.bars ? `${d.bottom.bars.n}DB${d.bottom.bars.dia}` : "-"}</td>
    <td>${d.top.bars ? `${d.top.bars.n}DB${d.top.bars.dia}` : "-"}</td><td>${esc(d.shear.message.replace("เหล็กปลอก ", ""))}</td><td>${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("");
  const reactRows = m.combos.map((c) => {
    const r = run.combos[c.id];
    return Object.entries(r.reactions).map(([nid, x]) => `<tr><td>${esc(c.name)}</td><td>${esc(nid)}</td><td>${f(x.fx)}</td><td>${f(x.fy)}</td><td>${f(x.mz)}</td></tr>`).join("");
  }).join("");
  return `<section class="page">
    <header class="ph"><div><b>${esc(m.name)}</b><br/>สรุปผลการวิเคราะห์และออกแบบ</div><div class="r">${new Date().toLocaleDateString("th-TH")}</div></header>
    ${(() => { const i = { ...emptyInfo, ...(m.info ?? {}) }; const rows = [["เจ้าของโครงการ", i.owner], ["สถานที่", i.location], ["บริษัท", i.company], ["วิศวกรผู้ออกแบบ", i.engineer], ["เลขใบอนุญาต", i.license]].filter(([, v]) => v);
      return rows.length ? `<h3>ข้อมูลโครงการ</h3><table class="kv"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : ""; })()}
    <h3>ข้อมูลโมเดล</h3>
    <p>จุดต่อ ${m.nodes.length} · ชิ้นส่วน ${m.members.length} · load case ${m.loadCases.length} · ชุดผสม ${m.combos.length}<br/>
    วิธีวิเคราะห์: วิธีความแข็งโดยตรง (โครงข้อแข็ง 2 มิติ, ยืดหยุ่นเชิงเส้น) · ${m.analysis?.pDelta ? "อันดับสอง P-Delta (เมทริกซ์ความแข็งเรขาคณิต + P-δ ตามความยาวชิ้นส่วน)" : "อันดับหนึ่ง (first-order)"} · ${m.analysis?.cracked ? "ความแข็งแตกร้าว เสา 0.70Ig / คาน 0.35Ig (ACI 6.6.3.1.1)" : "ความแข็งหน้าตัดเต็ม Ig"} · ชิ้นส่วนที่ปลดโมเมนต์ ${m.members.filter((x) => x.releaseI || x.releaseJ).length} ตัว · หน่วย kN, m</p>
    ${(() => {
      const fk = (fix: boolean, k?: number, u = "") => (fix ? "ยึด" : k && k > 0 ? `${k.toLocaleString("th-TH")}${u}` : "อิสระ");
      const sp = m.supports.filter((s) => (!s.ux && (s.kx ?? 0) > 0) || (!s.uy && (s.ky ?? 0) > 0) || (!s.rz && (s.kr ?? 0) > 0));
      const st = m.loadCases.flatMap((lc) => (lc.settle ?? []).map((t) => ({ lc: lc.id, ...t })));
      return (sp.length ? `<h3>จุดรองรับสปริง</h3><table class="grid"><thead><tr><th>จุด</th><th>kx (kN/m)</th><th>ky (kN/m)</th><th>kr (kN·m/rad)</th></tr></thead><tbody>${sp.map((s) => `<tr><td>${esc(s.node)}</td><td>${fk(s.ux, s.kx)}</td><td>${fk(s.uy, s.ky)}</td><td>${fk(s.rz, s.kr)}</td></tr>`).join("")}</tbody></table><p class="note">แรงปฏิกิริยาสปริง R = −k(u − δ)</p>` : "")
        + (st.length ? `<h3>การทรุดตัวของจุดรองรับ</h3><table class="grid"><thead><tr><th>load case</th><th>จุด</th><th>dx (mm)</th><th>dy (mm)</th><th>θ (×10⁻³ rad)</th></tr></thead><tbody>${st.map((t) => `<tr><td>${esc(t.lc)}</td><td>${esc(t.node)}</td><td>${(t.dx * 1000).toFixed(2)}</td><td>${(t.dy * 1000).toFixed(2)}</td><td>${(t.rz * 1000).toFixed(3)}</td></tr>`).join("")}</tbody></table>` : "");
    })()}
    <h3>ชุดผสมน้ำหนัก</h3>
    <table class="grid"><thead><tr><th>ชื่อ</th>${m.loadCases.map((lc) => `<th>${esc(lc.id)}</th>`).join("")}</tr></thead>
    <tbody>${m.combos.map((c) => `<tr><td>${esc(c.name)}</td>${m.loadCases.map((lc) => `<td>${c.factors[lc.id] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <h3>สรุปการออกแบบคาน</h3>
    <table class="grid"><thead><tr><th>คาน</th><th>b×h (mm)</th><th>ล่าง</th><th>บน</th><th>ปลอก</th><th>ผล</th></tr></thead><tbody>${rows || `<tr><td colspan="6">ไม่มีคาน</td></tr>`}</tbody></table>
    <h3>สรุปการออกแบบเสา</h3>
    <table class="grid"><thead><tr><th>เสา</th><th>b×h (mm)</th><th>เหล็กยืน</th><th>ρg</th><th>ปลอก</th><th>อัตราส่วน</th><th>ผล</th></tr></thead><tbody>${Object.entries(app.colDesigns).map(([id, c]) => `<tr class="${c.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${c.section.b}×${c.section.h}</td><td>${c.layout ? `${totalBars(c.layout)}DB${c.layout.dia}` : "-"}</td><td>${f(c.rho * 100)}%</td><td>${esc(c.ties.note)}</td><td>${f(c.maxRatio, 3)}</td><td>${c.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("") || `<tr><td colspan="7">ไม่มีเสา</td></tr>`}</tbody></table>
    ${storeyTable()}
    <h3>สรุปฐานราก</h3>
    <table class="grid"><thead><tr><th>จุดต่อ</th><th>ชนิด</th><th>L × B × t (m)</th><th>เข็ม</th><th>เหล็กแนว x</th><th>เหล็กแนว y</th><th>ผล</th></tr></thead><tbody>${Object.entries(app.footings).map(([id, fr]) => `<tr class="${fr.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${fr.type === "pile" ? "เสาเข็ม" : "แผ่"}</td><td>${f(fr.L)} × ${f(fr.B)} × ${f(fr.t)}</td><td>${fr.piles ? fr.piles.coords.length : "-"}</td><td>${esc(fr.barsX)}</td><td>${esc(fr.barsY)}</td><td>${fr.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("") || `<tr><td colspan="7">ไม่มีฐานราก</td></tr>`}</tbody></table>
    <h3>แรงปฏิกิริยาที่ฐาน (kN, kN·m)</h3>
    <table class="grid"><thead><tr><th>ชุดผสม</th><th>จุดต่อ</th><th>Rx</th><th>Ry</th><th>Mz</th></tr></thead><tbody>${reactRows}</tbody></table>
    <footer class="pf">ผลคำนวณจากโปรแกรม StructLab (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</footer>
  </section>`;
}

export function openReport(only?: string) {
  if (!app.run) return;
  const host = document.getElementById("report")!;
  const ids = only ? [only] : [...Object.keys(app.designs), ...Object.keys(app.colDesigns), ...Object.keys(app.footings).map((n) => `footing:${n}`)];
  const pages = ids.map((id) => {
    if (id.startsWith("footing:")) { const n = id.slice(8); return app.footings[n] ? footingPage(n, app.footings[n]) : ""; }
    return app.designs[id] ? beamPage(id, app.designs[id]) : app.colDesigns[id] ? columnPage(id, app.colDesigns[id]) : "";
  }).join("");
  const nb = ids.filter((id) => app.designs[id]).length, nc = ids.filter((id) => app.colDesigns[id]).length, nf = ids.filter((id) => id.startsWith("footing:")).length;
  host.innerHTML = `<div class="report-bar"><b>รายการคำนวณ</b><span>${nb ? `${nb} คาน` : ""} ${nc ? `${nc} เสา` : ""} ${nf ? `${nf} ฐานราก` : ""}</span>
    <button id="rp-print" class="primary">พิมพ์ / บันทึก PDF</button><button id="rp-close">ปิด</button></div>
    <style>${SECTION_CSS}</style><div class="pages">${only ? "" : summaryPage() + windPage() + schedule2D()}${pages}</div>`;
  convertDom(host.querySelector(".pages")!);
  host.hidden = false;
  document.body.classList.add("printing-report");
  host.querySelector("#rp-print")!.addEventListener("click", () => window.print());
  host.querySelector("#rp-close")!.addEventListener("click", () => {
    host.hidden = true;
    document.body.classList.remove("printing-report");
  });
}
