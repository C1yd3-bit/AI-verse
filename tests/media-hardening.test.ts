import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { versionInput } from "../src/features/media/schema";

const owner = "50000000-0000-0000-0000-000000000001";
const admin = "50000000-0000-0000-0000-000000000002";
const moderator = "50000000-0000-0000-0000-000000000003";
const application = {
  display_name: "A test creator",
  handle: "test-creator",
  bio: "A local test biography",
  portfolio_url: "https://example.com/portfolio",
  rights_attested: true,
};
const metadata = {
  title: "A tested film",
  description: "Test-only metadata",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: ["test-film"],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own all rights to this test fixture.",
};
let db: PGlite;
async function asRole<T>(name: string, id: string | null, run: () => Promise<T>) {
  await db.exec(`set role ${name};set request.jwt.claim.sub='${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ result: T }>(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
    args,
  );
  return rows[0].result;
}
async function draft(videoId: string | null = null) {
  return asRole("authenticated", owner, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      videoId,
      JSON.stringify(metadata),
    ]),
  );
}
async function leased() {
  const video = await draft();
  const reservation = await asRole("authenticated", owner, () =>
    rpc<{ reservation_id: string }>("reserve_video_upload", [
      video.version_id,
      "hardening-operation-001",
    ]),
  );
  expect(
    await asRole("service_role", null, () =>
      rpc("begin_upload_grant", [reservation.reservation_id]),
    ),
  ).toMatchObject({ lease: true });
  return { ...video, ...reservation };
}

describe("direct RPC validation and provider-grant hardening", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const name of [
      "202610240001_foundation.sql",
      "202610240002_media.sql",
      "202610240003_trust.sql",
      "202610240004_discovery.sql",
      "202610240005_hardening.sql",
    ]) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id) values('${owner}'),('${admin}'),('${moderator}');insert into public.user_roles values('${owner}','creator'),('${admin}','admin'),('${moderator}','moderator');`,
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("rejects direct application type poisoning, missing/extra fields, blanks and invalid bounds", async () => {
    const invalid: unknown[] = [
      null,
      [],
      { ...application, rights_attested: "true" },
      { ...application, role: "admin" },
      { ...application, display_name: "\t\n\u00a0" },
      { ...application, bio: " " },
      { ...application, display_name: "x".repeat(81) },
      { ...application, display_name: "🎬".repeat(41) },
      { ...application, bio: "x".repeat(2001) },
      { ...application, portfolio_url: "https://example.com/" + "x".repeat(2000) },
      { ...application, portfolio_url: "https://" },
      { ...application, portfolio_url: "http://example.com" },
      { ...application, handle: "bad handle" },
    ];
    for (const field of ["display_name", "handle", "bio", "portfolio_url"]) {
      for (const value of [{ nested: "poison" }, ["poison"], true, 42, null])
        invalid.push({ ...application, [field]: value });
      const missing: Record<string, unknown> = { ...application };
      delete missing[field];
      invalid.push(missing);
    }
    await asRole("authenticated", owner, async () => {
      for (const value of invalid)
        await expect(
          rpc("submit_creator_application", [JSON.stringify(value)]),
        ).rejects.toMatchObject({ code: "22023" });
      await rpc("submit_creator_application", [
        JSON.stringify({
          ...application,
          display_name: " \tTest creator\u00a0",
          bio: "\nA clean biography\n",
        }),
      ]);
    });
    const rows = (
      await db.query<{ application: typeof application }>(
        "select application from public.creator_applications",
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].application).toMatchObject({
      display_name: "Test creator",
      bio: "A clean biography",
    });
    for (const field of ["display_name", "handle", "bio", "portfolio_url"] as const)
      expect(typeof rows[0].application[field]).toBe("string");
  });

  it("keeps every stored metadata version compatible with the API/UI validator", async () => {
    const invalid: unknown[] = [
      null,
      [],
      { ...metadata, title: "\t\n\u00a0" },
      { ...metadata, description: " " },
      { ...metadata, description: "x".repeat(3001) },
      { ...metadata, title: "🎬".repeat(81) },
      { ...metadata, description: "🎬".repeat(1501) },
      { ...metadata, rights_declaration: "🎬".repeat(501) },
      { ...metadata, rights_declaration: "short" },
      { ...metadata, rights_declaration: "x".repeat(1001) },
      { ...metadata, regions: [] },
      { ...metadata, genres: [] },
      { ...metadata, languages: [] },
      { ...metadata, regions: ["unknown"] },
      { ...metadata, genres: ["fantasy", "fantasy"] },
      { ...metadata, tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
      { ...metadata, tags: ["bad tag"] },
      { ...metadata, ai_disclosed: "true" },
      { ...metadata, status: "published" },
      { ...metadata, description: "\u0001".repeat(3000) },
    ];
    for (const field of Object.keys(metadata)) {
      const missing: Record<string, unknown> = { ...metadata };
      delete missing[field];
      invalid.push(missing);
      if (["title", "description", "format", "rights_declaration"].includes(field))
        invalid.push({ ...metadata, [field]: { poison: true } });
    }
    await asRole("authenticated", owner, async () => {
      for (const value of invalid)
        await expect(
          rpc("create_video_version", [null, JSON.stringify(value)]),
        ).rejects.toMatchObject({ code: "22023" });
    });
    await draft();
    const rows = (
      await db.query<{ metadata: unknown }>("select metadata from public.video_versions")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(versionInput.safeParse({ videoId: null, metadata: rows[0].metadata }).success).toBe(
      true,
    );
  });

  it.each(["hide", "suspend", "revise", "revoke", "expire", "cancel"])(
    "denies provider binding after %s during external creation and queues the asset",
    async (change) => {
      const grant = await leased();
      if (change === "hide")
        await asRole("authenticated", moderator, () =>
          rpc("moderate_video", [grant.video_id, "hide", "Rights review during provider call"]),
        );
      if (change === "suspend")
        await asRole("authenticated", admin, () =>
          rpc("set_creator_suspension", [owner, true, "Creator suspended during provider call"]),
        );
      if (change === "revise") await draft(grant.video_id);
      if (change === "revoke")
        await asRole("authenticated", admin, () =>
          rpc("set_user_role", [owner, "creator", false, "Creator revoked during provider call"]),
        );
      if (change === "expire")
        await db.query(
          "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
          [grant.reservation_id],
        );
      if (change === "cancel")
        await asRole("service_role", null, () =>
          rpc("mark_upload_grant_failure", [grant.reservation_id, true, "Known provider failure"]),
        );
      await asRole("service_role", null, async () => {
        expect(await rpc("bind_video_provider", [grant.reservation_id, "test-provider"])).toEqual({
          usable: false,
        });
        expect(await rpc("bind_video_provider", [grant.reservation_id, "test-provider"])).toEqual({
          usable: false,
        });
        expect(
          await rpc("reconcile_video_provider", ["late-ready", "test-provider", "ready", 90, null]),
        ).toMatchObject({ ignored: true });
        expect(
          await rpc("playback_entitlement", [grant.video_id, owner, grant.version_id]),
        ).toBeNull();
      });
      expect((await db.query("select state from public.upload_reservations")).rows).toEqual([
        { state: "expired" },
      ]);
      expect((await db.query("select * from public.private_media_assets")).rows).toHaveLength(1);
      expect((await db.query("select * from public.media_deletion_jobs")).rows).toHaveLength(1);
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0);
    },
  );

  it("preserves an approved consumed asset when an idempotent bind occurs after a revision", async () => {
    const grant = await leased();
    await asRole("service_role", null, async () => {
      expect(await rpc("bind_video_provider", [grant.reservation_id, "approved-provider"])).toEqual(
        { usable: true },
      );
      expect(await rpc("bind_video_provider", [grant.reservation_id, "approved-provider"])).toEqual(
        { usable: true },
      );
      await rpc("reconcile_video_provider", ["ready", "approved-provider", "ready", 90, null]);
    });
    await asRole("authenticated", moderator, () =>
      rpc("review_video_version", [grant.version_id, true, "Reviewed exact current version"]),
    );
    await draft(grant.video_id);
    await asRole("service_role", null, async () => {
      expect(await rpc("bind_video_provider", [grant.reservation_id, "approved-provider"])).toEqual(
        { usable: false },
      );
    });
    expect((await db.query("select version_id from public.public_catalog")).rows).toEqual([
      { version_id: grant.version_id },
    ]);
    expect((await db.query("select * from public.media_deletion_jobs")).rows).toHaveLength(0);
  });

  it("retains service-only binding and target-profile locking for role changes", async () => {
    expect(
      (
        await db.query(
          "select has_function_privilege('anon','public.bind_video_provider(uuid,text)','execute') as anon,has_function_privilege('authenticated','public.bind_video_provider(uuid,text)','execute') as authenticated,has_function_privilege('service_role','public.bind_video_provider(uuid,text)','execute') as service",
        )
      ).rows,
    ).toEqual([{ anon: false, authenticated: false, service: true }]);
    const definition = (
      await db.query<{ definition: string }>(
        "select pg_get_functiondef('public.set_user_role(uuid,text,boolean,text)'::regprocedure) as definition",
      )
    ).rows[0].definition;
    expect(definition).toMatch(/profiles where id=target_user_id for update/);
  });
});
