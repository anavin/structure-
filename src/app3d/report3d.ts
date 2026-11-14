// รายการคำนวณโหมด 3D (A4) — พิมพ์หรือบันทึก PDF ผ่านเบราว์เซอร์
//  หน้าสรุป: โมเดล วัสดุ น้ำหนัก ชุดผสม แรงลม การเคลื่อนตัว และตารางผลออกแบบทุกชิ้น
//  หน้ารายละเอียด: คาน / เสาสองแกน / ฐานราก (ชิ้นที่เลือก หรือชิ้นวิกฤตของแต่ละกลุ่ม หรือทุกชิ้น)

import type { Run3 } from "../core3d/combos3d.ts";
import { storeyDrifts } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import type { BeamDesign3, ColumnDesign3, Design3Settings, MemberDesign3 } from "../design/design3d.ts";
import type { FoundationSettings } from "../design/footing.ts";
import type { FootingResult3 } from "../design/footing3d.ts";
import type { Step } from "../design/rcBeam.ts";
import { checkBiaxial, totalBarsBiax } from "../design/rcColumnBiaxial.ts";
import { IMPORTANCE, ZONES, refPressure } from "../loads/windTH.ts";
import type { GridParams, WindLevel3 } from "./generator.ts";
import { footingPlanSvg3 } from "./plan3d.ts";

export interface Report3Context {
  model: Model3; params: GridParams; run: Run3; wind: WindLevel3[];
  design: Record<string, MemberDesign3>; footings: Record<string, FootingResult3> | null;
  dset: Design3Settings; fset: FoundationSettings;
}
/** "summary" = หน้าสรุป + ชิ้นวิกฤตของแต่ละกลุ่ม, "all" = ทุกชิ้น, "member:ID" / "footing:NODE" = เฉพาะชิ้นนั้น */
export type Report3Scope = "summary" | "all" | `member:${string}` | `footing:${string}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : v.toFixed(dp)) : "-");
const KSC = 0.0980665;
const today = () => new Date().toLocaleDateString("th-TH");
const codeName = (c: string) => (c === "EIT" ? "วสท. 1008-38 (วิธีกำลัง)" : "ACI 318-19");

function stepsTable(steps: Step[]) {
  return `<table class="steps"><tbody>${steps.map((s) => `
    <tr class="${s.ok === false ? "bad" : s.ok ? "good" : ""}"><td class="lbl">${esc(s.label)}</td><td class="expr">${esc(s.expr)}</td><td class="val">${esc(s.value)}</td></tr>`).join("")}</tbody></table>`;
}
const header = (ctx: Report3Context, title: string) => `<header class="ph"><div><b>${esc(ctx.model.name)}</b><br/>${esc(title)}</div>
  <div class="r">มาตรฐาน: ${codeName(ctx.dset.code)}<br/>${today()}</div></header>`;
const footer = `<footer class="pf">ผลคำนวณจากโปรแกรม StructLab 3D (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</footer>`;

// ---------- หน้าสรุป ----------
function summaryPages(ctx: Report3Context): string {
  const { model: m, params: p, run, wind } = ctx;
  const a = m.analysis;
  const mat = m.materials[0];
  const nb = m.members.filter((x) => x.kind === "beam").length, nc = m.members.filter((x) => x.kind === "column").length;
  const w = p.wind;
  const drift = (id: string) => (run.results[`case:${id}`] ? storeyDrifts(m, run.results[`case:${id}`]) : []);
  const dX = drift("WX"), dY = drift("WY");
  const ratio = (d: number) => (Math.abs(d) < 1e-5 ? "–" : `1/${Math.round(1 / Math.abs(d)).toLocaleString()}`);
  const page1 = `<section class="page">${header(ctx, "สรุปข้อมูลโครงสร้างและการวิเคราะห์")}
    <h3>1. รูปแบบอาคาร</h3>
    <table class="kv"><tbody>
      <tr><td>ช่วงแกน X</td><td>${esc(p.xSpacing)} m</td><td>ช่วงแกน Y</td><td>${esc(p.ySpacing)} m</td></tr>
      <tr><td>ความสูงชั้น</td><td>${esc(p.storeys)} m</td><td>จำนวน</td><td>จุดต่อ ${m.nodes.length} · คาน ${nb} · เสา ${nc} · ฐาน ${m.supports.length}</td></tr>
      <tr><td>เสา</td><td>${f(p.col.b * 1000, 0)} × ${f(p.col.h * 1000, 0)} mm (h ตามแกน X)</td><td>คาน</td><td>${f(p.beam.b * 1000, 0)} × ${f(p.beam.h * 1000, 0)} mm</td></tr>
      <tr><td>คอนกรีต</td><td>fc' ${mat.fc} ksc (${f((mat.fc ?? 0) * KSC)} MPa), Ec = ${f(mat.E / 1e6, 2)} GPa</td><td>เหล็ก</td><td>fy ${mat.fy} ksc, fyt ${mat.fyt ?? 2400} ksc</td></tr>
    </tbody></table>
    <h3>2. วิธีวิเคราะห์</h3>
    <p>โครงข้อแข็ง 3 มิติ (12 DOF ต่อชิ้นส่วน) วิธีความแข็งโดยตรง · ${m.diaphragms?.length ? `พื้นแข็งในระนาบ (rigid diaphragm) ${m.diaphragms.length} ชั้น` : "ไม่มีพื้นแข็ง"} ·
      ${a?.pDelta ? "วิเคราะห์อันดับสอง P-Δ (Kg วนซ้ำ) + P-δ ตามความยาวชิ้นส่วน — ACI 6.7" : "วิเคราะห์อันดับหนึ่ง"} ·
      ${a?.cracked ? "ความแข็งแตกร้าว เสา 0.70Ig / คาน 0.35Ig (ACI 6.6.3.1.1)" : "ความแข็งหน้าตัดเต็ม Ig"} · ฐานยึดแน่น · หน่วย kN, m</p>
    <h3>3. น้ำหนักบรรทุก</h3>
    <table class="grid"><thead><tr><th>Load case</th><th>รายละเอียด</th></tr></thead><tbody>
      <tr><td>DL</td><td>น้ำหนักตัวเองโครงสร้าง (γ = 24 kN/m³) + SDL บนคาน ${p.sdl} kN/m (หลังคา ${p.sdlRoof} kN/m)</td></tr>
      <tr><td>LL</td><td>น้ำหนักจรบนคาน ${p.ll} kN/m (หลังคา ${p.llRoof} kN/m)</td></tr>
      <tr><td>WX / WY</td><td>แรงลม มยผ. 1311-50 วิธีอย่างง่าย ทิศ +X / +Y ที่จุดอ้างอิงพื้นแต่ละชั้น</td></tr>
    </tbody></table>
    <h3>4. ชุดผสมน้ำหนัก</h3>
    <table class="grid"><thead><tr><th>ชุด</th><th>ชื่อ</th>${m.loadCases.map((c) => `<th>${esc(c.id)}</th>`).join("")}</tr></thead>
    <tbody>${m.combos.map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(c.name)}</td>${m.loadCases.map((lc) => `<td>${c.factors[lc.id] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <h3>5. แรงลม มยผ. 1311-50</h3>
    <p>${esc(ZONES[w.zone].label)} · q = ½ρV₅₀²·TF = ${f(refPressure(w.V50, w.TF), 4)} kN/m² · ${esc(IMPORTANCE[w.importance].label)} · ภูมิประเทศ ${w.exposure} · Cg = ${w.Cg} · Cp = ${w.CpW} / ${w.CpL}</p>
    <table class="grid"><thead><tr><th>ชั้น</th><th>z (m)</th><th>ช่วงรับลม (m)</th><th>WX (kN)</th><th>WY (kN)</th></tr></thead><tbody>
      ${wind.map((l, k) => `<tr><td>${k + 1}</td><td>${f(l.z)}</td><td>${f(l.band)}</td><td>${f(l.FX)}</td><td>${f(l.FY)}</td></tr>`).join("")}
      <tr><td colspan="3"><b>แรงเฉือนที่ฐาน</b></td><td><b>${f(wind.reduce((s, l) => s + l.FX, 0))}</b></td><td><b>${f(wind.reduce((s, l) => s + l.FY, 0))}</b></td></tr>
    </tbody></table>
    ${dX.length ? `<h3>6. การเคลื่อนตัวรายชั้นจากแรงลม (load case WX / WY)</h3>
    <table class="grid"><thead><tr><th>ชั้น</th><th>h (m)</th><th>ux (mm)</th><th>Δ/h (WX)</th><th>uy (mm)</th><th>Δ/h (WY)</th></tr></thead><tbody>
      ${dX.map((d, k) => `<tr><td>${k + 1}</td><td>${f(d.h)}</td><td>${f(d.ux * 1000)}</td><td>${ratio(d.driftX)}</td><td>${f((dY[k]?.uy ?? 0) * 1000)}</td><td>${ratio(dY[k]?.driftY ?? 0)}</td></tr>`).join("")}
    </tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">ที่จุดอ้างอิงพื้นแข็ง ${a?.cracked ? "(ความแข็งแตกร้าวระดับกำลัง — สูงกว่าค่าใช้งานจริง)" : ""}</p>` : ""}
    ${footer}</section>`;

  const beams = Object.entries(ctx.design).filter(([, d]) => d.kind === "beam") as [string, BeamDesign3][];
  const cols = Object.entries(ctx.design).filter(([, d]) => d.kind === "column") as [string, ColumnDesign3][];
  const bar = (x: BeamDesign3["result"]["bottom"]) => (x.bars ? `${x.bars.n}DB${x.bars.dia}` : "—");
  const fts = Object.entries(ctx.footings ?? {});
  const page2 = `<section class="page">${header(ctx, "สรุปผลการออกแบบ")}
    <h3>7. คาน ค.ส.ล. (${beams.length} ตัว — ไม่ผ่าน ${beams.filter(([, d]) => !d.ok).length})</h3>
    <table class="grid"><thead><tr><th>คาน</th><th>b×h (mm)</th><th>ล่าง</th><th>บน</th><th>ปลอก</th><th>อัตราส่วน</th><th>ผล</th></tr></thead><tbody>
      ${beams.map(([id, d]) => `<tr class="${d.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${d.result.input.b}×${d.result.input.h}</td><td>${bar(d.result.bottom)}</td><td>${bar(d.result.top)}</td><td>${esc(d.result.shear.message.replace("เหล็กปลอก ", ""))}</td><td>${f(d.ratio)}</td><td>${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("")}
    </tbody></table>
    <h3>8. เสา ค.ส.ล. สองแกน (${cols.length} ต้น — ไม่ผ่าน ${cols.filter(([, d]) => !d.ok).length})</h3>
    <table class="grid"><thead><tr><th>เสา</th><th>b×h (mm)</th><th>เหล็กยืน</th><th>ρg</th><th>ปลอก</th><th>กรณีวิกฤต</th><th>อัตราส่วน</th><th>ผล</th></tr></thead><tbody>
      ${cols.map(([id, d]) => `<tr class="${d.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${d.section.b}×${d.section.h}</td><td>${d.result.layout ? `${totalBarsBiax(d.result.layout)}DB${d.result.layout.dia}` : "—"}</td><td>${f(d.result.rho * 100)}%</td><td>${esc(d.ties)}</td><td>${esc(d.result.crit?.combo ?? "-")}</td><td>${f(d.ratio)}</td><td>${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("")}
    </tbody></table>
    ${fts.length ? `<h3>9. ฐานราก${ctx.fset.type === "pile" ? "เสาเข็ม" : "แผ่"} (${fts.length} ฐาน — ไม่ผ่าน ${fts.filter(([, x]) => !x.ok).length})</h3>
    <table class="grid"><thead><tr><th>จุด</th><th>L × B × t (m)</th><th>${ctx.fset.type === "pile" ? "เข็ม" : "qmax / qa"}</th><th>เหล็กแนว X</th><th>เหล็กแนว Y</th><th>ผล</th></tr></thead><tbody>
      ${fts.map(([id, ft]) => {
        const w2 = ft.service.reduce((a2, s) => (s.qmax / s.allow > a2.qmax / a2.allow ? s : a2), ft.service[0]);
        return `<tr class="${ft.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${f(ft.L)} × ${f(ft.B)} × ${f(ft.t)}</td><td>${ft.piles ? `${ft.piles.coords.length} ต้น` : w2 ? `${f(w2.qmax, 1)} / ${f(w2.allow, 1)}` : "-"}</td><td>${esc(ft.barsX)}</td><td>${esc(ft.barsY)}</td><td>${ft.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`;
      }).join("")}
    </tbody></table>` : ""}
    ${footer}</section>`;
  return page1 + page2;
}

// ---------- หน้ารายละเอียด ----------
function beamPage(ctx: Report3Context, id: string, d: BeamDesign3): string {
  const r = d.result, inp = r.input;
  const mem = ctx.model.members.find((x) => x.id === id)!;
  const L = ctx.run.results[Object.keys(ctx.run.results)[0]].members[id].L;
  const bar = (x: typeof r.bottom) => (x.bars ? `${x.bars.n}DB${x.bars.dia}` : "ไม่ผ่าน");
  return `<section class="page">${header(ctx, `ออกแบบคาน ค.ส.ล. — ${id}`)}
    <h3>1. ข้อมูลชิ้นส่วน</h3>
    <table class="kv"><tbody>
      <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td><td>ความยาว</td><td>${f(L)} m</td></tr>
      <tr><td>หน้าตัด</td><td>b × h = ${inp.b} × ${inp.h} mm</td><td>ระยะหุ้ม</td><td>${inp.cover} mm</td></tr>
      <tr><td>fc' / fy / fyt</td><td colspan="3">${inp.fcKsc} / ${inp.fyKsc} / ${inp.fytKsc} ksc</td></tr>
      <tr><td>แรงออกแบบ</td><td colspan="3">Mu+ = ${f(inp.MuPos)} kN·m · Mu− = ${f(inp.MuNeg)} kN·m · Vu = ${f(inp.Vu)} kN (ค่าสุดขีด M33/V2 ทุกชุดผสม) · Tu = ${f(d.Tu)} kN·m</td></tr>
    </tbody></table>
    <h3>2. เหล็กรับโมเมนต์บวก (ล่าง)</h3>${stepsTable(r.bottom.steps)}
    <h3>3. เหล็กรับโมเมนต์ลบ (บน)</h3>${stepsTable(r.top.steps)}
    <h3>4. เหล็กปลอก</h3>${stepsTable(r.shear.steps)}
    <h3>5. แรงบิด</h3>
    <table class="steps"><tbody><tr class="${d.torsionOk ? "good" : "bad"}"><td class="lbl">เกณฑ์ไม่ต้องคิดแรงบิด</td><td class="expr">Tth = φ·0.083√fc'·Acp²/pcp</td><td class="val">Tu ${f(d.Tu)} ${d.torsionOk ? "≤" : ">"} ${f(d.Tth)} kN·m</td></tr></tbody></table>
    ${d.warnings.map((w) => `<p class="msg bad">${esc(w)}</p>`).join("")}
    <div class="result ${d.ok ? "" : "bad"}"><b>สรุป ${esc(id)}:</b> ล่าง ${bar(r.bottom)} · บน ${bar(r.top)} · ${esc(r.shear.message)} · อัตราส่วน ${f(d.ratio)} — ${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</div>
    ${footer}</section>`;
}

function columnPage(ctx: Report3Context, id: string, d: ColumnDesign3): string {
  const r = d.result, s = d.section;
  const mem = ctx.model.members.find((x) => x.id === id)!;
  const lay = r.layout;
  const rows = lay ? d.demands.map((dm) => ({ dm, c: checkBiaxial(s, lay, dm.Pu, dm.M3, dm.M2) })).sort((a, b) => b.c.ratio - a.c.ratio) : [];
  const a = ctx.model.analysis;
  return `<section class="page">${header(ctx, `ออกแบบเสา ค.ส.ล. สองแกน (P–M33–M22) — ${id}`)}
    <h3>1. ข้อมูลชิ้นส่วน</h3>
    <table class="kv"><tbody>
      <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td><td>ความยาว</td><td>${f(d.L)} m</td></tr>
      <tr><td>หน้าตัด</td><td>b × h = ${s.b} × ${s.h} mm (h ตามแกน 2)</td><td>ระยะหุ้ม</td><td>${s.cover} mm</td></tr>
      <tr><td>fc' / fy</td><td>${s.fcKsc} / ${s.fyKsc} ksc</td><td>kLu/r (k = 1)</td><td>${f(d.klur, 1)}</td></tr>
      <tr><td>ผลอันดับสอง</td><td colspan="3">${a?.pDelta ? "โมเมนต์จากการวิเคราะห์ P-Δ + P-δ โดยตรง (ACI 6.7) — ตรวจปลายทั้งสองและจุดโมเมนต์สูงสุดกลางเสา" : "วิเคราะห์อันดับหนึ่ง — ยังไม่คิดผลความชะลูด"}</td></tr>
    </tbody></table>
    <h3>2. กำลังหน้าตัดสองแกน</h3>
    <p>ความเข้ากันได้ของความเครียด (εcu = 0.003) ที่มุมแกนสะเทินใดๆ: ตัดพื้นที่รับแรงอัด (Whitney block) ด้วยระนาบ แล้วค้นหามุม θ และความลึก c ให้ φPn = Pu และทิศโมเมนต์ตรงกับแรงกระทำ · อัตราส่วน = √(M33² + M22²) / φMn</p>
    <table class="kv"><tbody>
      <tr><td>เหล็กยืน</td><td>${lay ? `${totalBarsBiax(lay)}DB${lay.dia} (ด้านละ ${lay.n2} ตามแนว h, ${lay.n3} ตามแนว b)` : "—"}</td><td>ρg</td><td>${f(r.rho * 100)} %</td></tr>
      <tr><td>เหล็กปลอก</td><td colspan="3">${esc(d.ties)} — min(16db, 48dtie, ด้านแคบ)</td></tr>
    </tbody></table>
    <h3>3. ตรวจทุกชุดผสม (เรียงจากวิกฤต)</h3>
    <table class="grid"><thead><tr><th>ชุดผสม</th><th>ตำแหน่ง</th><th>Pu (kN)</th><th>M33</th><th>M22</th><th>φMn (kN·m)</th><th>อัตราส่วน</th></tr></thead><tbody>
      ${rows.map(({ dm, c }) => `<tr class="${c.ratio > 1 ? "bad" : ""}"><td>${esc(dm.combo)}</td><td>${dm.end}</td><td>${f(dm.Pu)}</td><td>${f(Math.abs(dm.M3))}</td><td>${f(Math.abs(dm.M2))}</td><td>${f(c.phiMn)}</td><td>${f(c.ratio, 3)}${c.note ? `<br/><small>${esc(c.note)}</small>` : ""}</td></tr>`).join("")}
    </tbody></table>
    ${d.warnings.map((w) => `<p class="msg bad">${esc(w)}</p>`).join("")}
    <div class="result ${d.ok ? "" : "bad"}"><b>สรุป ${esc(id)}:</b> ${lay ? `${totalBarsBiax(lay)}DB${lay.dia}` : "—"} (ρg ${f(r.rho * 100)}%) · ปลอก ${esc(d.ties)} · อัตราส่วนสูงสุด ${f(d.ratio, 3)} — ${d.ok ? "ผ่าน" : esc(r.message)}</div>
    ${footer}</section>`;
}

function footingPage(ctx: Report3Context, node: string, ft: FootingResult3): string {
  const col = ctx.model.members.find((m) => m.kind === "column" && (m.i === node || m.j === node));
  const sec = col && ctx.model.sections.find((x) => x.id === col.section);
  const unit = ft.type === "pile" ? "kN/ต้น" : "kN/m²";
  return `<section class="page">${header(ctx, `ออกแบบฐานราก${ft.type === "pile" ? "เสาเข็ม" : "แผ่"} — จุดต่อ ${node}`)}
    <h3>1. แปลนและขั้นตอนคำนวณ</h3>
    <div class="chart-row"><div>${footingPlanSvg3(ft, sec?.h ?? 0.3, sec?.b ?? 0.3, ctx.fset.pileSize, 300, 260)}</div>${stepsTable(ft.steps)}</div>
    <h3>2. ตรวจแรงใช้งาน</h3>
    <table class="grid"><thead><tr><th>กรณี</th><th>P รวม (kN)</th><th>Mx ท้องฐาน</th><th>My ท้องฐาน</th><th>max (${unit})</th><th>min</th>${ft.type === "spread" ? "<th>สัมผัส</th>" : ""}<th>ยอมให้</th><th>ผล</th></tr></thead><tbody>
      ${ft.service.map((s) => `<tr class="${s.ok ? "" : "bad"}"><td>${esc(s.name)}</td><td>${f(s.Ptot)}</td><td>${f(s.Mbx)}</td><td>${f(s.Mby)}</td><td>${f(s.qmax)}</td><td>${f(s.qmin)}</td>${ft.type === "spread" ? `<td>${f(s.contact * 100, 0)}%</td>` : ""}<td>${f(s.allow)}</td><td>${s.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("")}
    </tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">แรงใช้งาน = ΣDL+LL (×1.0) ± แรงลมแต่ละทิศ (×1.0)${ctx.fset.windIncrease ? " โดยเพิ่มค่ายอมให้ 33% เมื่อรวมแรงลม" : ""} · P รวมน้ำหนักฐานและดินถม · Mbx = Mx − t·Hy, Mby = My + t·Hx</p>
    <div class="result ${ft.ok ? "" : "bad"}"><b>สรุปฐานราก ${esc(node)}:</b> ${f(ft.L)} × ${f(ft.B)} × ${f(ft.t)} m${ft.piles ? ` · เข็ม ${ft.piles.coords.length} ต้น` : ""} · แนว X ${esc(ft.barsX)} · แนว Y ${esc(ft.barsY)} — ${ft.ok ? "ผ่าน" : esc(ft.message)}</div>
    ${footer}</section>`;
}

const worstOf = <T,>(entries: [string, T][], key: (t: T) => number) =>
  entries.reduce<[string, T] | null>((a, e) => (!a || key(e[1]) > key(a[1]) ? e : a), null);

export function renderReport3(ctx: Report3Context, scope: Report3Scope): { html: string; label: string } {
  const beams = Object.entries(ctx.design).filter(([, d]) => d.kind === "beam") as [string, BeamDesign3][];
  const cols = Object.entries(ctx.design).filter(([, d]) => d.kind === "column") as [string, ColumnDesign3][];
  const fts = Object.entries(ctx.footings ?? {});
  const ftRatio = (ft: FootingResult3) => (ft.ok ? Math.max(...ft.service.map((s) => s.qmax / s.allow), ft.crit.punch, ft.crit.oneWayX, ft.crit.oneWayY) : Infinity);
  if (scope.startsWith("member:")) {
    const id = scope.slice(7), d = ctx.design[id];
    if (!d) return { html: "", label: "" };
    return { html: d.kind === "beam" ? beamPage(ctx, id, d) : columnPage(ctx, id, d), label: id };
  }
  if (scope.startsWith("footing:")) {
    const n = scope.slice(8), ft = ctx.footings?.[n];
    return ft ? { html: footingPage(ctx, n, ft), label: `ฐานราก ${n}` } : { html: "", label: "" };
  }
  let pages = summaryPages(ctx);
  if (scope === "all") {
    pages += beams.map(([id, d]) => beamPage(ctx, id, d)).join("") + cols.map(([id, d]) => columnPage(ctx, id, d)).join("") + fts.map(([n, ft]) => footingPage(ctx, n, ft)).join("");
    return { html: pages, label: `ทุกชิ้น: คาน ${beams.length} · เสา ${cols.length} · ฐาน ${fts.length}` };
  }
  const wb = worstOf(beams, (d) => d.ratio), wc = worstOf(cols, (d) => d.ratio), wf = worstOf(fts, ftRatio);
  if (wb) pages += beamPage(ctx, wb[0], wb[1]);
  if (wc) pages += columnPage(ctx, wc[0], wc[1]);
  if (wf) pages += footingPage(ctx, wf[0], wf[1]);
  return { html: pages, label: `สรุป + ชิ้นวิกฤต${wb ? ` (คาน ${wb[0]}` : ""}${wc ? `, เสา ${wc[0]}` : ""}${wf ? `, ฐาน ${wf[0]})` : wb ? ")" : ""}` };
}

/** เปิดหน้ารายการคำนวณใน #report */
export function openReport3(ctx: Report3Context, scope: Report3Scope) {
  const host = document.getElementById("report")!;
  const { html, label } = renderReport3(ctx, scope);
  const isSummary = scope === "summary" || scope === "all";
  host.innerHTML = `<div class="report-bar"><b>รายการคำนวณ 3D</b><span>${esc(label)}</span>
    ${isSummary ? `<button id="rp-scope">${scope === "all" ? "เฉพาะชิ้นวิกฤต" : "รายละเอียดทุกชิ้น"}</button>` : ""}
    <button id="rp-print" class="primary">พิมพ์ / บันทึก PDF</button><button id="rp-close">ปิด</button></div>
    <div class="pages">${html}</div>`;
  host.hidden = false;
  document.body.classList.add("printing-report");
  host.querySelector("#rp-print")!.addEventListener("click", () => window.print());
  host.querySelector("#rp-scope")?.addEventListener("click", () => openReport3(ctx, scope === "all" ? "summary" : "all"));
  host.querySelector("#rp-close")!.addEventListener("click", () => { host.hidden = true; document.body.classList.remove("printing-report"); });
}
