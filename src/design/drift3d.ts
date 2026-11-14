// ตรวจการเคลื่อนตัวด้านข้างรายชั้น (story drift) ที่จุดอ้างอิงพื้นแข็ง
//   แรงลม (load case WX/WY ไม่คูณตัวประกอบ): Δ/h ≤ เกณฑ์ (ค่าตั้งต้น 1/500)
//   แผ่นดินไหว มยผ. 1301/1302-61 (แนวทาง ASCE 7 §12.8.6): Δ = Cd·δe/Ie ≤ 0.020h
//   เสถียรภาพ P-Δ: θ = Px·Δ·Ie / (Vx·h·Cd) ≤ θmax = 0.5/Cd ≤ 0.25 (θ ≤ 0.10 ไม่ต้องคิดผล P-Δ)
//   หมายเหตุ: ใช้ความแข็งของการวิเคราะห์ (ถ้าเปิดหน้าตัดแตกร้าวจะได้ค่าสูงกว่าใช้งานจริง — ปลอดภัย)
//            ค่าที่จุดอ้างอิงพื้น ไม่ใช่ที่มุมอาคาร (อาคารบิดมากควรตรวจที่ขอบเพิ่ม)

import { storeyDrifts, type Run3 } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import type { RsaResult3 } from "../core3d/rsa3d.ts";

export interface DriftSettings { windLimit: number; eqLimit: number; Cd: number; Ie: number }
export const defaultDrift: DriftSettings = { windLimit: 1 / 500, eqLimit: 0.02, Cd: 2.5, Ie: 1 };

export interface WindDriftRow { storey: number; h: number; dx: number; dy: number; ok: boolean }
export interface EqDriftRow {
  storey: number; h: number;
  /** δe จากการวิเคราะห์ และ Δ = Cd·δe/Ie (m) */
  deX: number; deY: number; DX: number; DY: number; limit: number;
  Px: number; VX: number; VY: number; thetaX: number; thetaY: number; thetaMax: number;
  ok: boolean;
}
export interface DriftCheck { wind: WindDriftRow[]; eq: EqDriftRow[]; ok: boolean }

/** แรงตามแกนรวมของเสาในแต่ละชั้น (kN, อัด) จาก load case ที่ให้ */
function storeyAxial(model: Model3, run: Run3, cases: string[], nStorey: number): number[] {
  const out = new Array(nStorey).fill(0);
  for (const m of model.members) {
    const mm = m.id.match(/^C-[A-Z]\d+-(\d+)$/);
    if (!mm) continue;
    const k = +mm[1];
    if (k >= nStorey) continue;
    for (const c of cases) {
      const r = run.results[`case:${c}`]?.members[m.id];
      if (r) out[k] += Math.abs(r.endForces[0]);
    }
  }
  return out;
}

export function checkDrifts(model: Model3, run: Run3, s: DriftSettings = defaultDrift): DriftCheck {
  const rd = (id: string) => (run.results[`case:${id}`] ? storeyDrifts(model, run.results[`case:${id}`]) : []);
  const wx = rd("WX"), wy = rd("WY");
  const wind = wx.map((d, k) => {
    const dx = Math.abs(d.driftX), dy = Math.abs(wy[k]?.driftY ?? 0);
    return { storey: k + 1, h: d.h, dx, dy, ok: dx <= s.windLimit + 1e-12 && dy <= s.windLimit + 1e-12 };
  });

  const ex = rd("EX"), ey = rd("EY");
  let eq: EqDriftRow[] = [];
  if (ex.length) {
    const n = ex.length;
    // แรงเฉือนชั้น = ผลรวมแรงแผ่นดินไหวตั้งแต่ชั้นนั้นขึ้นไป
    const Fs = (id: string) => {
      const lc = model.loadCases.find((c) => c.id === id);
      const byZ = new Map<string, number>();
      for (const l of lc?.loads ?? []) if (l.type === "nodal") byZ.set(l.node, (byZ.get(l.node) ?? 0) + Math.abs(id === "EX" ? l.fx : l.fy));
      return [...byZ.values()];
    };
    const fx = Fs("EX"), fy = Fs("EY");
    const shear = (F: number[]) => F.map((_, k) => F.slice(k).reduce((a, v) => a + v, 0));
    const kx = (run.results["case:EX"] as RsaResult3 | undefined)?.rsa, ky = (run.results["case:EY"] as RsaResult3 | undefined)?.rsa;
    // RSA: ปรับแรงเฉือนชั้นตามสัดส่วนแรงเฉือนฐาน RSA / สถิต
    const VX = shear(fx).map((v) => v * (kx ? kx.V / kx.Vstatic : 1)), VY = shear(fy).map((v) => v * (ky ? ky.V / ky.Vstatic : 1));
    const gravity = model.loadCases.filter((c) => !c.lateral).map((c) => c.id);
    const P = storeyAxial(model, run, gravity, n);
    const thetaMax = Math.min(0.5 / s.Cd, 0.25);
    // RSA: δe รายชั้นรวมแบบ CQC จากแต่ละโหมด
    const rx = (run.results["case:EX"] as RsaResult3 | undefined)?.rsa, ry = (run.results["case:EY"] as RsaResult3 | undefined)?.rsa;
    eq = ex.map((d, k) => {
      const deX = rx ? rx.drifts[k] ?? 0 : Math.abs(d.driftX * d.h), deY = ry ? ry.drifts[k] ?? 0 : Math.abs((ey[k]?.driftY ?? 0) * d.h);
      const DX = (s.Cd * deX) / s.Ie, DY = (s.Cd * deY) / s.Ie;
      const limit = s.eqLimit * d.h;
      const th = (D: number, V: number) => (V > 0 ? (P[k] * D * s.Ie) / (V * d.h * s.Cd) : 0);
      const thetaX = th(DX, VX[k] ?? 0), thetaY = th(DY, VY[k] ?? 0);
      return {
        storey: k + 1, h: d.h, deX, deY, DX, DY, limit, Px: P[k], VX: VX[k] ?? 0, VY: VY[k] ?? 0, thetaX, thetaY, thetaMax,
        ok: DX <= limit + 1e-12 && DY <= limit + 1e-12 && thetaX <= thetaMax && thetaY <= thetaMax,
      };
    });
  }
  return { wind, eq, ok: wind.every((r) => r.ok) && eq.every((r) => r.ok) };
}
