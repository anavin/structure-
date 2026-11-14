// ระบบหน่วยที่แสดงผล: kN–m (SI) หรือ ตัน–m (tf) — การคำนวณภายในเป็น kN, m เสมอ
// แปลงข้อความ/ตารางที่สร้างเป็น kN ให้เป็นตันหลังวาด (DOM) เพื่อไม่ต้องแก้ทุกจุดที่สร้างข้อความ

export type UnitSys = "kN" | "tf";
const G = 9.80665;
let sys: UnitSys = "kN";

export const units = {
  get sys() { return sys; },
  set(s: UnitSys) { sys = s; },
  /** แรง kN → หน่วยที่เลือก */
  F: (v: number) => (sys === "tf" ? v / G : v),
  label: { F: () => (sys === "tf" ? "tf" : "kN"), M: () => (sys === "tf" ? "tf·m" : "kN·m"), Q: () => (sys === "tf" ? "t/m²" : "kN/m²"), W: () => (sys === "tf" ? "tf/m" : "kN/m") },
};

const UNIT_MAP: Record<string, string> = { "kN·m": "tf·m", "kN/m²": "t/m²", "kN/m": "tf/m", "kN/ต้น": "tf/ต้น", "kN": "tf" };
const UNIT_RE = "kN·m|kN/m²|kN/m|kN/ต้น|kN";
const NUM = "-?\\d[\\d,]*(?:\\.\\d+)?";
// ตัวเลข (ต่อด้วย / ตัวเลข ได้หลายตัว) ตามด้วยหน่วย เช่น "21.84 / -35.78 kN·m"
const CHAIN = new RegExp(`(${NUM}(?:\\s*/\\s*${NUM})*)(\\s*)(${UNIT_RE})(?![A-Za-z])`, "g");
const PURE = new RegExp(`^\\s*${NUM}\\s*$`);

function conv(numStr: string): string {
  const v = parseFloat(numStr.replace(/,/g, ""));
  const dp = (numStr.split(".")[1] ?? "").length;
  const out = v / G;
  const s = out.toFixed(dp);
  return numStr.includes(",") ? Number(s).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : s;
}

export function convertText(t: string): string {
  return t.replace(CHAIN, (_m, chain: string, sp: string, u: string) => chain.replace(new RegExp(NUM, "g"), (n) => conv(n)) + sp + UNIT_MAP[u]);
}

/** แปลงทั้งต้นไม้ DOM เป็นหน่วยตัน (ถ้าเลือกตัน): คอลัมน์ตารางที่หัวคอลัมน์มีหน่วย + ข้อความ "ตัวเลข หน่วย" */
export function convertDom(root: Element) {
  if (sys !== "tf") return;
  // 1) ตาราง: หัวคอลัมน์ที่มีหน่วย → แปลงเซลล์ที่เป็นตัวเลขล้วน
  for (const table of root.querySelectorAll("table")) {
    const head = table.querySelector("thead tr");
    if (!head) continue;
    const cols: number[] = [];
    [...head.children].forEach((th, i) => {
      if (new RegExp(`\\((${UNIT_RE})\\)|^(${UNIT_RE})$|\\b(${UNIT_RE})\\b`).test(th.textContent ?? "") && !/kg\/m²/.test(th.textContent ?? "")) {
        cols.push(i);
        th.textContent = (th.textContent ?? "").replace(new RegExp(UNIT_RE, "g"), (u) => UNIT_MAP[u]);
      }
    });
    if (!cols.length) continue;
    for (const tr of table.querySelectorAll("tbody tr")) {
      // ตำแหน่งคอลัมน์จริงโดยคิด colspan
      let col = 0;
      for (const td of [...tr.children] as HTMLTableCellElement[]) {
        const span = td.colSpan || 1;
        if (span === 1 && cols.includes(col) && PURE.test(td.textContent ?? "") && td.children.length <= 1) {
          const target = td.querySelector("b") ?? td;
          target.textContent = conv((target.textContent ?? "").trim());
        }
        col += span;
      }
    }
  }
  // 2) ข้อความทั่วไป
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    if (!n.data.includes("kN")) continue;
    n.data = convertText(n.data);
  }
}
