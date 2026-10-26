"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { z } from "zod";
import { useAppearance } from "./appearance-provider";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import { playbackTrackingSchema } from "@/features/playback/schema";
import { createPlaybackActivity } from "@/features/playback/activity";
import { MAX_MOVIE_SECONDS, MAX_PLAYBACK_TTL_SECONDS } from "@/features/media/policy";
import { getSupabaseConfig } from "@/lib/env";
import { safeStorageUrl } from "@/features/media/storage-upload-client";

const activationEvent = "aiverse:player-activate";
let activePlayer: string | null = null;
const playbackGrantSchema = z
  .object({
    videoUrl: z.string().max(8300),
    expiresAt: z.union([z.number().int().positive(), z.iso.datetime({ offset: true })]),
    versionId: z.uuid(),
    durationSeconds: z.number().int().min(1).max(MAX_MOVIE_SECONDS),
    tracking: playbackTrackingSchema.nullable(),
  })
  .strict();
type ActiveGrant = z.infer<typeof playbackGrantSchema> & {
  source: string;
  expires: number;
  accountId: string | null;
  generation: number;
};
type Runtime = {
  close: (flush: boolean) => void;
};

export function FilmPlayer({
  videoId,
  versionId,
  title,
}: {
  videoId: string;
  versionId?: string;
  title: string;
}) {
  return (
    <FilmPlayerSession
      key={`${videoId}:${versionId ?? "public"}`}
      videoId={videoId}
      versionId={versionId}
      title={title}
    />
  );
}

function FilmPlayerSession({
  videoId,
  versionId,
  title,
}: {
  videoId: string;
  versionId?: string;
  title: string;
}) {
  const instance = useId();
  const appearance = useAppearance();
  const identity = useRef(appearance.ready ? appearance.accountId : null);
  const identityBlocked = useRef(false);
  const generation = useRef(0);
  const frame = useRef<HTMLVideoElement | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [grant, setGrant] = useState<ActiveGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const stop = useCallback(
    (flush: boolean, update = true) => {
      generation.current += 1;
      pending.current?.abort();
      pending.current = null;
      runtime.current?.close(flush);
      runtime.current = null;
      // Stop playback and scrub the private bearer URL before React commits.
      if (frame.current) {
        frame.current.pause();
        frame.current.removeAttribute("src");
        frame.current.load();
      }
      if (activePlayer === instance) activePlayer = null;
      if (update) {
        setGrant(null);
        setBusy(false);
      }
    },
    [instance],
  );

  useEffect(() => {
    function anotherPlayer(event: Event) {
      if ((event as CustomEvent<string>).detail === instance) return;
      stop(true);
      setMessage("");
    }
    function hidden() {
      if (document.visibilityState !== "visible") stop(true);
    }
    function changed() {
      identity.current = null;
      identityBlocked.current = true;
      stop(false);
    }
    function unavailable() {
      if (identity.current !== null || identityBlocked.current) changed();
    }
    window.addEventListener(activationEvent, anotherPlayer);
    window.addEventListener(accountChangedEvent, changed);
    window.addEventListener(accountUnavailableEvent, unavailable);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener(activationEvent, anotherPlayer);
      window.removeEventListener(accountChangedEvent, changed);
      window.removeEventListener(accountUnavailableEvent, unavailable);
      document.removeEventListener("visibilitychange", hidden);
      stop(true, false);
    };
  }, [instance, stop]);

  useEffect(() => {
    if (!appearance.ready) return;
    if (identity.current !== appearance.accountId) stop(false);
    identity.current = appearance.accountId;
    identityBlocked.current = false;
  }, [appearance.ready, appearance.accountId, stop]);

  useEffect(() => {
    if (!grant) return;
    const timer = window.setTimeout(
      () => {
        stop(false);
        setMessage("This playback session expired. Select play to request access again.");
      },
      Math.max(0, grant.expires - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [grant, stop]);

  useEffect(() => {
    const player = frame.current;
    if (!grant || !player) return;
    let disposed = false;
    let activity: ReturnType<typeof createPlaybackActivity> | null = null;
    const events = [
      "play",
      "playing",
      "pause",
      "timeupdate",
      "seeking",
      "seeked",
      "waiting",
      "stalled",
      "ended",
      "error",
      "abort",
    ] as const;
    const handlers = events.map((event) => ({
      event,
      handler: () => {
        if (disposed) return;
        if (identityBlocked.current || identity.current !== grant.accountId) {
          stop(false);
          return;
        }
        activity?.sample(
          {
            currentTime: player.currentTime,
            paused: player.paused,
            ended: player.ended,
            visible: document.visibilityState === "visible",
          },
          event,
        );
        if (event === "error")
          setMessage(
            "The video could not be played. Check your connection and whether this MP4 uses browser-supported video and audio.",
          );
      },
    }));
    const session: Runtime = {
      close(flush) {
        if (disposed) return;
        disposed = true;
        if (activity) {
          if (flush && identity.current === grant.accountId && !identityBlocked.current) {
            activity.sample(
              {
                currentTime: player.currentTime,
                paused: true,
                ended: player.ended,
                visible: document.visibilityState === "visible",
              },
              "pause",
            );
            void activity.stop();
          } else activity.invalidate();
        }
        for (const { event, handler } of handlers) player.removeEventListener(event, handler);
        if (runtime.current === session) runtime.current = null;
      },
    };
    runtime.current = session;
    if (
      generation.current === grant.generation &&
      activePlayer === instance &&
      document.visibilityState === "visible" &&
      !identityBlocked.current &&
      identity.current === grant.accountId &&
      Date.now() < grant.expires
    ) {
      if (!versionId && grant.tracking && grant.accountId)
        activity = createPlaybackActivity({
          videoId,
          durationSeconds: grant.durationSeconds,
          expiresAt: grant.expires,
          tracking: grant.tracking,
        });
      for (const { event, handler } of handlers) player.addEventListener(event, handler);
    }
    return () => session.close(true);
  }, [grant, instance, stop, versionId, videoId]);

  async function play() {
    stop(true);
    if (document.visibilityState !== "visible" || identityBlocked.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const currentGeneration = ++generation.current;
    const accountId = identity.current;
    activePlayer = instance;
    window.dispatchEvent(new CustomEvent(activationEvent, { detail: instance }));
    setBusy(true);
    setMessage("");
    try {
      const params = versionId ? `?version=${encodeURIComponent(versionId)}` : "";
      const response = await fetch(`/api/playback/${encodeURIComponent(videoId)}${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error.slice(0, 300)
            : "Playback is unavailable. Please try again later.",
        );
      const parsed = playbackGrantSchema.safeParse(result);
      if (!parsed.success) throw new Error("Playback could not be safely opened.");
      const data = parsed.data;
      const url = new URL(data.videoUrl);
      const configured = getSupabaseConfig();
      const path = new RegExp(
        `^/storage/v1/object/sign/aiverse-videos/([a-fA-F0-9-]{36})/${data.versionId}/([a-fA-F0-9-]{36})\\.mp4$`,
      );
      const match = path.exec(url.pathname);
      if (
        !configured ||
        !match ||
        !z.uuid().safeParse(match[1]).success ||
        !z.uuid().safeParse(match[2]).success ||
        !safeStorageUrl(data.videoUrl, configured.url, url.pathname)
      )
        throw new Error("Playback could not be safely opened.");
      const expiresAt =
        typeof data.expiresAt === "number" ? data.expiresAt * 1000 : Date.parse(data.expiresAt);
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt >
          Date.now() +
            Math.min(MAX_PLAYBACK_TTL_SECONDS, Math.max(60, data.durationSeconds + 60)) * 1000 ||
        (versionId && data.versionId !== versionId) ||
        (data.tracking &&
          (data.tracking.versionId !== data.versionId ||
            (accountId !== null && data.tracking.accountId !== accountId)))
      )
        throw new Error("Playback access has expired. Please request it again.");
      if (
        controller.signal.aborted ||
        currentGeneration !== generation.current ||
        activePlayer !== instance ||
        document.visibilityState !== "visible" ||
        identityBlocked.current ||
        accountId !== identity.current
      )
        return;
      const policy = document.createElement("meta");
      policy.name = "referrer";
      policy.content = "no-referrer";
      document.head.appendChild(policy);
      setGrant({
        ...data,
        tracking: !versionId && accountId !== null ? data.tracking : null,
        source: url.toString(),
        expires: expiresAt,
        accountId,
        generation: currentGeneration,
      });
    } catch (error) {
      if (!controller.signal.aborted && currentGeneration === generation.current)
        setMessage(error instanceof Error ? error.message : "Playback is temporarily unavailable.");
    } finally {
      if (!controller.signal.aborted && currentGeneration === generation.current) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function close() {
    stop(true);
  }

  return (
    <div
      className="film-playback"
      aria-label={versionId ? `Private preview of ${title}` : `Playback of ${title}`}
    >
      {grant ? (
        <>
          <video
            key={grant.generation}
            ref={frame}
            src={grant.source}
            aria-label={`${versionId ? "Private preview" : "Film"}: ${title}`}
            controls
            playsInline
            preload="none"
            crossOrigin="anonymous"
            style={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
          />
          <button className="text-button" type="button" onClick={close}>
            <X size={18} aria-hidden="true" />
            Close player
          </button>
        </>
      ) : (
        <>
          <button className="button secondary" type="button" onClick={play} disabled={busy}>
            <Play size={18} aria-hidden="true" />
            {busy ? "Requesting playback…" : versionId ? "Open private preview" : "Play film"}
          </button>
          <p className="field-description">
            {versionId
              ? "Preview this specific revision before recording your decision."
              : "Video loads when you choose to play."}
          </p>
        </>
      )}
      {message && (
        <p className="error-message" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
