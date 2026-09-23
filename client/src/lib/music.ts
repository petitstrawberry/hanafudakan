/// <reference types="vite/client" />
import { getMusicOutput } from "./audio";
import { setSynthMusicMode, type MusicMode } from "./synthMusic";

export type { MusicMode };
export type TrackMode = Exclude<MusicMode, null>;
export type MusicTrack = { url: string; title: string; artist: string; gain: number };
export const MUSIC_PLAYLISTS: Record<TrackMode, readonly MusicTrack[]> = {
  calm: [
    { url: "/music/michikusa3-loop.mp3", title: "Michikusa3", artist: "PeriTune", gain: .24 },
    { url: "/music/michikusa2-loop.mp3", title: "Michikusa2", artist: "PeriTune", gain: .24 },
    { url: "/music/koharu-loop.mp3", title: "RetroRoman_Koharu", artist: "PeriTune", gain: .30 },
  ],
  hyper: [
    { url: "/music/jrpg-battle-loop.mp3", title: "JRPG Epic Rock Battle Theme #1", artist: "HydroGene", gain: .24 },
    { url: "/music/cynic-battle-loop.mp3", title: "Cynic Battle Loop", artist: "cynicmusic / Ferk", gain: .31 },
  ],
};

export function pickNextMusicIndex(previous: number, length: number, random = Math.random): number {
  if (length <= 1) return 0;
  if (previous < 0) return Math.floor(random() * length);
  const picked = Math.floor(random() * (length - 1));
  return picked >= previous ? picked + 1 : picked;
}

type Output = NonNullable<ReturnType<typeof getMusicOutput>>;
type Dependencies = {
  getOutput: () => Output | undefined;
  load: (track: MusicTrack, audio: AudioContext) => Promise<AudioBuffer>;
  fallback: (mode: MusicMode) => void;
  onTrack?: (track: MusicTrack | null) => void;
  random?: () => number;
};

/** One randomly chosen, looping song per round; Hyper entry changes the cue. */
export function createMusicPlayer({ getOutput, load, fallback, onTrack = () => {}, random = Math.random }: Dependencies) {
  let requested: MusicMode = null;
  let currentCue = "";
  let pendingCue: string | null = null;
  let generation = 0;
  let loading = false;
  const positions = { calm: { index: -1, elapsed: 0 }, hyper: { index: -1, elapsed: 0 } };
  let voice: {
    source: AudioBufferSourceNode; bus: GainNode; mode: TrackMode; index: number;
    started: number; elapsed: number;
  } | undefined;

  function fadeOut(remember: boolean) {
    if (!voice) return;
    const { source, bus, mode, index, started, elapsed } = voice;
    if (remember) positions[mode] = { index, elapsed: elapsed + Math.max(0, bus.context.currentTime - started) };
    voice = undefined;
    const now = bus.context.currentTime;
    bus.gain.cancelAndHoldAtTime(now);
    bus.gain.linearRampToValueAtTime(0, now + .8);
    source.stop(now + .85);
    source.onended = () => { source.disconnect(); bus.disconnect(); };
  }

  async function start(mode: TrackMode, output: Output, index: number, elapsed: number, cue?: string) {
    const ticket = ++generation;
    loading = true;
    const playlist = MUSIC_PLAYLISTS[mode];
    const candidates = Array.from({ length: playlist.length }, (_, step) => (index + step) % playlist.length)
      .filter(candidate => !(voice?.mode === mode && index !== voice.index && candidate === voice.index));
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const trackIndex = candidates[attempt];
      const track = playlist[trackIndex];
      try {
        const buffer = await load(track, output.audio);
        if (ticket !== generation) return;
        if (!(buffer.duration > 0) || !Number.isFinite(buffer.duration)) throw new Error("Invalid music duration");
        const played = attempt === 0 ? elapsed % buffer.duration : 0;
        const { audio, output: master } = output;
        const source = audio.createBufferSource();
        const bus = audio.createGain();
        source.buffer = buffer;
        source.loop = true;
        source.connect(bus);
        bus.connect(master);
        bus.gain.setValueAtTime(0, audio.currentTime);
        bus.gain.linearRampToValueAtTime(track.gain, audio.currentTime + 1.2);
        source.start(0, played);
        fallback(null);
        fadeOut(false);
        positions[mode] = { index: trackIndex, elapsed: played };
        voice = { source, bus, mode, index: trackIndex, started: audio.currentTime, elapsed: played };
        loading = false;
        if (cue !== undefined) currentCue = cue;
        pendingCue = null;
        onTrack(track);
        return;
      } catch {
        if (ticket !== generation) return;
      }
    }
    loading = false;
    if (cue !== undefined) currentCue = cue;
    pendingCue = null;
    fadeOut(false);
    fallback(mode);
    onTrack({ url: "", title: mode === "hyper" ? "花札館・ハイパー" : "花札館・花遊び", artist: "内蔵BGM", gain: 0 });
  }

  async function next(): Promise<void> {
    if (!requested || loading) return;
    const output = getOutput();
    if (!output) return;
    const index = pickNextMusicIndex(positions[requested].index, MUSIC_PLAYLISTS[requested].length, random);
    await start(requested, output, index, 0);
  }

  async function setMode(mode: MusicMode, cue = ""): Promise<void> {
    const newCue = mode !== null && cue !== currentCue;
    if (mode === requested && (!newCue || pendingCue === cue)) return;
    const output = mode ? getOutput() : undefined;
    if (mode && !output) return;
    // Pauses resume the same loop; a new round or Hyper entry selects a new
    // song. Hold the old bus until the replacement is decoded for crossfade.
    if (voice) positions[voice.mode] = { index: voice.index,
      elapsed: voice.elapsed + Math.max(0, voice.bus.context.currentTime - voice.started) };
    requested = mode;
    ++generation;
    loading = false;
    pendingCue = null;
    if (!mode || !output) {
      fallback(null);
      fadeOut(true);
      onTrack(null);
      return;
    }
    const position = positions[mode];
    const index = newCue || position.index < 0
      ? pickNextMusicIndex(position.index, MUSIC_PLAYLISTS[mode].length, random)
      : position.index;
    pendingCue = cue;
    await start(mode, output, index, newCue ? 0 : position.elapsed, cue);
  }
  return { setMode, next };
}

// Keep only a few recently decoded tracks, rather than every full PCM song.
const buffers = new Map<string, Promise<AudioBuffer>>();
function loadTrack(track: MusicTrack, audio: AudioContext): Promise<AudioBuffer> {
  const existing = buffers.get(track.url);
  if (existing) { buffers.delete(track.url); buffers.set(track.url, existing); return existing; }
  const loading = (async () => {
    const response = await fetch(track.url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Music HTTP ${response.status}`);
    return audio.decodeAudioData(await response.arrayBuffer());
  })();
  buffers.set(track.url, loading);
  while (buffers.size > 3) buffers.delete(buffers.keys().next().value!);
  void loading.catch(() => { if (buffers.get(track.url) === loading) buffers.delete(track.url); });
  return loading;
}

let nowPlaying: MusicTrack | null = null;
const listeners = new Set<(track: MusicTrack | null) => void>();
export function subscribeMusic(listener: (track: MusicTrack | null) => void): () => void {
  listeners.add(listener); listener(nowPlaying);
  return () => { listeners.delete(listener); };
}
const player = createMusicPlayer({ getOutput: getMusicOutput, load: loadTrack, fallback: setSynthMusicMode,
  onTrack: track => { nowPlaying = track; listeners.forEach(listener => listener(track)); } });
export function setMusicMode(mode: MusicMode, cue?: string): void { void player.setMode(mode, cue); }
// The dev-only QA fixture can preview another track without ending a round.
export function previewNextMusicTrack(): void { if (import.meta.env.DEV) void player.next(); }
if (import.meta.hot) import.meta.hot.dispose(() => setMusicMode(null));
