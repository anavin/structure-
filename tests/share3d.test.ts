import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeShare, decodeShare } from "../src/app3d/share.ts";
import { defaultGrid } from "../src/app3d/generator.ts";

test("ลิงก์แชร์: เข้ารหัส–ถอดรหัสได้ข้อมูลเดิม และสั้นกว่า JSON", async () => {
  const data = { app: "structlab-3d", version: 1, params: { ...defaultGrid, name: "อาคารทดสอบ ก" } };
  const h = await encodeShare(data);
  assert.match(h, /^p=[A-Za-z0-9_-]+$/);
  assert.ok(h.length < JSON.stringify(data).length, `${h.length} vs ${JSON.stringify(data).length}`);
  assert.deepEqual(await decodeShare("#" + h), data);
  assert.equal(await decodeShare("#other"), null);
});
