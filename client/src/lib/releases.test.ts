// @ts-expect-error Node built-ins are supplied by the test runner.
import { test } from "node:test";
// @ts-expect-error Node built-ins are supplied by the test runner.
import assert from "node:assert/strict";
import { APP_VERSION, RELEASES, RELEASE_READ_KEY, acknowledgeReleases, canShowReleaseNotice, compareVersions, readReleaseVersion, unreadReleases } from "./releases";
import { readLocal, writeLocal } from "./storage";
import type { Release } from "./releases";
const fixture = (version: string): Release => ({ version, date: null, title: version, summary: version, highlights: [], sections: [] });
test("numeric stable versions and invalid markers", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  for (const bad of ["oops", "1.0", "01.0.0", "1.0.0-beta", "9007199254740992.0.0"]) assert.equal(compareVersions(bad, "1.0.0"), null);
});
test("first visit, jumps, unknown historical version, malformed marker and rollback", () => {
  const releases = [fixture("2.0.0"), fixture("1.10.0"), fixture("1.2.0"), fixture("1.0.0")];
  assert.equal(unreadReleases(null, releases).length, 4);
  assert.deepEqual(unreadReleases("1.0.1", releases).map(r => r.version), ["2.0.0", "1.10.0", "1.2.0"]);
  assert.equal(unreadReleases("bad", releases).length, 4);
  assert.equal(unreadReleases("2.0.0", releases).length, 0);
  assert.equal(unreadReleases("3.0.0", releases).length, 0);
});
test("only the idle lobby may show the notice", () => {
  const safe = { roomId: null, page: "lobby", modalOpen: false, busy: false, loading: false, invitation: false };
  assert.ok(canShowReleaseNotice(safe));
  for (const patch of [{roomId:"playing"}, {page:"announcements"}, {modalOpen:true}, {busy:true}, {loading:true}, {invitation:true}]) assert.equal(canShowReleaseNotice({...safe,...patch}), false);
});
test("acknowledgment preserves sessions, survives reload reads, never downgrades and tolerates blocked storage", () => {
  const values = new Map([["hanafudakan-session", "existing session"]]);
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  assert.ok(acknowledgeReleases());
  assert.equal(readReleaseVersion(), APP_VERSION);
  assert.equal(unreadReleases(readReleaseVersion()).length, 0);
  localStorage.setItem(RELEASE_READ_KEY, "2.0.0");
  acknowledgeReleases("1.0.0");
  assert.equal(readReleaseVersion(), "2.0.0");
  assert.equal(values.get("hanafudakan-session"), "existing session");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("SecurityError"); } } });
  assert.equal(writeLocal("blocked-preference", "kept"), false);
  assert.equal(readLocal("blocked-preference"), "kept");
  assert.doesNotThrow(() => acknowledgeReleases());
  assert.equal(readReleaseVersion(), APP_VERSION);
  // A failed earlier write must not hide a newer marker written by another tab.
  values.set(RELEASE_READ_KEY, "3.0.0");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  acknowledgeReleases("1.0.0");
  assert.equal(values.get(RELEASE_READ_KEY), "3.0.0");
  delete (globalThis as { window?: unknown }).window;
});
test("real release catalog is unique and strictly ordered", () => {
  assert.equal(APP_VERSION, RELEASES[0].version);
  RELEASES.forEach((release, index) => {
    assert.equal(compareVersions(release.version, release.version), 0);
    if (index) assert.equal(compareVersions(RELEASES[index - 1].version, release.version), 1);
    assert.ok(release.sections.every(section => section.items.length));
  });
});
