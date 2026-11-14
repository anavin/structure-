import { test } from "node:test";
import assert from "node:assert/strict";
import { beamSectionSvg, columnSectionSvg, scheduleHtml } from "../src/ui/sectionSvg.ts";
import { barPositions } from "../src/design/rcColumnBiaxial.ts";

const count = (svg: string, cls: string) => (svg.match(new RegExp(`class="${cls}"`, "g")) ?? []).length;

test("ภาพตัดคาน: จำนวนวงกลมเหล็ก = บน + ล่าง, มีป้ายเหล็กและเส้นบอกขนาด", () => {
  const svg = beamSectionSvg({ b: 250, h: 500, cover: 40, tieDia: 9, top: { n: 3, dia: 16 }, bottom: { n: 2, dia: 20 }, tieLabel: "RB9@0.20" });
  assert.equal(count(svg, "sx-bar"), 5);
  assert.ok(svg.includes("3-DB16") && svg.includes("2-DB20") && svg.includes("RB9@0.20"));
  assert.ok(svg.includes(">250<") && svg.includes(">500<"));
});

test("ภาพตัดเสา: วงกลมเหล็กตรงกับตำแหน่งเหล็กของหน้าตัดสองแกน", () => {
  const s = { code: "EIT" as const, b: 400, h: 400, cover: 40, tieDia: 9, fcKsc: 280, fyKsc: 4000 };
  const lay = { dia: 16, n2: 3, n3: 3 };
  const bars = barPositions(s, lay);
  const svg = columnSectionSvg({ b: 400, h: 400, cover: 40, tieDia: 9, bars, dia: 16, tieLabel: "RB9@0.25" });
  assert.equal(count(svg, "sx-bar"), 8);
  assert.ok(svg.includes("8-DB16"));
});

test("ตารางหน้าตัด: รวมชิ้นที่ key เดียวกัน เรียงตามจำนวน", () => {
  const html = scheduleHtml("B", [
    { id: "B1", key: "a", svg: (t) => `<svg>${t}</svg>` }, { id: "B2", key: "b", svg: (t) => `<svg>${t}</svg>` }, { id: "B3", key: "b", svg: (t) => `<svg>${t}</svg>` },
  ], (s) => s);
  assert.ok(html.indexOf("B-1 (2 ตัว)") < html.indexOf("B-2 (1 ตัว)"));
  assert.ok(html.includes("B2, B3"));
});
