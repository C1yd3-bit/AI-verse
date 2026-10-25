import "server-only";
import { timingSafeEqual } from "node:crypto";

export function isWorker(request: Request) {
  const expected = process.env.AIVERSE_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !supplied || supplied.length > 256) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
