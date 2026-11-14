import { test } from "node:test";
import assert from "node:assert/strict";
import { responseSpectrum, sdofPeak, syntheticMotion } from "../src/loads/groundMotion.ts";
import { defaultSeismic, Sa, spectrum } from "../src/loads/seismicTH.ts";

test("Newmark SDOF: คาบสั้นมาก Sa → PGA, ฮาร์มอนิกส์ตรงทฤษฎี", () => {
  const dt = 0.005, n = 4000;
  // ag = sin(Ωt) Ω = 2π·1 Hz, ระบบ T = 0.5 s ζ = 5%: steady state u = 1/√((k−Ω²)² + (cΩ)²)
  // เพิ่มแอมพลิจูดอย่างนุ่มนวลใน 4 s แรก (ลดช่วงเปลี่ยนผ่าน)
  const W = 2 * Math.PI, ag = Array.from({ length: n }, (_, i) => Math.sin(W * i * dt) * Math.min(1, (i * dt) / 4));
  const w = 2 * Math.PI / 0.5, c = 2 * 0.05 * w;
  const uss = 1 / Math.hypot(w * w - W * W, c * W);
  const r = sdofPeak(ag, dt, 0.5);
  assert.ok(Math.abs(r.umax - uss) / uss < 0.08, `${r.umax} vs ${uss}`); // รวมช่วงเปลี่ยนผ่าน
  const short = sdofPeak(ag, dt, 0.02);
  assert.ok(Math.abs(short.Sa - 1) < 0.03);
});

test("คลื่นสังเคราะห์: สเปกตรัมใกล้เป้าหมาย (±30% ที่ 0.1–3 s), ความเร็วปลายเป็นศูนย์, ผลซ้ำได้", () => {
  const spec = spectrum({ ...defaultSeismic });
  const target = (T: number) => Sa(spec, T);
  const gm = syntheticMotion(target, { duration: 20 });
  const Ts = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3];
  const sa = responseSpectrum(gm.ag, gm.dt, Ts);
  const err = Ts.map((T, k) => sa[k] / target(T));
  assert.ok(err.every((e) => e > 0.7 && e < 1.3), err.map((e) => e.toFixed(2)).join(","));
  const vEnd = gm.ag.reduce((a, x) => a + x * gm.dt, 0);
  assert.ok(Math.abs(vEnd) < 1e-6);
  assert.deepEqual(syntheticMotion(target, { duration: 20 }).ag.slice(0, 50), gm.ag.slice(0, 50));
});
