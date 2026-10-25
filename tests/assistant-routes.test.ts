import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ask: vi.fn(), account: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/assistant/service", () => ({ askAssistant: m.ask }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.account }));
import { POST } from "../src/app/api/assistant/route";
const request = (
  body: unknown,
  origin: string | null = "http://localhost:3000",
  type = "application/json",
) =>
  new Request("http://localhost:3000/api/assistant", {
    method: "POST",
    headers: { "content-type": type, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.ask.mockResolvedValue({ mode: "demo", reply: "Catalog matches" });
});
describe("assistant guest API boundary", () => {
  it("allows a same-origin guest without account reads and never caches", async () => {
    const response = await POST(request({ message: " comedy " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "demo", reply: "Catalog matches" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.ask).toHaveBeenCalledExactlyOnceWith({ message: "comedy" });
    expect(m.account).not.toHaveBeenCalled();
  });
  it("denies missing/foreign origins before interpretation", async () => {
    for (const origin of [null, "https://foreign.example"])
      expect((await POST(request({ message: "comedy" }, origin))).status).toBe(403);
    expect(m.ask).not.toHaveBeenCalled();
  });
  it("rejects malformed, unknown, wrong-MIME and streamed oversized bodies", async () => {
    for (const body of [
      { message: "" },
      { message: "x".repeat(501) },
      { message: "comedy", userId: "other" },
      { message: "comedy", context: { genres: ["fake"] } },
      { message: "under 0 seconds" },
      { message: "over 3 minutes under 2 minutes" },
    ])
      expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request({ message: "ok" }, undefined, "text/plain"))).status).toBe(400);
    const bad = new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: "{",
    });
    expect((await POST(bad)).status).toBe(400);
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096));
      },
      cancel() {
        canceled = true;
      },
    });
    const huge = new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(huge)).status).toBe(400);
    expect(canceled).toBe(true);
    expect(m.ask).not.toHaveBeenCalled();
  });
  it("reports catalog failures as unavailable without leaking internal details", async () => {
    m.ask.mockRejectedValueOnce(new Error("network private provider detail"));
    const response = await POST(request({ message: "comedy" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Catalog unavailable. Try again later." });
  });
});
