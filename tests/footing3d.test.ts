import { test } from "node:test";
import assert from "node:assert/strict";
import { designFooting3, pileForces3, pressure2, type FootingInput3 } from "../src/design/footing3d.ts";
import { defaultFoundation, designFooting, pileLayout, type FootingInput } from "../src/design/footing.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

const base2 = (over: Partial<FootingInput> = {}): FootingInput => ({
  code: "EIT", c1: 0.3, c2: 0.3, fcKsc: 240, fyKsc: 4000, settings: { ...defaultFoundation },
  service: [{ name: "D+L", P: 500, M: 80, H: 10, wind: false }],
  strength: [{ name: "U1", Pu: 750, Mu: 120, Hu: 15 }],
  ...over,
});
/** แปลงข้อมูล 2D → 3D: โมเมนต์ทวนเข็มในระนาบ XZ = −My */
const to3 = (i: FootingInput): FootingInput3 => ({
  code: i.code, cx: i.c1, cy: i.c2, fcKsc: i.fcKsc, fyKsc: i.fyKsc, settings: i.settings,
  service: i.service.map((s) => ({ name: s.name, P: s.P, Mx: 0, My: -s.M, Hx: s.H, Hy: 0, wind: s.wind })),
  strength: i.strength.map((s) => ({ name: s.name, P: s.Pu, Mx: 0, My: -s.Mu, Hx: s.Hu, Hy: 0 })),
});

test("แรงดัน: ใน kern ตรงสูตร P/A ± My·x/Iy ∓ Mx·y/Ix; ขอบ kern → qmin = 0", () => {
  const P = 400, L = 2, B = 1.5;
  const pr = pressure2(P, 20, 30, L, B);
  near(pr.qmax, P / (L * B) + (30 * 1) / ((B * L ** 3) / 12) + (20 * 0.75) / ((L * B ** 3) / 12), 1e-12, "qmax");
  // บนเส้น kern: |ex|/L + |ey|/B = 1/6
  const ex = L / 12, ey = B / 12;
  const edge = pressure2(P, P * ey, P * ex, L, B);
  near(edge.qmin, 0, 1e-9, "qmin บนขอบ kern");
});

test("แรงดันนอก kern ทิศเดียว ≈ สามเหลี่ยม 2P/[3B(L/2 − e)] และสมดุลแรง", () => {
  const P = 400, L = 2, B = 1.5, e = 0.5;
  const pr = pressure2(P, 0, P * e, L, B);
  assert.ok(pr.ok);
  near(pr.qmax, (2 * P) / (3 * B * (L / 2 - e)), 0.02, "qmax");
  near(pr.contact, (3 * (L / 2 - e)) / L, 0.03, "สัดส่วนสัมผัส");
});

test("แรงดันนอก kern สองทิศ: ลู่เข้าและสมดุลทั้ง P, Mx, My", () => {
  const P = 500, L = 2.4, B = 2.0, Mx = 120, My = 160;
  const pr = pressure2(P, Mx, My, L, B);
  assert.ok(pr.ok && pr.contact < 1);
  // ตรวจสมดุลด้วยกริดละเอียดอิสระ
  const n = 240, dx = L / n, dy = B / n;
  let F = 0, Sx = 0, Sy = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -L / 2 + (i + 0.5) * dx, y = -B / 2 + (j + 0.5) * dy, q = pr.q(x, y);
    F += q * dx * dy; Sx += q * x * dx * dy; Sy -= q * y * dx * dy;
  }
  near(F, P, 0.01, "ΣqdA"); near(Sx, My, 0.02, "ΣqxdA"); near(Sy, Mx, 0.02, "−ΣqydA");
});

test("ฐานแผ่ 3D โมเมนต์ทิศเดียว = ฐานแผ่ 2D (ขนาด ความหนา เหล็ก)", () => {
  for (const i2 of [base2(), base2({ service: [{ name: "D+L", P: 500, M: 0, H: 0, wind: false }], strength: [{ name: "U1", Pu: 750, Mu: 0, Hu: 0 }] })]) {
    const r2 = designFooting(i2), r3 = designFooting3(to3(i2));
    near(r3.L, r2.L, 1e-9, "L"); near(r3.B, r2.B, 1e-9, "B"); near(r3.t, r2.t, 1e-9, "t");
    near(r3.service[0].qmax, r2.service[0].qmax, 1e-6, "qmax");
    assert.equal(r3.barsX, r2.barsX); assert.equal(r3.barsY, r2.barsY);
    assert.equal(r3.ok, r2.ok);
  }
});

test("ฐานแผ่สองทิศใหญ่กว่าทิศเดียว และกรณีแรงแนวดิ่งสัมผัสดินเต็ม", () => {
  const one = designFooting3(to3(base2()));
  const two = designFooting3({ ...to3(base2()), service: [{ name: "D+L", P: 500, Mx: 80, My: -80, Hx: 10, Hy: 10 }], strength: [{ name: "U1", P: 750, Mx: 120, My: -120, Hx: 15, Hy: 15 }] });
  assert.ok(two.B > one.B);
  assert.ok(two.service.every((s) => s.contact >= 1 - 1e-9));
  assert.ok(two.ok, two.message);
});

test("ฐานเข็ม 3D ทิศเดียว = ฐานเข็ม 2D; แรงเข็มสองทิศตามสูตร", () => {
  const set = { ...defaultFoundation, type: "pile" as const };
  const i2 = base2({ settings: set, service: [{ name: "D+L", P: 600, M: 0, H: 0, wind: false }], strength: [{ name: "U1", Pu: 900, Mu: 0, Hu: 0 }] });
  const r2 = designFooting(i2), r3 = designFooting3(to3(i2));
  assert.equal(r3.piles?.coords.length, r2.piles?.coords.length);
  near(r3.t, r2.t, 1e-9, "t");
  const lay = pileLayout(2, 2, 0.66, 0.25);
  const pf = pileForces3(400, 50, 80, lay)!;
  near(pf.reduce((a, b) => a + b, 0), 400, 1e-12, "ΣP");
  near(Math.max(...pf), 100 + (80 * 0.33) / (4 * 0.33 ** 2) + (50 * 0.33) / (4 * 0.33 ** 2), 1e-12, "Pmax");
});

test("ฐานเข็ม: โมเมนต์รอบแกน X อย่างเดียว → เลือกวางเข็มตามแกน Y (1×2) ไม่ใช่ 2×1", () => {
  const r = designFooting3({
    code: "EIT", cx: 0.3, cy: 0.3, fcKsc: 240, fyKsc: 4000, settings: { ...defaultFoundation, type: "pile" },
    service: [{ name: "S", P: 350, Mx: 60, My: 0, Hx: 0, Hy: 0 }], strength: [{ name: "U", P: 500, Mx: 90, My: 0, Hx: 0, Hy: 0 }],
  });
  assert.equal(r.piles?.nx, 1); assert.equal(r.piles?.ny, 2);
  assert.ok(r.service.every((s) => s.qmin >= 0));
  assert.ok(r.ok, r.message);
});

test("ฐานรากทั้งอาคารตัวอย่าง 3D: ทุกจุดรองรับมีฐาน, ΣP แรงใช้งาน = แรงแนวดิ่งรวม, ผ่านทั้งหมด", async () => {
  const { defaultGrid, generateBuilding } = await import("../src/app3d/generator.ts");
  const { runAll3 } = await import("../src/core3d/combos3d.ts");
  const { designFoundations3 } = await import("../src/design/foundation3d.ts");
  const { model } = generateBuilding(defaultGrid);
  const run = runAll3(model);
  const res = designFoundations3(model, run, { ...defaultFoundation }, "EIT");
  assert.equal(Object.keys(res.footings).length, model.supports.length);
  const s1 = res.service[0].r;
  const sumP = model.supports.reduce((a, s) => a + s1.reactions[s.node].fz, 0);
  near(sumP, -s1.appliedTotal.fz, 1e-9, "ΣP");
  assert.equal(res.service.length, 1 + 2 * 2, "D+L และ ±WX, ±WY");
  for (const [id, f] of Object.entries(res.footings)) assert.ok(f.ok, `${id}: ${f.message}`);
});

test("ฐานแผ่: แรงถอน/แรงลัพธ์นอกฐานรายงานชัดเจน และคานคอดินตัดโมเมนต์", async () => {
  const { designFooting3 } = await import("../src/design/footing3d.ts");
  const { defaultFoundation } = await import("../src/design/footing.ts");
  const base = { code: "EIT" as const, cx: 0.4, cy: 0.4, fcKsc: 240, fyKsc: 4000, settings: { ...defaultFoundation, qaTon: 15 } };
  const service = [{ name: "D+L", P: 600, Mx: 0, My: 0, Hx: 0, Hy: 0 }];
  const r = designFooting3({ ...base, service, strength: [{ name: "U1", P: 850, Mx: 0, My: 0, Hx: 0, Hy: 0 }, { name: "0.9D+E", P: 40, Mx: 0, My: 400, Hx: 0, Hy: 0 }] });
  assert.equal(r.ok, false);
  assert.match(r.message, /แรงลัพธ์นอกฐาน.*0\.9D\+E/);
  const up = designFooting3({ ...base, service, strength: [{ name: "U1", P: 850, Mx: 0, My: 0, Hx: 0, Hy: 0 }, { name: "0.9D-E", P: -30, Mx: 0, My: 0, Hx: 0, Hy: 0 }] });
  assert.match(up.message, /แรงถอน/);
  const tie = designFooting3({ ...base, settings: { ...base.settings, tieBeams: true }, service, strength: [{ name: "U1", P: 850, Mx: 0, My: 0, Hx: 0, Hy: 0 }, { name: "0.9D+E", P: 40, Mx: 0, My: 400, Hx: 0, Hy: 0 }] });
  assert.equal(tie.ok, true);
});
