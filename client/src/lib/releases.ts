import data from "../data/releases.json";
import { readLocal, readStoredLocal, writeLocal } from "./storage";
export type Release = { version: string; date: string | null; title: string; summary: string; highlights: string[]; sections: { title: string; items: string[] }[] };
export const RELEASES: readonly Release[] = data.releases;
export const APP_VERSION = RELEASES[0].version;
export const RELEASE_READ_KEY = "hanafudakan-announcements-read-through";
// Stable SemVer releases only. Numeric comparison handles 1.10 > 1.9.
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    ? value.split(".").map(Number) : null;
  const x = parse(a), y = parse(b);
  if (!x || !y || ![...x, ...y].every(Number.isSafeInteger)) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function unreadReleases(readThrough: string | null, releases: readonly Release[] = RELEASES): readonly Release[] {
  return releases.filter(release => {
    const comparison = readThrough ? compareVersions(release.version, readThrough) : null;
    return comparison === null || comparison > 0;
  });
}
export function readReleaseVersion(): string | null { return readLocal(RELEASE_READ_KEY); }
export function acknowledgeReleases(version = APP_VERSION): boolean {
  const previous = [readReleaseVersion(), readStoredLocal(RELEASE_READ_KEY)];
  // An older tab/build must never overwrite a newer acknowledgment.
  if (previous.some(value => value && compareVersions(value, version) === 1)) return true;
  return writeLocal(RELEASE_READ_KEY, version);
}
export function canShowReleaseNotice({ roomId, page, modalOpen, busy, loading, invitation }: {
  roomId: string | null; page: string; modalOpen: boolean; busy: boolean; loading: boolean; invitation: boolean;
}): boolean {
  return !roomId && page === "lobby" && !modalOpen && !busy && !loading && !invitation;
}
