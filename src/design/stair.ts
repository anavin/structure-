// ออกแบบบันได ค.ส.ล. แบบท้องเรียบ (waist slab) ช่วงเดียว รับน้ำหนักทางเดียวตามแนวราบ
//   ลูกตั้ง R = H/n (n = ceil(H/0.18)), ลูกนอน G · cosθ = G/√(G² + R²)
//   น้ำหนักตัวเองต่อพื้นที่ราบ = 24·(t/cosθ + R/2) kN/m² + วัสดุปู + น้ำหนักจร
//   M = wu·Ln²/8 (ฐานรองรับธรรมดา) หรือ wu·Ln²/10 (ต่อเนื่อง) ต่อความกว้าง 1 m · V = wu·Ln/2
//   t ≥ Ln/20 (ธรรมดา) หรือ Ln/24 (ต่อเนื่อง) ≥ 100 mm · เหล็กขั้นต่ำ/กันร้าวตามพื้น · d วัดตั้งฉากกับท้องบันได

import { KSC_TO_MPA } from "../core/model.ts";
import type { DesignCode, Step } from "./rcBeam.ts";
import { pickBar, rhoMin } from "./slab3d.ts";

export interface StairInput {
  enabled: boolean; Ln: number; H: number; tread: number; width: number; t: number;
  sdl: number; ll: number; // kg/m²
  support: "simple" | "continuous";
}
export const defaultStair: StairInput = { enabled: false, Ln: 3.0, H: 1.75, tread: 0.25, width: 1.2, t: 0.15, sdl: 100, ll: 300, support: "simple" };

export interface StairResult {
  n: number; R: number; cos: number; wD: number; wL: number; wu: number; Mu: number; Vu: number;
  main: { dia: number; s: number; As: number; AsReq: number }; dist: { dia: number; s: number };
  reaction: number; tMin: number; ok: boolean; message: string; steps: Step[];
}

const KG = 0.00980665;
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");
const nm = (d: number) => (d <= 9 ? `RB${d}` : `DB${d}`);

export function designStair(s: StairInput, fcKsc: number, fyKsc: number, code: DesignCode): StairResult {
  const fc = fcKsc * KSC_TO_MPA, fy = fyKsc * KSC_TO_MPA;
  const n = Math.max(1, Math.ceil(s.H / 0.18 - 1e-9));
  const R = s.H / n, G = s.tread;
  const cos = G / Math.hypot(G, R);
  const wD = 24 * (s.t / cos + R / 2) + s.sdl * KG, wL = s.ll * KG;
  const wu = code === "ACI" ? 1.2 * wD + 1.6 * wL : 1.4 * wD + 1.7 * wL;
  const k = s.support === "continuous" ? 10 : 8;
  const Mu = (wu * s.Ln * s.Ln) / k, Vu = (wu * s.Ln) / 2;
  const tmm = s.t * 1000, cover = 20;
  const d = tmm - cover - 6;
  const Rn = (Mu * 1e6) / (0.9 * 1000 * d * d);
  const inner = 1 - (2 * Rn) / (0.85 * fc);
  const rho = inner > 0 ? ((0.85 * fc) / fy) * (1 - Math.sqrt(inner)) : Infinity;
  const amin = rhoMin(fyKsc) * 1000 * tmm;
  const AsReq = Math.max(rho * 1000 * d, amin);
  const main = { ...pickBar(AsReq, Math.min(3 * tmm, 450), fyKsc), AsReq };
  const dist = pickBar(Math.max(amin, rhoMin(Math.min(fyKsc, 2400)) * 1000 * tmm), Math.min(5 * tmm, 450), Math.min(fyKsc, 2400)); // เหล็กกลม → ρmin 0.0025
  const phiV = code === "ACI" ? 0.75 : 0.85;
  const phiVc = (phiV * 0.17 * Math.sqrt(fc) * 1000 * d) / 1000;
  const tMin = Math.max((s.Ln * 1000) / (s.support === "continuous" ? 24 : 20), 100);
  const tOk = tmm >= tMin - 1e-6, vOk = Vu <= phiVc, aOk = Number.isFinite(AsReq) && main.As >= AsReq - 1e-6;
  const ok = tOk && vOk && aOk;
  const steps: Step[] = [
    { label: "ขั้นบันได", expr: `n = ⌈H/0.18⌉, R = H/n, ลูกนอน G`, value: `${n} ขั้น · R = ${f(R * 1000, 0)} mm · G = ${f(G * 1000, 0)} mm` },
    { label: "ความชัน", expr: "cosθ = G/√(G² + R²)", value: f(cos, 3) },
    { label: "น้ำหนักคงที่ (ต่อพื้นที่ราบ)", expr: "24(t/cosθ + R/2) + วัสดุปู", value: `${f(wD)} kN/m²` },
    { label: "น้ำหนักจร", expr: `${s.ll} kg/m²`, value: `${f(wL)} kN/m²` },
    { label: "น้ำหนักประลัย", expr: code === "ACI" ? "1.2D + 1.6L" : "1.4D + 1.7L", value: `${f(wu)} kN/m²` },
    { label: "ความหนา", expr: `t ≥ Ln/${s.support === "continuous" ? 24 : 20} ≥ 100 mm`, value: `${f(tmm, 0)} ${tOk ? "≥" : "<"} ${f(tMin, 0)} mm`, ok: tOk },
    { label: "โมเมนต์", expr: `Mu = wu·Ln²/${k} (ต่อกว้าง 1 m)`, value: `${f(Mu)} kN·m/m` },
    { label: "เหล็กหลัก", expr: `d = ${f(d, 0)} mm, As ≥ ${f(AsReq, 0)} mm²/m`, value: `${nm(main.dia)} @ ${(main.s / 1000).toFixed(3)} m (${f(main.As, 0)} mm²/m)`, ok: aOk },
    { label: "เหล็กกันร้าว (ตามขวาง)", expr: `As ≥ ${rhoMin(fyKsc)}·b·t`, value: `${nm(dist.dia)} @ ${(dist.s / 1000).toFixed(3)} m` },
    { label: "แรงเฉือน", expr: "Vu = wu·Ln/2 ≤ φ·0.17√fc'·b·d", value: `${f(Vu)} ≤ ${f(phiVc)} kN/m`, ok: vOk },
    { label: "แรงที่ถ่ายลงคานรองรับ", expr: "(D + L)·Ln/2 ต่อความกว้าง 1 m (ใช้งาน)", value: `${f(((wD + wL) * s.Ln) / 2)} kN/m` },
  ];
  return {
    n, R, cos, wD, wL, wu, Mu, Vu, main, dist: { dia: dist.dia, s: dist.s }, reaction: ((wD + wL) * s.Ln) / 2, tMin, ok,
    message: ok ? `${nm(main.dia)}@${main.s / 1000} · กันร้าว ${nm(dist.dia)}@${dist.s / 1000}` : !tOk ? "บันไดบางเกินไป" : !vOk ? "แรงเฉือนเกิน — เพิ่มความหนา" : "เหล็กไม่พอ — เพิ่มความหนา",
    steps,
  };
}
