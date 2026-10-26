import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "a6000000-0000-4000-8000-000000000001";
const other = "a6000000-0000-4000-8000-000000000002";
const unverified = "a6000000-0000-4000-8000-000000000003";
const admin = "a6000000-0000-4000-8000-000000000004";
const moderator = "a6000000-0000-4000-8000-000000000005";
const metadata = {
  title: "Synthetic direct upload",
  description: "In-memory verification fixture only",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own the rights to this synthetic test fixture.",
};
let db: PGlite;
let image: string;
async function role<T>(name: string, id: string | null, run: () => Promise<T>) {
  await db.exec(`set role ${name};set request.jwt.claim.sub='${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  return (
    await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
      args,
    )
  ).rows[0].result;
}
const draft = (actor = owner, videoId: string | null = null, patch: object = {}) =>
  role("authenticated", actor, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      videoId,
      JSON.stringify({ ...metadata, ...patch }),
    ]),
  );
const reserve = (version: string, actor = owner, key = randomUUID()) =>
  role("authenticated", actor, () =>
    rpc<{ reservation_id: string; max_duration_seconds: number; provider_uid: null }>(
      "reserve_video_upload",
      [version, key],
    ),
  );
const suspend = (enabled = true) =>
  role("authenticated", admin, () =>
    rpc("set_creator_suspension", [owner, enabled, "Synthetic account suspension decision"]),
  );
const grant = (reservation: string) =>
  role("service_role", null, () => rpc<{ lease: boolean }>("begin_upload_grant", [reservation]));
const bind = (reservation: string, uid: string) =>
  role("service_role", null, () =>
    rpc<{ usable: boolean }>("bind_video_provider", [reservation, uid]),
  );

describe("verified viewer direct upload SQL boundaries", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${other}',now()),('${unverified}',null),('${admin}',now()),('${moderator}',now());insert into public.user_roles values('${admin}','admin'),('${moderator}','moderator');`,
    );
    image =
      "data:image/webp;base64," +
      (
        await sharp({ create: { width: 160, height: 90, channels: 3, background: "purple" } })
          .webp()
          .toBuffer()
      ).toString("base64");
  }, 30000);
  beforeEach(async () => {
    await db.exec(
      "truncate public.videos,public.creator_suspensions,public.quota_overrides,public.media_audit restart identity cascade;",
    );
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [owner]);
  });
  afterAll(async () => {
    await db?.close();
  });
  it("makes verified unsuspended viewers eligible without applications or creator/privileged roles", async () => {
    expect(await role("authenticated", owner, () => rpc("can_upload_media"))).toBe(true);
    expect(await role("authenticated", owner, () => rpc("is_creator"))).toBe(false);
    expect(await role("authenticated", unverified, () => rpc("can_upload_media"))).toBe(false);
    await expect(role("anon", null, () => rpc("can_upload_media"))).rejects.toMatchObject({
      code: "42501",
    });
    expect(
      (await db.query("select role from public.user_roles where user_id=$1", [owner])).rows,
    ).toEqual([{ role: "viewer" }]);
    expect((await db.query("select * from public.creator_applications")).rows).toEqual([]);
  });
  it("creates owned immutable drafts/revisions and normalized private artwork without approval", async () => {
    const first = await draft();
    expect(
      await role("authenticated", owner, () => rpc("can_edit_version_artwork", [first.version_id])),
    ).toBe(true);
    await role("service_role", null, () =>
      rpc("set_version_artwork", [owner, first.version_id, image]),
    );
    expect(
      await role("authenticated", owner, () => rpc("get_version_artwork", [first.version_id])),
    ).toBe(image);
    await expect(
      role("service_role", null, () =>
        rpc("set_version_artwork", [other, first.version_id, image]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await role("authenticated", other, () => rpc("can_edit_version_artwork", [first.version_id])),
    ).toBe(false);
    await expect(draft(other, first.video_id)).rejects.toMatchObject({ code: "42501" });
    const next = await draft(owner, first.video_id, { title: "Revised direct upload" });
    expect(next.video_id).toBe(first.video_id);
    expect(next.version_id).not.toBe(first.version_id);
    expect(
      await role("authenticated", owner, () => rpc("can_edit_version_artwork", [first.version_id])),
    ).toBe(false);
    await expect(reserve(first.version_id)).rejects.toMatchObject({ code: "22023" });
    await reserve(next.version_id);
    expect(
      await role("authenticated", owner, () => rpc("can_edit_version_artwork", [next.version_id])),
    ).toBe(false);
    await expect(
      role("service_role", null, () => rpc("set_version_artwork", [owner, next.version_id, image])),
    ).rejects.toMatchObject({ code: "22023" });
  });
  it("denies guest/unverified/suspended and cross-owner draft/reservation/artwork access", async () => {
    const own = await draft();
    await expect(
      role("anon", null, () => rpc("create_video_version", [null, JSON.stringify(metadata)])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(draft(unverified)).rejects.toMatchObject({ code: "42501" });
    await expect(reserve(own.version_id, unverified)).rejects.toMatchObject({ code: "42501" });
    await expect(reserve(own.version_id, other)).rejects.toMatchObject({ code: "42501" });
    await suspend();
    expect(await role("authenticated", owner, () => rpc("can_upload_media"))).toBe(false);
    await expect(draft()).rejects.toMatchObject({ code: "42501" });
    await expect(reserve(own.version_id)).rejects.toMatchObject({ code: "42501" });
    expect(
      await role("authenticated", owner, () => rpc("can_edit_version_artwork", [own.version_id])),
    ).toBe(false);
    await expect(
      role("service_role", null, () => rpc("set_version_artwork", [owner, own.version_id, image])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("service_role", null, () =>
        rpc("set_version_artwork", [unverified, own.version_id, image]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await suspend(false);
    expect(await role("authenticated", owner, () => rpc("can_upload_media"))).toBe(true);
  });
  it("preserves strict rights/metadata ownership and human review instead of self-publication", async () => {
    for (const patch of [
      { rights_attested: false },
      { ai_disclosed: false },
      { owner_id: other },
      { state: "published" },
      { format: "podcast" },
    ])
      await expect(draft(owner, null, patch)).rejects.toMatchObject({ code: "22023" });
    const film = await draft();
    const reservation = await reserve(film.version_id);
    expect(reservation.provider_uid).toBeNull();
    expect((await grant(reservation.reservation_id)).lease).toBe(true);
    expect((await bind(reservation.reservation_id, "direct-viewer-provider")).usable).toBe(true);
    const claimed = await role("service_role", null, () =>
      rpc<{ provider_uid: string }[]>("claim_media_processing", [10]),
    );
    expect(claimed.map((item) => item.provider_uid)).toEqual(["direct-viewer-provider"]);
    expect(
      await role("service_role", null, () =>
        rpc("reconcile_video_provider", [
          "direct-viewer-ready",
          "direct-viewer-provider",
          "ready",
          90,
          null,
        ]),
      ),
    ).toEqual({ state: "pending_review" });
    expect(
      (await role("anon", null, () => db.query("select id from public.public_catalog"))).rows,
    ).toEqual([]);
    await expect(
      role("authenticated", owner, () =>
        rpc("review_video_version", [film.version_id, true, "Self-publish attempt"]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("authenticated", owner, () =>
        db.query("update public.videos set state='published' where id=$1", [film.video_id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await role("authenticated", moderator, () =>
      rpc("review_video_version", [film.version_id, true, "Reviewed synthetic fixture"]),
    );
    expect(
      (await role("anon", null, () => db.query("select id from public.public_catalog"))).rows,
    ).toEqual([{ id: film.video_id }]);
    expect(
      (await db.query("select role from public.user_roles where user_id=$1", [owner])).rows,
    ).toEqual([{ role: "viewer" }]);
    expect((await db.query("select * from public.creator_applications")).rows).toEqual([]);
  });
  it("preserves Reel/Movie caps, reservation idempotency and three-upload default allowance", async () => {
    const film = await draft(owner, null, { format: "movie" });
    const movieHold = await reserve(film.version_id);
    expect(movieHold.max_duration_seconds).toBe(1200);
    for (let i = 0; i < 2; i++)
      expect((await reserve((await draft()).version_id)).max_duration_seconds).toBe(180);
    await expect(reserve((await draft()).version_id)).rejects.toMatchObject({ code: "22023" });
    const otherFilm = await draft(other);
    const key = randomUUID();
    const held = await reserve(otherFilm.version_id, other, key);
    expect(await reserve(otherFilm.version_id, other, key)).toEqual(held);
    await expect(reserve(film.version_id, other, key)).rejects.toMatchObject({ code: "22023" });
  });
  it("keeps quota overrides and suspensions admin-only, self-denied, validated and audited for viewer targets", async () => {
    for (const actor of [owner, moderator]) {
      await expect(
        role("authenticated", actor, () =>
          rpc("set_creator_suspension", [other, true, "Forbidden moderation attempt"]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        role("authenticated", actor, () =>
          rpc("set_quota_override", [
            other,
            3,
            180,
            new Date(Date.now() + 86400000).toISOString(),
            "Forbidden override attempt",
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      role("authenticated", admin, () =>
        rpc("set_creator_suspension", [admin, true, "Self suspension forbidden"]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("authenticated", admin, () =>
        rpc("set_quota_override", [
          admin,
          3,
          180,
          new Date(Date.now() + 86400000).toISOString(),
          "Self override forbidden",
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("authenticated", admin, () =>
        rpc("set_quota_override", [
          owner,
          0,
          180,
          new Date(Date.now() + 86400000).toISOString(),
          "Invalid daily allowance",
        ]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await role("authenticated", admin, () =>
      rpc("set_quota_override", [
        owner,
        3,
        180,
        new Date(Date.now() + 86400000).toISOString(),
        "Bounded synthetic quota test",
      ]),
    );
    expect((await reserve((await draft()).version_id)).max_duration_seconds).toBe(180);
    await expect(reserve((await draft()).version_id)).rejects.toMatchObject({ code: "22023" });
    await suspend();
    expect(
      (
        await db.query<{ action: string }>(
          "select action from public.media_audit order by created_at,id",
        )
      ).rows.map((row) => row.action),
    ).toEqual(["quota_override", "creator_suspended"]);
    await role("authenticated", admin, () =>
      rpc("set_quota_override", [owner, null, null, null, "Clear synthetic override"]),
    );
    const limits = await role("service_role", null, () =>
      rpc<{ daily_uploads: number; monthly_seconds: number }>("get_upload_limits", [owner]),
    );
    expect(limits.daily_uploads).toBe(3);
    expect(limits.monthly_seconds).toBe(1800);
  });
  it("rechecks suspension between reservation, grant, binding and processing claim", async () => {
    const first = await reserve((await draft()).version_id);
    const second = await reserve((await draft()).version_id);
    const third = await reserve((await draft()).version_id);
    expect((await grant(second.reservation_id)).lease).toBe(true);
    expect((await grant(third.reservation_id)).lease).toBe(true);
    expect((await bind(third.reservation_id, "processing-before-suspension")).usable).toBe(true);
    await suspend();
    expect((await grant(first.reservation_id)).lease).toBe(false);
    expect((await bind(second.reservation_id, "bound-after-suspension")).usable).toBe(false);
    expect(await role("service_role", null, () => rpc("claim_media_processing", [10]))).toEqual([]);
  });
  it("rechecks owner verification in service-context gates without granting raw provider authority", async () => {
    const first = await reserve((await draft()).version_id);
    const second = await reserve((await draft()).version_id);
    const third = await reserve((await draft()).version_id);
    await grant(second.reservation_id);
    await grant(third.reservation_id);
    await bind(third.reservation_id, "processing-before-unverification");
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [owner]);
    expect((await grant(first.reservation_id)).lease).toBe(false);
    expect((await bind(second.reservation_id, "bound-after-unverification")).usable).toBe(false);
    expect(await role("service_role", null, () => rpc("claim_media_processing", [10]))).toEqual([]);
    for (const actor of [owner, moderator]) {
      await expect(
        role("authenticated", actor, () => rpc("begin_upload_grant", [first.reservation_id])),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        role("authenticated", actor, () =>
          rpc("bind_video_provider", [first.reservation_id, "forbidden-provider"]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        role("authenticated", actor, () => rpc("claim_media_processing", [10])),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        role("authenticated", actor, () =>
          rpc("set_version_artwork", [owner, randomUUID(), image]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
