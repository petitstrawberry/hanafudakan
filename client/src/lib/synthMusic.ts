import { getMusicOutput } from "./audio";

export type MusicMode = "calm" | "hyper" | null;
let current: MusicMode = null;
let timer: number | undefined;
let channel: GainNode | undefined;

// Original pentatonic phrases: a bright plucked theme, then a faster battle
// arrangement. Schedule against the audio clock, not the rendering frame rate.
const calmMelody = [74, -1, 78, 81, 83, -1, 81, 78, 76, -1, 78, 81, 74, -1, 76, -1];
const hyperMelody = [74, 69, 77, 74, 79, 77, 74, 69, 72, 67, 74, 72, 77, 74, 72, 67];
const bassNotes = [38, 41, 36, 43];

export function setSynthMusicMode(mode: MusicMode): void {
  if (mode === current && (mode === null || timer !== undefined)) return;
  const output = mode ? getMusicOutput() : undefined;
  if (mode && !output) return; // Wait for a real user gesture to unlock audio.
  window.clearInterval(timer);
  timer = undefined;
  const old = channel;
  if (old) {
    const now = old.context.currentTime;
    old.gain.cancelScheduledValues(now);
    old.gain.setTargetAtTime(0, now, .12);
    window.setTimeout(() => old.disconnect(), 900);
  }
  channel = undefined;
  current = mode;
  if (!mode || !output) return;
  const { audio, output: master } = output;
  const bus = audio.createGain();
  bus.gain.setValueAtTime(0, audio.currentTime);
  bus.gain.linearRampToValueAtTime(mode === "hyper" ? .3 : .22, audio.currentTime + .7);
  bus.connect(master);
  channel = bus;
  let step = 0;
  let next = audio.currentTime + .05;
  const beat = 60 / (mode === "hyper" ? 144 : 116) / 4;
  const note = (midi: number, at: number, length: number, gain: number, type: OscillatorType = "triangle", bend = false) => {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const hz = 440 * 2 ** ((midi - 69) / 12);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, at);
    if (bend) oscillator.frequency.exponentialRampToValueAtTime(hz / 3, at + length);
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + .008);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + length + .02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  };
  const schedule = () => {
    if (audio.state !== "running") return;
    // Do not replay a backlog after the browser sleeps or suspends audio.
    if (next < audio.currentTime) next = audio.currentTime + .03;
    while (next < audio.currentTime + .2) {
      const bar = Math.floor(step / 16) % 4;
      const index = step % 16;
      const melody = (mode === "hyper" ? hyperMelody : calmMelody)[index];
      if (melody >= 0) {
        const pitch = melody + (mode === "hyper" ? (bar === 1 ? 3 : bar === 3 ? -2 : 0) : [0, 5, 7, 0][bar]);
        note(pitch, next, mode === "hyper" ? .23 : .7, .24);
        note(pitch + 12, next, .13, .045, "sine");
      }
      if (index % 4 === 0) note(mode === "hyper" ? bassNotes[bar] : [38, 43, 45, 38][bar], next, .45, .27, "sine");
      if (mode === "hyper") {
        if (index % 4 === 0) note(48, next, .16, .48, "sine", true);
        if (index % 8 === 4) note(67, next, .08, .12, "triangle", true);
        if (index % 2 === 0) note(105, next, .025, .035, "square");
      } else if (index === 0) note(43, next, .22, .12, "sine", true);
      step++;
      next += beat;
    }
  };
  schedule();
  timer = window.setInterval(schedule, 80);
  // Nodes disconnect themselves when their short envelopes finish; each mode
  // has an independent bus so transitions can crossfade without overlap leaks.
}
