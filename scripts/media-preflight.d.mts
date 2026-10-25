export type MediaPreflight = {
  kind: string;
  ready: boolean;
  checks: { id: string; ready: boolean; action: string }[];
  externalChecks: string[];
};
export function mediaReadiness(env: Record<string, string | undefined>): MediaPreflight;
export function mediaFileReadiness(
  file: string | undefined,
  rightsConfirmed: boolean,
): Promise<{
  provided: boolean;
  ready: boolean;
  bytes?: number;
  reason: string;
}>;
