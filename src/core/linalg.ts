// พีชคณิตเชิงเส้นสำหรับเมทริกซ์สมมาตรบวกแน่นอน (Cholesky แบบ dense)
// เพียงพอสำหรับโมเดล 2D ขนาดเล็กถึงกลาง (หลักร้อย DOF); รุ่นถัดไปเปลี่ยนเป็น skyline/sparse + WASM

export class SingularMatrixError extends Error {
  readonly dof: number;
  constructor(dof: number) {
    super(`เมทริกซ์ความแข็งเป็นเอกฐาน (singular) ที่ DOF ${dof} — โครงสร้างไม่มีเสถียรภาพหรือการยึดรั้งไม่พอ`);
    this.dof = dof;
  }
}

/** แก้ K x = f โดย K สมมาตรบวกแน่นอน (row-major, n×n). คืนค่า x */
export function choleskySolve(K: Float64Array, f: Float64Array, n: number): Float64Array {
  const L = new Float64Array(K); // แยกส่วนแบบ in-place ในสำเนา
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, Math.abs(K[i * n + i]));
  const tol = maxDiag * 1e-12;

  for (let j = 0; j < n; j++) {
    let sum = L[j * n + j];
    for (let k = 0; k < j; k++) sum -= L[j * n + k] ** 2;
    if (!(sum > tol)) throw new SingularMatrixError(j);
    const ljj = Math.sqrt(sum);
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = L[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = s / ljj;
    }
  }
  // forward: L y = f
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = f[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  // backward: Lᵀ x = y
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}
