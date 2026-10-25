import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { discoveryQuerySchema } from "../src/features/discovery/query";

const alice = "20000000-0000-0000-0000-000000000001";
const bob = "20000000-0000-0000-0000-000000000002";
const admin = "20000000-0000-0000-0000-000000000003";
const moderator = "20000000-0000-0000-0000-000000000004";
const viewer = "20000000-0000-0000-0000-000000000005";
let db: PGlite;
let video: { id: string; version: string };
let privateVideo: { id: string; version: string };
const metadata = {
  title: "A reviewed film",
  description: "SQL integration fixture",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: ["test-film"],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "Licensed test media only",
};
async function role<T>(name: string, id: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${name}; set request.jwt.claim.sub='${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  const parameters = args.map((_, index) => `$${index + 1}`).join(",");
  const { rows } = await db.query<{ result: T }>(
    `select public.${name}(${parameters}) as result`,
    args,
  );
  return rows[0].result;
}
const user = <T>(id: string, run: () => Promise<T>) => role("authenticated", id, run);
async function seedVideo(owner: string, published = true) {
  const id = randomUUID();
  const version = randomUUID();
  const reservation = randomUUID();
  await db.query(
    "insert into public.videos(id,owner_id,state,published_at) values($1,$2,$3,now())",
    [id, owner, published ? "published" : "draft"],
  );
  await db.query(
    "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,1,$3,$4,90)",
    [version, id, JSON.stringify(metadata), published ? "published" : "draft"],
  );
  await db.query("insert into public.video_languages values($1,'english')", [version]);
  await db.query("update public.videos set latest_version_id=$2,active_version_id=$3 where id=$1", [
    id,
    version,
    published ? version : null,
  ]);
  if (published) {
    await db.query(
      "insert into public.upload_reservations(id,owner_id,version_id,idempotency_key,state,consumed_seconds) values($1,$2,$3,$4,'consumed',90)",
      [reservation, owner, version, randomUUID()],
    );
    await db.query(
      "insert into public.private_media_assets(reservation_id,provider_uid,state) values($1,$2,'ready')",
      [reservation, randomUUID().replaceAll("-", "")],
    );
  }
  return { id, version };
}

describe("trust, engagement and operations SQL contracts (PostgreSQL/PGlite)", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const file of [
      "202610240001_foundation.sql",
      "202610240002_media.sql",
      "202610240003_trust.sql",
    ]) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
      );
      if (file.startsWith("202610240001"))
        await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    }
    await db.exec(`insert into auth.users(id) values('${alice}'),('${bob}'),('${admin}'),('${moderator}'),('${viewer}');
      insert into public.user_roles values('${alice}','creator'),('${bob}','creator'),('${admin}','admin'),('${moderator}','moderator');`);
    video = await seedVideo(alice);
    privateVideo = await seedVideo(bob, false);
  }, 30000);
  afterEach(async () => db?.close());

  it("canonicalizes saved Fusion queries, round-trips TypeScript shape and enforces owner CRUD", async () => {
    const query = {
      keywords: ["Cat", "cat", "고양이", "Ｃａｔ"],
      genres: ["romance", "comedy", "romance"],
      regions: ["global", "korean"],
      formats: ["reel"],
      languages: ["english"],
      maxDurationSeconds: 120,
    };
    const id = await user(viewer, () =>
      rpc<string>("save_fusion", [null, "  My mix  ", JSON.stringify(query)]),
    );
    await user(viewer, async () => {
      const { rows } = await db.query<{ query: unknown; name: string }>(
        "select query,name from public.saved_fusions",
      );
      const expected = discoveryQuerySchema.parse(query);
      expect(rows).toEqual([{ name: "My mix", query: expected }]);
      expect(
        await rpc("save_fusion", [id, "Updated", JSON.stringify({ genres: ["nature"] })]),
      ).toBe(id);
      await expect(db.exec("update public.saved_fusions set owner_id=null")).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(bob, async () => {
      expect((await db.query("select * from public.saved_fusions")).rows).toEqual([]);
      await expect(rpc("save_fusion", [id, "Stolen", "{}"])).rejects.toThrow(/Own saved filter/);
      await expect(rpc("delete_saved_fusion", [id])).rejects.toThrow(/Own saved filter/);
    });
    await user(viewer, () => rpc("delete_saved_fusion", [id]));
    expect((await db.query("select * from public.saved_fusions")).rows).toEqual([]);
  });

  it("rejects malformed saved filters and caps each owner at twenty rows", async () => {
    await user(viewer, async () => {
      for (const invalid of [
        { status: "published" },
        { genres: ["invented"] },
        { formats: ["clip"] },
        { languages: ["xx"] },
        { minDurationSeconds: 100, maxDurationSeconds: 99 },
        { maxDurationSeconds: 1.5 },
        { keywords: [null] },
        { keywords: ["x".repeat(81)] },
        { hashtags: ["bad/tag"] },
      ]) {
        await expect(
          rpc("save_fusion", [null, "My mix", JSON.stringify(invalid)]),
        ).rejects.toThrow();
      }
      for (let index = 0; index < 20; index++)
        await rpc("save_fusion", [null, `Mix ${index}`, "{}"]);
      await expect(rpc("save_fusion", [null, "Overflow", "{}"])).rejects.toThrow(/limit reached/);
    });
    const definition = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.save_fusion(uuid,text,jsonb)'::regprocedure) as definition",
    );
    expect(definition.rows[0].definition).toMatch(/profiles where id=auth.uid\(\) for update/);
  });

  it("makes likes/negative signals idempotent and private, validates published targets", async () => {
    await user(viewer, async () => {
      for (const signal of ["like", "not_interested"]) {
        await rpc("set_video_signal", [video.id, signal, true]);
        await rpc("set_video_signal", [video.id, signal, true]);
      }
      expect((await db.query("select * from public.video_signals")).rows).toHaveLength(2);
      await expect(rpc("set_video_signal", [privateVideo.id, "like", true])).rejects.toThrow(
        /Published video/,
      );
      await expect(rpc("set_video_signal", [video.id, "owner", true])).rejects.toThrow(
        /Invalid signal/,
      );
      await expect(
        db.exec("insert into public.video_signals values(null,null,'like')"),
      ).rejects.toThrow(/permission denied/);
    });
    await user(bob, async () => {
      expect((await db.query("select * from public.video_signals")).rows).toHaveLength(0);
      await rpc("set_video_signal", [video.id, "like", false]);
    });
    await user(viewer, async () => {
      expect((await db.query("select * from public.video_signals")).rows).toHaveLength(2);
      await rpc("set_video_signal", [video.id, "like", false]);
      expect((await db.query("select signal from public.video_signals")).rows).toEqual([
        { signal: "not_interested" },
      ]);
    });
  });

  it("follows published creators idempotently without exposing other viewers", async () => {
    await user(viewer, async () => {
      await rpc("set_creator_follow", [alice, true]);
      await rpc("set_creator_follow", [alice, true]);
      expect((await db.query("select * from public.creator_follows")).rows).toHaveLength(1);
      await expect(rpc("set_creator_follow", [bob, true])).rejects.toThrow(/Published creator/);
      await expect(rpc("set_creator_follow", [viewer, true])).rejects.toThrow(/Invalid follow/);
      await expect(db.exec("delete from public.creator_follows")).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(bob, async () => {
      expect((await db.query("select * from public.creator_follows")).rows).toHaveLength(0);
      await rpc("set_creator_follow", [alice, false]);
    });
    await user(viewer, () => rpc("set_creator_follow", [alice, false]));
    expect((await db.query("select * from public.creator_follows")).rows).toHaveLength(0);
  });

  it("rejects autoplay claims and inflated duration, bounds and deduplicates completion credit", async () => {
    await user(viewer, async () => {
      await expect(
        rpc("record_watch_completion", [video.id, randomUUID(), 90, false]),
      ).rejects.toThrow(/Explicit playback/);
      await expect(
        rpc("record_watch_completion", [video.id, randomUUID(), 91, true]),
      ).rejects.toThrow(/Invalid watch duration/);
      await expect(
        rpc("record_watch_completion", [privateVideo.id, randomUUID(), 90, true]),
      ).rejects.toThrow(/Published video/);
      const session = randomUUID();
      await rpc("record_watch_completion", [video.id, session, 90, true]);
      await rpc("record_watch_completion", [video.id, session, 90, true]);
      await expect(
        rpc("record_watch_completion", [privateVideo.id, session, 90, true]),
      ).rejects.toThrow(/belongs to another video/);
      for (let index = 0; index < 29; index++)
        await rpc("record_watch_completion", [video.id, randomUUID(), 90, true]);
      await expect(
        rpc("record_watch_completion", [video.id, randomUUID(), 90, true]),
      ).rejects.toThrow(/Watch event limit/);
      const events = await db.query<{ credited: boolean }>(
        "select credited from public.watch_completions",
      );
      expect(events.rows).toHaveLength(30);
      expect(events.rows.filter((event) => event.credited)).toHaveLength(1);
    });
    await user(bob, async () =>
      expect((await db.query("select * from public.watch_completions")).rows).toHaveLength(0),
    );
  });

  it("locks reporter identities, enforces five reports/day, and keeps private details scoped", async () => {
    await user(viewer, async () => {
      for (let index = 0; index < 5; index++)
        await rpc("submit_video_report", [video.id, "rights", "Review this rights concern"]);
      await expect(
        rpc("submit_video_report", [video.id, "rights", "Sixth report blocked"]),
      ).rejects.toThrow(/Daily report limit/);
      await expect(db.exec("update public.video_reports set status='removed'")).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(bob, async () => {
      expect((await db.query("select * from public.video_reports")).rows).toHaveLength(0);
      await expect(
        rpc("submit_video_report", [privateVideo.id, "rights", "Private target denied"]),
      ).rejects.toThrow(/Published video/);
    });
    await user(moderator, async () =>
      expect((await db.query("select * from public.video_reports")).rows).toHaveLength(5),
    );
    const definition = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.submit_video_report(uuid,text,text)'::regprocedure) as definition",
    );
    expect(definition.rows[0].definition).toMatch(/profiles where id=auth.uid\(\) for update/);
  });

  it("requires moderators for audited report resolution and atomically hides content", async () => {
    const report = await user(viewer, () =>
      rpc<string>("submit_video_report", [video.id, "harmful", "Please inspect the content"]),
    );
    await user(bob, () =>
      expect(
        rpc("resolve_video_report", [report, "hide", "Confirmed policy concern"]),
      ).rejects.toThrow(/Moderator required/),
    );
    await user(moderator, () =>
      rpc("resolve_video_report", [report, "hide", "Confirmed policy concern"]),
    );
    await role("anon", null, async () =>
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0),
    );
    expect(
      (await db.query("select status from public.video_reports where id=$1", [report])).rows,
    ).toEqual([{ status: "hidden" }]);
    expect(
      (await db.query("select action from public.media_audit where subject_id=$1", [report])).rows,
    ).toEqual([{ action: "report_hide" }]);
    await user(moderator, () =>
      expect(
        rpc("resolve_video_report", [report, "dismiss", "Duplicate decision denied"]),
      ).rejects.toThrow(/Pending report/),
    );
  });

  it("suspends only by admin and denies catalog, private playback, drafts and uploads", async () => {
    const draft = await user(alice, () =>
      rpc<{ version_id: string }>("create_video_version", [null, JSON.stringify(metadata)]),
    );
    await user(moderator, () =>
      expect(
        rpc("set_creator_suspension", [alice, true, "Rights concern confirmed"]),
      ).rejects.toThrow(/Administrator required/),
    );
    await user(admin, () =>
      rpc("set_creator_suspension", [alice, true, "Rights concern confirmed"]),
    );
    await role("anon", null, async () => {
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0);
      expect(await rpc("creator_is_suspended", [alice])).toBe(true);
      await expect(db.exec("select reason from public.creator_suspensions")).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(alice, async () => {
      expect(await rpc("is_creator")).toBe(false);
      await expect(rpc("create_video_version", [null, JSON.stringify(metadata)])).rejects.toThrow(
        /Approved creator/,
      );
      await expect(rpc("reserve_video_upload", [draft.version_id, randomUUID()])).rejects.toThrow(
        /Approved creator/,
      );
      await expect(db.exec("update public.creator_suspensions set active=false")).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(viewer, () =>
      expect(rpc("set_creator_follow", [alice, true])).rejects.toThrow(/Published creator/),
    );
    await role("service_role", null, async () =>
      expect(await rpc("playback_entitlement", [video.id, moderator, null])).toBeNull(),
    );
    await user(bob, async () =>
      expect((await db.query("select * from public.creator_suspensions")).rows).toHaveLength(0),
    );
  });

  it("binds appeals to owned incidents and only administrators can approve reinstatement", async () => {
    await user(admin, () =>
      rpc("set_creator_suspension", [alice, true, "Initial rights restriction"]),
    );
    const incident = (await db.query<{ id: string }>("select id from public.creator_suspensions"))
      .rows[0].id;
    await user(bob, () =>
      expect(rpc("submit_appeal", [incident, "This is someone else's incident"])).rejects.toThrow(
        /Own active suspension/,
      ),
    );
    const appeal = await user(alice, () =>
      rpc<string>("submit_appeal", [incident, "I can provide the required license"]),
    );
    await user(alice, () =>
      expect(rpc("submit_appeal", [incident, "Duplicate pending appeal denied"])).rejects.toThrow(
        /unique constraint/,
      ),
    );
    await user(moderator, async () => {
      expect((await db.query("select * from public.creator_appeals")).rows).toHaveLength(0);
      await expect(
        rpc("resolve_appeal", [appeal, true, "Cannot reinstate creator"]),
      ).rejects.toThrow(/Administrator required/);
    });
    await user(admin, () => rpc("resolve_appeal", [appeal, true, "License verified in review"]));
    await user(alice, async () => expect(await rpc("is_creator")).toBe(true));
    await role("anon", null, async () =>
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(1),
    );
    expect(
      (await db.query("select action from public.media_audit where subject_id=$1", [appeal])).rows,
    ).toEqual([{ action: "appeal_approved" }]);
  });

  it("prevents an old appeal from lifting a newer suspension incident", async () => {
    await user(admin, () =>
      rpc("set_creator_suspension", [alice, true, "First suspension incident"]),
    );
    const incident = (await db.query<{ id: string }>("select id from public.creator_suspensions"))
      .rows[0].id;
    const appeal = await user(alice, () =>
      rpc("submit_appeal", [incident, "Please consider my original appeal"]),
    );
    await user(admin, async () => {
      await rpc("set_creator_suspension", [alice, false, "Manual resolution approved"]);
      await rpc("set_creator_suspension", [alice, true, "Independent new rights concern"]);
      await expect(
        rpc("resolve_appeal", [appeal, true, "Old decision cannot override new"]),
      ).rejects.toThrow(/no longer active/);
    });
    await user(alice, async () => expect(await rpc("is_creator")).toBe(false));
  });

  it("audits bounded expiring quota overrides, enforces effective reservation allowances", async () => {
    const expiry = new Date(Date.now() + 86400000).toISOString();
    await user(moderator, () =>
      expect(
        rpc("set_quota_override", [alice, 10, 3600, expiry, "Extra capacity granted"]),
      ).rejects.toThrow(/Administrator required/),
    );
    await user(admin, async () => {
      await expect(
        rpc("set_quota_override", [alice, 101, 3600, expiry, "Outside allowed bounds"]),
      ).rejects.toThrow(/Invalid quota override/);
      await rpc("set_quota_override", [alice, 1, 1800, expiry, "One upload per UTC day"]);
    });
    await user(alice, async () => {
      const created = await rpc<{ version_id: string }>("create_video_version", [
        null,
        JSON.stringify(metadata),
      ]);
      // The fixture's already-consumed upload counts against the same owner/day.
      await expect(rpc("reserve_video_upload", [created.version_id, randomUUID()])).rejects.toThrow(
        /quota exceeded/,
      );
      await expect(rpc("get_upload_limits", [bob])).rejects.toThrow(/permission denied/);
    });
    await user(admin, () =>
      rpc("set_quota_override", [alice, 10, 3600, expiry, "Test expanded allowance"]),
    );
    await user(alice, async () => {
      const created = await rpc<{ version_id: string }>("create_video_version", [
        null,
        JSON.stringify(metadata),
      ]);
      expect(await rpc("reserve_video_upload", [created.version_id, randomUUID()])).toHaveProperty(
        "reservation_id",
      );
    });
    await role("service_role", null, async () =>
      expect(await rpc("get_upload_limits", [alice])).toEqual({
        daily_uploads: 10,
        monthly_seconds: 3600,
        max_duration_seconds: 180,
      }),
    );
    await db.query(
      "update public.quota_overrides set expires_at=now()-interval '1 second' where creator_id=$1",
      [alice],
    );
    await role("service_role", null, async () =>
      expect(await rpc("get_upload_limits", [alice])).toEqual({
        daily_uploads: 3,
        monthly_seconds: 1800,
        max_duration_seconds: 180,
      }),
    );
    expect(
      (await db.query("select * from public.media_audit where action='quota_override'")).rows,
    ).toHaveLength(2);
  });

  it("exposes aggregate operational counts only to administrators and bounds service-only cleanup", async () => {
    await user(viewer, () => rpc("record_watch_completion", [video.id, randomUUID(), 90, true]));
    await db.exec("update public.watch_completions set created_at=now()-interval '31 days'");
    await user(bob, async () => {
      await expect(rpc("ops_summary")).rejects.toThrow(/Administrator required/);
      await expect(rpc("purge_operational_events", [new Date().toISOString()])).rejects.toThrow(
        /permission denied/,
      );
    });
    await user(admin, async () => {
      const summary = await rpc<Record<string, unknown>>("ops_summary");
      expect(summary.published_videos).toBe(1);
      expect(summary.stored_seconds).toBe(90);
      expect(Object.keys(summary).every((key) => !key.endsWith("_id"))).toBe(true);
    });
    await role("service_role", null, async () => {
      await expect(rpc("purge_operational_events", [new Date().toISOString()])).rejects.toThrow(
        /Retention cutoff/,
      );
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      expect(await rpc("purge_operational_events", [cutoff])).toEqual({
        watch_events: 1,
        terminal_provider_events: 0,
      });
    });
    expect((await db.query("select * from public.watch_completions")).rows).toHaveLength(0);
  });

  it("revokes all anonymous mutations and denies direct internal helper execution", async () => {
    await role("anon", null, async () => {
      for (const name of [
        "saved_fusions",
        "video_signals",
        "creator_follows",
        "watch_completions",
        "video_reports",
        "creator_appeals",
        "quota_overrides",
      ])
        await expect(db.exec(`select * from public.${name}`)).rejects.toThrow(/permission denied/);
      await expect(rpc("save_fusion", [null, "Anon", "{}"])).rejects.toThrow(/permission denied/);
      await expect(rpc("canonical_discovery_query", ["{}"])).rejects.toThrow(/permission denied/);
      await expect(
        rpc("submit_video_report", [video.id, "rights", "Anonymous report denied"]),
      ).rejects.toThrow(/permission denied/);
    });
    await user(viewer, () =>
      expect(rpc("canonical_discovery_query", ["{}"])).rejects.toThrow(/permission denied/),
    );
    const functions = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
      "select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('save_fusion','set_video_signal','submit_video_report','set_creator_suspension','purge_operational_events')",
    );
    expect(functions.rows).toHaveLength(5);
    for (const fn of functions.rows) {
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig.join(",")).toContain('search_path=""');
    }
  });
});
