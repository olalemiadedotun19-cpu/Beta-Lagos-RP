/**
 * Engine, wind / road and tyre-squeal sound for the player's car, synthesised with Web Audio (no audio files).
 *
 * The engine is three oscillators (a saw at the firing frequency, a square an octave up, a saw at the third harmonic) through a soft
 * clipper and a low-pass whose cut-off follows the revs and the throttle. The revs come from the car's speed through a six-speed
 * automatic (shifts up near the redline, down when the revs fall, a short power cut on every shift), with free revving at a standstill.
 * Browsers only allow audio after a tap: `prime()` is called when the player presses the car button, so the context is ready by the
 * time the character is seated and `start()` is called.
 */

const IDLE_RPM = 950;
const REDLINE_RPM = 6400;
/** speed (m/s) at the redline in each gear */
const GEAR_TOP = [10, 17, 25, 33, 42, 55];
const UP_RPM = 5800;
const DOWN_RPM = 2300;
const MASTER = 0.2;

export interface EngineInput {
  /** speed along the nose, m/s (sign ignored) */
  speed: number;
  throttle: number;
  /** sideways slip, m/s (sign ignored) */
  slip: number;
  handbrake: boolean;
}

interface Graph {
  oscs: OscillatorNode[];
  oscGain: GainNode;
  filter: BiquadFilterNode;
  master: GainNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  squeal: GainNode;
  noise: AudioBufferSourceNode;
}

export class EngineSound {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private running = false;
  private rpm = 0;
  private gear = 0;
  private shiftCut = 0;
  private onVisibility = (): void => {
    if (!this.ctx) return;
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.running) void this.ctx.resume();
  };

  /** creates / wakes the audio context: call from a tap or key press */
  prime(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** the ignition: the revs climb from zero to idle */
  start(): void {
    this.prime();
    if (!this.ctx) return;
    if (!this.graph) this.graph = this.build(this.ctx);
    this.running = true;
    this.rpm = 0;
    this.gear = 0;
    this.shiftCut = 0;
    const g = this.graph.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(MASTER, this.ctx.currentTime, 0.08);
  }

  /** the engine is switched off (fades out) */
  stop(): void {
    this.running = false;
    if (!this.ctx || !this.graph) return;
    const t = this.ctx.currentTime;
    this.graph.master.gain.cancelScheduledValues(t);
    this.graph.master.gain.setTargetAtTime(0, t, 0.12);
    this.graph.squeal.gain.setTargetAtTime(0, t, 0.05);
    this.graph.wind.gain.setTargetAtTime(0, t, 0.1);
  }

  update(dt: number, input: EngineInput): void {
    if (!this.running || !this.ctx || !this.graph) return;
    const v = Math.abs(input.speed);
    const throttle = Math.min(1, Math.max(0, input.throttle));

    // ---- gearbox
    const last = GEAR_TOP.length - 1;
    let fromSpeed = (v / GEAR_TOP[this.gear]) * REDLINE_RPM;
    if (this.shiftCut > 0) this.shiftCut = Math.max(0, this.shiftCut - dt);
    else if (fromSpeed > UP_RPM && this.gear < last) {
      this.gear++;
      this.shiftCut = 0.16;
    } else if (this.gear > 0 && fromSpeed < DOWN_RPM) {
      this.gear--;
    }
    fromSpeed = (v / GEAR_TOP[this.gear]) * REDLINE_RPM;

    // ---- revs: tied to the wheels once moving, free-revving (and idling) at a standstill
    const free = IDLE_RPM + throttle * 3800;
    const lock = Math.min(1, v / 3);
    const target = Math.min(REDLINE_RPM, Math.max(IDLE_RPM, free * (1 - lock) + (fromSpeed + throttle * 350) * lock));
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 5 : 3));

    // ---- sound parameters
    const t = this.ctx.currentTime;
    const f0 = (this.rpm / 60) * 2; // two firings per revolution
    const [a, b, c] = this.graph.oscs;
    a.frequency.setTargetAtTime(f0, t, 0.03);
    b.frequency.setTargetAtTime(f0 * 2, t, 0.03);
    c.frequency.setTargetAtTime(f0 * 3.01, t, 0.03);
    const load = this.shiftCut > 0 ? 0.1 : throttle;
    this.graph.filter.frequency.setTargetAtTime(350 + this.rpm * 0.55 + load * 900, t, 0.05);
    this.graph.oscGain.gain.setTargetAtTime(0.45 + load * 0.55, t, 0.05);

    // wind and road noise follow the speed
    const speedK = Math.min(1, v / 40);
    this.graph.wind.gain.setTargetAtTime(speedK * speedK * 0.5 + speedK * 0.08, t, 0.1);
    this.graph.windFilter.frequency.setTargetAtTime(250 + v * 28, t, 0.1);

    // tyre squeal: sliding sideways, or the handbrake while moving
    const sliding = Math.min(1, Math.max(0, (Math.abs(input.slip) - 2.2) / 6));
    const drift = input.handbrake && v > 6 ? 0.5 : 0;
    this.graph.squeal.gain.setTargetAtTime(Math.max(sliding, drift) * 0.16, t, 0.06);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.running = false;
    if (this.graph) {
      for (const o of this.graph.oscs) o.stop();
      this.graph.noise.stop();
      this.graph = null;
    }
    void this.ctx?.close();
    this.ctx = null;
  }

  private build(ctx: AudioContext): Graph {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // engine
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.9;
    filter.frequency.value = 900;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 128) - 1) * 2.4);
    shaper.curve = curve;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.45;
    const types: OscillatorType[] = ['sawtooth', 'square', 'sawtooth'];
    const levels = [0.5, 0.2, 0.22];
    const oscs = types.map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 30;
      const g = ctx.createGain();
      g.gain.value = levels[i];
      o.connect(g).connect(oscGain);
      o.start();
      return o;
    });
    oscGain.connect(shaper).connect(filter).connect(master);

    // noise bed for wind / road and tyre squeal
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.7;
    windFilter.frequency.value = 400;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    noise.connect(windFilter).connect(wind).connect(master);
    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.Q.value = 5;
    squealFilter.frequency.value = 1900;
    const squeal = ctx.createGain();
    squeal.gain.value = 0;
    noise.connect(squealFilter).connect(squeal).connect(master);
    noise.start();

    return { oscs, oscGain, filter, master, wind, windFilter, squeal, noise };
  }
}
