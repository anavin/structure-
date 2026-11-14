// รายการคำนวณโหมด 3D (A4) — พิมพ์หรือบันทึก PDF ผ่านเบราว์เซอร์
//  หน้าสรุป: โมเดล วัสดุ น้ำหนัก ชุดผสม แรงลม การเคลื่อนตัว และตารางผลออกแบบทุกชิ้น
//  หน้ารายละเอียด: คาน / เสาสองแกน / ฐานราก (ชิ้นที่เลือก หรือชิ้นวิกฤตของแต่ละกลุ่ม หรือทุกชิ้น)

import type { Run3 } from "../core3d/combos3d.ts";
import { storeyDrifts } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import type { BeamDesign3, ColumnDesign3, WallDesign3, Design3Settings, MemberDesign3 } from "../design/design3d.ts";
import type { FoundationSettings } from "../design/footing.ts";
import type { FootingResult3 } from "../design/footing3d.ts";
import type { Step } from "../design/rcBeam.ts";
import { barPositions, checkBiaxial, totalBarsBiax } from "../design/rcColumnBiaxial.ts";
import { beamSectionSvg, columnSectionSvg, scheduleHtml, SECTION_CSS, tieShort } from "../ui/sectionSvg.ts";
import { IMPORTANCE, ZONES, refPressure } from "../loads/windTH.ts";
import type { GridParams, Seismic3, WindLevel3 } from "./generator.ts";
import { footingPlanSvg3 } from "./plan3d.ts";
import { checkDrifts } from "../design/drift3d.ts";
import type { RsaInfo, RsaResult3 } from "../core3d/rsa3d.ts";
import { beamElevationSvg } from "../design/beamDetail.ts";
import { designStair } from "../design/stair.ts";
import { boq3d, boqCost, defaultPrices } from "../design/boq3d.ts";
import { designBuildingSlabs, M_COLS, METHOD2, panelName, rhoMin } from "../design/slab3d.ts";
import { convertDom, units } from "./units.ts";
import { emptyInfo } from "./generator.ts";

export interface Report3Context {
  model: Model3; params: GridParams; run: Run3; wind: WindLevel3[]; seismic?: Seismic3 | null;
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
const header = (ctx: Report3Context, title: string) => `<header class="ph"><div><b>${esc(ctx.model.name)}</b><br/><span class="ptitle">${esc(title)}</span></div>
  <div class="r">มาตรฐาน: ${codeName(ctx.dset.code)}<br/>${today()}</div></header>`;
const footer = `<footer class="pf"><span>ผลคำนวณจากโปรแกรม StructLab 3D (รุ่นทดลอง) — วิศวกรผู้ออกแบบต้องตรวจสอบและรับผิดชอบผลการออกแบบ</span><span class="pno"></span></footer>`;

/** หน้าปก: ข้อมูลโครงการ, ผู้ออกแบบ, ช่องลงนาม และสารบัญ (เติมเลขหน้าหลังวาด) */
function coverPage(ctx: Report3Context): string {
  const i = { ...emptyInfo, ...(ctx.params.info ?? {}) };
  const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v ? esc(v) : '<span class="blank">&nbsp;</span>'}</td></tr>`;
  return `<section class="page cover">
    <div class="cv-top"><div class="cv-brand">STRUCTLAB</div><div class="cv-sub">รายการคำนวณโครงสร้าง (Structural Calculation)</div></div>
    <h1 class="cv-title">${esc(ctx.model.name)}</h1>
    <table class="kv cv-info"><tbody>
      ${row("เจ้าของโครงการ", i.owner)}${row("สถานที่ก่อสร้าง", i.location)}${row("บริษัท / สำนักงาน", i.company)}
      ${row("วิศวกรผู้ออกแบบ", i.engineer)}${row("เลขทะเบียนใบอนุญาต (กว./ภว.)", i.license)}
      ${row("มาตรฐานการออกแบบ", codeName(ctx.dset.code) + " · แรงลม มยผ. 1311-50")}
      ${row("หน่วย", units.sys === "tf" ? "ตัน (tf), เมตร" : "kN, เมตร")}${row("วันที่", today())}
    </tbody></table>
    <h3>สารบัญ</h3><table class="toc"><tbody class="toc-body"></tbody></table>
    <div class="cv-sign"><div><div class="line"></div>วิศวกรผู้ออกแบบ${i.engineer ? `<br/>(${esc(i.engineer)})` : ""}${i.license ? `<br/>${esc(i.license)}` : ""}</div>
      <div><div class="line"></div>ผู้ตรวจสอบ</div></div>
    ${footer}</section>`;
}

// ---------- ภาพตัด ----------
function beamSvg3(d: BeamDesign3, title?: string, W?: number, H?: number) {
  const r = d.result, i = r.input;
  return beamSectionSvg({ b: i.b, h: i.h, cover: i.cover, tieDia: i.stirrupDia, bottom: r.bottom.bars, top: r.top.bars, tieLabel: tieShort(i.stirrupDia, r.shear.spacing), title }, W, H);
}
function columnSvg3(d: ColumnDesign3, title?: string, W?: number, H?: number) {
  const lay = d.result.layout, s = d.section;
  const sp = d.ties.match(/@\s*([\d.]+)/)?.[1];
  return columnSectionSvg({ b: s.b, h: s.h, cover: s.cover, tieDia: s.tieDia, bars: lay ? barPositions(s, lay) : [], dia: lay?.dia ?? 16, tieLabel: tieShort(s.tieDia, sp ? parseFloat(sp) * 1000 : null), title }, W, H);
}
function schedulePage(ctx: Report3Context): string {
  const beams = Object.entries(ctx.design).filter(([, d]) => d.kind === "beam") as [string, BeamDesign3][];
  const cols = Object.entries(ctx.design).filter(([, d]) => d.kind === "column") as [string, ColumnDesign3][];
  const bKey = (d: BeamDesign3) => { const r = d.result; return `${r.input.b}x${r.input.h}|${r.top.bars?.n}-${r.top.bars?.dia}|${r.bottom.bars?.n}-${r.bottom.bars?.dia}|${r.shear.spacing}`; };
  const cKey = (d: ColumnDesign3) => `${d.section.b}x${d.section.h}|${d.result.layout?.dia}-${d.result.layout?.n2}-${d.result.layout?.n3}|${d.ties}`;
  return `<section class="page">${header(ctx, "ตารางหน้าตัดคานและเสา (Section Schedule)")}
    <h3>คาน (${beams.length} ตัว)</h3>
    ${scheduleHtml("B", beams.map(([id, d]) => ({ id, key: bKey(d), svg: (t) => beamSvg3(d, t, 210, 230) })), esc)}
    <h3>เสา (${cols.length} ต้น)</h3>
    ${scheduleHtml("C", cols.map(([id, d]) => ({ id, key: cKey(d), svg: (t) => columnSvg3(d, t, 210, 230) })), esc)}
    <p style="font-size:10px;color:#667;margin:6px 0 0">รวมชิ้นที่มีขนาด เหล็กเสริม และเหล็กปลอกเหมือนกันเป็นแบบเดียว · ภาพตัดตามมาตราส่วน (มิติเป็น mm) · คาน: เหล็กบนตามโมเมนต์ลบ เหล็กล่างตามโมเมนต์บวก</p>
    ${footer}</section>`;
}

function seismicSection(s: Seismic3, p: GridParams, run?: Run3): string {
  const rs = ["EX", "EY"].map((id) => (run?.results[`case:${id}`] as RsaResult3 | undefined)?.rsa).filter((x): x is RsaInfo => !!x);
  const rsaRep = rs.length ? `<p><b>สเปกตรัมการตอบสนอง (RSA)</b> — รวม ${rs[0].nModes} โหมดด้วย CQC (ζ = 5%) · Sa(Tn) จากสเปกตรัมออกแบบ · แรงของโหมด f = M·φ·Γ·Sa·g·Ie/R · ปรับให้ V ≥ ${Math.round((p.seismic?.rsaMinScale ?? 0.85) * 100)}% ของวิธีสถิต · บวกแรงบิดจากการเยื้องศูนย์โดยบังเอิญ</p>
    <table class="grid"><thead><tr><th>ทิศ</th><th>V RSA (kN)</th><th>V สถิต (kN)</th><th>ตัวคูณ</th><th>V ที่ใช้ (kN)</th><th>มวลประสิทธิผลรวม</th><th>โหมดหลัก (T, Sa)</th></tr></thead><tbody>
    ${rs.map((r) => { const m = [...r.modes].sort((a, b) => b.V - a.V)[0]; return `<tr><td>${r.dir}</td><td>${f(r.V / r.scale, 1)}</td><td>${f(r.Vstatic, 1)}</td><td>${f(r.scale, 3)}</td><td>${f(r.V, 1)}</td><td>${f(r.mass * 100, 1)}%</td><td>โหมด ${m.n}: ${f(m.T, 3)} s, ${f(m.Sa, 3)} g</td></tr>`; }).join("")}
    </tbody></table>` : "";
  const r = s.result, sp = r.spec, e = p.seismic!;
  return `<h3>5.1 แรงแผ่นดินไหว มยผ. 1301/1302-61 (สถิตเทียบเท่า)</h3>
    <table class="kv"><tbody>
      <tr><td>Ss / S1</td><td>${f(e.Ss, 3)} / ${f(e.S1, 3)} g · ชั้นดิน ${e.site}</td><td>Fa / Fv</td><td>${f(sp.Fa, 3)} / ${f(sp.Fv, 3)}</td></tr>
      <tr><td>SDS = ⅔Fa·Ss</td><td>${f(sp.SDS, 3)} g</td><td>SD1 = ⅔Fv·S1</td><td>${f(sp.SD1, 3)} g</td></tr>
      <tr><td>T</td><td>${f(r.T, 3)} s ${e.Tuser > 0 ? "(กำหนดเอง)" : "(0.02H)"}</td><td>Sa(T)</td><td>${f(r.Sa, 3)} g</td></tr>
      <tr><td>Ie / R</td><td>${e.Ie} / ${e.R}</td><td>Cs = Sa·Ie/R ≥ 0.01</td><td>${f(r.Cs, 4)}</td></tr>
      <tr><td>W (D + ${f(e.llFraction * 100, 0)}%L)</td><td>${f(r.W, 1)} kN</td><td>V = Cs·W</td><td><b>${f(r.V, 1)} kN</b></td></tr>
    </tbody></table>
    <table class="grid"><thead><tr><th>ชั้น</th><th>z (m)</th><th>W (kN)</th><th>Cvx</th><th>F (kN)</th><th>Mz EX (kN·m)</th><th>Mz EY (kN·m)</th></tr></thead><tbody>
      ${s.levels.map((l, k) => `<tr><td>${k + 1}</td><td>${f(l.z)}</td><td>${f(l.W, 1)}</td><td>${f(l.Cvx, 3)}</td><td>${f(l.F)}</td><td>${f(l.MzX)}</td><td>${f(l.MzY)}</td></tr>`).join("")}
    </tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">Fx = Cvx·V, Cvx = wx·hx^k/Σwi·hi^k (k = ${f(r.k, 2)}) · เยื้องศูนย์โดยบังเอิญ ${f(e.eccentricity * 100, 0)}% · ฐานรากตรวจหน่วยแรงด้วย 0.7E · ค่าพารามิเตอร์ต้องตรวจกับมาตรฐานฉบับจริง</p>${rsaRep}`;
}

// ---------- บันได ----------
function stairPage(ctx: Report3Context): string {
  const s = ctx.params.stair;
  if (!s?.enabled) return "";
  const r = designStair(s, ctx.params.fcKsc, ctx.params.fyKsc, ctx.dset.code);
  return `<section class="page">${header(ctx, "ออกแบบบันได ค.ส.ล. (ท้องเรียบ)")}
    <p>ช่วงราบ Ln = ${s.Ln} m · สูง ${s.H} m · ลูกนอน ${s.tread} m · กว้าง ${s.width} m · ท้องบันได t = ${s.t} m · ฐานรองรับ${s.support === "continuous" ? "ต่อเนื่อง" : "ธรรมดา"} · SDL ${s.sdl} / LL ${s.ll} kg/m² · fc' ${ctx.params.fcKsc} / fy ${ctx.params.fyKsc} ksc</p>
    ${stepsTable(r.steps)}
    <div class="result ${r.ok ? "" : "bad"}"><b>สรุปบันได:</b> ${esc(r.message)} — ${r.ok ? "ผ่าน" : "ไม่ผ่าน"}</div>
    ${footer}</section>`;
}

// ---------- พื้นสองทาง ----------
function slabPages(ctx: Report3Context): string {
  const types = designBuildingSlabs(ctx.params, ctx.dset.code);
  if (!types.length) return "";
  const s = ctx.params.slab!;
  const coefRows = ([1, 2, 3, 4, 5] as const).map((c) => {
    const C = METHOD2[c];
    const r = (name: string, row: number[] | null) => `<tr><td>${c}</td><td>${name}</td>${M_COLS.map((_, k) => `<td>${row ? row[k].toFixed(3) : "–"}</td>`).join("")}<td>${(() => { const v = name.includes("บวก") ? C.long.pos : name.includes("ไม่ต่อ") ? C.long.negD : C.long.negC; return v == null ? "–" : v.toFixed(3); })()}</td></tr>`;
    return r("ลบ ขอบต่อเนื่อง", C.short.negC) + r("ลบ ขอบไม่ต่อเนื่อง", C.short.negD) + r("บวก กลางช่วง", C.short.pos);
  }).join("");
  const bars = (x: { label: string } | null) => (x ? x.label : "–");
  const summary = `<table class="grid"><thead><tr><th>แบบ</th><th>S × L (m)</th><th>กรณี</th><th>wu (kN/m²)</th><th>ทิศสั้น ล่าง</th><th>ทิศสั้น บน (ต่อเนื่อง/ไม่ต่อเนื่อง)</th><th>ทิศยาว ล่าง</th><th>ทิศยาว บน</th><th>จำนวนแผ่น</th><th>ผล</th></tr></thead><tbody>
    ${types.map((t) => { const r = t.result; return `<tr class="${r.ok ? "" : "bad"}"><td><b>${t.mark}</b>${t.roof ? " (หลังคา)" : ""}</td><td>${f(r.S)} × ${f(r.L)}</td><td>${r.oneWay ? "ทางเดียว" : r.caseNo}</td><td>${f(r.wu)}</td><td>${bars(r.short.pos)}</td><td>${bars(r.short.negC)} / ${bars(r.short.negD)}</td><td>${bars(r.long.pos)}</td><td>${bars(r.long.negC)} / ${bars(r.long.negD)}</td><td>${t.panels.length}</td><td>${r.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`; }).join("")}
  </tbody></table>`;
  const page1 = `<section class="page">${header(ctx, "ออกแบบพื้นสองทาง (วิธีที่ 2)")}
    <p>พื้นหนา t = ${s.t} m · SDL ${s.sdl} / LL ${s.ll} kg/m² (หลังคา ${s.sdlRoof} / ${s.llRoof} kg/m²) · fc' ${ctx.params.fcKsc} ksc · fy ${ctx.params.fyKsc} ksc · หุ้ม 20 mm
      · M = C·wu·S² ต่อความกว้าง 1 m · กรณีตามจำนวนขอบที่ไม่ต่อเนื่อง (ขอบต่อเนื่อง = มีแผ่นข้างเคียงในกริด) · t ≥ เส้นรอบรูป/180 · As ≥ ${rhoMin(ctx.params.fyKsc)}bt · ระยะเหล็ก ≤ 2t</p>
    ${summary}
    <h3>ตารางสัมประสิทธิ์โมเมนต์ (วิธีที่ 2, ACI 318-63)</h3>
    <table class="grid"><thead><tr><th>กรณี</th><th>โมเมนต์</th>${M_COLS.map((m) => `<th>ทิศสั้น m=${m.toFixed(1)}</th>`).join("")}<th>ทิศยาว</th></tr></thead><tbody>${coefRows}</tbody></table>
    <p style="font-size:10px;color:#667;margin:4px 0 0">กรณี 1 = แผ่นภายใน, 2–5 = ขอบไม่ต่อเนื่อง 1–4 ด้าน · m < 0.5 ออกแบบเป็นพื้นทางเดียว (ACI: 1/10, 1/11, 1/14, 1/16, 1/24) · ค่าในตารางต้องตรวจกับมาตรฐานฉบับจริง</p>
    ${footer}</section>`;
  const detail = types.map((t) => `<section class="page">${header(ctx, `ออกแบบพื้น ${t.mark}`)}
    <p>${t.result.S.toFixed(2)} × ${t.result.L.toFixed(2)} m${t.roof ? " (หลังคา)" : ""} · ${t.panels.length} แผ่น: ${esc(t.panels.slice(0, 18).map(panelName).join(", "))}${t.panels.length > 18 ? " …" : ""}</p>
    ${stepsTable(t.result.steps)}
    ${footer}</section>`).join("");
  return page1 + detail;
}

// ---------- ปริมาณวัสดุ ----------
function boqPage(ctx: Report3Context): string {
  const sb = ctx.params.slab;
  const b = boq3d(ctx.model, ctx.design, ctx.footings, { cover: ctx.dset.cover, slabT: sb?.enabled ? sb.t : 0, slabs: designBuildingSlabs(ctx.params, ctx.dset.code) });
  const pr = { ...defaultPrices, ...(ctx.dset.prices ?? {}) };
  const cost = boqCost(b, pr);
  const dias = Object.keys(b.total.steel).map(Number).sort((a, c) => a - c);
  const bar = (d: number) => (d <= 9 ? `RB${d}` : `DB${d}`);
  const kg = (r: Record<number, number>) => Object.values(r).reduce((a, v) => a + v, 0);
  const baht = (v: number) => Math.round(v).toLocaleString("th-TH");
  return `<section class="page">${header(ctx, "ปริมาณวัสดุโดยประมาณ (BOQ)")}
    <h3>ปริมาณวัสดุโครงสร้าง</h3>
    <table class="grid"><thead><tr><th>รายการ</th><th>จำนวน</th><th>คอนกรีต (m³)</th><th>แบบหล่อ (m²)</th>${dias.map((d) => `<th>${bar(d)} (kg)</th>`).join("")}<th>เหล็กรวม (kg)</th></tr></thead><tbody>
      ${b.rows.map((r) => `<tr><td>${r.group}</td><td>${r.count}</td><td>${f(r.conc)}</td><td>${f(r.form, 1)}</td>${dias.map((d) => `<td>${r.steel[d] ? f(r.steel[d], 0) : "-"}</td>`).join("")}<td>${f(kg(r.steel), 0)}</td></tr>`).join("")}
      <tr><td><b>รวม</b></td><td></td><td><b>${f(b.total.conc)}</b></td><td><b>${f(b.total.form, 1)}</b></td>${dias.map((d) => `<td><b>${f(b.total.steel[d], 0)}</b></td>`).join("")}<td><b>${f(b.total.steelKg, 0)}</b></td></tr>
    </tbody></table>
    <p>เหล็กเสริมเฉลี่ย ${f(b.total.steelKg / Math.max(b.total.conc, 1e-9), 0)} kg ต่อคอนกรีต 1 m³${b.piles ? ` · เสาเข็ม ${b.piles} ต้น` : ""}</p>
    <h3>ค่าก่อสร้างโครงสร้างโดยประมาณ</h3>
    <table class="grid"><thead><tr><th>รายการ</th><th>ปริมาณ</th><th>ราคาต่อหน่วย (บาท)</th><th>เป็นเงิน (บาท)</th></tr></thead><tbody>
      <tr><td>คอนกรีต</td><td>${f(b.total.conc)} m³</td><td>${baht(pr.conc)}</td><td>${baht(cost.conc)}</td></tr>
      <tr><td>แบบหล่อ</td><td>${f(b.total.form, 1)} m²</td><td>${baht(pr.form)}</td><td>${baht(cost.form)}</td></tr>
      <tr><td>เหล็กเสริม</td><td>${f(b.total.steelKg, 0)} kg</td><td>${baht(pr.steel)}</td><td>${baht(cost.steel)}</td></tr>
      <tr><td colspan="3"><b>รวม</b></td><td><b>${baht(cost.total)}</b></td></tr>
    </tbody></table>
    <p style="font-size:10px;color:#667;margin:6px 0 0">${esc(b.note.join(" · "))} · ราคาต่อหน่วยเป็นค่าโดยประมาณ (วัสดุ + ค่าแรง) ที่ผู้ใช้กำหนด${b.piles ? " · ไม่รวมค่าเสาเข็ม" : ""}
      · หลักการ: คานคิดช่วงสุทธิ เหล็กยาวตลอดช่วง + งอ 12d; เสาเหล็กยืน + ทาบ 40d; ปลอกตามระยะที่ออกแบบ; ฐานรากเหล็กตะแกรงสองทาง</p>
    ${footer}</section>`;
}

// ---------- หน้าสรุป ----------
function summaryPages(ctx: Report3Context): string {
  const { model: m, params: p, run, wind } = ctx;
  const a = m.analysis;
  const mat = m.materials[0];
  const nb = m.members.filter((x) => x.kind === "beam").length, nc = m.members.filter((x) => x.kind === "column").length;
  const w = p.wind;
  const drift = (id: string) => (run.results[`case:${id}`] ? storeyDrifts(m, run.results[`case:${id}`]) : []);
  const dX = drift("WX"), dY = drift("WY");
  const wDen = ctx.dset.windDriftDen ?? 500;
  const dsS = { windLimit: 1 / wDen, eqLimit: 0.02, Cd: p.seismic?.Cd ?? 2.5, Ie: p.seismic?.Ie ?? 1 };
  const dc = checkDrifts(m, run, dsS);
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
      ${a?.cracked ? "ความแข็งแตกร้าว เสา 0.70Ig / คาน 0.35Ig (ACI 6.6.3.1.1) · ความแข็งบิดคาน 0.10J (แรงบิดแบบสอดคล้อง ACI 22.7.3.2)" : "ความแข็งหน้าตัดเต็ม Ig"} · ${p.tieBeam?.enabled ? `ฐานเสาหมุนได้ + คานคอดิน ${f(p.tieBeam.b * 1000, 0)} × ${f(p.tieBeam.h * 1000, 0)} mm (รับโมเมนต์ที่ฐาน, น้ำหนักผนัง ${p.tieBeam.sdl} kN/m)` : "ฐานยึดแน่น"} · หน่วย kN, m</p>
    <h3>3. น้ำหนักบรรทุก</h3>
    <table class="grid"><thead><tr><th>Load case</th><th>รายละเอียด</th></tr></thead><tbody>
      ${p.slab?.enabled ? `<tr><td>พื้น</td><td>พื้นสองทาง t = ${p.slab.t} m (${f(24 * p.slab.t * 101.97, 0)} kg/m²) · SDL ${p.slab.sdl} / LL ${p.slab.ll} kg/m² (หลังคา ${p.slab.sdlRoof} / ${p.slab.llRoof} kg/m²) — กระจายลงคานรอบแผ่นด้วยเส้น 45° เป็นน้ำหนักแผ่สม่ำเสมอเทียบเท่า: ด้านสั้น wS/3, ด้านยาว wS/3·(3 − m²)/2, m = S/L</td></tr>` : ""}
      <tr><td>DL</td><td>น้ำหนักตัวเองโครงสร้าง (γ = 24 kN/m³)${p.slab?.enabled ? " + พื้น" : ""} + SDL บนคาน ${p.sdl} kN/m (หลังคา ${p.sdlRoof} kN/m)</td></tr>
      <tr><td>LL</td><td>น้ำหนักจร${p.slab?.enabled ? "จากพื้น + " : ""}บนคาน ${p.ll} kN/m (หลังคา ${p.llRoof} kN/m)</td></tr>
      <tr><td>WX / WY</td><td>แรงลม มยผ. 1311-50 วิธีอย่างง่าย ทิศ +X / +Y ที่จุดอ้างอิงพื้นแต่ละชั้น</td></tr>
      ${ctx.seismic ? `<tr><td>EX / EY</td><td>แรงแผ่นดินไหว มยผ. 1301/1302-61 วิธีแรงสถิตเทียบเท่า ทิศ +X / +Y พร้อมแรงบิดจากการเยื้องศูนย์โดยบังเอิญ</td></tr>` : ""}
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
    ${ctx.seismic ? seismicSection(ctx.seismic, p, run) : ""}
    ${dX.length ? `<h3>6. ตรวจการเคลื่อนตัวรายชั้น</h3>
    <p>แรงลม (load case WX / WY ไม่คูณตัวประกอบ): Δ/h ≤ 1/${wDen}</p>
    <table class="grid"><thead><tr><th>ชั้น</th><th>h (m)</th><th>ux (mm)</th><th>Δ/h (WX)</th><th>uy (mm)</th><th>Δ/h (WY)</th><th>ผล</th></tr></thead><tbody>
      ${dX.map((d, k) => `<tr class="${dc.wind[k]?.ok === false ? "bad" : ""}"><td>${k + 1}</td><td>${f(d.h)}</td><td>${f(d.ux * 1000)}</td><td>${ratio(d.driftX)}</td><td>${f((dY[k]?.uy ?? 0) * 1000)}</td><td>${ratio(dY[k]?.driftY ?? 0)}</td><td>${dc.wind[k]?.ok === false ? "ไม่ผ่าน" : "ผ่าน"}</td></tr>`).join("")}
    </tbody></table>
    ${dc.eq.length ? `<p>แผ่นดินไหว (มยผ. 1301/1302-61): Δ = Cd·δe/Ie (Cd = ${dsS.Cd}, Ie = ${dsS.Ie}) ≤ 0.020h · เสถียรภาพ θ = Px·Δ·Ie/(Vx·h·Cd) ≤ θmax = 0.5/Cd ≤ 0.25</p>
    <table class="grid"><thead><tr><th>ชั้น</th><th>h (m)</th><th>δe x / y (mm)</th><th>Δx / Δy (mm)</th><th>ยอมให้ (mm)</th><th>Px (kN)</th><th>Vx / Vy (kN)</th><th>θ</th><th>ผล</th></tr></thead><tbody>
      ${dc.eq.map((r) => `<tr class="${r.ok ? "" : "bad"}"><td>${r.storey}</td><td>${f(r.h)}</td><td>${f(r.deX * 1000)} / ${f(r.deY * 1000)}</td><td>${f(r.DX * 1000)} / ${f(r.DY * 1000)}</td><td>${f(r.limit * 1000, 0)}</td><td>${f(r.Px, 0)}</td><td>${f(r.VX, 1)} / ${f(r.VY, 1)}</td><td>${f(Math.max(r.thetaX, r.thetaY), 3)} ≤ ${f(r.thetaMax, 3)}</td><td>${r.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("")}
    </tbody></table>` : ""}
    <p style="font-size:10px;color:#667;margin:4px 0 0">ที่จุดอ้างอิงพื้นแข็ง ${a?.cracked ? "(ความแข็งแตกร้าวระดับกำลัง — สูงกว่าค่าใช้งานจริง)" : ""} · Px = แรงตามแกนรวมของเสาในชั้น (D + L ไม่คูณตัวประกอบ)</p>` : ""}
    ${footer}</section>`;

  const beams = Object.entries(ctx.design).filter(([, d]) => d.kind === "beam") as [string, BeamDesign3][];
  const cols = Object.entries(ctx.design).filter(([, d]) => d.kind === "column") as [string, ColumnDesign3][];
  const walls = Object.entries(ctx.design).filter(([, d]) => d.kind === "wall") as [string, WallDesign3][];
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
    ${walls.length ? `<h3>ผนังรับแรงเฉือน (${walls.length} ช่วงชั้น — ไม่ผ่าน ${walls.filter(([, d]) => !d.ok).length})</h3>
    <table class="grid"><thead><tr><th>ผนัง</th><th>t × Lw (mm)</th><th>แนวดิ่ง</th><th>แนวนอน</th><th>P–M</th><th>เฉือน</th><th>ผล</th></tr></thead><tbody>
      ${walls.map(([id, d]) => { const w = d.result, b = (x: typeof w.vertical) => (x ? `DB${x.dia}@${(x.s / 1000).toFixed(2)}${x.curtains === 2 ? "×2" : ""}` : "—"); return `<tr class="${d.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${f(d.t, 0)}×${f(d.Lw, 0)}</td><td>${b(w.vertical)}</td><td>${b(w.horizontal)}</td><td>${f(w.ratioPM)}</td><td>${f(w.ratioV)}</td><td>${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`; }).join("")}
    </tbody></table>` : ""}
    ${fts.length ? `<h3>9. ฐานราก${ctx.fset.type === "pile" ? "เสาเข็ม" : "แผ่"} (${fts.length} ฐาน — ไม่ผ่าน ${fts.filter(([, x]) => !x.ok).length})</h3>
    <table class="grid"><thead><tr><th>จุด</th><th>L × B × t (m)</th><th>${ctx.fset.type === "pile" ? "เข็ม" : "qmax / qa"}</th><th>เหล็กแนว X</th><th>เหล็กแนว Y</th><th>ผล</th></tr></thead><tbody>
      ${fts.map(([id, ft]) => {
        const w2 = ft.service.reduce((a2, s) => (s.qmax / s.allow > a2.qmax / a2.allow ? s : a2), ft.service[0]);
        return `<tr class="${ft.ok ? "" : "bad"}"><td>${esc(id)}</td><td>${f(ft.L)} × ${f(ft.B)} × ${f(ft.t)}</td><td>${ft.piles ? `${ft.piles.coords.length} ต้น` : w2 ? `${f(w2.qmax, 1)} / ${f(w2.allow, 1)}` : "-"}</td><td>${esc(ft.barsX)}</td><td>${esc(ft.barsY)}</td><td>${ft.ok ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`;
      }).join("")}
    </tbody></table>` : ""}
    ${footer}</section>`;
  return page1 + page2 + schedulePage(ctx) + slabPages(ctx) + stairPage(ctx) + boqPage(ctx);
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
    <h3>ภาพตัดเหล็กเสริม</h3>
    <div class="sec-row">${beamSvg3(d)}<table class="kv"><tbody>
      <tr><td>เหล็กบน</td><td>${bar(r.top)} (As ${f(r.top.AsProv, 0)} mm²)</td></tr>
      <tr><td>เหล็กล่าง</td><td>${bar(r.bottom)} (As ${f(r.bottom.AsProv, 0)} mm²)</td></tr>
      <tr><td>เหล็กปลอก</td><td>${esc(r.shear.message.replace("เหล็กปลอก ", ""))}, ${inp.stirrupLegs} ขา</td></tr>
      <tr><td>ระยะหุ้ม</td><td>${inp.cover} mm ถึงผิวเหล็กปลอก</td></tr>
    </tbody></table></div>
    ${d.detail ? `<h3>รายละเอียดเหล็กเสริมตามความยาว</h3>
    ${beamElevationSvg(d.detail, inp.h / 1000, `${esc(id)} — แนวเหล็กบน (แดง) / ล่าง (น้ำเงิน)`)}
    <table class="grid"><thead><tr><th>ตำแหน่ง</th><th>เหล็ก</th><th>จาก (m)</th><th>ถึง (m)</th><th>ยาว (m)</th></tr></thead><tbody>
      ${[...d.detail.top.map((b) => ["บน", b] as const), ...d.detail.bottom.map((b) => ["ล่าง", b] as const)].map(([w, b]) => `<tr><td>${w}${b.from === 0 && b.to === d.detail!.L ? " (ต่อเนื่อง)" : " (เสริม)"}</td><td>${b.n}-DB${b.dia}</td><td>${f(b.from)}</td><td>${f(b.to)}</td><td>${f(b.to - b.from)}</td></tr>`).join("")}
    </tbody></table>
    ${d.detail.dev ? `<table class="grid"><thead><tr><th></th><th>ระยะฝังตรง ld</th><th>งอ 90° ldh</th><th>ทาบ Class B (1.3ld)</th></tr></thead><tbody>
      <tr><td>เหล็กบน (ψt = 1.3)</td><td>${d.detail.dev.ldTop} mm</td><td>${d.detail.dev.ldhTop} mm</td><td>${d.detail.dev.lapTop} mm</td></tr>
      <tr><td>เหล็กล่าง</td><td>${d.detail.dev.ldBot} mm</td><td>${d.detail.dev.ldhBot} mm</td><td>${d.detail.dev.lapBot} mm</td></tr>
      ${d.detail.dev.hooks.map((h) => `<tr class="${h.ok ? "" : "bad"}"><td>งอฝังปลาย ${h.end} (ริม)</td><td colspan="2">ต้องการ ${h.need} mm · มี ${h.avail.toFixed(0)} mm (เสา − หุ้ม 50)</td><td>${h.ok ? "ผ่าน" : "ไม่พอ"}</td></tr>`).join("")}
    </tbody></table>` : ""}
    <p style="font-size:10px;color:#667;margin:4px 0 0">${esc(d.detail.notes.join(" · "))} · ระยะวัดจากจุดต่อปลาย i (ศูนย์กลางเสา) · ACI 318-19 §25.4.2.3, §25.4.3.1, §25.5.2</p>` : ""}
    <h3>2. เหล็กรับโมเมนต์บวก (ล่าง)</h3>${stepsTable(r.bottom.steps)}
    <h3>3. เหล็กรับโมเมนต์ลบ (บน)</h3>${stepsTable(r.top.steps)}
    <h3>4. เหล็กปลอก</h3>${stepsTable(r.shear.steps)}
    <h3>5. แรงบิด</h3>
    ${d.torsion?.required ? `${stepsTable(d.torsion.steps)}
    ${d.torsion.ok ? `<p>เหล็กตามยาวรับแรงบิด: ${d.torsionBars?.top ? `เพิ่มเหล็กบน ${d.torsionBars.top} เส้น · ` : ""}${d.torsionBars?.bottom ? `เพิ่มเหล็กล่าง ${d.torsionBars.bottom} เส้น · ` : ""}${d.torsion.side ? `เหล็กข้างด้านละ ${d.torsion.side.n}-DB${d.torsion.side.dia} · ` : ""}เหล็กปลอกต้องเป็นปลอกปิด ขอ 135°</p>` : ""}`
    : `<table class="steps"><tbody><tr class="good"><td class="lbl">เกณฑ์ไม่ต้องคิดแรงบิด</td><td class="expr">Tth = φ·0.083√fc'·Acp²/pcp</td><td class="val">Tu ${f(d.Tu)} ≤ ${f(d.Tth)} kN·m</td></tr></tbody></table>`}
    ${d.warnings.map((w) => `<p class="msg bad">${esc(w)}</p>`).join("")}
    <div class="result ${d.ok ? "" : "bad"}"><b>สรุป ${esc(id)}:</b> ล่าง ${bar(r.bottom)} · บน ${bar(r.top)} · ${esc(r.shear.message)} · อัตราส่วน ${f(d.ratio)} — ${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</div>
    ${footer}</section>`;
}

function wallPage(ctx: Report3Context, id: string, d: WallDesign3): string {
  const mem = ctx.model.members.find((x) => x.id === id)!;
  return `<section class="page">${header(ctx, `ออกแบบผนังรับแรงเฉือน ค.ส.ล. — ${id}`)}
    <h3>1. ข้อมูลผนัง</h3>
    <table class="kv"><tbody>
      <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td><td>ความสูงช่วงนี้</td><td>${f(d.L)} m</td></tr>
      <tr><td>ขนาด</td><td>t × Lw = ${f(d.t, 0)} × ${f(d.Lw, 0)} mm</td><td>ความสูงรวม hw</td><td>${f(d.hw / 1000)} m</td></tr>
      <tr><td>แบบจำลอง</td><td colspan="3">เสากว้างที่แนวศูนย์กลางผนัง + แขนแข็งเชื่อมปลายผนังทุกชั้น · ดัดและเฉือนในระนาบผนัง (ค่าสุดขีดทุกชุดผสม ที่ปลายบน/ล่างของช่วงชั้น)</td></tr>
    </tbody></table>
    <h3>2. ออกแบบ (ACI 318-19 บทที่ 11)</h3>${stepsTable(d.result.steps)}
    ${d.warnings.map((w) => `<p class="msg bad">${esc(w)}</p>`).join("")}
    <div class="result ${d.ok ? "" : "bad"}"><b>สรุป ${esc(id)}:</b> ${esc(d.result.message)} — อัตราส่วน ${f(d.ratio)} ${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</div>
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
    <h3>ภาพตัดเหล็กเสริม</h3>
    <div class="sec-row">${columnSvg3(d)}<table class="kv"><tbody>
      <tr><td>เหล็กยืน</td><td>${lay ? `${totalBarsBiax(lay)}-DB${lay.dia} (As ${f(r.Ast, 0)} mm², ρg ${f(r.rho * 100)}%)` : "—"}</td></tr>
      <tr><td>การวาง</td><td>${lay ? `ด้าน h ด้านละ ${lay.n2} เส้น · ด้าน b ด้านละ ${lay.n3} เส้น (รวมมุม)` : "—"}</td></tr>
      <tr><td>เหล็กปลอก</td><td>${esc(d.ties)}</td></tr>
      ${d.lap ? `<tr><td>ระยะทาบ</td><td>${d.lap.mm} mm เหนือพื้น (${d.lap.kind === "tension" ? "รับแรงดึง Class B 1.3ld — เสามีแรงดึง" : "รับแรงอัด 0.071fy·db ≥ 300"}, ACI 25.5)</td></tr>` : ""}
      <tr><td>ระยะหุ้ม</td><td>${s.cover} mm ถึงผิวเหล็กปลอก</td></tr>
    </tbody></table></div>
    <h3>2. กำลังหน้าตัดสองแกน</h3>
    <p>ความเข้ากันได้ของความเครียด (εcu = 0.003) ที่มุมแกนสะเทินใดๆ: ตัดพื้นที่รับแรงอัด (Whitney block) ด้วยระนาบ แล้วค้นหามุม θ และความลึก c ให้ φPn = Pu และทิศโมเมนต์ตรงกับแรงกระทำ · อัตราส่วน = √(M33² + M22²) / φMn</p>
    <table class="kv"><tbody>
      <tr><td>เหล็กยืน</td><td>${lay ? `${totalBarsBiax(lay)}DB${lay.dia} (ด้านละ ${lay.n2} ตามแนว h, ${lay.n3} ตามแนว b)` : "—"}</td><td>ρg</td><td>${f(r.rho * 100)} %</td></tr>
      <tr><td>เหล็กปลอก</td><td colspan="3">${esc(d.ties)} — min(16db, 48dtie, ด้านแคบ)</td></tr>
    </tbody></table>
    <h3>3. ตรวจทุกชุดผสม (เรียงจากวิกฤต)</h3>
    <table class="grid"><thead><tr><th>ชุดผสม</th><th>ตำแหน่ง</th><th>Pu (kN)</th><th>M33 (kN·m)</th><th>M22 (kN·m)</th><th>φMn (kN·m)</th><th>อัตราส่วน</th></tr></thead><tbody>
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
    <table class="grid"><thead><tr><th>กรณี</th><th>P รวม (kN)</th><th>Mx ท้องฐาน (kN·m)</th><th>My ท้องฐาน (kN·m)</th><th>max (${unit})</th><th>min (${unit})</th>${ft.type === "spread" ? "<th>สัมผัส</th>" : ""}<th>ยอมให้ (${unit})</th><th>ผล</th></tr></thead><tbody>
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
  const wallList = Object.entries(ctx.design).filter(([, d]) => d.kind === "wall") as [string, WallDesign3][];
  const ftRatio = (ft: FootingResult3) => (ft.ok ? Math.max(...ft.service.map((s) => s.qmax / s.allow), ft.crit.punch, ft.crit.oneWayX, ft.crit.oneWayY) : Infinity);
  if (scope.startsWith("member:")) {
    const id = scope.slice(7), d = ctx.design[id];
    if (!d) return { html: "", label: "" };
    return { html: d.kind === "beam" ? beamPage(ctx, id, d) : d.kind === "wall" ? wallPage(ctx, id, d) : columnPage(ctx, id, d), label: id };
  }
  if (scope.startsWith("footing:")) {
    const n = scope.slice(8), ft = ctx.footings?.[n];
    return ft ? { html: footingPage(ctx, n, ft), label: `ฐานราก ${n}` } : { html: "", label: "" };
  }
  let pages = summaryPages(ctx);
  if (scope === "all") {
    pages += beams.map(([id, d]) => beamPage(ctx, id, d)).join("") + cols.map(([id, d]) => columnPage(ctx, id, d)).join("") + wallList.map(([id, d]) => wallPage(ctx, id, d)).join("") + fts.map(([n, ft]) => footingPage(ctx, n, ft)).join("");
    return { html: pages, label: `ทุกชิ้น: คาน ${beams.length} · เสา ${cols.length} · ฐาน ${fts.length}` };
  }
  const wb = worstOf(beams, (d) => d.ratio), wc = worstOf(cols, (d) => d.ratio), wf = worstOf(fts, ftRatio);
  if (wb) pages += beamPage(ctx, wb[0], wb[1]);
  if (wc) pages += columnPage(ctx, wc[0], wc[1]);
  const ww = worstOf(wallList, (d) => d.ratio);
  if (ww) pages += wallPage(ctx, ww[0], ww[1]);
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
    <style>${SECTION_CSS}</style><div class="pages">${isSummary ? coverPage(ctx) : ""}${html}</div>`;
  // เลขหน้า "หน้า n / N" และสารบัญ (ชื่อหน้าจากหัวกระดาษ)
  const pages = [...host.querySelectorAll<HTMLElement>(".pages .page")];
  pages.forEach((p, i) => { const no = p.querySelector(".pno"); if (no) no.textContent = `หน้า ${i + 1} / ${pages.length}`; });
  const toc = host.querySelector(".toc-body");
  if (toc) {
    toc.innerHTML = pages.slice(1).map((p, i) => `<tr><td>${esc(p.querySelector(".ptitle")?.textContent ?? "")}</td><td class="pg">${i + 2}</td></tr>`).join("");
  }
  convertDom(host.querySelector(".pages")!);
  host.hidden = false;
  document.body.classList.add("printing-report");
  host.querySelector("#rp-print")!.addEventListener("click", () => window.print());
  host.querySelector("#rp-scope")?.addEventListener("click", () => openReport3(ctx, scope === "all" ? "summary" : "all"));
  host.querySelector("#rp-close")!.addEventListener("click", () => { host.hidden = true; document.body.classList.remove("printing-report"); });
}
