// Low-resolution flags. The open-source flag-icons SVGs are rasterised once into tiny
// canvases (12x9 by default) and then drawn with nearest-neighbour scaling, which gives
// them a chunky pixel-art look both on containers and in the HTML UI.

const urls = import.meta.glob('/node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const byCode = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -4);
  byCode.set(code, url);
}

export const FLAG_W = 12;
export const FLAG_H = 9;

const cache = new Map<string, HTMLCanvasElement | null>();
const pending = new Map<string, Promise<HTMLCanvasElement | null>>();

/** Returns the rasterised flag if ready, otherwise starts loading it and returns null. */
export function flag(iso2: string): HTMLCanvasElement | null {
  const code = iso2.toLowerCase();
  if (cache.has(code)) return cache.get(code) ?? null;
  void loadFlag(code);
  return null;
}

export function loadFlag(iso2: string): Promise<HTMLCanvasElement | null> {
  const code = iso2.toLowerCase();
  if (cache.has(code)) return Promise.resolve(cache.get(code) ?? null);
  let p = pending.get(code);
  if (p) return p;
  const url = byCode.get(code);
  if (!url) {
    cache.set(code, null);
    return Promise.resolve(null);
  }
  p = new Promise((resolve) => {
    const fail = () => {
      cache.set(code, null);
      resolve(null);
    };
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      // Downsample in two steps for cleaner colours, then keep the tiny result.
      const mid = document.createElement('canvas');
      mid.width = FLAG_W * 4;
      mid.height = FLAG_H * 4;
      const m = mid.getContext('2d')!;
      m.drawImage(img, 0, 0, mid.width, mid.height);
      const out = document.createElement('canvas');
      out.width = FLAG_W;
      out.height = FLAG_H;
      const o = out.getContext('2d')!;
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'high';
      o.drawImage(mid, 0, 0, FLAG_W, FLAG_H);
      cache.set(code, out);
      resolve(out);
    };
    img.onerror = fail;
    // The SVGs only carry a viewBox; Firefox won't rasterise an SVG image without an
    // intrinsic size, so add one before loading.
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((svg) => {
        const sized = svg.replace('<svg ', '<svg width="640" height="480" ');
        img.src = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
      })
      .catch(fail);
  });
  pending.set(code, p);
  return p;
}

/** A small <canvas> element showing the pixelated flag, for use in the HTML UI. */
export function flagElement(iso2: string, label: string): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = FLAG_W;
  el.height = FLAG_H;
  el.className = 'flag';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `Flag of ${label}`);
  const paint = (src: HTMLCanvasElement | null) => {
    const c = el.getContext('2d')!;
    if (src) c.drawImage(src, 0, 0);
    else {
      c.fillStyle = '#3a4466';
      c.fillRect(0, 0, FLAG_W, FLAG_H);
    }
  };
  const ready = flag(iso2);
  if (ready) paint(ready);
  else void loadFlag(iso2).then(paint);
  return el;
}
