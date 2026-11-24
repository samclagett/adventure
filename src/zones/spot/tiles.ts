/**
 * Ground data for the 3D spot view: heights and a satellite photo for a square around one place.
 *
 * Both come from free, keyless map tiles (web mercator, the same scheme MapLibre uses):
 * - Heights: Mapzen/AWS terrarium tiles (also used by the main map). Along the Australian coast these come
 *   from Geoscience Australia's 5 m LiDAR model, so beaches, dunes and headlands are close to real.
 * - Photo: Esri World Imagery (free for non-commercial use with credit), sharper zoom levels in the middle.
 *
 * `GroundSource` is the one thing the scene needs. A Google Photorealistic 3D Tiles source (needs Sam's
 * Google Maps Platform key) can be added later as a different way of drawing the ground; see README.md.
 */

const TERRAIN_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMAGERY_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const EARTH = 40075016.686;

/** A square of ground: `size` metres a side, centred on lat/lng. Heights are a `grid` × `grid` array, north row first. */
export interface Ground {
  size: number;
  grid: number;
  heights: Float32Array;
  photo: HTMLCanvasElement;
}

/** Fractional tile coordinates at zoom z. */
function tileXY(lat: number, lng: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

const metresPerTile = (lat: number, z: number) => (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Draw the tiles at zoom z covering the box [x0, y0]–[x1, y1] (tile coordinates at that zoom) into `ctx`,
 * stretched to fill `out` pixels a side.
 */
async function drawTiles(
  ctx: CanvasRenderingContext2D,
  url: (z: number, x: number, y: number) => string,
  z: number,
  box: [number, number, number, number],
  out: [number, number, number, number],
): Promise<number> {
  const [x0, y0, x1, y1] = box;
  const [ox, oy, ow, oh] = out;
  const sx = ow / (x1 - x0);
  const sy = oh / (y1 - y0);
  const jobs: Promise<void>[] = [];
  let loaded = 0;
  for (let ty = Math.floor(y0); ty < y1; ty++) {
    for (let tx = Math.floor(x0); tx < x1; tx++) {
      jobs.push(
        loadImage(url(z, tx, ty)).then((img) => {
          if (!img) return;
          loaded++;
          // Overlap by a fraction of a pixel so no seams show between tiles.
          ctx.drawImage(img, ox + (tx - x0) * sx - 0.25, oy + (ty - y0) * sy - 0.25, sx + 0.5, sy + 0.5);
        }),
      );
    }
  }
  await Promise.all(jobs);
  return loaded;
}

/** The box (tile coordinates at zoom z) for a square `size` metres a side around lat/lng. */
function boxAt(lat: number, lng: number, size: number, z: number): [number, number, number, number] {
  const [cx, cy] = tileXY(lat, lng, z);
  const half = size / 2 / metresPerTile(lat, z);
  return [cx - half, cy - half, cx + half, cy + half];
}

/** Heights in metres, `grid` × `grid`, from terrarium tiles at zoom 15 (about 4 m per pixel). */
async function loadHeights(lat: number, lng: number, size: number, grid: number): Promise<Float32Array> {
  const z = 15;
  const box = boxAt(lat, lng, size, z);
  // Decode at the tiles' own pixel size: smoothing would blend the colour-coded heights into nonsense.
  const px = Math.ceil((box[2] - box[0]) * 256);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  const [x0, y0] = box;
  const fx = Math.floor(x0);
  const fy = Math.floor(y0);
  const jobs: Promise<void>[] = [];
  for (let ty = fy; ty < box[3]; ty++) {
    for (let tx = fx; tx < box[2]; tx++) {
      jobs.push(
        loadImage(TERRAIN_URL(z, tx, ty)).then((img) => {
          if (img) ctx.drawImage(img, Math.round((tx - x0) * 256), Math.round((ty - y0) * 256));
        }),
      );
    }
  }
  await Promise.all(jobs);
  const data = ctx.getImageData(0, 0, px, px).data;
  const raw = new Float32Array(px * px);
  for (let i = 0; i < raw.length; i++) raw[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
  // Missing tiles decode as -32768: treat them as sea level.
  for (let i = 0; i < raw.length; i++) if (raw[i] < -1000) raw[i] = 0;

  // Resample to the grid (bilinear).
  const out = new Float32Array(grid * grid);
  const scale = (px - 1) / (grid - 1);
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const x = c * scale;
      const y = r * scale;
      const xi = Math.min(px - 2, Math.floor(x));
      const yi = Math.min(px - 2, Math.floor(y));
      const tx = x - xi;
      const ty = y - yi;
      const a = raw[yi * px + xi];
      const b = raw[yi * px + xi + 1];
      const c2 = raw[(yi + 1) * px + xi];
      const d = raw[(yi + 1) * px + xi + 1];
      out[r * grid + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/**
 * The satellite photo, `px` pixels a side, from the zoom whose pixels best match (or one given).
 * The scene uses two: the whole square, and a much sharper one for the middle (the beach itself).
 */
export async function loadPhoto(lat: number, lng: number, size: number, px: number, zoom?: number): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1d3a48';
  ctx.fillRect(0, 0, px, px);
  // The coarsest zoom that is still at least as sharp as the canvas.
  const mPerPx = size / px;
  let z = zoom ?? 18;
  if (zoom == null) while (z > 10 && metresPerTile(lat, z - 1) / 256 <= mPerPx * 1.1) z--;
  const loaded = await drawTiles(ctx, IMAGERY_URL, z, boxAt(lat, lng, size, z), [0, 0, px, px]);
  return loaded ? canvas : null;
}

/** If the photo can't be fetched, colour the ground by height instead (sand, scrub, forest, rock), like the main map. */
function reliefPhoto(heights: Float32Array, grid: number, size: number): HTMLCanvasElement {
  // Distance from the sea: the same distance field, run on the water instead of the land.
  const wet = new Float32Array(heights.length);
  for (let i = 0; i < wet.length; i++) wet[i] = heights[i] > 0.6 ? 0 : 1;
  const fromSea = distanceFromLand({ size, grid, heights: wet, photo: document.createElement('canvas') }, 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = grid;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid, grid);
  const stops: [number, [number, number, number]][] = [
    [-30, [20, 70, 90]],
    [0, [60, 130, 135]],
    [0.6, [226, 214, 176]],
    [5, [210, 200, 158]],
    [12, [118, 140, 88]],
    [80, [86, 116, 70]],
    [250, [104, 122, 82]],
    [600, [150, 140, 116]],
    [1200, [200, 196, 186]],
  ];
  for (let i = 0; i < heights.length; i++) {
    let h = heights[i];
    // Sand only along the shore; low ground further in is grass.
    if (h > 0.6 && h < 12 && fromSea[i] > 60) h = 12 + h;
    let k = stops.findIndex(([v]) => v > h);
    if (k <= 0) k = k === 0 ? 1 : stops.length - 1;
    const [a, ca] = stops[k - 1];
    const [b, cb] = stops[k];
    const t = Math.max(0, Math.min(1, (h - a) / (b - a)));
    for (let j = 0; j < 3; j++) img.data[i * 4 + j] = ca[j] + (cb[j] - ca[j]) * t;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function loadGround(lat: number, lng: number, size: number, grid: number, photoPx: number): Promise<Ground> {
  const [heights, photo] = await Promise.all([loadHeights(lat, lng, size, grid), loadPhoto(lat, lng, size, photoPx)]);
  return { size, grid, heights, photo: photo ?? reliefPhoto(heights, grid, size) };
}

/**
 * How far each grid point is from land, in metres (0 on land), for surf lines and the colour of shallow water.
 * Land is anything above `landAt` metres. A simple two-pass chamfer distance.
 */
export function distanceFromLand(g: Ground, landAt = 0.6): Float32Array {
  const n = g.grid;
  const step = g.size / (n - 1);
  const d = new Float32Array(n * n);
  const BIG = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = g.heights[i] > landAt ? 0 : BIG;
  const diag = step * Math.SQRT2;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (c > 0) d[i] = Math.min(d[i], d[i - 1] + step);
      if (r > 0) {
        d[i] = Math.min(d[i], d[i - n] + step);
        if (c > 0) d[i] = Math.min(d[i], d[i - n - 1] + diag);
        if (c < n - 1) d[i] = Math.min(d[i], d[i - n + 1] + diag);
      }
    }
  for (let r = n - 1; r >= 0; r--)
    for (let c = n - 1; c >= 0; c--) {
      const i = r * n + c;
      if (c < n - 1) d[i] = Math.min(d[i], d[i + 1] + step);
      if (r < n - 1) {
        d[i] = Math.min(d[i], d[i + n] + step);
        if (c < n - 1) d[i] = Math.min(d[i], d[i + n + 1] + diag);
        if (c > 0) d[i] = Math.min(d[i], d[i + n - 1] + diag);
      }
    }
  return d;
}

/**
 * Many hit list pins sit a little inland of the beach (a car park, the middle of a park). Find the nearest
 * water's edge within `size`/2 of the pin, so the scene can centre on the beach itself. Null if there's no sea nearby.
 */
export async function findShore(lat: number, lng: number, size: number): Promise<{ lat: number; lng: number } | null> {
  const grid = 121;
  const heights = await loadHeights(lat, lng, size, grid);
  const g: Ground = { size, grid, heights, photo: document.createElement('canvas') };
  const dist = distanceFromLand(g);
  const step = size / (grid - 1);
  const mid = (grid - 1) / 2;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let r = 0; r < grid; r++)
    for (let c = 0; c < grid; c++) {
      const d = dist[r * grid + c];
      // Water right at the edge of the land, with open water beyond (not a puddle or a dam).
      if (d <= 0 || d > step * 1.5) continue;
      const k = Math.hypot(r - mid, c - mid);
      if (k < bestD && openWater(dist, grid, r, c, step)) {
        bestD = k;
        best = [r, c];
      }
    }
  if (!best) return null;
  const x = (best[1] - mid) * step;
  const z = (best[0] - mid) * step;
  return { lat: lat - z / 111320, lng: lng + x / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

/** True if, somewhere within ~300 m of this cell, the water is at least 150 m from land. */
function openWater(dist: Float32Array, grid: number, r: number, c: number, step: number): boolean {
  const reach = Math.round(300 / step);
  for (let dr = -reach; dr <= reach; dr += 2)
    for (let dc = -reach; dc <= reach; dc += 2) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= grid || cc >= grid) continue;
      if (dist[rr * grid + cc] >= 150) return true;
    }
  return false;
}
