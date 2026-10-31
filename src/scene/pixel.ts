// Pixel-art helpers: colour maths, a 3x5 stencil font and string-defined sprites.

export type RGB = [number, number, number];

const rgbCache = new Map<string, RGB>();
export function hex(h: string): RGB {
  let c = rgbCache.get(h);
  if (!c) {
    if (h.startsWith('rgb')) {
      const [r, g, b] = h.slice(h.indexOf('(') + 1, -1).split(',').map(Number);
      c = [r, g, b];
    } else {
      const n = parseInt(h.slice(1), 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    if (rgbCache.size > 4000) rgbCache.clear();
    rgbCache.set(h, c);
  }
  return c;
}

export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(x[0] + (y[0] - x[0]) * k);
  const g = Math.round(x[1] + (y[1] - x[1]) * k);
  const bl = Math.round(x[2] + (y[2] - x[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

export function rgba(h: string, a: number): string {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
}

// 3x5 font, one string of 15 bits per glyph (rows top to bottom).
const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  '-': '000000111000000', '#': '101111101111101', ' ': '000000000000000',
};

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1): void {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') ctx.fillRect(cx + (i % 3) * scale, cy + Math.floor(i / 3) * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
}

export function textWidth(text: string, scale = 1): number {
  return text.length * 4 * scale - scale;
}

/** Draws a sprite given as rows of characters; '.' is transparent. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  palette: Record<string, string>,
  flip = false,
): void {
  const w = rows[0].length;
  const ox = Math.round(x);
  const oy = Math.round(y);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(ox + (flip ? w - 1 - c : c), oy + r, 1, 1);
    }
  }
}

export const GULL_FRAMES = [
  ['ww...ww', '..w.w..', '...w...'],
  ['.......', 'wwwwwww', '...w...'],
  ['...w...', '.ww.ww.', 'w.....w'],
];

export const GULL_SITTING = ['..ww.', '.wwwk', 'gwww.', '..y..'];

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}
export function easeIn(t: number): number {
  return t * t * t;
}
export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Small deterministic hash -> [0, 1), handy for stable "random" scenery. */
export function noise(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
