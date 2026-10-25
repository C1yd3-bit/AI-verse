import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onboardingInputSchema } from "../src/features/auth/onboarding";

const owner = "90000000-0000-4000-8000-000000000001",
  unverified = "90000000-0000-4000-8000-000000000002",
  other = "90000000-0000-4000-8000-000000000003";
const preferences = {
  status: "completed",
  genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
  regions: ["korean"],
};
const payload = {
  fullName: "Private Test Name",
  age: 25,
  contactNumber: "+1 (555) 123-4567",
  preferences,
  ethnicity: "Optional private self-description",
  ethnicityConsent: true,
};
let db: PGlite;
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function save(value: unknown = payload) {
  return db.query("select public.complete_account_onboarding($1)", [JSON.stringify(value)]);
}

describe("private verified account onboarding transaction", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    for (const name of [
      "202610240001_foundation.sql",
      "202610240002_media.sql",
      "202610240003_trust.sql",
      "202610240004_discovery.sql",
      "202610240005_hardening.sql",
      "202610240006_creator_projection.sql",
      "202610240007_processing_queue.sql",
      "202610240008_playback_window.sql",
      "202610240009_account_onboarding.sql",
      "202610240010_account_information_bounds.sql",
    ]) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${unverified}',null),('${other}',now());insert into public.user_roles values('${owner}','creator'),('${other}','admin');update public.profiles set display_name='Public display choice' where id='${owner}';`,
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("atomically saves private information and interests for the verified owner only", async () => {
    await asUser(owner, async () => {
      await save();
      expect(
        (
          await db.query(
            "select full_name,age,contact_number,ethnicity,ethnicity_consent from public.account_details",
          )
        ).rows,
      ).toEqual([
        {
          full_name: payload.fullName,
          age: 25,
          contact_number: payload.contactNumber,
          ethnicity: payload.ethnicity,
          ethnicity_consent: true,
        },
      ]);
      expect(
        (await db.query("select status,genres,regions from public.viewer_preferences")).rows,
      ).toEqual([preferences]);
    });
    await asUser(other, async () => {
      expect((await db.query("select * from public.account_details")).rows).toEqual([]);
      await expect(
        db.exec("update public.account_details set full_name='Other user'"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    expect(
      (await db.query("select display_name from public.profiles where id=$1", [owner])).rows,
    ).toEqual([{ display_name: "Public display choice" }]);
  });
  it("rejects unverified JWT owners in SQL and rolls every field back on an invalid preference", async () => {
    await asUser(unverified, () => expect(save()).rejects.toMatchObject({ code: "42501" }));
    await asUser(owner, async () => {
      await save();
      await expect(
        save({
          ...payload,
          fullName: "Changed name",
          ethnicity: null,
          ethnicityConsent: false,
          preferences: {
            ...preferences,
            genres: ["invalid", "sci-fi", "comedy", "horror", "animals"],
          },
        }),
      ).rejects.toMatchObject({ code: "22023" });
      const row = (
        await db.query("select full_name,ethnicity,ethnicity_consent from public.account_details")
      ).rows[0];
      expect(row).toEqual({
        full_name: payload.fullName,
        ethnicity: payload.ethnicity,
        ethnicity_consent: true,
      });
      expect((await db.query("select genres from public.viewer_preferences")).rows[0]).toEqual({
        genres: preferences.genres,
      });
    });
  });
  it("allows optional contact/ethnicity skip and revokes consent by removing the saved description", async () => {
    await asUser(owner, async () => {
      await save();
      await save({
        ...payload,
        age: 120,
        contactNumber: null,
        ethnicity: null,
        ethnicityConsent: false,
        preferences: { status: "skipped", genres: [], regions: [] },
      });
      expect(
        (
          await db.query(
            "select contact_number,ethnicity,ethnicity_consent,ethnicity_consented_at from public.account_details",
          )
        ).rows,
      ).toEqual([
        {
          contact_number: null,
          ethnicity: null,
          ethnicity_consent: false,
          ethnicity_consented_at: null,
        },
      ]);
      expect(
        (await db.query("select status,genres,regions from public.viewer_preferences")).rows,
      ).toEqual([{ status: "skipped", genres: [], regions: [] }]);
    });
  });
  it("rejects malformed direct RPC data, consent bypass, implausible ages and ownership injection", async () => {
    const invalid = [
      { ...payload, age: 0 },
      { ...payload, age: 121 },
      { ...payload, age: 1.5 },
      { ...payload, age: "25" },
      { ...payload, fullName: { value: "name" } },
      { ...payload, fullName: "\t\u00a0" },
      { ...payload, fullName: "🎬".repeat(41) },
      { ...payload, contactNumber: 1234567 },
      { ...payload, contactNumber: "123456" },
      { ...payload, contactNumber: "9".repeat(16) },
      { ...payload, ethnicityConsent: false },
      { ...payload, ethnicity: null, ethnicityConsent: true },
      { ...payload, ethnicity: { poison: true } },
      { ...payload, ethnicity: "🎬".repeat(51) },
      { ...payload, user_id: other },
      { ...payload, preferences: { ...preferences, user_id: other } },
      { ...payload, preferences: { ...preferences, genres: [{ genre: "fantasy" }] } },
    ];
    await asUser(owner, async () => {
      for (const [index, value] of invalid.entries()) {
        expect(onboardingInputSchema.safeParse(value).success, `invalid input ${index}`).toBe(
          false,
        );
        await expect(save(value)).rejects.toMatchObject({ code: "22023" });
      }
      expect((await db.query("select * from public.account_details")).rows).toEqual([]);
    });
  });
  it("rejects UTF-16 overflow atomically through RPC and enforces table constraints", async () => {
    await asUser(owner, async () => {
      await save();
      for (const value of [
        { ...payload, fullName: "🎬".repeat(41), age: 26 },
        { ...payload, ethnicity: "🎬".repeat(51), age: 26 },
      ]) {
        expect(onboardingInputSchema.safeParse(value).success).toBe(false);
        await expect(save(value)).rejects.toMatchObject({ code: "22023" });
      }
      expect(
        (await db.query("select full_name,age,ethnicity from public.account_details")).rows,
      ).toEqual([{ full_name: payload.fullName, age: 25, ethnicity: payload.ethnicity }]);
    });
    await expect(
      db.query("update public.account_details set full_name=$1 where user_id=$2", [
        "🎬".repeat(41),
        owner,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query("update public.account_details set ethnicity=$1 where user_id=$2", [
        "🎬".repeat(51),
        owner,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps sensitive fields and the full name out of public creator projections", async () => {
    await asUser(owner, () => save());
    await db.query(
      "insert into public.creator_applications(user_id,application,status,decided_by,decided_at) values($1,$2,'approved',$3,now())",
      [
        owner,
        JSON.stringify({
          display_name: "Public Creator",
          handle: "public-creator",
          bio: "Public biography",
          portfolio_url: "https://example.com",
          rights_attested: true,
        }),
        other,
      ],
    );
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.account_details")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(save()).rejects.toMatchObject({ code: "42501" });
      const publicRows = (await db.query("select * from public.public_creators")).rows;
      expect(publicRows).toEqual([
        {
          id: owner,
          display_name: "Public Creator",
          handle: "public-creator",
          bio: "Public biography",
        },
      ]);
      const text = JSON.stringify(publicRows);
      for (const value of [
        payload.fullName,
        payload.ethnicity,
        payload.contactNumber,
        "ethnicity",
        "contact_number",
        "age",
        "full_name",
      ])
        expect(text).not.toContain(value);
    } finally {
      await db.exec("reset role");
    }
  });
});
