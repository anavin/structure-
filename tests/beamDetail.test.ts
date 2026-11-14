import { test } from "node:test";
import assert from "node:assert/strict";
import { designRcBeam } from "../src/design/rcBeam.ts";
import { detailBeam, detailBarLength, phiMnBars } from "../src/design/beamDetail.ts";

// คานยาว 6 m เสา 0.4 m: โมเมนต์ลบที่ปลาย 120, บวกกลางช่วง 80 kN·m (พาราโบลา)
const L = 6;
const x = Array.from({ length: 21 }, (_, k) => (k * L) / 20);
const M = x.map((xx) => -120 + (200 * 4 * xx * (L - xx)) / (L * L));
const env = { x, mPos: M.map((m) => Math.max(0, m)), mNeg: M.map((m) => Math.max(0, -m)) };
const r = designRcBeam({ code: "EIT", b: 300, h: 600, cover: 40, fcKsc: 280, fyKsc: 4000, fytKsc: 2400, stirrupDia: 9, stirrupLegs: 2, MuPos: 80, MuNeg: 120, Vu: 100 });

test("จุดตัดเหล็ก: เหล็กต่อเนื่องตลอด เหล็กเสริมบนยื่น ≥ Ln/3 และครอบคลุมจุดที่โมเมนต์เกินกำลังเหล็กต่อเนื่อง", () => {
  const dt = detailBeam(r, env, L, 0.4, 0.4);
  assert.equal(dt.ln, 5.6);
  const cont = dt.top.find((b) => b.from === 0 && b.to === L)!;
  assert.equal(cont.n, 2);
  const extraI = dt.top.find((b) => b.from === 0 && b.to < L);
  if (r.top.bars!.n > 2) {
    assert.ok(extraI);
    assert.ok(extraI!.to >= 0.2 + 5.6 / 3 - 1e-9);
    const cap = phiMnBars(2, r.top.bars!.dia, r, r.top.d);
    const lastOver = Math.max(...x.filter((xx, k) => xx <= 3 && env.mNeg[k] > cap));
    assert.ok(extraI!.to >= lastOver);
  }
  // เหล็กล่างต่อเนื่องเข้าฐานรองรับ
  assert.ok(dt.bottom.some((b) => b.from === 0 && b.to === L && b.n >= 2));
  // ความยาวเหล็กรวม < ความยาวเต็มทุกเส้น
  const total = detailBarLength(dt).reduce((a, b) => a + b.m, 0);
  const full = (r.top.bars!.n + r.bottom.bars!.n) * L;
  assert.ok(total < full + 1);
});

import { ldHook, ldStraight } from "../src/design/development.ts";

test("ระยะฝัง: เหล็กเสริมบนยาว ≥ ld จากผิวเสา, ปลายริมตรวจงอฝังในเสา", () => {
  const dt = detailBeam(r, env, L, 0.4, 0.4, { contI: false, contJ: true });
  assert.ok(dt.dev);
  const fc = 280 * 0.0980665, fy = 4000 * 0.0980665;
  assert.ok(dt.dev!.ldTop >= ldStraight({ db: r.top.bars!.dia, fc, fy, top: true }));
  assert.ok(dt.dev!.lapTop >= 1.3 * ldStraight({ db: r.top.bars!.dia, fc, fy, top: true }));
  assert.equal(dt.dev!.hooks.length, 1);
  const h = dt.dev!.hooks[0];
  assert.equal(h.end, "i");
  assert.equal(h.avail, 400 - 50);
  assert.ok(h.need >= ldHook({ db: r.top.bars!.dia, fc, fy }));
  for (const b of dt.top.filter((x) => !(x.from === 0 && x.to === L))) {
    const len = b.from === 0 ? b.to - 0.2 : L - 0.2 - b.from;
    assert.ok(len * 1000 >= dt.dev!.ldTop - 1e-6, `เหล็กเสริมบนยาว ${len} m`);
  }
  // เสาเล็กเกินไปสำหรับงอฝัง
  const small = detailBeam(r, env, L, 0.15, 0.4, { contI: false, contJ: false });
  assert.ok(small.dev!.hooks.some((x) => !x.ok));
});
