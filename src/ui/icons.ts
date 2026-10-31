// 8x8 pixel icons, rendered as crisp SVG in the current text colour.

const GRIDS: Record<string, string[]> = {
  help: ['..XXXX..', '.XX..XX.', '.....XX.', '....XX..', '...XX...', '........', '...XX...', '...XX...'],
  stats: ['......XX', '......XX', '...XX.XX', '...XX.XX', 'XX.XX.XX', 'XX.XX.XX', 'XX.XX.XX', 'XXXXXXXX'],
  gear: ['...XX...', '.XXXXXX.', '.XX..XX.', 'XX....XX', 'XX....XX', '.XX..XX.', '.XXXXXX.', '...XX...'],
  sound: ['...X....', '..XX..X.', 'XXXX...X', 'XXXX.X.X', 'XXXX.X.X', 'XXXX...X', '..XX..X.', '...X....'],
  mute: ['...X....', '..XX....', 'XXXX.X.X', 'XXXX..X.', 'XXXX..X.', 'XXXX.X.X', '..XX....', '...X....'],
  anchor: ['...XX...', '..X..X..', '...XX...', '...XX...', '.XXXXXX.', 'X..XX..X', 'XX.XX.XX', '.XXXXXX.'],
  ship: ['....X...', '....XX..', '....XXX.', '....X...', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '........'],
  lock: ['..XXXX..', '.X....X.', '.X....X.', 'XXXXXXXX', 'XXX..XXX', 'XXX..XXX', 'XXXXXXXX', '........'],
  close: ['XX....XX', '.XX..XX.', '..XXXX..', '...XX...', '..XXXX..', '.XX..XX.', 'XX....XX', '........'],
};

export function icon(name: keyof typeof GRIDS | string): string {
  const grid = GRIDS[name];
  if (!grid) return '';
  let rects = '';
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return `<svg viewBox="0 0 8 8" width="100%" height="100%" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
