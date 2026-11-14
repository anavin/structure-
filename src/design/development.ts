// ระยะฝังและระยะทาบเหล็กข้ออ้อย (ACI 318-19 บทที่ 25) — หน่วย mm, MPa
//   ld (ตรง, §25.4.2.3 แบบง่าย กรณีระยะห่าง/ระยะหุ้ม ≥ db และมีเหล็กปลอก):
//      db ≤ 19 mm: ld = fy·ψt·ψe / (2.1λ√fc') · db   ·   db ≥ 22 mm: ld = fy·ψt·ψe / (1.7λ√fc') · db   ≥ 300 mm
//      ψt = 1.3 สำหรับเหล็กบน (มีคอนกรีตใต้เหล็ก > 300 mm), ψe = 1.0 (ไม่เคลือบ), λ = 1.0
//   ldh (งอ 90°, §25.4.3.1): (fy·ψe·ψr·ψo·ψc / (23λ√fc')) · db^1.5 ≥ max(8db, 150)
//      ψr = 1.0 (มีเหล็กปลอกในจุดต่อ), ψo = 1.0 (ฝังในแกนเสา), ψc = fc'/105 + 0.6 (fc' < 40 MPa)
//   ทาบรับแรงดึง Class B (§25.5.2): 1.3·ld ≥ 300 mm
//   ทาบรับแรงอัด (§25.5.5.1): fy ≤ 420 MPa → 0.071·fy·db ≥ 300 mm; fy > 420 → (0.13fy − 24)·db
//   เหล็กกลมผิวเรียบ (RB) ไม่ใช้สูตรนี้ (ต้องงอขอทุกปลาย)

export interface DevInput { db: number; fc: number; fy: number; top?: boolean }

export function ldStraight(d: DevInput): number {
  const psiT = d.top ? 1.3 : 1.0;
  const k = d.db <= 19 ? 2.1 : 1.7;
  return Math.max((d.fy * psiT) / (k * Math.sqrt(d.fc)) * d.db, 300);
}

export function ldHook(d: DevInput): number {
  const psiC = d.fc < 40 ? d.fc / 105 + 0.6 : 1.0;
  return Math.max(((d.fy * psiC) / (23 * Math.sqrt(d.fc))) * d.db ** 1.5, 8 * d.db, 150);
}

export const lapTension = (d: DevInput) => Math.max(1.3 * ldStraight(d), 300);

export function lapCompression(d: DevInput): number {
  const l = d.fy <= 420 ? 0.071 * d.fy * d.db : (0.13 * d.fy - 24) * d.db;
  return Math.max(l, 300);
}

/** ปัดขึ้นทีละ 50 mm (ระยะใช้งานจริงในแบบ) */
export const roundUp50 = (mm: number) => Math.ceil(mm / 50 - 1e-9) * 50;
