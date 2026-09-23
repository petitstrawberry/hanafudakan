// @ts-expect-error Node built-ins are supplied by the test runner.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner.
import test from "node:test";
import { createMusicPlayer, MUSIC_PLAYLISTS, musicRepeatCount, pickNextMusicIndex, type MusicMode, type MusicTrack } from "./music";

function deferred() {
  let resolve!: (value: AudioBuffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AudioBuffer>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: (duration = 60) => resolve({ duration } as AudioBuffer), reject };
}
function fixture() {
  const sources: { loop: boolean; started: boolean; offset: number; stopped: number | null; disconnected: boolean; onended?: () => void }[] = [];
  const gains: { disconnected: boolean; ramps: { value: number; at: number }[] }[] = [];
  const fallback: MusicMode[] = [];
  const announcements: (MusicTrack | null)[] = [];
  const requests = new Map<string, ReturnType<typeof deferred>>();
  const watches = new Set<() => void>();
  let unlocked = true;
  const audio = {
    currentTime: 10, state: "running",
    createBufferSource() {
      const source = {
        loop: false, started: false, offset: 0, stopped: null as number | null, disconnected: false,
        connect() {}, disconnect() { source.disconnected = true; },
        start(_at: number, offset: number) { source.started = true; source.offset = offset; },
        stop(at: number) { source.stopped = at; },
      };
      sources.push(source); return source;
    },
    createGain() {
      const bus = {
        context: audio, disconnected: false, ramps: [] as { value: number; at: number }[],
        gain: { setValueAtTime() {}, cancelAndHoldAtTime() {}, linearRampToValueAtTime(value: number, at: number) { bus.ramps.push({ value, at }); } },
        connect() {}, disconnect() { bus.disconnected = true; },
      };
      gains.push(bus); return bus;
    },
  };
  const player = createMusicPlayer({
    random: () => 0,
    getOutput: () => unlocked ? { audio: audio as unknown as AudioContext, output: {} as GainNode } : undefined,
    load: track => {
      if (!requests.has(track.url)) requests.set(track.url, deferred());
      return requests.get(track.url)!.promise;
    },
    fallback: mode => fallback.push(mode),
    onTrack: track => announcements.push(track),
    watch: tick => { watches.add(tick); return () => { watches.delete(tick); }; },
  });
  const job = (mode: "calm" | "hyper", index = 0) => requests.get(MUSIC_PLAYLISTS[mode][index].url)!;
  const advance = async (seconds: number) => {
    audio.currentTime += seconds;
    [...watches].forEach(tick => tick());
    await Promise.resolve(); await Promise.resolve();
  };
  return { ...player, requests, job, advance, audio, sources, gains, fallback, announcements, watches,
    lock: () => { unlocked = false; }, unlock: () => { unlocked = true; } };
}

test("short songs repeat three/two times, longer songs once", () => {
  assert.deepEqual([20, 44.9, 45, 68.8, 89.9, 90, 114].map(musicRepeatCount), [3, 3, 2, 2, 2, 1, 1]);
});

test("stopping during a download never starts a late track or credit", async () => {
  const f = fixture(); const pending = f.setMode("calm");
  await f.setMode(null); f.job("calm").resolve(); await pending;
  assert.equal(f.sources.length, 0); assert.deepEqual(f.announcements, [null]);
});

test("latest mode wins when older downloads complete last", async () => {
  const f = fixture(); const calm = f.setMode("calm"), hyper = f.setMode("hyper");
  f.job("hyper").resolve(); await hyper; f.job("calm").resolve(); await calm;
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].loop, true);
  assert.equal(f.sources[0].started, true);
  assert.equal(f.announcements[0], MUSIC_PLAYLISTS.hyper[0]);
});

test("mode switches crossfade through separate buses and release old nodes", async () => {
  const f = fixture(); const calm = f.setMode("calm"); f.job("calm").resolve(); await calm;
  const hyper = f.setMode("hyper"); assert.equal(f.sources[0].stopped, null);
  f.job("hyper").resolve(); await hyper;
  assert.equal(f.sources[0].stopped, 10.85);
  assert.deepEqual(f.gains[0].ramps.at(-1), { value: 0, at: 10.8 });
  assert.deepEqual(f.gains[1].ramps.at(-1), { value: .24, at: 11.2 });
  f.sources[0].onended?.();
  assert.equal(f.sources[0].disconnected, true); assert.equal(f.gains[0].disconnected, true);
  await f.setMode(null); assert.equal(f.sources[1].stopped, 10.85); assert.equal(f.watches.size, 0);
});

test("repeated gestures do not duplicate a pending or playing track", async () => {
  const f = fixture(); const pending = f.setMode("calm"); await f.setMode("calm");
  f.job("calm").resolve(); await pending; await f.setMode("calm");
  assert.equal(f.sources.length, 1); assert.equal(f.watches.size, 1);
});

test("audio stays locked until a user gesture can create the shared output", async () => {
  const f = fixture(); f.lock(); await f.setMode("hyper"); assert.equal(f.requests.size, 0);
  f.unlock(); const pending = f.setMode("hyper"); f.job("hyper").resolve(); await pending;
  assert.equal(f.sources.length, 1);
});

test("short track finishes two loops before moving; credit changes only with the song", async () => {
  const f = fixture(); const pending = f.setMode("calm"); f.job("calm").resolve(60); await pending;
  f.job("calm", 1).resolve(60);
  await f.advance(60); assert.equal(f.sources.length, 1); assert.equal(f.announcements.length, 1);
  await f.advance(58.8); assert.equal(f.sources.length, 2);
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.calm[1]);
  assert.equal(f.sources[0].stopped, 129.65);
});

test("random selection covers every other song without immediate repeats", () => {
  for (const size of [2, 3, 5]) {
    for (let previous = 0; previous < size; previous++) {
      const choices = new Set(Array.from({ length: size - 1 }, (_, i) => pickNextMusicIndex(previous, size, () => (i + .5) / (size - 1))));
      assert.equal(choices.size, size - 1); assert.equal(choices.has(previous), false);
    }
  }
  assert.equal(pickNextMusicIndex(-1, 3, () => .9), 2);
});

test("medley uses its preloaded random song and does not repeat the current song", async () => {
  const f = fixture(); const pending = f.setMode("calm"); f.job("calm").resolve(); await pending;
  assert.ok(f.job("calm", 1)); f.job("calm", 1).resolve(); await f.next(); await f.next();
  assert.deepEqual(f.announcements, [MUSIC_PLAYLISTS.calm[0], MUSIC_PLAYLISTS.calm[1], MUSIC_PLAYLISTS.calm[0]]);
});

test("pause resumes position and remaining repeat time instead of restarting song one", async () => {
  const f = fixture(); const pending = f.setMode("calm"); f.job("calm").resolve(60); await pending;
  f.job("calm", 1).resolve(60); await f.advance(65); await f.setMode(null);
  await f.advance(100); await f.setMode("calm");
  assert.equal(f.sources[1].offset, 5);
  await f.advance(53.8); assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.calm[1]);
});

test("slow download keeps previous loop alive; stopping invalidates pending next song", async () => {
  const f = fixture(); const pending = f.setMode("hyper"); f.job("hyper").resolve(100); await pending;
  await f.advance(100); assert.equal(f.sources[0].stopped, null);
  await f.setMode(null); f.job("hyper", 1).resolve(); await Promise.resolve();
  assert.equal(f.sources.length, 1); assert.equal(f.announcements.at(-1), null);
});

test("bad asset skips to another track; all failures fall back without retry storms", async () => {
  const f = fixture(); const pending = f.setMode("hyper");
  f.job("hyper").reject(new Error("offline")); await Promise.resolve();
  f.job("hyper", 1).resolve(); await pending;
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.hyper[1]);
  const g = fixture(); const failed = g.setMode("hyper");
  g.job("hyper").reject(new Error("offline")); await Promise.resolve();
  g.job("hyper", 1).reject(new Error("decode failed")); await failed;
  assert.deepEqual(g.fallback, ["hyper"]); assert.equal(g.watches.size, 0);
  await g.setMode("hyper"); assert.equal(g.requests.size, 2);
});

test("suspended audio clock does not advance songs", async () => {
  const f = fixture(); const pending = f.setMode("hyper"); f.job("hyper").resolve(100); await pending;
  f.job("hyper", 1).resolve(); f.audio.state = "suspended";
  await f.advance(101); assert.equal(f.sources.length, 1);
});
