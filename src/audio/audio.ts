// All sound is synthesised with the Web Audio API: effects, a wave ambience and a
// soft lo-fi chiptune loop. Nothing is downloaded.

export type Sfx =
  | 'click'
  | 'tick'
  | 'whir'
  | 'clank'
  | 'thud'
  | 'splash'
  | 'creak'
  | 'horn'
  | 'foghorn'
  | 'gull'
  | 'firework'
  | 'bubble'
  | 'reject'
  | 'type'
  | 'fanfare'
  | 'reveal';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// I–vi–ii–V in C: bass note and chord tones (MIDI).
const CHORDS: [number, number[]][] = [
  [36, [60, 64, 67, 71]],
  [33, [60, 64, 67, 69]],
  [38, [60, 65, 69, 72]],
  [31, [59, 62, 65, 67]],
];
// Two 4-bar phrases of eighth notes (null = rest).
const MELODY: (number | null)[] = [
  76, null, 79, null, 81, null, 79, null,
  76, null, null, 72, 74, null, 76, null,
  77, null, 81, null, 79, null, 77, 76,
  74, null, null, null, 71, null, 74, null,
  76, null, 79, 81, 84, null, 81, null,
  79, null, 76, null, 74, null, 72, null,
  74, null, 77, null, 76, null, 74, 72,
  71, null, 67, null, 69, null, null, null,
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private thinBus!: GainNode; // melody + drums, faded out under tension
  private noiseBuf!: AudioBuffer;
  private waveFilter!: BiquadFilterNode;
  private sfxOn = true;
  private musicOn = true;
  private muted = false;
  private tension = 0;
  private step = 0;
  private nextTime = 0;
  private timer: number | undefined;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.thinBus = ctx.createGain();
    this.thinBus.connect(this.musicBus);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startWaves();
    this.applyLevels(true);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  configure(opts: { sfx: boolean; music: boolean; muted: boolean }): void {
    this.sfxOn = opts.sfx;
    this.musicOn = opts.music;
    this.muted = opts.muted;
    this.applyLevels();
  }

  /** 0..1: as the load nears the line the music thins out and the sea gets louder. */
  setTension(t: number): void {
    this.tension = Math.max(0, Math.min(1, t));
    this.applyLevels();
  }

  private applyLevels(instant = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const ramp = (p: AudioParam, v: number) => (instant ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, 0.25));
    ramp(this.master.gain, this.muted ? 0 : 0.9);
    ramp(this.sfxBus.gain, this.sfxOn ? 1 : 0);
    ramp(this.ambBus.gain, this.sfxOn ? 0.5 + this.tension * 0.7 : 0);
    ramp(this.musicBus.gain, this.musicOn ? 0.55 : 0);
    ramp(this.thinBus.gain, 1 - this.tension * 0.92);
    ramp(this.waveFilter.frequency, 420 + this.tension * 900);
  }

  // ------------------------------------------------------------ building blocks

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, bus: AudioNode, attack = 0.005, filter?: number): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    if (filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filter;
      o.connect(lp).connect(g);
    } else o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private noise(t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, bus: AudioNode, q = 1, attack = 0.005): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + dur + 0.05);
  }

  private startWaves(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.waveFilter = ctx.createBiquadFilter();
    this.waveFilter.type = 'lowpass';
    this.waveFilter.frequency.value = 420;
    const swell = ctx.createGain();
    swell.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.035;
    lfo.connect(depth).connect(swell.gain);
    src.connect(this.waveFilter).connect(swell).connect(this.ambBus);
    src.start();
    lfo.start();
  }

  // ------------------------------------------------------------ effects

  play(name: Sfx, opt = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const bus = this.sfxBus;
    switch (name) {
      case 'click':
        this.tone('square', 880, 880, t, 0.03, 0.05, bus, 0.002, 3000);
        break;
      case 'type':
        this.tone('square', 1400 + Math.random() * 300, 1400, t, 0.015, 0.015, bus, 0.001, 2500);
        break;
      case 'tick':
        this.tone('square', 1000 + opt * 700, 1000 + opt * 700, t, 0.025, 0.04, bus, 0.001, 4000);
        break;
      case 'reveal':
        this.tone('triangle', 520, 1040, t, 0.18, 0.08, bus, 0.005);
        this.tone('square', 780, 780, t + 0.06, 0.12, 0.03, bus, 0.005, 2400);
        break;
      case 'whir': {
        this.tone('sawtooth', 70, 120, t, 0.55, 0.05, bus, 0.05, 500);
        this.noise(t, 0.5, 0.03, 'bandpass', 900, 1400, bus, 3, 0.05);
        break;
      }
      case 'clank':
        this.tone('square', 640, 600, t, 0.07, 0.04, bus, 0.001, 2200);
        this.tone('triangle', 960, 900, t + 0.03, 0.08, 0.04, bus, 0.001);
        this.noise(t, 0.04, 0.05, 'highpass', 3000, 2000, bus);
        break;
      case 'thud':
        this.tone('sine', 120, 38, t, 0.32, 0.55, bus, 0.003);
        this.noise(t, 0.16, 0.25, 'lowpass', 500, 120, bus, 1, 0.002);
        this.tone('square', 220, 180, t, 0.05, 0.04, bus, 0.001, 900);
        break;
      case 'splash':
        this.noise(t, 0.7, 0.22, 'bandpass', 2600, 500, bus, 0.8, 0.01);
        this.noise(t + 0.05, 0.45, 0.1, 'highpass', 4000, 2500, bus, 0.7, 0.01);
        break;
      case 'creak': {
        const o = this.tone('sawtooth', 95, 80, t, 0.8, 0.045, bus, 0.15, 900);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 9;
        const d = ctx.createGain();
        d.gain.value = 18;
        lfo.connect(d).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 1);
        break;
      }
      case 'horn':
        for (const f of [98, 147, 196]) this.tone('sawtooth', f, f * 0.995, t, 1.5, 0.07, bus, 0.09, 700);
        this.tone('sawtooth', 98, 97, t + 1.9, 0.9, 0.06, bus, 0.08, 650);
        this.tone('sawtooth', 147, 146, t + 1.9, 0.9, 0.05, bus, 0.08, 650);
        break;
      case 'foghorn':
        // A sad, descending two-tone groan.
        this.tone('sawtooth', 87, 82, t, 1.1, 0.12, bus, 0.12, 480);
        this.tone('square', 87.6, 82.4, t, 1.1, 0.04, bus, 0.12, 380);
        this.tone('sawtooth', 73, 52, t + 1.3, 2.2, 0.12, bus, 0.12, 420);
        this.tone('square', 73.5, 52.3, t + 1.3, 2.2, 0.04, bus, 0.12, 340);
        break;
      case 'gull':
        for (let i = 0; i < 3; i++) {
          const s = t + i * 0.22 + Math.random() * 0.05;
          this.tone('triangle', 1900, 1250, s, 0.16, 0.025, bus, 0.02);
          this.tone('sine', 2500, 1700, s, 0.12, 0.012, bus, 0.02);
        }
        break;
      case 'firework':
        this.noise(t, 0.35, 0.16, 'lowpass', 1800, 200, bus, 1, 0.003);
        for (let i = 0; i < 6; i++) this.noise(t + 0.25 + Math.random() * 0.5, 0.03, 0.04, 'highpass', 5000, 4000, bus);
        break;
      case 'bubble':
        for (let i = 0; i < 5; i++) {
          const s = t + i * 0.09 + Math.random() * 0.05;
          this.tone('sine', 300 + Math.random() * 200, 900 + Math.random() * 400, s, 0.07, 0.05, bus, 0.005);
        }
        break;
      case 'reject':
        this.tone('square', 196, 160, t, 0.12, 0.05, bus, 0.003, 1200);
        this.tone('square', 147, 120, t + 0.13, 0.18, 0.05, bus, 0.003, 1200);
        break;
      case 'fanfare': {
        const notes = opt ? [72, 76, 79, 84, 88, 91] : [67, 72, 76, 79];
        notes.forEach((n, i) => this.tone('square', midi(n), midi(n), t + i * 0.1, 0.22, 0.045, bus, 0.005, 3200));
        this.tone('triangle', midi(notes[notes.length - 1] - 12), midi(notes[notes.length - 1] - 12), t + notes.length * 0.1, 0.8, 0.08, bus, 0.01);
        break;
      }
    }
  }

  // ------------------------------------------------------------ music

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const beat = 60 / 74;
    const eighth = beat / 2;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const s = this.step;
      const swing = s % 2 === 1 ? eighth * 0.16 : 0;
      this.playStep(s, this.nextTime + swing, eighth);
      this.nextTime += eighth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(s: number, t: number, eighth: number): void {
    if (!this.musicOn || this.muted) return;
    const bar = Math.floor(s / 8) % 4;
    const pos = s % 8;
    const [bass, chord] = CHORDS[bar];
    const music = this.musicBus;
    const thin = this.thinBus;
    // Bass: root on 1, fifth-ish pickup on the "and" of 3.
    if (pos === 0) this.tone('triangle', midi(bass), midi(bass), t, eighth * 3.2, 0.16, music, 0.01);
    if (pos === 5) this.tone('triangle', midi(bass + 7), midi(bass + 7), t, eighth * 1.2, 0.1, music, 0.01);
    // Warm pad on each bar, a little detuned like an old tape.
    if (pos === 0) {
      for (const n of chord) {
        const f = midi(n) * (1 + (Math.random() - 0.5) * 0.006);
        this.tone('triangle', f, f, t, eighth * 7.5, 0.022, music, 0.25, 1400);
      }
    }
    // Soft keys stabs on the off-beats.
    if (pos === 3 || pos === 6) {
      for (const n of chord.slice(1)) this.tone('square', midi(n), midi(n), t, eighth * 0.6, 0.008, thin, 0.005, 900);
    }
    // Melody
    const note = MELODY[s];
    if (note !== null && note !== undefined) this.tone('square', midi(note), midi(note), t, eighth * 1.4, 0.022, thin, 0.008, 2000);
    // Drums: soft kick, snare-ish noise, swung hats.
    if (pos === 0 || pos === 5) this.tone('sine', 110, 45, t, 0.18, 0.18, thin, 0.002);
    if (pos === 2 || pos === 6) this.noise(t, 0.12, 0.035, 'bandpass', 1800, 1200, thin, 0.7);
    this.noise(t, 0.03, pos % 2 ? 0.008 : 0.014, 'highpass', 7000, 6000, thin);
    // Vinyl crackle
    if (Math.random() < 0.25) this.noise(t + Math.random() * eighth, 0.01, 0.01, 'highpass', 3000, 3000, music);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export const audio = new AudioEngine();
