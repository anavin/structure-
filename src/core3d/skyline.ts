// ตัวแก้สมการแบบ skyline (profile) LDLᵀ สำหรับเมทริกซ์สมมาตรบวกแน่นอน (ตามแนวทาง COLSOL, Bathe)
// เก็บเฉพาะสามเหลี่ยมบนตามคอลัมน์ ตั้งแต่แถวแรกที่ไม่เป็นศูนย์ (first[j]) ถึงแนวทแยง
// ใช้ร่วมกับการเรียงลำดับจุดต่อแบบ Reverse Cuthill–McKee เพื่อลดความกว้างแถบ

export class SkylineMatrix {
  readonly n: number;
  readonly first: Int32Array; // แถวแรกของแต่ละคอลัมน์
  readonly start: Int32Array; // ตำแหน่งเริ่มของคอลัมน์ในอาร์เรย์ a
  readonly a: Float64Array;

  constructor(first: Int32Array) {
    this.n = first.length;
    this.first = first;
    this.start = new Int32Array(this.n + 1);
    for (let j = 0; j < this.n; j++) this.start[j + 1] = this.start[j] + (j - first[j] + 1);
    this.a = new Float64Array(this.start[this.n]);
  }

  get size() { return this.a.length; }

  /** เพิ่มค่าที่ (i, j) — ใช้ได้ทั้ง i ≤ j หรือ i > j (สมมาตร) */
  add(i: number, j: number, v: number) {
    if (i > j) { const t = i; i = j; j = t; }
    const k = this.start[j] + (i - this.first[j]);
    if (i < this.first[j]) throw new Error(`skyline: (${i},${j}) อยู่นอกโปรไฟล์`);
    this.a[k] += v;
  }

  get(i: number, j: number): number {
    if (i > j) { const t = i; i = j; j = t; }
    if (i < this.first[j]) return 0;
    return this.a[this.start[j] + (i - this.first[j])];
  }

  diag(j: number) { return this.a[this.start[j + 1] - 1]; }
}

export class SkylineSingularError extends Error {
  readonly eq: number;
  constructor(eq: number) {
    super(`เมทริกซ์เอกฐานที่สมการ ${eq}`);
    this.eq = eq;
  }
}

/** แยกตัวประกอบ LDLᵀ ในที่ (in-place): หลังเรียก a เก็บ L (นอกแนวทแยง) และ D (แนวทแยง) */
export function factorize(K: SkylineMatrix, relTol = 1e-10) {
  const { n, first, start, a } = K;
  const orig = new Float64Array(n);
  for (let j = 0; j < n; j++) orig[j] = K.diag(j);
  for (let j = 0; j < n; j++) {
    const mj = first[j];
    const sj = start[j];
    // g_ij = a_ij − Σ l_ki g_kj
    for (let i = mj + 1; i < j; i++) {
      const mi = first[i];
      const m = Math.max(mi, mj);
      const si = start[i];
      let s = 0;
      for (let k = m; k < i; k++) s += a[si + (k - mi)] * a[sj + (k - mj)];
      a[sj + (i - mj)] -= s;
    }
    // l_ij = g_ij / d_i ; d_j −= l_ij g_ij
    let dj = a[sj + (j - mj)];
    for (let i = mj; i < j; i++) {
      const g = a[sj + (i - mj)];
      const l = g / a[start[i + 1] - 1];
      a[sj + (i - mj)] = l;
      dj -= l * g;
    }
    if (!(dj > relTol * Math.abs(orig[j])) || !(dj > 0)) throw new SkylineSingularError(j);
    a[sj + (j - mj)] = dj;
  }
}

/** แก้ระบบหลังแยกตัวประกอบ: คืนค่า x (เขียนทับ b) */
export function solveFactored(K: SkylineMatrix, b: Float64Array): Float64Array {
  const { n, first, start, a } = K;
  // L y = b
  for (let j = 0; j < n; j++) {
    const mj = first[j], sj = start[j];
    let s = b[j];
    for (let k = mj; k < j; k++) s -= a[sj + (k - mj)] * b[k];
    b[j] = s;
  }
  // D z = y
  for (let j = 0; j < n; j++) b[j] /= a[start[j + 1] - 1];
  // Lᵀ x = z
  for (let j = n - 1; j >= 0; j--) {
    const mj = first[j], sj = start[j];
    const xj = b[j];
    for (let k = mj; k < j; k++) b[k] -= a[sj + (k - mj)] * xj;
  }
  return b;
}

/** เรียงลำดับจุดต่อแบบ Reverse Cuthill–McKee จากรายการคู่ที่เชื่อมกัน */
export function reverseCuthillMcKee(nNodes: number, edges: [number, number][]): number[] {
  const adj: number[][] = Array.from({ length: nNodes }, () => []);
  for (const [a, b] of edges) { if (a !== b) { adj[a].push(b); adj[b].push(a); } }
  for (const l of adj) l.sort((x, y) => adj[x].length - adj[y].length);
  const visited = new Uint8Array(nNodes);
  const order: number[] = [];
  const byDeg = [...Array(nNodes).keys()].sort((x, y) => adj[x].length - adj[y].length);
  for (const s of byDeg) {
    if (visited[s]) continue;
    visited[s] = 1;
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      order.push(v);
      for (const u of adj[v]) if (!visited[u]) { visited[u] = 1; queue.push(u); }
    }
  }
  return order.reverse();
}
