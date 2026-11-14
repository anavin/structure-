// วิเคราะห์ผลักทีละขั้น (Pushover) แบบเกิดจุดหมุนพลาสติกทีละจุด (event-to-event, elastic–perfectly plastic)
//   1) น้ำหนักแนวดิ่ง D + 0.25L (เชิงเส้น)
//   2) แรงด้านข้างรูปแบบคงที่ (แผ่นดินไหว Fx = Cvx·V หรือแรงลมรายชั้น) ที่จุดอ้างอิงพื้น เพิ่มทีละขั้น:
//      วิเคราะห์โครงสร้างปัจจุบัน (ปลดโมเมนต์ที่จุดหมุนที่เกิดแล้ว) ภายใต้แรงหนึ่งหน่วย → หา λ ที่ทำให้ปลายชิ้นถัดไปถึงกำลังดัด
//      ใส่จุดหมุน (ปลดโมเมนต์ปลายนั้น) แล้วรวมแรง: ผลรวม = Σ λ·ผลของแต่ละขั้น — โมเมนต์ที่จุดหมุนคงที่เท่ากำลัง
//   3) หยุดเมื่อเป็นกลไก (โครงสร้างไม่มีเสถียรภาพ = พัง), คานแรงเฉือนเกิน (พังแบบเปราะ), การเคลื่อนตัวยอด > 4%H หรือครบจำนวนขั้น
//   กำลัง: คานใช้ φMn ของเหล็กบน/ล่างที่ออกแบบ, เสาใช้ φMn ที่แรงอัดจากน้ำหนักแนวดิ่ง (ผิวปฏิสัมพันธ์ P–M) — ผนังและแขนแข็งคิดยืดหยุ่น
//   (ประมาณ: ไม่คิด P-Δ, กำลังคาดหวัง, การเสื่อมกำลัง และพฤติกรรมแบบวัฏจักร — ใช้ดูลำดับการเกิดจุดหมุนและจุดอ่อนของโครงสร้าง)

import { analyze3d, type AnalysisResult3 } from "../core3d/frame3d.ts";
import { analyzeCombo3, modelOptions3 } from "../core3d/combos3d.ts";
import type { Load3, Model3 } from "../core3d/model3d.ts";
import { linearResults } from "../core3d/rsa3d.ts";
import type { MemberDesign3 } from "./design3d.ts";
import { checkBiaxial } from "./rcColumnBiaxial.ts";
import { KSC_TO_MPA } from "../core/model.ts";

export interface Hinge { member: string; end: "i" | "j"; kind: "beam" | "column"; step: number; M: number; Mp: number; type: "flexure" | "shear"; z: number }
export interface PushStep { step: number; lambda: number; V: number; roof: number; drift: number; result: AnalysisResult3; hinges: Hinge[] }
export interface PushoverResult {
  dir: "X" | "Y"; pattern: "seismic" | "wind";
  steps: PushStep[]; hinges: Hinge[];
  end: "mechanism" | "shear" | "drift" | "limit";
  endNote: string;
  H: number; Vdesign: number; Vmax: number; firstYield: PushStep | null;
  softStorey: number | null; columnFirst: boolean;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function pushover(model: Model3, design: Record<string, MemberDesign3>, opts: { dir: "X" | "Y"; pattern: "seismic" | "wind"; forces: number[]; Vdesign: number; maxSteps?: number; driftLimit?: number }): PushoverResult {
  const dir = opts.dir;
  const dias = [...(model.diaphragms ?? [])].map((d) => ({ d, z: model.nodes.find((n) => n.id === d.nodes[0])!.z })).sort((a, b) => a.z - b.z);
  if (!dias.length) throw new Error("ต้องเปิดพื้นแข็งเพื่อวิเคราะห์ Pushover");
  const nodeZ = new Map(model.nodes.map((n) => [n.id, n.z]));
  const zBase = Math.min(...model.nodes.map((n) => n.z));
  const H = dias[dias.length - 1].z - zBase;
  const sumF = opts.forces.reduce((a, v) => a + v, 0) || 1;
  const unit: Load3[] = dias.map(({ d }, k) => ({ type: "nodal", node: d.id, fx: dir === "X" ? (opts.forces[k] ?? 0) / sumF : 0, fy: dir === "Y" ? (opts.forces[k] ?? 0) / sumF : 0, fz: 0, mx: 0, my: 0, mz: 0 }));
  const topId = dias[dias.length - 1].d.id;
  const roofOf = (r: AnalysisResult3) => (dir === "X" ? r.diaphragms[topId].ux : r.diaphragms[topId].uy);
  // ปลายชิ้นที่อาจเกิดจุดหมุน และกำลัง
  type End = { member: string; end: "i" | "j"; kind: "beam" | "column"; Mpos: number; Mneg: number; key: "Mz" | "My"; rel: "m3" | "m2"; Vcap: number };
  const ends: End[] = [];
  const grav = analyzeCombo3(model, Object.fromEntries(model.loadCases.filter((c) => !c.lateral).map((c) => [c.id, c.id === "LL" ? 0.25 : 1])));
  for (const m of model.members) {
    const d = design[m.id];
    if (!d) continue;
    if (m.kind === "beam" && d.kind === "beam") {
      const r = d.result;
      const Av = r.input.stirrupLegs * Math.PI * r.input.stirrupDia ** 2 / 4, dd = Math.min(r.bottom.d, r.top.d);
      const phiV = r.input.code === "ACI" ? 0.75 : 0.85;
      const Vcap = r.shear.spacing ? r.shear.phiVc + (phiV * Av * r.input.fytKsc * KSC_TO_MPA * dd) / r.shear.spacing / 1e3 : r.shear.phiVc;
      for (const e of ["i", "j"] as const) ends.push({ member: m.id, end: e, kind: "beam", Mpos: r.bottom.phiMn || 1e-6, Mneg: r.top.phiMn || 1e-6, key: "Mz", rel: "m3", Vcap });
    } else if (m.kind === "column" && d.kind === "column" && d.result.layout) {
      const st = grav.members[m.id].stations;
      for (const e of ["i", "j"] as const) {
        const P = -(e === "i" ? st[0] : st[st.length - 1]).N;
        const c = checkBiaxial(d.section, d.result.layout, P, dir === "X" ? 1 : 0, dir === "Y" ? 1 : 0);
        const Mp = Math.max(c.phiMn, 1e-6);
        ends.push({ member: m.id, end: e, kind: "column", Mpos: Mp, Mneg: Mp, key: dir === "X" ? "Mz" : "My", rel: dir === "X" ? "m3" : "m2", Vcap: Infinity });
      }
    }
  }
  const work: Model3 = structuredClone(model);
  const memW = new Map(work.members.map((m) => [m.id, m]));
  const lin = { ...modelOptions3(model), pDelta: false };
  const endM = (r: AnalysisResult3, e: End) => { const s = r.members[e.member].stations; return (e.end === "i" ? s[0] : s[s.length - 1])[e.key]; };
  const endV = (r: AnalysisResult3, e: End) => { const s = r.members[e.member].stations; return Math.abs((e.end === "i" ? s[0] : s[s.length - 1]).Vy); };
  let total = grav;
  const hinged = new Set<string>();
  const hinges: Hinge[] = [];
  const steps: PushStep[] = [{ step: 0, lambda: 0, V: 0, roof: roofOf(grav), drift: roofOf(grav) / H, result: grav, hinges: [] }];
  let lambda = 0;
  let endState: PushoverResult["end"] = "limit", endNote = "ครบจำนวนขั้นที่กำหนด";
  const maxSteps = opts.maxSteps ?? 250, driftLimit = opts.driftLimit ?? 0.04;
  for (let s = 1; s <= maxSteps; s++) {
    let inc: AnalysisResult3;
    try { inc = analyze3d(work, unit, 0, lin); }
    catch { endState = "mechanism"; endNote = "เกิดกลไกการพัง (โครงสร้างไม่มีเสถียรภาพหลังเกิดจุดหมุน)"; break; }
    const dRoof = roofOf(inc);
    if (!(Math.abs(dRoof) > 1e-12) || Math.abs(dRoof) > 1e3) { endState = "mechanism"; endNote = "เกิดกลไกการพัง (ความแข็งด้านข้างเหลือน้อยมาก)"; break; }
    // หา λ ที่ทำให้ปลายถัดไปถึงกำลัง (หรือแรงเฉือนคานถึงกำลัง)
    let best = Infinity, who: End | null = null, type: Hinge["type"] = "flexure";
    for (const e of ends) {
      const key = `${e.member}|${e.end}`;
      if (hinged.has(key)) continue;
      const M0 = endM(total, e), dM = endM(inc, e);
      if (Math.abs(dM) > 1e-12) {
        const cap = dM > 0 ? e.Mpos - M0 : -e.Mneg - M0;
        const l = cap / dM;
        if (l >= -1e-9 && l < best) { best = Math.max(l, 0); who = e; type = "flexure"; }
      }
      if (e.kind === "beam" && Number.isFinite(e.Vcap)) {
        const V0 = endV(total, e), dV = endV(inc, e);
        if (dV > 1e-12) { const l = (e.Vcap - V0) / dV; if (l >= -1e-9 && l < best) { best = Math.max(l, 0); who = e; type = "shear"; } }
      }
    }
    // จำกัดด้วยการเคลื่อนตัวยอด
    const roofNow = roofOf(total);
    const lDrift = (driftLimit * H * Math.sign(dRoof) - roofNow) / dRoof;
    const limitedByDrift = !who || lDrift < best;
    const l = Math.max(0, limitedByDrift ? lDrift : best);
    total = linearResults([total, inc], [1, l]);
    lambda += l;
    const newHinges: Hinge[] = [];
    if (!limitedByDrift && who) {
      const z = nodeZ.get(memW.get(who.member)![who.end === "i" ? "i" : "j"]) ?? 0;
      const h: Hinge = { member: who.member, end: who.end, kind: who.kind, step: s, M: r4(endM(total, who)), Mp: who.kind === "beam" ? (endM(total, who) >= 0 ? who.Mpos : who.Mneg) : who.Mpos, type, z };
      hinges.push(h); newHinges.push(h);
      hinged.add(`${who.member}|${who.end}`);
      const mem = memW.get(who.member)!;
      const rel = { ...(who.end === "i" ? mem.releaseI : mem.releaseJ), [who.rel]: true };
      if (who.end === "i") mem.releaseI = rel; else mem.releaseJ = rel;
    }
    const roof = roofOf(total);
    steps.push({ step: s, lambda, V: lambda, roof, drift: roof / H, result: total, hinges: newHinges });
    if (type === "shear" && !limitedByDrift) { endState = "shear"; endNote = `คาน ${who!.member} แรงเฉือนถึงกำลัง — พังแบบเปราะ (ควรให้คานครากด้วยการดัดก่อน)`; break; }
    if (limitedByDrift) { endState = "drift"; endNote = `การเคลื่อนตัวยอดถึง ${(driftLimit * 100).toFixed(0)}% ของความสูงอาคาร`; break; }
  }
  // ชั้นอ่อน: ชั้นที่เสาทุกต้นเกิดจุดหมุนทั้งบนและล่าง
  const cols = model.members.filter((m) => m.kind === "column");
  let soft: number | null = null;
  for (let k = 0; k < dias.length && soft === null; k++) {
    const zTop = dias[k].z, zBot = k ? dias[k - 1].z : zBase;
    const cs = cols.filter((m) => Math.abs((nodeZ.get(m.j) ?? 0) - zTop) < 1e-6 && Math.abs((nodeZ.get(m.i) ?? 0) - zBot) < 1e-6);
    if (cs.length && cs.every((m) => hinged.has(`${m.id}|i`) && hinged.has(`${m.id}|j`))) soft = k + 1;
  }
  const firstBeam = hinges.findIndex((h) => h.kind === "beam"), firstCol = hinges.findIndex((h) => h.kind === "column");
  return {
    dir, pattern: opts.pattern, steps, hinges, end: endState, endNote, H,
    Vdesign: opts.Vdesign, Vmax: Math.max(...steps.map((s) => s.V)),
    firstYield: steps.find((s) => s.hinges.length) ?? null,
    softStorey: soft,
    columnFirst: firstCol >= 0 && (firstBeam < 0 || firstCol < firstBeam),
  };
}
