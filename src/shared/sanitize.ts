// ทำความสะอาดข้อมูลจากภายนอก (ไฟล์โปรเจกต์, ลิงก์แชร์, localStorage) ก่อนใช้งาน
//   - ค่าที่ค่าตั้งต้นเป็นตัวเลข → ต้องเป็นตัวเลขจำกัด ไม่งั้นใช้ค่าตั้งต้น (กันสตริงแปลก ๆ ไปอยู่ใน value="..." ของ HTML)
//   - ข้อความทุกช่อง → ตัดอักขระ < > " ` ออก (กัน XSS แม้จุดใดลืม escape) · ค่าที่ไม่ใช่ข้อความในช่องข้อความ → ค่าตั้งต้น
//   - บูลีน/อาร์เรย์/อ็อบเจ็กต์ตามชนิดของค่าตั้งต้น · คีย์ที่ไม่มีในค่าตั้งต้นทำความสะอาดแบบทั่วไป

const cleanStr = (s: string) => s.replace(/[<>"`]/g, "");

/** ทำความสะอาดค่าที่ไม่รู้โครงสร้าง (เช่น รายการในอาร์เรย์) */
export function sanitizeAny(v: unknown, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") return cleanStr(v);
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 10000).map((x) => sanitizeAny(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { if (k === "__proto__" || k === "constructor" || k === "prototype") continue; const c = sanitizeAny(x, depth + 1); if (c !== undefined) o[cleanStr(k)] = c; }
    return o;
  }
  return undefined;
}

/** ทำความสะอาด val ตามชนิดของ tpl (ค่าตั้งต้น) — คืนค่าชนิดเดียวกับ tpl เสมอ */
export function sanitizeLike<T>(tpl: T, val: unknown, depth = 0): T {
  if (val === undefined || val === null) return tpl;
  if (typeof tpl === "number") { const n = typeof val === "number" ? val : typeof val === "string" && val.trim() !== "" ? Number(val) : NaN; return (Number.isFinite(n) ? n : tpl) as T; }
  if (typeof tpl === "string") return (typeof val === "string" ? cleanStr(val) : typeof val === "number" && Number.isFinite(val) ? String(val) : tpl) as T;
  if (typeof tpl === "boolean") return (typeof val === "boolean" ? val : tpl) as T;
  if (Array.isArray(tpl)) return (Array.isArray(val) ? sanitizeAny(val, depth) : tpl) as T;
  if (tpl && typeof tpl === "object") {
    if (typeof val !== "object" || Array.isArray(val) || depth > 12) return tpl;
    const out: Record<string, unknown> = { ...(tpl as Record<string, unknown>) };
    for (const [k, x] of Object.entries(val as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      const t = (tpl as Record<string, unknown>)[k];
      const c = t !== undefined ? sanitizeLike(t, x, depth + 1) : sanitizeAny(x, depth + 1);
      if (c !== undefined) out[cleanStr(k)] = c;
    }
    return out as T;
  }
  return tpl;
}

/** ค่าต้องอยู่ในรายการ ไม่งั้นใช้ค่าตั้งต้น */
export const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
