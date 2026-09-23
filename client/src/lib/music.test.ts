// @ts-expect-error Node built-ins are supplied by the test runner.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner.
import test from "node:test";
import { createMusicPlayer, MUSIC_PLAYLISTS, pickNextMusicIndex, type MusicMode, type MusicTrack } from "./music";

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
  });
  const job = (mode: "calm" | "hyper", index = 0) => requests.get(MUSIC_PLAYLISTS[mode][index].url)!;
  const advance = async (seconds: number) => {
    audio.currentTime += seconds;
    await Promise.resolve(); await Promise.resolve();
  };
  return { ...player, requests, job, advance, audio, sources, gains, fallback, announcements,
    lock: () => { unlocked = false; }, unlock: () => { unlocked = true; } };
}

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
  await f.setMode(null); assert.equal(f.sources[1].stopped, 10.85);
});

test("repeated gestures do not duplicate a pending or playing track", async () => {
  const f = fixture(); const pending = f.setMode("calm"); await f.setMode("calm");
  f.job("calm").resolve(); await pending; await f.setMode("calm");
  assert.equal(f.sources.length, 1);
});

test("audio stays locked until a user gesture can create the shared output", async () => {
  const f = fixture(); f.lock(); await f.setMode("hyper"); assert.equal(f.requests.size, 0);
  f.unlock(); const pending = f.setMode("hyper"); f.job("hyper").resolve(); await pending;
  assert.equal(f.sources.length, 1);
});

test("a song loops throughout the round without loading or announcing another song", async () => {
  const f = fixture(); const pending = f.setMode("calm", "room:1:calm"); f.job("calm").resolve(60); await pending;
  await f.advance(600);
  await f.setMode("calm", "room:1:calm");
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].loop, true);
  assert.equal(f.requests.size, 1);
  assert.deepEqual(f.announcements, [MUSIC_PLAYLISTS.calm[0]]);
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

test("a new round selects another song and never repeats the previous one", async () => {
  const f = fixture(); const first = f.setMode("calm", "room:1:calm"); f.job("calm").resolve(); await first;
  const second = f.setMode("calm", "room:2:calm");
  assert.equal(f.sources[0].stopped, null);
  f.job("calm", 1).resolve(); await second;
  assert.deepEqual(f.announcements, [MUSIC_PLAYLISTS.calm[0], MUSIC_PLAYLISTS.calm[1]]);
  assert.equal(f.sources[0].stopped, 10.85);
  await f.setMode("calm", "room:2:calm");
  assert.equal(f.sources.length, 2);
});

test("leaving during a round-change download still selects the new round on return", async () => {
  const f = fixture(); const first = f.setMode("calm", "room:1:calm"); f.job("calm").resolve(); await first;
  const interrupted = f.setMode("calm", "room:2:calm");
  await f.setMode(null);
  f.job("calm", 1).resolve(); await interrupted;
  assert.equal(f.sources.length, 1);
  const resumed = f.setMode("calm", "room:2:calm"); await resumed;
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources[1].offset, 0);
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.calm[1]);
});

test("pause resumes the same song at its loop position", async () => {
  const f = fixture(); const pending = f.setMode("calm", "room:1:calm"); f.job("calm").resolve(60); await pending;
  await f.advance(65); await f.setMode(null);
  await f.advance(100); await f.setMode("calm", "room:1:calm");
  assert.equal(f.sources[1].offset, 5);
  assert.equal(f.requests.size, 1);
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.calm[0]);
});

test("Hyper entry changes music once; another contract does not interrupt it", async () => {
  const f = fixture(); const calm = f.setMode("calm", "room:1:calm"); f.job("calm").resolve(); await calm;
  const hyper = f.setMode("hyper", "room:1:hyper");
  assert.equal(f.sources[0].stopped, null);
  f.job("hyper").resolve(); await hyper;
  await f.advance(200);
  await f.setMode("hyper", "room:1:hyper");
  assert.equal(f.sources.length, 2);
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.hyper[0]);
});

test("bad asset skips to another track; all failures fall back without retry storms", async () => {
  const f = fixture(); const pending = f.setMode("hyper");
  f.job("hyper").reject(new Error("offline")); await Promise.resolve();
  f.job("hyper", 1).resolve(); await pending;
  assert.equal(f.announcements.at(-1), MUSIC_PLAYLISTS.hyper[1]);
  const g = fixture(); const failed = g.setMode("hyper");
  g.job("hyper").reject(new Error("offline")); await Promise.resolve();
  g.job("hyper", 1).reject(new Error("decode failed")); await failed;
  assert.deepEqual(g.fallback, ["hyper"]);
  await g.setMode("hyper"); assert.equal(g.requests.size, 2);
});

test("suspended audio clock does not trigger a new track", async () => {
  const f = fixture(); const pending = f.setMode("hyper"); f.job("hyper").resolve(100); await pending;
  f.audio.state = "suspended";
  await f.advance(101); assert.equal(f.sources.length, 1);
});
