import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const alice = "10000000-0000-0000-0000-000000000001";
const bob = "10000000-0000-0000-0000-000000000002";
const admin = "10000000-0000-0000-0000-000000000003";
const moderator = "10000000-0000-0000-0000-000000000004";
let db: PGlite;
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}

describe("foundation SQL privileges and RLS (PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/202610240001_foundation.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(`insert into auth.users(id,raw_user_meta_data) values
      ('${alice}','{"role":"admin"}'),('${bob}','{}'),('${admin}','{}'),('${moderator}','{}');
      insert into public.user_roles(user_id,role) values('${admin}','admin'),('${moderator}','moderator');`);
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it("ignores signup metadata role claims and hides other accounts", async () => {
    await asUser(alice, async () => {
      const profiles = await db.query("select id from public.profiles");
      expect(profiles.rows).toEqual([{ id: alice }]);
      const roles = await db.query("select role from public.user_roles");
      expect(roles.rows).toEqual([{ role: "viewer" }]);
      await expect(
        db.exec(`insert into public.user_roles values('${alice}','admin')`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.exec(`update public.profiles set id='${bob}' where id='${alice}'`),
      ).rejects.toThrow(/permission denied/);
      await db.exec("update public.profiles set display_name = 'Alice'");
    });
  });

  it("requires admin decisions and records role grants", async () => {
    for (const actor of [alice, moderator]) {
      await asUser(actor, async () => {
        await expect(
          db.exec(`select public.set_user_role('${bob}','creator',true,'Approved application')`),
        ).rejects.toThrow(/Administrator required/);
      });
    }
    await asUser(admin, async () => {
      await expect(
        db.exec(`select public.set_user_role('${admin}','creator',true,'Self grant denied')`),
      ).rejects.toThrow(/Self role changes denied/);
      await db.exec(`select public.set_user_role('${bob}','creator',true,'Approved application')`);
      expect((await db.query("select target_id,role from public.role_audit")).rows).toEqual([
        { target_id: bob, role: "creator" },
      ]);
    });
    await asUser(alice, async () => {
      expect((await db.query("select * from public.role_audit")).rows).toEqual([]);
    });
  });

  it("writes only authenticated owner preferences and atomically validates taxonomy", async () => {
    await asUser(alice, async () => {
      await db.exec(
        "select public.save_viewer_preferences('completed',array['fantasy','sci-fi','comedy','horror','animals'],array['korean'])",
      );
      await expect(
        db.exec(
          "select public.save_viewer_preferences('completed',array['fantasy'],array[]::text[])",
        ),
      ).rejects.toThrow(/Choose 5 to 8/);
      await expect(
        db.exec(
          "select public.save_viewer_preferences('completed',array['fantasy','fantasy','comedy','horror','animals'],array[]::text[])",
        ),
      ).rejects.toThrow(/Duplicate/);
      await expect(
        db.exec(
          "select public.save_viewer_preferences('completed',array['bogus','sci-fi','comedy','horror','animals'],array[]::text[])",
        ),
      ).rejects.toThrow(/Unknown/);
      await expect(
        db.exec(
          "select public.save_viewer_preferences('skipped',array['fantasy'],array[]::text[])",
        ),
      ).rejects.toThrow(/Skip requires empty/);
      await expect(
        db.exec(`insert into public.viewer_preferences(user_id,status) values('${bob}','skipped')`),
      ).rejects.toThrow(/permission denied/);
      expect(
        (await db.query("select user_id, status, genres from public.viewer_preferences")).rows,
      ).toEqual([
        {
          user_id: alice,
          status: "completed",
          genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
        },
      ]);
    });
    await asUser(bob, async () => {
      expect((await db.query("select * from public.viewer_preferences")).rows).toEqual([]);
      await expect(db.exec("delete from public.viewer_preferences")).rejects.toThrow(
        /permission denied/,
      );
    });
    await asUser(alice, async () => {
      await db.exec(
        "select public.save_viewer_preferences('skipped',array[]::text[],array[]::text[])",
      );
      expect(
        (await db.query("select status,genres,regions from public.viewer_preferences")).rows,
      ).toEqual([{ status: "skipped", genres: [], regions: [] }]);
    });
  });

  it("allows anonymous taxonomy reads but no account access or mutation", async () => {
    await db.exec("set role anon");
    try {
      expect((await db.query("select * from public.genres")).rows).toHaveLength(12);
      await expect(db.exec("select * from public.viewer_preferences")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.exec("delete from public.genres")).rejects.toThrow(/permission denied/);
      await expect(
        db.exec("select public.save_viewer_preferences('skipped',array[]::text[],array[]::text[])"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
