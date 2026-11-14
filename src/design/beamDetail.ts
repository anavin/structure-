// รายละเอียดเหล็กเสริมคาน: จุดตัดเหล็ก (cut-off) จากเส้นห่อโมเมนต์ + ข้อกำหนดเชิงปฏิบัติ
//   เหล็กบน: เหล็กต่อเนื่องตลอดช่วง (อย่างน้อย 2 เส้นมุม) + เหล็กเสริมที่ฐานรองรับ
//     ระยะเหล็กเสริมบนจากผิวฐานรองรับ = max(จุดที่ Mu− ≤ φMn ของเหล็กต่อเนื่อง + max(d, 12db), Ln/3)
//   เหล็กล่าง: เหล็กต่อเนื่องเข้าฐานรองรับ (อย่างน้อย 2 เส้น หรือ ⅓ ของเหล็กทั้งหมด) + เหล็กเสริมกลางช่วง
//     ตัดที่ระยะ min(จุดที่ Mu+ ≤ φMn ของเหล็กต่อเนื่อง − max(d, 12db), 0.15Ln) จากผิวฐานรองรับ
//   ระยะฝัง ld / งอ ldh / ทาบ Class B ตาม ACI 318-19 §25.4–25.5 · เหล็กเสริมยาวอย่างน้อย ld จากจุดวิกฤต · ปลายริมตรวจงอฝังในเสา

import type { BeamDesignResult } from "./rcBeam.ts";
import { KSC_TO_MPA } from "../core/model.ts";
import { lapTension, ldHook, ldStraight, roundUp50 } from "./development.ts";

export interface Envelope { x: number[]; mPos: number[]; mNeg: number[] } // m, kN·m (mNeg เป็นค่าบวกของโมเมนต์ลบ)
export interface BarRun { n: number; dia: number; from: number; to: number } // ตำแหน่งตามแนวคาน (m จากปลาย i)
export interface HookCheck { end: "i" | "j"; need: number; avail: number; ok: boolean } // mm
export interface BeamDev { ldTop: number; ldBot: number; ldhTop: number; ldhBot: number; lapTop: number; lapBot: number; hooks: HookCheck[] } // mm
export interface BeamDetail {
  L: number; ln: number; a0: number; a1: number; // ความยาว, ช่วงสุทธิ, ผิวฐานรองรับปลาย i/j
  top: BarRun[]; bottom: BarRun[];
  /** ระยะฝัง/ทาบ (ACI 25.4–25.5) และการตรวจงอที่ปลายคานริม */
  dev?: BeamDev;
  notes: string[];
}

const area = (d: number) => (Math.PI * d * d) / 4;

/** φMn ของเหล็ก n เส้น (kN·m) */
export function phiMnBars(n: number, dia: number, r: BeamDesignResult, d: number): number {
  const inp = r.input;
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const As = n * area(dia);
  const a = (As * fy) / (0.85 * fc * inp.b);
  return (0.9 * As * fy * (d - a / 2)) / 1e6;
}

/** ตำแหน่งที่ค่าในเส้นห่อเกินค่า cap (จากซ้าย/ขวา) — คืนช่วง [แรก, สุดท้าย] หรือ null */
function exceed(x: number[], m: number[], cap: number, region: (xx: number) => boolean): number[] {
  return x.filter((xx, k) => region(xx) && m[k] > cap + 1e-9);
}

/** ends: ปลายที่มีคานต่อเนื่องในแนวเดียวกัน (ไม่มี = ปลายริม → เหล็กต้องงอฝังในเสา) */
export function detailBeam(r: BeamDesignResult, env: Envelope, L: number, supI: number, supJ: number, ends: { contI: boolean; contJ: boolean } = { contI: true, contJ: true }): BeamDetail {
  const a0 = supI / 2, a1 = L - supJ / 2, ln = Math.max(a1 - a0, 0.1);
  const fc = r.input.fcKsc * KSC_TO_MPA, fy = r.input.fyKsc * KSC_TO_MPA;
  const tdb = r.top.bars?.dia ?? 12, bdb = r.bottom.bars?.dia ?? 12;
  const dev: BeamDev = {
    ldTop: roundUp50(ldStraight({ db: tdb, fc, fy, top: r.input.h >= 300 + 2 * r.input.cover })), ldBot: roundUp50(ldStraight({ db: bdb, fc, fy })),
    ldhTop: roundUp50(ldHook({ db: tdb, fc, fy })), ldhBot: roundUp50(ldHook({ db: bdb, fc, fy })),
    lapTop: roundUp50(lapTension({ db: tdb, fc, fy, top: true })), lapBot: roundUp50(lapTension({ db: bdb, fc, fy })),
    hooks: [],
  };
  const notes: string[] = [];
  const top: BarRun[] = [], bottom: BarRun[] = [];
  const ext = (d: number, db: number) => Math.max(d, 12 * db) / 1000;
  // ---- บน ----
  const tb = r.top.bars;
  if (tb) {
    const nc = Math.min(tb.n, 2);
    top.push({ n: nc, dia: tb.dia, from: 0, to: L });
    const ne = tb.n - nc;
    if (ne > 0) {
      const cap = phiMnBars(nc, tb.dia, r, r.top.d);
      const e = ext(r.top.d, tb.dia);
      // ปลาย i: ช่วงครึ่งซ้าย, ปลาย j: ครึ่งขวา
      const left = exceed(env.x, env.mNeg, cap, (xx) => xx <= L / 2);
      const right = exceed(env.x, env.mNeg, cap, (xx) => xx > L / 2);
      if (left.length) {
        const need = Math.max(...left) + e;
        const to = Math.min(L, Math.max(need, a0 + ln / 3, a0 + dev.ldTop / 1000));
        top.push({ n: ne, dia: tb.dia, from: 0, to });
      }
      if (right.length) {
        const need = Math.min(...right) - e;
        const from = Math.max(0, Math.min(need, a1 - ln / 3, a1 - dev.ldTop / 1000));
        top.push({ n: ne, dia: tb.dia, from, to: L });
      }
      if (!left.length && !right.length) top.push({ n: ne, dia: tb.dia, from: 0, to: L });
      notes.push(`เหล็กบนต่อเนื่อง ${nc}-DB${tb.dia} รับ φMn ${cap.toFixed(1)} kN·m · เหล็กเสริมบนยื่นจากผิวฐานรองรับ ≥ Ln/3 = ${(ln / 3).toFixed(2)} m`);
    }
  }
  // ---- ล่าง ----
  const bb = r.bottom.bars;
  if (bb) {
    const nc = Math.min(bb.n, Math.max(2, Math.ceil(bb.n / 3)));
    bottom.push({ n: nc, dia: bb.dia, from: 0, to: L });
    const ne = bb.n - nc;
    if (ne > 0) {
      const cap = phiMnBars(nc, bb.dia, r, r.bottom.d);
      const e = ext(r.bottom.d, bb.dia);
      const over = exceed(env.x, env.mPos, cap, () => true);
      // เหล็กเสริมล่างต้องยาวพอให้ฝังได้ ld ทั้งสองข้างของจุดโมเมนต์สูงสุด
      const kMax = env.mPos.reduce((bi, v, k) => (v > env.mPos[bi] ? k : bi), 0);
      const xm = env.x[kMax] ?? L / 2, ldb = dev.ldBot / 1000;
      if (over.length) {
        const from = Math.max(a0, Math.min(Math.min(...over) - e, a0 + 0.15 * ln, xm - ldb));
        const to = Math.min(a1, Math.max(Math.max(...over) + e, a1 - 0.15 * ln, xm + ldb));
        bottom.push({ n: ne, dia: bb.dia, from, to });
      } else bottom.push({ n: ne, dia: bb.dia, from: Math.max(a0, Math.min(a0 + 0.15 * ln, xm - ldb)), to: Math.min(a1, Math.max(a1 - 0.15 * ln, xm + ldb)) });
      notes.push(`เหล็กล่างต่อเนื่อง ${nc}-DB${bb.dia} เข้าฐานรองรับ (φMn ${cap.toFixed(1)} kN·m) · เหล็กเสริมล่างตัดห่างผิวฐานรองรับ ≤ 0.15Ln = ${(0.15 * ln).toFixed(2)} m`);
    }
  }
  // ปลายริม (ไม่มีคานต่อ) ที่มีเสา: เหล็กบน/ล่างงอ 90° ฝังในเสา — ต้องการ ldh ≤ ความกว้างเสา − หุ้ม 50 mm
  for (const [end, cont, w] of [["i", ends.contI, supI], ["j", ends.contJ, supJ]] as const) {
    if (cont || w <= 0) continue;
    const avail = w * 1000 - 50, need = Math.max(tb ? dev.ldhTop : 0, bb ? dev.ldhBot : 0);
    dev.hooks.push({ end, need, avail, ok: need <= avail });
  }
  for (const h of dev.hooks) notes.push(h.ok ? `ปลาย ${h.end} (ริม): เหล็กงอ 90° ฝัง ldh ${h.need} ≤ ${h.avail.toFixed(0)} mm` : `ปลาย ${h.end} (ริม): ldh ${h.need} > ${h.avail.toFixed(0)} mm — เพิ่มขนาดเสา ลดขนาดเหล็ก หรือใช้หัวเหล็ก/ระยะฝังพิเศษ`);
  notes.push(`ระยะฝัง ld บน ${dev.ldTop} / ล่าง ${dev.ldBot} mm · ทาบ (Class B) บน ${dev.lapTop} / ล่าง ${dev.lapBot} mm — ทาบเหล็กบนช่วงกลางคาน เหล็กล่างเหนือฐานรองรับ`);
  if (!tb) notes.push("เหล็กบนออกแบบไม่ผ่าน — ไม่แสดงแนวเหล็กบน (แก้หน้าตัดก่อน)");
  if (!bb) notes.push("เหล็กล่างออกแบบไม่ผ่าน — ไม่แสดงแนวเหล็กล่าง (แก้หน้าตัดก่อน)");
  return { L, ln, a0, a1, top, bottom, dev, notes };
}

/** ความยาวเหล็กรวม (m) ต่อชนิด — ใช้ใน BOQ
 *  เหล็กต่อเนื่อง: + ทาบ 1 ครั้งต่อความยาวเหล็กมาตรฐาน 10 m (เฉลี่ยตามความยาวช่วง) · ปลายริมงอ 12db */
export function detailBarLength(dt: BeamDetail): { dia: number; m: number }[] {
  const hooksAt = dt.dev ? dt.dev.hooks.length : 2;
  return [...dt.top, ...dt.bottom].map((b) => {
    const cont = b.from === 0 && b.to === dt.L;
    const lap = dt.dev ? (dt.top.includes(b) ? dt.dev.lapTop : dt.dev.lapBot) / 1000 : 0;
    const extra = cont ? hooksAt * 12 * b.dia / 1000 + (lap * dt.L) / 10 : 0;
    return { dia: b.dia, m: b.n * (b.to - b.from + extra) };
  });
}

/** ภาพด้านข้างคานแสดงแนวเหล็ก (SVG) */
export function beamElevationSvg(dt: BeamDetail, h: number, title: string, W = 640, H = 170): string {
  const padL = 30, padR = 30, sx = (W - padL - padR) / dt.L;
  const X = (x: number) => padL + x * sx;
  const top = 40, bot = 40 + Math.max(50, Math.min(80, h * 120));
  const parts: string[] = [];
  parts.push(`<text x="${W / 2}" y="16" text-anchor="middle" class="sx-title">${title}</text>`);
  parts.push(`<rect x="${X(0)}" y="${top}" width="${X(dt.L) - X(0)}" height="${bot - top}" class="sx-conc"/>`);
  // ฐานรองรับ (เสา)
  for (const [a, b] of [[0, dt.a0], [dt.a1, dt.L]]) parts.push(`<rect x="${X(a)}" y="${top - 12}" width="${Math.max(2, X(b) - X(a))}" height="${bot - top + 24}" fill="#cfd6df" stroke="#556" stroke-width=".8"/>`);
  const row = (runs: BarRun[], y0: number, dy: number, cls: string) => runs.forEach((b, k) => {
    const y = y0 + k * dy;
    parts.push(`<line x1="${X(b.from)}" y1="${y}" x2="${X(b.to)}" y2="${y}" stroke="${cls}" stroke-width="2.2"/>`);
    parts.push(`<text x="${(X(b.from) + X(b.to)) / 2}" y="${y + (dy > 0 ? 11 : -4)}" text-anchor="middle" class="sx-lbl2">${b.n}-DB${b.dia}${b.from > 0 || b.to < dt.L ? ` (${(b.to - b.from).toFixed(2)} m)` : ""}</text>`);
  });
  row(dt.top, top + 6, 9, "#c0392b");
  row(dt.bottom, bot - 6, -9, "#1f5fbf");
  // เส้นบอกระยะ Ln
  parts.push(`<g class="sx-dim"><line x1="${X(dt.a0)}" y1="${bot + 26}" x2="${X(dt.a1)}" y2="${bot + 26}"/><text x="${(X(dt.a0) + X(dt.a1)) / 2}" y="${bot + 39}" text-anchor="middle">Ln = ${dt.ln.toFixed(2)} m</text></g>`);
  return `<svg class="sx" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;
}
