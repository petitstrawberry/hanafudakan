export type SoundKind = 'click' | 'deal' | 'capture' | 'hyper_capture' | 'hyper_chain' | 'hp_hit' | 'ko_blast' | 'win' | 'koikoi' | 'hyper';

let context: AudioContext | undefined;
let muted = false;
let volume = 0.35;
let master: GainNode | undefined;

export function setMuted(value: boolean): void {
  muted = value;
  if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.03);
}
export function isMuted(): boolean { return muted; }
export function setVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.03);
}

function getAudio(): AudioContext | undefined {
  // Effects and music share one context; autoplay waits for user activation.
  if (typeof window === 'undefined' || !window.AudioContext) return undefined;
  try {
    if (!context) {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return undefined;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 5;
      master.connect(compressor);
      compressor.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  } catch { return undefined; }
}

/** Music shares the effects master, so the existing sound toggle mutes both. */
export function getMusicOutput(): { audio: AudioContext; output: GainNode } | undefined {
  const audio = getAudio();
  return audio && master ? { audio, output: master } : undefined;
}

function tone(audio: AudioContext, frequency: number, at: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!master) return;
  const osc = audio.createOscillator();
  const envelope = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(envelope);
  envelope.connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.03);
  osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
}

function pluck(audio: AudioContext, frequency: number, at: number, gain = 0.18): void {
  tone(audio, frequency, at, 0.8, gain, 'triangle');
  tone(audio, frequency * 2.005, at, 0.3, gain * 0.25);
  tone(audio, frequency * 3.01, at, 0.12, gain * 0.12);
}

function drum(audio: AudioContext, at: number, gain = 0.45): void {
  if (!master) return;
  const osc = audio.createOscillator();
  const envelope = audio.createGain();
  osc.frequency.setValueAtTime(145, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.25);
  envelope.gain.setValueAtTime(gain, at);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
  osc.connect(envelope);
  envelope.connect(master);
  osc.start(at);
  osc.stop(at + 0.6);
  osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
}

function brush(audio: AudioContext, at: number, duration = 0.12): void {
  if (!master) return;
  const length = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();
  filter.type = 'bandpass'; filter.frequency.value = 2300; filter.Q.value = 0.7;
  envelope.gain.setValueAtTime(0.14, at);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.buffer = buffer;
  source.connect(filter); filter.connect(envelope); envelope.connect(master);
  source.start(at);
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
}

export function playSound(kind: SoundKind): void {
  if (muted) return;
  const audio = getAudio();
  if (!audio) return;
  const at = audio.currentTime + 0.01;
  switch (kind) {
    case 'click': tone(audio, 880, at, 0.055, 0.08, 'triangle'); break;
    case 'deal': brush(audio, at); pluck(audio, 440, at, 0.07); break;
    case 'capture':
      brush(audio, at, 0.08);
      [440, 587.33, 880].forEach((f, i) => pluck(audio, f, at + i * 0.075, 0.15));
      break;
    case 'hyper_capture':
      // A short impact followed by a rising metallic arpeggio makes every
      // Hyper stack feel like a deliberate battle beat rather than a normal
      // capture with a color filter.
      drum(audio, at, 0.72);
      drum(audio, at + 0.12, 0.44);
      brush(audio, at + 0.04, 0.2);
      [220, 293.66, 392, 523.25, 783.99, 1046.5].forEach((f, i) => {
        pluck(audio, f, at + i * 0.045, 0.22);
        tone(audio, f * 2, at + i * 0.045, 0.18, 0.045, 'sawtooth');
      });
      tone(audio, 1568, at + 0.34, 0.9, 0.13, 'triangle');
      break;
    case 'hyper_chain':
      [261.63, 329.63, 440, 659.25, 880, 1318.51].forEach((f, i) => {
        pluck(audio, f, at + i * 0.06, 0.17);
        tone(audio, f * 1.5, at + i * 0.06, 0.25, 0.025, 'square');
      });
      tone(audio, 1760, at + 0.38, 1.1, 0.1, 'triangle');
      break;
    case 'hp_hit':
      drum(audio, at, 0.8);
      brush(audio, at, 0.16);
      tone(audio, 98, at, 0.2, 0.18, 'sawtooth');
      tone(audio, 784, at + 0.015, 0.1, 0.08, 'triangle');
      break;
    case 'ko_blast':
      drum(audio, at, 1);
      drum(audio, at + 0.16, 0.7);
      brush(audio, at, 0.5);
      [55, 82.41, 110].forEach(f => tone(audio, f, at, 0.85, 0.12, 'sawtooth'));
      [293.66, 440, 587.33].forEach(f => tone(audio, f, at + 0.25, 1.5, 0.1, 'triangle'));
      break;
    case 'koikoi':
      drum(audio, at);
      [293.66, 349.23, 440, 587.33].forEach((f, i) => pluck(audio, f, at + i * 0.085, 0.23));
      tone(audio, 1174.66, at + 0.3, 1.2, 0.1);
      break;
    case 'win':
      drum(audio, at, 0.5);
      drum(audio, at + 0.28, 0.32);
      [293.66, 349.23, 440, 587.33, 698.46, 880, 1174.66].forEach((f, i) => pluck(audio, f, at + i * 0.105, 0.2));
      [587.33, 880, 1174.66].forEach((f) => tone(audio, f, at + 0.8, 1.9, 0.08));
      break;
    case 'hyper':
      drum(audio, at, 0.55);
      drum(audio, at + 0.18, 0.38);
      [196, 246.94, 329.63, 493.88, 659.25, 987.77, 1318.51].forEach((f, i) => {
        pluck(audio, f, at + i * 0.055, 0.2);
        tone(audio, f * 2, at + i * 0.055, 0.24, 0.03, 'sawtooth');
      });
      tone(audio, 1568, at + 0.45, 1.2, 0.12, 'triangle');
      break;
  }
}
