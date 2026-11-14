// แชร์โปรเจกต์ด้วยลิงก์: JSON → deflate-raw (CompressionStream) → base64url ใน hash "#p=…"
//   ไม่ต้องมีเซิร์ฟเวอร์ — ข้อมูลอยู่ในลิงก์ทั้งหมด (hash ไม่ถูกส่งไปที่เซิร์ฟเวอร์)

const PREFIX = "p=";

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** เข้ารหัสข้อมูลเป็นส่วน hash (ไม่รวม "#") */
export async function encodeShare(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return PREFIX + toB64url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

/** ถอดรหัส hash (มีหรือไม่มี "#" ก็ได้) — คืน null ถ้าไม่ใช่ลิงก์แชร์ */
export async function decodeShare(hash: string): Promise<unknown | null> {
  const h = hash.replace(/^#/, "");
  if (!h.startsWith(PREFIX)) return null;
  const bytes = await pipe(fromB64url(h.slice(PREFIX.length)), new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(bytes));
}
