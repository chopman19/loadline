// The harbour: a 320x200 pixel-art canvas, scaled up with nearest-neighbour filtering.
// Everything is drawn in code. The game drives it through a small async API
// (load, jettison, sink, sail, showGhost) and the scene reports sound cues back.
import { clamp, drawSprite, drawText, easeIn, easeInOut, easeOut, GULL_FRAMES, GULL_SITTING, mix, noise, rgba } from './pixel';
import { flag, loadFlag, FLAG_H, FLAG_W } from './flags';
import { hashString } from '../core/rng';

export const W = 320;
export const H = 200;
const HORIZON = 128;
const WATER = 142; // front water surface at the ship
const PIER_Y = 134;

// Ship geometry, in ship-buffer coordinates.
const BUF_W = 204;
const BUF_H = 100;
const BX = 10; // stern x
const DECK = 62; // deck y
const HULL_L = 176;
const HULL_ROWS = 34;
const EMPTY_ROW = 29; // waterline row (from deck) when empty
const LOAD_ROW = 17; // painted load line row
const DOCK_X = 76; // world x of the stern when docked
const BOX_W = 34;
const BOX_H = 15;
const PICK_X = 26; // pier pickup spot (left edge of the container)
const JIB_Y = 38;
const LIFT_Y = 46;

export type SoundCue = 'whir' | 'thud' | 'splash' | 'creak' | 'horn' | 'foghorn' | 'gull' | 'firework' | 'bubble' | 'clank';

export interface BoxSpec {
  iso3: string;
  iso2: string;
}

interface Box extends BoxSpec {
  color: string;
  canvas: HTMLCanvasElement;
  hasFlag: boolean;
  /** Animated offset from the slot position (for sliding into place). */
  ox: number;
  oy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  g: number;
}

interface Bubble {
  x: number;
  y: number;
  vy: number;
  r: number;
  phase: number;
  top: number;
}

interface Gull {
  x: number;
  y: number;
  vx: number;
  phase: number;
  target?: Floater;
}

interface Floater {
  box: Box;
  x: number;
  y: number;
  vx: number;
  rot: number;
  t: number;
  gull: boolean;
}

interface Flying {
  box: Box;
  x: number;
  y: number;
  rot: number;
}

interface Tween {
  t: number;
  dur: number;
  step: (p: number) => void;
  done: () => void;
}

const BOX_COLORS = ['#b4472f', '#2f6fa8', '#3f8f5a', '#e07b2a', '#2a9d8f', '#8a3550', '#c9962e', '#5d6b8a', '#7a4fa0', '#c2553a'];

export class Scene {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private tint: HTMLCanvasElement;
  private last = 0;
  private time = 0;
  private running = false;
  private tweens: Tween[] = [];

  // World state
  mode: 'harbor' | 'underwater' = 'harbor';
  private night = 0.12;
  private nightTarget = 0.12;
  private tension = 0;
  private shake = 0;
  private fade = 0;
  private flashUntil = 0;
  private skyFlash = 0;
  private fireworksUntil = 0;
  private nextFirework = 0;
  private nextGullCry = 6;
  private nextCreak = 0;

  private ship = { x: DOCK_X, ratio: 0, shown: 0, spring: 0, springV: 0, tilt: 0, drop: 0, visible: true };
  private hold = 3;
  private showSlots = false;
  private boxes: Box[] = [];
  private pier: Box | null = null;
  private pierDrop = 0;
  private crane = { x: PICK_X + BOX_W / 2, hook: JIB_Y + 10, carrying: null as Box | null, swing: 0, swingV: 0, lastX: 0, lastV: 0 };
  private flying: Flying[] = [];
  private floaters: Floater[] = [];
  private particles: Particle[] = [];
  private bubbles: Bubble[] = [];
  private gulls: Gull[] = [];
  private ghost: { boxes: Box[]; ratio: number; rise: number; alpha: number } | null = null;
  private ghostBuf: HTMLCanvasElement | null = null;
  private clouds = [
    { x: 30, y: 22, w: 34, s: 2.2 },
    { x: 150, y: 14, w: 46, s: 1.4 },
    { x: 250, y: 34, w: 28, s: 2.8 },
    { x: 95, y: 48, w: 22, s: 3.4 },
  ];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly cue: (c: SoundCue) => void,
    private readonly reducedMotion: () => boolean,
  ) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.buf = document.createElement('canvas');
    this.buf.width = BUF_W;
    this.buf.height = BUF_H;
    this.bctx = this.buf.getContext('2d')!;
    this.tint = document.createElement('canvas');
    this.tint.width = BUF_W;
    this.tint.height = BUF_H;
    for (let i = 0; i < 4; i++) this.gulls.push({ x: noise(i) * W, y: 20 + noise(i + 9) * 50, vx: (noise(i + 3) > 0.5 ? 1 : -1) * (8 + noise(i + 5) * 8), phase: noise(i + 7) * 6 });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
      this.last = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- public API

  /** Back to an empty ship at the dock. */
  reset(hold: number, showSlots: boolean): void {
    this.tweens = [];
    this.mode = 'harbor';
    this.hold = hold;
    this.showSlots = showSlots;
    this.boxes = [];
    this.pier = null;
    this.flying = [];
    this.floaters = [];
    this.particles = [];
    this.bubbles = [];
    this.ghost = null;
    this.fade = 0;
    this.tension = 0;
    this.fireworksUntil = 0;
    this.flashUntil = 0;
    this.ship = { x: DOCK_X, ratio: 0, shown: 0, spring: 0, springV: 0, tilt: 0, drop: 0, visible: true };
    this.crane.carrying = null;
    this.crane.hook = JIB_Y + 10;
    this.gulls.forEach((g) => (g.target = undefined));
  }

  /** Put containers on deck instantly (used when resuming a voyage). */
  restore(specs: BoxSpec[], ratio: number): void {
    this.boxes = specs.map((s) => this.makeBox(s));
    this.ship.ratio = ratio;
    this.ship.shown = ratio;
  }

  setNight(n: number, instant = false): void {
    this.nightTarget = clamp(n);
    if (instant) this.night = this.nightTarget;
  }

  setTension(t: number): void {
    this.tension = clamp(t);
  }

  setRatio(r: number): void {
    this.ship.ratio = r;
  }

  setShowSlots(show: boolean): void {
    this.showSlots = show;
  }

  setShipVisible(visible: boolean): void {
    this.ship.visible = visible;
  }

  /** Top-centre of a deck slot in canvas coordinates (for UI pop-ups). */
  slotPoint(i: number): { x: number; y: number } {
    const s = this.slotPos(i);
    const o = this.shipOrigin();
    return { x: o.x + s.x + BOX_W / 2, y: o.y + s.y };
  }

  /** Crane lifts a container from the pier and lowers it onto the next free slot. Resolves on touchdown. */
  async load(spec: BoxSpec): Promise<void> {
    void loadFlag(spec.iso2);
    const box = this.makeBox(spec);
    const slot = this.boxes.length;
    const fast = this.reducedMotion() ? 0.7 : 1;
    this.pier = box;
    this.pierDrop = 1;
    const c = this.crane;
    const pickX = PICK_X + BOX_W / 2;
    if (Math.abs(c.x - pickX) > 1) {
      const from = c.x;
      const fromHook = c.hook;
      await this.tween(0.45 * fast, (p) => {
        c.x = from + (pickX - from) * easeInOut(p);
        c.hook = fromHook + (JIB_Y + 10 - fromHook) * p;
      });
    }
    const pierTop = PIER_Y - BOX_H;
    await this.tween(0.3 * fast, (p) => (c.hook = JIB_Y + 10 + (pierTop - JIB_Y - 10) * easeIn(p)));
    this.cue('clank');
    c.carrying = box;
    this.pier = null;
    this.cue('whir');
    await this.tween(0.45 * fast, (p) => (c.hook = pierTop + (LIFT_Y - pierTop) * easeInOut(p)));
    const slotX = () => this.slotPoint(slot).x;
    const startX = c.x;
    await this.tween(0.7 * fast, (p) => (c.x = startX + (slotX() - startX) * easeInOut(p)));
    await this.tween(0.5 * fast, (p) => {
      c.x = slotX();
      c.hook = LIFT_Y + (this.slotPoint(slot).y - LIFT_Y) * easeIn(p);
      c.swing *= 1 - p * 0.5;
    });
    // Touchdown.
    c.carrying = null;
    c.swing = 0;
    c.swingV = 0;
    box.ox = 0;
    box.oy = 0;
    this.boxes.push(box);
    this.cue('thud');
    this.addShake(2.5);
    this.ship.springV += this.reducedMotion() ? 10 : 34;
    this.splashAlongHull(22);
    void this.tween(0.4 * fast, (p) => (c.hook = this.slotPoint(slot).y + (JIB_Y + 10 - this.slotPoint(slot).y) * easeOut(p)));
  }

  /** Throws a container overboard; a gull comes to sit on it as it drifts away. */
  async jettison(iso3: string): Promise<void> {
    const idx = this.boxes.findIndex((b) => b.iso3 === iso3);
    if (idx < 0) return;
    const o = this.shipOrigin();
    const before = this.boxes.map((_, i) => this.slotPos(i));
    const [box] = this.boxes.splice(idx, 1);
    const start = before[idx];
    const fly: Flying = { box, x: o.x + start.x, y: o.y + start.y, rot: 0 };
    this.flying.push(fly);
    // Remaining containers slide into the freed slot positions.
    this.boxes.forEach((b, i) => {
      const was = before[i >= idx ? i + 1 : i];
      const now = this.slotPos(i);
      b.ox = was.x - now.x;
      b.oy = was.y - now.y;
    });
    const slide = this.boxes.map((b) => ({ b, ox: b.ox, oy: b.oy }));
    void this.tween(0.5, (p) => slide.forEach((s) => ((s.b.ox = s.ox * (1 - easeInOut(p))), (s.b.oy = s.oy * (1 - easeInOut(p))))));
    const sx = fly.x;
    const sy = fly.y;
    const ex = Math.min(W - 60, sx + 40);
    const ey = WATER + 12;
    this.cue('whir');
    await this.tween(0.75, (p) => {
      fly.x = sx + (ex - sx) * p;
      fly.y = sy + (ey - sy) * p - Math.sin(p * Math.PI) * 26;
      fly.rot = p * 2.4;
    });
    this.flying = this.flying.filter((f) => f !== fly);
    const floater: Floater = { box, x: ex, y: ey, vx: 5, rot: 0.25, t: 0, gull: false };
    this.floaters.push(floater);
    this.cue('splash');
    this.splash(ex + BOX_W / 2, WATER + 8, 26);
    this.ship.springV -= 14;
    // Send a gull to perch on it.
    const g: Gull = { x: W + 10, y: 30, vx: -20, phase: 0, target: floater };
    this.gulls.push(g);
  }

  /** Overloaded: water over the deck, tilt, slide under, then fade to the underwater view. */
  async sink(): Promise<void> {
    const s = this.ship;
    const rm = this.reducedMotion();
    this.cue('creak');
    this.addShake(4);
    await this.tween(0.9, (p) => {
      s.ratio = 1.05 + p * 0.6;
      if (Math.random() < 0.7) this.splashOnDeck();
    });
    this.cue('foghorn');
    this.cue('splash');
    this.addShake(3);
    await this.tween(rm ? 1.6 : 2.6, (p) => {
      const e = easeIn(p);
      s.tilt = -0.32 * easeOut(Math.min(1, p * 1.6));
      s.drop = e * 120;
      s.x = DOCK_X + e * 26;
      if (Math.random() < 0.6) this.spawnBubble(s.x + 30 + Math.random() * 140, WATER + 4, WATER - 2);
    });
    s.visible = false;
    for (let i = 0; i < 18; i++) this.spawnBubble(DOCK_X + 40 + Math.random() * 140, WATER + 4 + Math.random() * 40, WATER - 2);
    this.cue('bubble');
    await this.tween(0.8, (p) => (this.fade = p));
    this.mode = 'underwater';
    this.bubbles = [];
    this.particles = [];
    this.cue('bubble');
    await this.tween(0.9, (p) => (this.fade = 1 - p));
  }

  /** Horn, then the ship sails off to the right. Fireworks if the trim is perfect. */
  async sail(perfect: boolean): Promise<void> {
    const s = this.ship;
    this.showSlots = false;
    this.cue('horn');
    if (perfect) {
      this.fireworksUntil = this.time + 6;
      this.flashUntil = this.time + 6;
      this.nextFirework = this.time + 0.3;
    }
    await this.wait(0.7);
    const from = s.x;
    await this.tween(this.reducedMotion() ? 2.2 : 3.4, (p) => {
      s.x = from + (W + 40 - from) * easeIn(p);
      if (Math.random() < 0.8) this.wake(s.x + 8, WATER + 1);
    });
    s.visible = false;
  }

  /** The best possible load, as a ghost ship rising out of the water (or from the wreck). */
  showGhost(specs: BoxSpec[], ratio: number): void {
    specs.forEach((s) => void loadFlag(s.iso2));
    this.ghost = { boxes: specs.map((s) => this.makeBox(s)), ratio, rise: 1, alpha: 0 };
    this.ghostBuf = null;
    const g = this.ghost;
    void this.tween(2.4, (p) => {
      g.rise = 1 - easeOut(p);
      g.alpha = easeInOut(p);
    });
  }

  hideGhost(): void {
    this.ghost = null;
  }

  // ---------------------------------------------------------------- internals

  private tween(dur: number, step: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) {
        step(1);
        resolve();
        return;
      }
      this.tweens.push({ t: 0, dur, step, done: resolve });
    });
  }

  private wait(sec: number): Promise<void> {
    return this.tween(sec, () => {});
  }

  private addShake(m: number): void {
    if (!this.reducedMotion()) this.shake = Math.max(this.shake, m);
  }

  private makeBox(spec: BoxSpec): Box {
    const canvas = document.createElement('canvas');
    canvas.width = BOX_W;
    canvas.height = BOX_H;
    const box: Box = { ...spec, color: BOX_COLORS[hashString(spec.iso3) % BOX_COLORS.length], canvas, hasFlag: false, ox: 0, oy: 0 };
    this.paintBox(box);
    return box;
  }

  private paintBox(box: Box): void {
    const c = box.canvas.getContext('2d')!;
    c.clearRect(0, 0, BOX_W, BOX_H);
    c.fillStyle = box.color;
    c.fillRect(0, 0, BOX_W, BOX_H);
    // corrugation
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 1; x < BOX_W - 1; x += 2) c.fillRect(x, 1, 1, BOX_H - 2);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(0, 0, BOX_W, 1);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, BOX_H - 1, BOX_W, 1);
    c.fillRect(0, 0, 1, BOX_H);
    c.fillRect(BOX_W - 1, 0, 1, BOX_H);
    // door bars
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(BOX_W - 4, 2, 1, BOX_H - 4);
    // flag plate
    const f = flag(box.iso2);
    c.fillStyle = '#1a1c2c';
    c.fillRect(2, 2, FLAG_W + 2, FLAG_H + 2);
    if (f) {
      c.drawImage(f, 3, 3);
      box.hasFlag = true;
    } else {
      c.fillStyle = '#55607a';
      c.fillRect(3, 3, FLAG_W, FLAG_H);
    }
    // stencilled ISO code
    drawText(c, box.iso3, 17, 5, 'rgba(0,0,0,0.35)');
    drawText(c, box.iso3, 17, 4, '#f3ead7');
  }

  private slotPos(i: number): { x: number; y: number } {
    const col = i % 3;
    const tier = Math.floor(i / 3);
    return { x: BX + 40 + col * 36, y: DECK - BOX_H * (tier + 1) };
  }

  private waterRow(ratio: number): number {
    return EMPTY_ROW - (EMPTY_ROW - LOAD_ROW) * ratio;
  }

  private bob(): number {
    const rm = this.reducedMotion();
    const amp = (rm ? 0.3 : 0.7) + this.tension * (rm ? 0.3 : 1.2);
    return Math.sin(this.time * 1.4) * amp;
  }

  /** World position of the ship buffer's top-left corner. */
  private shipOrigin(): { x: number; y: number } {
    const s = this.ship;
    const deckY = WATER - this.waterRow(s.shown) + s.spring + this.bob() + s.drop;
    return { x: Math.round(s.x - BX), y: Math.round(deckY - DECK) };
  }

  private update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // Tweens (copy: completing one may start another).
    for (const tw of this.tweens.slice()) {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.step(p);
      if (p >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }
    this.night += (this.nightTarget - this.night) * Math.min(1, dt * 0.35);
    this.shake *= Math.exp(-dt * 9);
    this.skyFlash *= Math.exp(-dt * 7);
    if (this.shake < 0.1) this.shake = 0;

    const s = this.ship;
    s.shown += (Math.min(s.ratio, 1.7) - s.shown) * Math.min(1, dt * 4);
    s.springV += (-90 * s.spring - 7 * s.springV) * dt;
    s.spring += s.springV * dt;

    // Crane pendulum, excited by trolley acceleration.
    const c = this.crane;
    const v = (c.x - c.lastX) / Math.max(dt, 1e-3);
    const a = (v - c.lastV) / Math.max(dt, 1e-3);
    c.lastX = c.x;
    c.lastV = v;
    if (c.carrying) c.swingV -= a * 0.0009;
    c.swingV += -c.swing * 14 * dt;
    c.swingV *= 1 - Math.min(1, 1.8 * dt);
    c.swing = clamp(c.swing + c.swingV * dt, -0.35, 0.35);
    if (this.pierDrop > 0) this.pierDrop = Math.max(0, this.pierDrop - dt * 5);

    // Repaint containers once their flags arrive.
    const all = [...this.boxes, ...(this.ghost?.boxes ?? []), ...this.floaters.map((f) => f.box), ...this.flying.map((f) => f.box)];
    if (this.pier) all.push(this.pier);
    if (c.carrying) all.push(c.carrying);
    for (const b of all) {
      if (!b.hasFlag && flag(b.iso2)) {
        this.paintBox(b);
        this.ghostBuf = null;
      }
    }

    // Particles
    for (const p of this.particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < H + 4);
    for (const b of this.bubbles) {
      b.y -= b.vy * dt;
      b.x += Math.sin(t * 3 + b.phase) * 6 * dt;
    }
    this.bubbles = this.bubbles.filter((b) => b.y > b.top);
    if (this.mode === 'underwater' && Math.random() < dt * 6) this.spawnBubble(150 + Math.random() * 60, 168, 0);

    // Floating containers drift off; perched gulls ride along.
    for (const f of this.floaters) {
      f.t += dt;
      f.x += f.vx * dt;
      f.rot *= 1 - Math.min(1, dt);
    }
    this.floaters = this.floaters.filter((f) => f.x < W + 10);

    // Gulls
    for (const g of this.gulls) {
      if (g.target) {
        const tx = g.target.x + 14;
        const ty = g.target.y - 5 + Math.sin(g.target.t * 2) * 0.8;
        const dx = tx - g.x;
        const dy = ty - g.y;
        const d = Math.hypot(dx, dy);
        if (d < 2 || g.target.gull) {
          g.target.gull = true;
        } else {
          const sp = 46;
          g.x += (dx / d) * sp * dt;
          g.y += (dy / d) * sp * dt;
          g.vx = dx < 0 ? -1 : 1;
        }
      } else {
        g.x += g.vx * dt;
        g.y += Math.sin(t * 0.8 + g.phase) * 4 * dt;
        if (g.x < -12) g.x = W + 10;
        if (g.x > W + 12) g.x = -10;
      }
    }
    this.gulls = this.gulls.filter((g) => !g.target || !g.target.gull || this.floaters.includes(g.target));
    if (this.mode === 'harbor' && t > this.nextGullCry) {
      this.cue('gull');
      this.nextGullCry = t + 9 + Math.random() * 14;
    }
    if (this.tension > 0.5 && s.visible && this.mode === 'harbor' && t > this.nextCreak) {
      this.cue('creak');
      this.nextCreak = t + 3.5 + Math.random() * 4;
    }

    for (const cl of this.clouds) {
      cl.x += cl.s * dt;
      if (cl.x > W + 10) cl.x = -cl.w - 10;
    }

    if (t < this.fireworksUntil && t > this.nextFirework) {
      this.launchFirework();
      this.nextFirework = t + 0.35 + Math.random() * 0.5;
    }
  }

  // ---------------------------------------------------------------- effects

  private splash(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 18,
        y,
        vx: (Math.random() - 0.5) * 50,
        vy: -30 - Math.random() * 70,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        color: Math.random() < 0.5 ? '#ffffff' : '#9fe3f0',
        size: Math.random() < 0.3 ? 2 : 1,
        g: 230,
      });
    }
  }

  private splashAlongHull(n: number): void {
    const x0 = this.ship.x;
    for (let i = 0; i < n; i++) this.splash(x0 + 10 + Math.random() * (HULL_L - 20), WATER, 1);
    this.splash(x0 + 4, WATER, 6);
    this.splash(x0 + HULL_L - 8, WATER, 6);
  }

  private splashOnDeck(): void {
    const o = this.shipOrigin();
    this.particles.push({
      x: o.x + BX + 20 + Math.random() * (HULL_L - 40),
      y: o.y + DECK - 1,
      vx: (Math.random() - 0.5) * 40,
      vy: -20 - Math.random() * 50,
      life: 0.6,
      max: 0.6,
      color: Math.random() < 0.5 ? '#ffffff' : '#7fd1d8',
      size: 1,
      g: 200,
    });
  }

  private wake(x: number, y: number): void {
    this.particles.push({ x: x - Math.random() * 10, y: y + Math.random() * 3, vx: -20 - Math.random() * 20, vy: -8 - Math.random() * 12, life: 0.7, max: 0.7, color: '#d8f6f8', size: 1, g: 40 });
  }

  private spawnBubble(x: number, y: number, top: number): void {
    this.bubbles.push({ x, y, vy: 18 + Math.random() * 26, r: Math.random() < 0.3 ? 2 : 1, phase: Math.random() * 6, top });
  }

  private launchFirework(): void {
    const x = 40 + Math.random() * 240;
    const y = 20 + Math.random() * 50;
    const colors = ['#ffd23f', '#ff5fa2', '#5ee0f0', '#b8f35a', '#ff8a3d', '#ffffff'];
    const col = colors[Math.floor(Math.random() * colors.length)];
    const col2 = colors[Math.floor(Math.random() * colors.length)];
    this.cue('firework');
    const rm = this.reducedMotion();
    const n = rm ? 20 : 48;
    // Outer ring of chunky sparks, inner ring of fine ones, and a bright core.
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.07;
        const sp = (ring ? 24 : 52) + Math.random() * 14;
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1.1 + Math.random() * 0.7,
          max: 1.8,
          color: ring ? col2 : col,
          size: ring === 0 && i % 2 === 0 ? 2 : 1,
          g: 22,
        });
      }
    }
    for (let i = 0; i < 8; i++) {
      this.particles.push({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#ffffff', size: 3, g: 0 });
    }
    if (!rm) this.skyFlash = 0.22;
  }

  // ---------------------------------------------------------------- drawing

  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * this.shake * 2), Math.round((Math.random() - 0.5) * this.shake * 2));
    if (this.mode === 'underwater') this.drawUnderwater();
    else this.drawHarbor();
    ctx.restore();
    if (this.skyFlash > 0.01) {
      ctx.fillStyle = `rgba(255,230,190,${this.skyFlash.toFixed(3)})`;
      ctx.fillRect(0, 0, W, HORIZON);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(3,6,18,${this.fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private skyColors(): [string, string, string] {
    const n = this.night;
    return [mix('#3b2f6b', '#060a1c', n), mix('#c4566e', '#1a2150', n), mix('#f7a74e', '#3b3266', n)];
  }

  private drawHarbor(): void {
    const ctx = this.ctx;
    const t = this.time;
    const n = this.night;
    const [top, mid, low] = this.skyColors();

    // Sky in chunky 4px bands.
    for (let y = 0; y < HORIZON; y += 4) {
      const k = y / HORIZON;
      ctx.fillStyle = k < 0.55 ? mix(top, mid, k / 0.55) : mix(mid, low, (k - 0.55) / 0.45);
      ctx.fillRect(0, y, W, 4);
    }
    // Stars
    const starA = clamp((n - 0.35) * 2);
    if (starA > 0) {
      for (let i = 0; i < 46; i++) {
        const tw = 0.6 + 0.4 * Math.sin(t * (1 + noise(i) * 2) + i);
        ctx.fillStyle = `rgba(255,248,220,${(starA * tw * (0.5 + noise(i + 40) * 0.5)).toFixed(2)})`;
        ctx.fillRect(Math.floor(noise(i + 1) * W), Math.floor(noise(i + 2) * 90), 1, 1);
      }
    }
    // Moon
    const moonA = clamp((n - 0.45) * 2.5);
    if (moonA > 0) {
      ctx.globalAlpha = moonA;
      this.disc(52, 26, 8, '#f2ecd0');
      this.disc(56, 23, 7, top);
      ctx.globalAlpha = 1;
    }
    // Sun, sinking into the sea as night falls
    const sunY = 112 + n * 44;
    if (sunY < HORIZON + 14) {
      this.disc(214, sunY, 15, mix('#ffb35c', '#ff6a3d', n * 1.5), 0.25);
      this.disc(214, sunY, 12, mix('#ffe08a', '#ff7a45', n * 1.4));
    }
    // Clouds
    for (const cl of this.clouds) this.cloud(cl.x, cl.y, cl.w, mix('#f6b48e', '#262c55', n), mix('#c67a8a', '#1a1f40', n));

    // Distant city
    const city = mix('#7a4f73', '#121835', n);
    for (let i = 0; i < 34; i++) {
      const bx = 64 + i * 6.6;
      const h = 6 + Math.floor(noise(i + 100) * 18);
      ctx.fillStyle = city;
      ctx.fillRect(Math.floor(bx), HORIZON - h, 6, h);
      for (let wy = HORIZON - h + 2; wy < HORIZON - 1; wy += 3) {
        for (let wx = 1; wx < 5; wx += 2) {
          const lit = noise(i * 31 + wy * 7 + wx) < n * 0.85;
          if (lit) {
            ctx.fillStyle = noise(i + wy + wx * 3) < 0.15 ? '#9fd8ff' : '#ffd27a';
            ctx.fillRect(Math.floor(bx) + wx, wy, 1, 1);
          }
        }
      }
    }
    // A blinking antenna light
    if (Math.sin(t * 3) > 0.2) {
      ctx.fillStyle = '#ff4d4d';
      ctx.fillRect(Math.floor(64 + 17 * 6.6) + 2, HORIZON - 25, 1, 1);
    }

    // Back sea
    const sea = ctx.createLinearGradient(0, HORIZON, 0, H);
    sea.addColorStop(0, mix('#3d7f96', '#14354f', n));
    sea.addColorStop(1, mix('#0d2140', '#040a18', n));
    ctx.fillStyle = sea;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);
    ctx.fillStyle = rgba('#ffd9a0', 0.35 * (1 - n));
    ctx.fillRect(0, HORIZON, W, 1);
    // Sun / moon glitter on the far water
    for (let i = 0; i < 12; i++) {
      const y = HORIZON + 2 + i * 1.2;
      const w = 6 + Math.sin(t * 2 + i) * 3 + i;
      ctx.fillStyle = n < 0.6 ? rgba('#ffd28a', 0.5 * (1 - n)) : rgba('#f2ecd0', 0.25 * (n - 0.4));
      ctx.fillRect(Math.round((n < 0.6 ? 214 : 52) - w / 2 + Math.sin(t * 1.3 + i * 2) * 2), Math.round(y), Math.round(w), 1);
    }

    this.drawLighthouse();
    this.drawWarehouses();
    this.drawPier();

    if (this.ghost && this.mode === 'harbor') this.drawGhost(DOCK_X, WATER);
    if (this.ship.visible) this.drawShip();
    this.drawCrane();
    for (const f of this.flying) this.drawRotated(f.box.canvas, f.x + BOX_W / 2, f.y + BOX_H / 2, f.rot);

    this.drawFrontWater();
    this.drawFloaters();
    this.drawGulls();
    this.drawParticles();
    this.drawBubbles();
  }

  private disc(cx: number, cy: number, r: number, color: string, alpha = 1): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha *= alpha;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
    ctx.globalAlpha /= alpha;
  }

  private cloud(x: number, y: number, w: number, light: string, dark: string): void {
    const ctx = this.ctx;
    const X = Math.round(x);
    const Y = Math.round(y);
    ctx.fillStyle = dark;
    ctx.fillRect(X, Y + 4, w, 4);
    ctx.fillStyle = light;
    ctx.fillRect(X + 2, Y + 2, w - 4, 4);
    ctx.fillRect(X + Math.floor(w * 0.2), Y - 2, Math.floor(w * 0.35), 4);
    ctx.fillRect(X + Math.floor(w * 0.5), Y, Math.floor(w * 0.3), 4);
  }

  private drawLighthouse(): void {
    const ctx = this.ctx;
    const n = this.night;
    const t = this.time;
    // rocks
    ctx.fillStyle = mix('#5a4a5a', '#1c1d33', n);
    ctx.fillRect(276, 124, 44, 30);
    ctx.fillRect(282, 120, 32, 6);
    ctx.fillStyle = mix('#7a6470', '#2a2a44', n);
    ctx.fillRect(284, 120, 12, 2);
    ctx.fillRect(278, 126, 8, 2);
    // tower, tapering
    for (let y = 66; y < 121; y++) {
      const k = (y - 66) / 55;
      const half = Math.round(4 + k * 3);
      const stripe = Math.floor((y - 66) / 8) % 2 === 0;
      ctx.fillStyle = stripe ? mix('#efe6d6', '#8e8aa6', n * 0.8) : mix('#c8402f', '#6a2430', n * 0.8);
      ctx.fillRect(298 - half, y, half * 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(298 + half - 2, y, 2, 1);
    }
    // gallery, lamp room, roof
    ctx.fillStyle = '#2a2236';
    ctx.fillRect(291, 64, 14, 2);
    const flashing = t < this.flashUntil;
    const lampOn = flashing ? Math.sin(t * 22) > 0 : true;
    const lamp = lampOn ? '#fff2b0' : '#7a6a3a';
    ctx.fillStyle = mix('#ffe9a6', lamp, n);
    ctx.fillRect(294, 58, 8, 6);
    ctx.fillStyle = '#2a2236';
    ctx.fillRect(294, 58, 1, 6);
    ctx.fillRect(301, 58, 1, 6);
    ctx.fillRect(293, 56, 10, 2);
    ctx.fillRect(296, 54, 4, 2);
    // rotating beam
    const ang = t * (flashing ? 4 : 1.1);
    const face = Math.cos(ang);
    const beamA = (0.1 + 0.32 * n) * Math.abs(face) * (flashing ? 1.6 : 1) * (lampOn ? 1 : 0.2);
    if (beamA > 0.02) {
      const dir = Math.sin(ang) > 0 ? -1 : 1;
      const len = 150 * Math.abs(face) + 20;
      ctx.fillStyle = `rgba(255,240,180,${Math.min(0.6, beamA).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(298, 61);
      ctx.lineTo(298 + dir * len, 61 - 10 * Math.abs(face));
      ctx.lineTo(298 + dir * len, 61 + 12 * Math.abs(face));
      ctx.closePath();
      ctx.fill();
    }
    // glow
    const glow = (0.1 + 0.22 * n) * (lampOn ? 1 : 0.3);
    this.disc(298, 61, 11, '#ffeca0', glow * 0.5);
    this.disc(298, 61, 7, '#ffeca0', glow);
  }

  private drawWarehouses(): void {
    const ctx = this.ctx;
    const n = this.night;
    // far warehouse
    ctx.fillStyle = mix('#4f5d78', '#1a2138', n);
    ctx.fillRect(30, 108, 42, 26);
    ctx.fillStyle = mix('#3a4560', '#121829', n);
    for (let i = 0; i < 4; i++) ctx.fillRect(30 + i * 11, 104, 8, 4);
    ctx.fillRect(30, 107, 42, 1);
    // near warehouse with sawtooth roof
    ctx.fillStyle = mix('#6a4d63', '#20192e', n);
    ctx.fillRect(0, 98, 40, 36);
    ctx.fillStyle = mix('#4a3548', '#150f1f', n);
    for (let i = 0; i < 5; i++) {
      for (let r = 0; r < 5; r++) ctx.fillRect(i * 8 + r, 93 + r, 8 - r, 1);
    }
    ctx.fillRect(0, 97, 40, 2);
    // big door + sign
    ctx.fillStyle = mix('#3b2b3d', '#0e0a15', n);
    ctx.fillRect(18, 114, 16, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 116; y < 134; y += 3) ctx.fillRect(18, y, 16, 1);
    ctx.fillStyle = mix('#d6c08a', '#2e2a20', n * 0.6);
    ctx.fillRect(4, 102, 30, 7);
    drawText(ctx, 'PIER 7', 7, 103, mix('#3b2b3d', '#ffb347', n));
    // windows
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = n > 0.3 ? mix('#2a2236', '#ffd27a', clamp((n - 0.3) * 3)) : '#2a2236';
      ctx.fillRect(4 + i * 7, 116, 4, 3);
      ctx.fillRect(48 + i * 10, 116, 5, 3);
    }
  }

  private drawPier(): void {
    const ctx = this.ctx;
    const n = this.night;
    ctx.fillStyle = mix('#3a2e2c', '#141018', n);
    for (let x = 4; x < 70; x += 13) ctx.fillRect(x, PIER_Y + 4, 3, H - PIER_Y);
    ctx.fillStyle = mix('#7d6a58', '#2c2630', n);
    ctx.fillRect(0, PIER_Y, 70, 4);
    ctx.fillStyle = mix('#a08a70', '#3a3440', n);
    ctx.fillRect(0, PIER_Y, 70, 1);
    // bollards
    ctx.fillStyle = mix('#2a2a2a', '#0c0c10', n);
    ctx.fillRect(62, PIER_Y - 3, 4, 3);
    ctx.fillRect(4, PIER_Y - 3, 3, 3);
    // mooring rope to the ship
    if (this.ship.visible && this.ship.x < DOCK_X + 4 && this.mode === 'harbor') {
      const o = this.shipOrigin();
      ctx.fillStyle = mix('#c9b48a', '#4a4236', n);
      const x1 = 64;
      const y1 = PIER_Y - 2;
      const x2 = o.x + BX + 4;
      const y2 = o.y + DECK + 2;
      for (let i = 0; i <= 12; i++) {
        const k = i / 12;
        ctx.fillRect(Math.round(x1 + (x2 - x1) * k), Math.round(y1 + (y2 - y1) * k + Math.sin(k * Math.PI) * 3), 1, 1);
      }
    }
    if (this.pier) {
      const y = PIER_Y - BOX_H - Math.round(this.pierDrop * 8);
      ctx.drawImage(this.pier.canvas, PICK_X, y);
    }
  }

  private paintShip(ctx: CanvasRenderingContext2D, boxes: Box[], showSlots: boolean, hold: number, nightLights: number): void {
    ctx.clearRect(0, 0, BUF_W, BUF_H);
    const lit = (base: string) => mix(base, '#ffd27a', nightLights);
    // funnel
    ctx.fillStyle = '#2b2b3a';
    ctx.fillRect(BX + 13, DECK - 46, 10, 12);
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(BX + 13, DECK - 42, 10, 3);
    ctx.fillStyle = '#1d1d28';
    ctx.fillRect(BX + 13, DECK - 46, 10, 1);
    // bridge
    ctx.fillStyle = '#e9e4d6';
    ctx.fillRect(BX + 4, DECK - 34, 30, 34);
    ctx.fillStyle = '#b9b3a6';
    ctx.fillRect(BX + 30, DECK - 34, 4, 34);
    ctx.fillStyle = '#d2ccbe';
    ctx.fillRect(BX + 2, DECK - 34, 34, 2);
    ctx.fillStyle = lit('#1b2335');
    for (let i = 0; i < 6; i++) ctx.fillRect(BX + 6 + i * 4, DECK - 30, 3, 3);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) ctx.fillRect(BX + 8 + i * 6, DECK - 22 + r * 7, 2, 2);
    // mast and light at the bow
    ctx.fillStyle = '#b9b3a6';
    ctx.fillRect(BX + HULL_L - 14, DECK - 24, 1, 24);
    ctx.fillRect(BX + HULL_L - 17, DECK - 18, 7, 1);
    ctx.fillStyle = Math.sin(this.time * 4) > 0 ? '#ff5050' : '#7a2020';
    ctx.fillRect(BX + HULL_L - 14, DECK - 26, 1, 2);
    // empty slot outlines
    if (showSlots) {
      for (let i = boxes.length; i < hold; i++) {
        const p = this.slotPos(i);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        for (let x = 0; x < BOX_W; x += 3) {
          ctx.fillRect(p.x + x, p.y, 2, 1);
          ctx.fillRect(p.x + x, p.y + BOX_H - 1, 2, 1);
        }
        for (let y = 0; y < BOX_H; y += 3) {
          ctx.fillRect(p.x, p.y + y, 1, 2);
          ctx.fillRect(p.x + BOX_W - 1, p.y + y, 1, 2);
        }
      }
    }
    // containers
    boxes.forEach((b, i) => {
      const p = this.slotPos(i);
      ctx.drawImage(b.canvas, Math.round(p.x + b.ox), Math.round(p.y + b.oy));
    });
    // hull
    for (let r = 0; r < HULL_ROWS; r++) {
      const left = BX + Math.floor((r * r) / 90);
      const right = BX + HULL_L - Math.floor(r * 0.9) + (r === 0 ? 2 : 0);
      let col: string;
      if (r === 0) col = '#c9ced6';
      else if (r === 1) col = '#8d97a8';
      else if (r === 2) col = '#3a5784';
      else if (r < 20) col = '#263a5a';
      else if (r === 20) col = '#e8e2d0';
      else col = r === HULL_ROWS - 1 ? '#7a241e' : '#a8352c';
      ctx.fillStyle = col;
      ctx.fillRect(left, DECK + r, right - left, 1);
    }
    // portholes
    ctx.fillStyle = lit('#0f1a2c');
    for (let x = BX + 44; x < BX + 150; x += 9) ctx.fillRect(x, DECK + 7, 2, 2);
    // name on the bow
    drawText(ctx, 'LOADLINE', BX + 124, DECK + 4, '#e9e4d6');
    // painted load line: a dashed line along the hull and a Plimsoll mark
    const ly = DECK + LOAD_ROW;
    ctx.fillStyle = '#ff7a1a';
    for (let x = BX + 46; x < BX + HULL_L - 18; x += 6) ctx.fillRect(x, ly, 4, 1);
    const cx = BX + 28;
    ctx.fillStyle = '#ffe2c4';
    for (let a = 0; a < 28; a++) {
      const th = (a / 28) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(th) * 5), Math.round(ly + Math.sin(th) * 5), 1, 1);
    }
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(cx - 9, ly, 19, 1);
    ctx.fillRect(cx + 13, ly - 6, 1, 10);
    for (let k = 0; k < 4; k++) ctx.fillRect(cx + 14, ly - 6 + k * 3, 3, 1);
    drawText(ctx, 'L', cx - 8, ly - 7, '#ffe2c4');
    drawText(ctx, 'R', cx + 6, ly - 7, '#ffe2c4');
  }

  private drawShip(): void {
    const ctx = this.ctx;
    const nightLights = clamp((this.night - 0.3) * 2);
    this.paintShip(this.bctx, this.boxes, this.showSlots, this.hold, nightLights);
    const o = this.shipOrigin();
    if (this.ship.tilt !== 0) {
      const pivotX = o.x + BX + HULL_L / 2;
      const pivotY = o.y + DECK + 20;
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate(this.ship.tilt);
      ctx.drawImage(this.buf, -(BX + HULL_L / 2), -(DECK + 20));
      ctx.restore();
    } else {
      ctx.drawImage(this.buf, o.x, o.y);
    }
    // foam where the hull meets the water
    if (this.ship.drop < 10) {
      ctx.fillStyle = 'rgba(230,250,255,0.75)';
      for (let i = 0; i < 10; i++) {
        const x = this.ship.x + 6 + ((i * 19 + this.time * 7) % (HULL_L - 10));
        ctx.fillRect(Math.round(x), WATER - 1 + Math.round(Math.sin(this.time * 3 + i)), 2, 1);
      }
    }
  }

  private drawGhost(x: number, waterY: number, underwater = false): void {
    const g = this.ghost!;
    if (!this.ghostBuf) {
      const c = document.createElement('canvas');
      c.width = BUF_W;
      c.height = BUF_H;
      const gc = c.getContext('2d')!;
      this.paintShip(gc, g.boxes, false, g.boxes.length, 0);
      gc.globalCompositeOperation = 'source-atop';
      gc.fillStyle = 'rgba(140,240,255,0.55)';
      gc.fillRect(0, 0, BUF_W, BUF_H);
      gc.globalCompositeOperation = 'source-over';
      // scanline gaps for a spectral look
      gc.globalCompositeOperation = 'destination-out';
      gc.fillStyle = 'rgba(0,0,0,0.45)';
      for (let y = 0; y < BUF_H; y += 2) gc.fillRect(0, y, BUF_W, 1);
      gc.globalCompositeOperation = 'source-over';
      this.ghostBuf = c;
    }
    const ctx = this.ctx;
    const flicker = 0.85 + 0.15 * Math.sin(this.time * 9) * Math.sin(this.time * 2.3);
    const deckY = waterY - this.waterRow(g.ratio) + Math.sin(this.time * 1.2 + 1) * 0.8 + g.rise * (underwater ? 70 : 40);
    ctx.globalAlpha = g.alpha * 0.8 * flicker;
    ctx.drawImage(this.ghostBuf, Math.round(x - BX + Math.sin(this.time * 0.7) * (underwater ? 3 : 0)), Math.round(deckY - DECK));
    ctx.globalAlpha = 1;
  }

  private drawCrane(): void {
    const ctx = this.ctx;
    const n = this.night;
    const c = this.crane;
    const steel = mix('#f2a33a', '#7a5226', n * 0.7);
    const dark = mix('#b8692a', '#4a3018', n * 0.7);
    // tower (lattice)
    ctx.fillStyle = steel;
    ctx.fillRect(9, JIB_Y, 2, PIER_Y - JIB_Y);
    ctx.fillRect(17, JIB_Y, 2, PIER_Y - JIB_Y);
    ctx.fillStyle = dark;
    for (let y = JIB_Y + 4; y < PIER_Y; y += 8) {
      for (let k = 0; k < 8; k++) {
        ctx.fillRect(11 + k * 0.75, y + k, 1, 1);
        ctx.fillRect(17 - k * 0.75, y + k, 1, 1);
      }
    }
    // base
    ctx.fillStyle = mix('#3a3a44', '#15151c', n);
    ctx.fillRect(6, PIER_Y - 4, 16, 4);
    // jib + counter-jib
    ctx.fillStyle = steel;
    ctx.fillRect(0, JIB_Y, 266, 2);
    ctx.fillRect(0, JIB_Y + 5, 266, 1);
    ctx.fillStyle = dark;
    for (let x = 0; x < 264; x += 6) {
      ctx.fillRect(x, JIB_Y + 2, 1, 3);
      ctx.fillRect(x + 3, JIB_Y + 3, 1, 1);
    }
    // apex and stays
    ctx.fillStyle = steel;
    ctx.fillRect(13, JIB_Y - 14, 2, 14);
    ctx.fillStyle = dark;
    for (let i = 0; i < 60; i++) {
      const k = i / 60;
      ctx.fillRect(Math.round(14 + k * 200), Math.round(JIB_Y - 14 + k * 14), 1, 1);
    }
    // counterweight + cab
    ctx.fillStyle = mix('#555060', '#1c1a24', n);
    ctx.fillRect(0, JIB_Y + 6, 7, 7);
    ctx.fillStyle = steel;
    ctx.fillRect(14, JIB_Y + 6, 12, 8);
    ctx.fillStyle = mix('#1b2335', '#ffd27a', clamp((n - 0.3) * 2));
    ctx.fillRect(20, JIB_Y + 8, 5, 3);
    // warning light
    if (Math.sin(this.time * 2.5) > 0.3) {
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(13, JIB_Y - 16, 2, 2);
    }
    // trolley, cable, spreader and load
    const tx = Math.round(c.x);
    ctx.fillStyle = mix('#3a3a44', '#15151c', n);
    ctx.fillRect(tx - 4, JIB_Y + 5, 8, 3);
    const len = c.hook - (JIB_Y + 8);
    const swingX = Math.sin(c.swing) * len;
    const hx = tx + swingX;
    ctx.fillStyle = mix('#2a2a30', '#0c0c10', n);
    for (let i = 0; i < len; i++) {
      const k = i / Math.max(1, len);
      ctx.fillRect(Math.round(tx - 2 + swingX * k), JIB_Y + 8 + i, 1, 1);
      ctx.fillRect(Math.round(tx + 2 + swingX * k), JIB_Y + 8 + i, 1, 1);
    }
    ctx.fillStyle = mix('#e0c23a', '#6a5a20', n * 0.6);
    ctx.fillRect(Math.round(hx - BOX_W / 2), Math.round(c.hook) - 2, BOX_W, 2);
    if (c.carrying) ctx.drawImage(c.carrying.canvas, Math.round(hx - BOX_W / 2), Math.round(c.hook));
  }

  private drawRotated(img: CanvasImageSource, cx: number, cy: number, rot: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(rot);
    ctx.drawImage(img, -BOX_W / 2, -BOX_H / 2);
    ctx.restore();
  }

  private waveAt(x: number): number {
    const amp = 0.8 + this.tension * 1.8;
    const t = this.time * (1 + this.tension * 0.8);
    return Math.sin(x * 0.07 + t * 1.6) * amp + Math.sin(x * 0.17 - t * 2.3) * amp * 0.45;
  }

  private drawFrontWater(): void {
    const ctx = this.ctx;
    const n = this.night;
    const t = this.time;
    const grad = ctx.createLinearGradient(0, WATER, 0, H);
    grad.addColorStop(0, rgba(n < 0.5 ? '#2b8299' : '#1a4a66', 0.84));
    grad.addColorStop(1, rgba(n < 0.5 ? '#0c2448' : '#050d22', 0.94));
    ctx.fillStyle = grad;
    for (let x = 0; x < W; x += 2) {
      const y = Math.round(WATER + this.waveAt(x));
      ctx.fillRect(x, y, 2, H - y);
    }
    // surface highlight
    ctx.fillStyle = rgba('#a8eef2', 0.55 - n * 0.25);
    for (let x = 0; x < W; x += 2) {
      const y = Math.round(WATER + this.waveAt(x));
      if (Math.sin(x * 0.3 + t * 2) > -0.2) ctx.fillRect(x, y, 2, 1);
    }
    // layered parallax wave dashes, slower and dimmer with depth
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      const y0 = WATER + 7 + l * 13;
      const speed = (l + 1) * 6 * (1 + this.tension);
      const alpha = 0.32 - l * 0.06 + this.tension * 0.1;
      ctx.fillStyle = rgba('#9fe0ea', Math.max(0.05, alpha) * (1 - n * 0.4));
      const count = 9 + l * 3 + Math.round(this.tension * 8);
      for (let i = 0; i < count; i++) {
        const x = (noise(i * 7 + l * 50) * (W + 40) + t * speed * (l % 2 ? -1 : 1)) % (W + 40);
        const xx = Math.round(x < 0 ? x + W + 40 : x) - 20;
        const yy = Math.round(y0 + noise(i + l * 13) * 8 + Math.sin(t * 1.5 + i) * (0.8 + this.tension * 1.5));
        const w = 3 + Math.floor(noise(i * 3 + l) * 6);
        ctx.fillRect(xx, yy, w, 1);
      }
    }
    // reflections: sun at dusk, lighthouse/moon at night
    for (let i = 0; i < 8; i++) {
      const y = WATER + 4 + i * 6;
      if (y >= H) break;
      const w = 2 + Math.round(Math.abs(Math.sin(t * 2 + i)) * 5);
      if (n < 0.6) {
        ctx.fillStyle = rgba('#ffcf8a', 0.3 * (1 - n));
        ctx.fillRect(Math.round(214 - w / 2 + Math.sin(t + i) * 3), y, w, 1);
      }
      ctx.fillStyle = rgba('#fff0b0', 0.12 + n * 0.2);
      ctx.fillRect(Math.round(298 - w / 2 + Math.sin(t * 1.3 + i) * 2), y + 2, w, 1);
    }
  }

  private drawFloaters(): void {
    const ctx = this.ctx;
    for (const f of this.floaters) {
      const bobY = Math.sin(f.t * 2) * 1.2;
      const cx = f.x + BOX_W / 2;
      const cy = f.y + BOX_H / 2 + bobY;
      this.drawRotated(f.box.canvas, cx, cy, f.rot + Math.sin(f.t * 1.7) * 0.06);
      // waterline over the lower part
      ctx.fillStyle = rgba('#1f6f88', 0.75);
      ctx.fillRect(Math.round(f.x - 2), Math.round(f.y + 9 + bobY), BOX_W + 4, 8);
      ctx.fillStyle = rgba('#d8f6f8', 0.7);
      ctx.fillRect(Math.round(f.x - 2), Math.round(f.y + 9 + bobY), BOX_W + 4, 1);
      if (f.gull) {
        drawSprite(ctx, GULL_SITTING, f.x + 13, f.y - 4 + bobY, { w: '#f4f4f4', k: '#ffb02e', g: '#9aa3b5', y: '#ffb02e' });
      }
    }
  }

  private drawGulls(): void {
    const ctx = this.ctx;
    const pal = { w: mix('#ffffff', '#c9cbe0', this.night) };
    for (const g of this.gulls) {
      if (g.target?.gull) continue;
      const frame = GULL_FRAMES[Math.floor((this.time * 7 + g.phase * 3) % 3)];
      drawSprite(ctx, frame, g.x, g.y, pal, g.vx < 0);
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / (p.max * 0.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawBubbles(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(200,240,255,0.7)';
    for (const b of this.bubbles) {
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      if (b.r === 1) ctx.fillRect(x, y, 1, 1);
      else {
        ctx.fillRect(x, y - 1, 2, 1);
        ctx.fillRect(x - 1, y, 1, 2);
        ctx.fillRect(x + 2, y, 1, 2);
        ctx.fillRect(x, y + 2, 2, 1);
      }
    }
  }

  private drawUnderwater(): void {
    const ctx = this.ctx;
    const t = this.time;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e3a5c');
    g.addColorStop(0.5, '#08213d');
    g.addColorStop(1, '#030916');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // surface shimmer
    ctx.fillStyle = 'rgba(140,220,240,0.25)';
    for (let x = 0; x < W; x += 3) ctx.fillRect(x, Math.round(4 + Math.sin(x * 0.1 + t * 2) * 2), 2, 1);
    // light rays
    for (let i = 0; i < 5; i++) {
      const x = 30 + i * 62 + Math.sin(t * 0.4 + i) * 8;
      ctx.fillStyle = `rgba(150,220,255,${(0.05 + 0.03 * Math.sin(t + i)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 14, 0);
      ctx.lineTo(x + 48, H);
      ctx.lineTo(x + 22, H);
      ctx.closePath();
      ctx.fill();
    }
    if (this.ghost) this.drawGhost(DOCK_X, 90, true);
    // seabed
    ctx.fillStyle = '#2a2a33';
    for (let x = 0; x < W; x += 4) {
      const h = 18 + Math.round(Math.sin(x * 0.05) * 4 + noise(x) * 3);
      ctx.fillRect(x, H - h, 4, h);
    }
    ctx.fillStyle = '#3d3a40';
    for (let x = 0; x < W; x += 4) {
      const h = 18 + Math.round(Math.sin(x * 0.05) * 4 + noise(x) * 3);
      ctx.fillRect(x, H - h, 4, 1);
    }
    // seaweed
    for (let i = 0; i < 9; i++) {
      const bx = 12 + i * 36 + noise(i) * 10;
      const h = 14 + Math.floor(noise(i + 4) * 20);
      ctx.fillStyle = i % 2 ? '#1f6b4a' : '#2b8a5a';
      for (let y = 0; y < h; y++) {
        const sway = Math.sin(t * 1.5 + y * 0.25 + i) * (y / h) * 4;
        ctx.fillRect(Math.round(bx + sway), H - 16 - y, 2, 1);
      }
    }
    // the wreck, resting on the bottom
    const nightLights = 0;
    this.paintShip(this.bctx, this.boxes, false, this.hold, nightLights);
    const tc = this.tint.getContext('2d')!;
    tc.clearRect(0, 0, BUF_W, BUF_H);
    tc.drawImage(this.buf, 0, 0);
    tc.globalCompositeOperation = 'source-atop';
    tc.fillStyle = 'rgba(8,30,60,0.55)';
    tc.fillRect(0, 0, BUF_W, BUF_H);
    tc.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(160, 166);
    ctx.rotate(0.14);
    ctx.drawImage(this.tint, -(BX + HULL_L / 2), -(DECK + 16));
    ctx.restore();
    // fish
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 ? 1 : -1;
      const x = ((t * (10 + i * 5) * dir + i * 120) % (W + 40) + W + 40) % (W + 40) - 20;
      const y = 50 + i * 30 + Math.sin(t + i) * 4;
      ctx.fillStyle = ['#ff9f43', '#5ee0c8', '#ffd23f'][i];
      ctx.fillRect(Math.round(x), Math.round(y), 5, 3);
      ctx.fillRect(Math.round(x + (dir > 0 ? -2 : 5)), Math.round(y - 1), 2, 5);
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(Math.round(x + (dir > 0 ? 3 : 1)), Math.round(y + 1), 1, 1);
    }
    this.drawBubbles();
    this.drawParticles();
  }
}
