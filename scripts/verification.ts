// สร้าง VERIFICATION.md จากชุดตรวจความถูกต้อง: node scripts/verification.ts
import { writeFileSync } from "node:fs";
import { relErr, runBenchmarks } from "../src/verify/benchmarks.ts";

const rows = runBenchmarks();
const fmt = (v: number) => (Math.abs(v) >= 1e-3 || v === 0 ? v.toFixed(4) : v.toExponential(4));
const lines = [
  "# การตรวจความถูกต้องของ StructLab (Verification)",
  "",
  "เทียบผลโปรแกรมกับผลเฉลยปิดของปัญหามาตรฐาน — สร้างอัตโนมัติด้วย `node scripts/verification.ts` และตรวจซ้ำทุกครั้งในชุดทดสอบ (`tests/verification.test.ts`)",
  "",
  "หน้าตัดทดสอบ 300 × 500 mm, E = 25,000 MPa, ν = 0.2 · ทุกค่ามาจากการวิเคราะห์จริงของโปรแกรม (ไม่ปรับแต่ง)",
  "",
  "| กลุ่ม | รายการ | สูตร | ทฤษฎี | โปรแกรม | หน่วย | คลาดเคลื่อน | เกณฑ์ | ผล |",
  "|---|---|---|---:|---:|---|---:|---:|:---:|",
  ...rows.map((r) => `| ${r.group} | ${r.name} | ${r.formula} | ${fmt(r.theory)} | ${fmt(r.program)} | ${r.unit} | ${(relErr(r) * 100).toFixed(3)}% | ${r.tol < 1e-4 ? "≈ 0 (ตัวเลข)" : `${(r.tol * 100).toFixed(1)}%`} | ${relErr(r) <= r.tol ? "✅" : "❌"} |`),
  "",
  "หมายเหตุ",
  "- โครงข้อแข็ง: สูตร Hh³/24EI สมมติคานแข็งอนันต์ โปรแกรมใช้คานแข็งมาก (2 × 6 m) จึงต่างเล็กน้อยตามจริง",
  "- คาบธรรมชาติ: สูตร k = 4·12EI/h³ สมมติคานแข็งอนันต์และเสายึดแน่นสองปลาย",
  "- P-Δ: เสายื่น 8 ชิ้นย่อย เทียบผลเฉลยแม่นตรงของคานยื่นรับแรงอัดและแรงด้านข้างที่ปลาย",
  "- ยังไม่รวมการเทียบกับโปรแกรมเชิงพาณิชย์ (SAP2000/ETABS) — แนะนำให้ผู้ใช้ทดสอบโมเดลของตนเพิ่มเติม",
  "",
];
writeFileSync(new URL("../VERIFICATION.md", import.meta.url), lines.join("\n"));
console.log(`เขียน VERIFICATION.md (${rows.length} รายการ, ผ่าน ${rows.filter((r) => relErr(r) <= r.tol).length})`);
