import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { distanceFromLand, findShore, loadGround, loadPhoto, type Ground } from './tiles';
import { sunPosition, type SpotHour } from './weather';

/**
 * The 3D spot scene (three.js): real ground with a satellite photo, a sea surface ruffled by the wind (glassy
 * when calm, choppy with whitecaps when it blows), swell arrows on the water with the swell size written in
 * them, wind streaks in the air, and a sky with sun, cloud and rain for the chosen hour.
 * Sam swapped the drawn swell waves for the number in the arrow on 2026-11-28: the size reads exactly.
 *
 * Kept light for phones: one ground mesh plus a sharper patch in the middle, one sea mesh with its own shader,
 * and a few hundred moving bits. Everything is thrown away when the spot closes (`dispose`).
 */

const GRID = 241;
const PHOTO_PX = 2048;
/** The sharper patch of photo in the middle (metres a side). */
const DETAIL = 700;

const PAPER = new THREE.Color('#efe9dc');
const INK = new THREE.Color('#1b2830');

/** Unit vector (x east, z south) pointing toward a compass bearing. */
function toward(bearing: number): THREE.Vector2 {
  const r = (bearing * Math.PI) / 180;
  return new THREE.Vector2(Math.sin(r), -Math.cos(r));
}

/** A flat arrow shape lying on the ground, pointing along +x, `len` long. */
function arrowShape(len: number, width: number): THREE.Shape {
  const s = new THREE.Shape();
  const head = len * 0.42;
  const shaft = width * 0.38;
  s.moveTo(-len / 2, -shaft);
  s.lineTo(len / 2 - head, -shaft);
  s.lineTo(len / 2 - head, -width / 2);
  s.lineTo(len / 2, 0);
  s.lineTo(len / 2 - head, width / 2);
  s.lineTo(len / 2 - head, shaft);
  s.lineTo(-len / 2, shaft);
  s.closePath();
  return s;
}

/** An ink edge round a flat arrow, fading with the arrow's own material. */
function outline(shape: THREE.Shape, fill: THREE.Material): THREE.LineLoop {
  const pts = shape.getPoints().map((p) => new THREE.Vector3(p.x, 0.3, -p.y));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: INK, transparent: true }));
  line.onBeforeRender = () => {
    (line.material as THREE.LineBasicMaterial).opacity = (fill as THREE.MeshBasicMaterial).opacity;
  };
  return line;
}

/** An open chevron (a "›"), pointing along +x, for the wind. */
function chevronShape(len: number): THREE.Shape {
  const w = len * 0.9;
  const t = len * 0.22;
  const s = new THREE.Shape();
  s.moveTo(-len / 2, -w / 2);
  s.lineTo(len / 2, 0);
  s.lineTo(-len / 2, w / 2);
  s.lineTo(-len / 2 + t * 0.6, w / 2 - t * 0.35);
  s.lineTo(len / 2 - t * 1.4, 0);
  s.lineTo(-len / 2 + t * 0.6, -w / 2 + t * 0.35);
  s.closePath();
  return s;
}

/** The swell size as a label for the arrows: "1.6 m" in ink with a paper edge, and the period under it. */
function swellLabel(swell: number, period: number | null): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const write = (text: string, y: number, px: number) => {
    g.font = `700 ${px}px Inter, system-ui, sans-serif`;
    g.lineWidth = px * 0.22;
    g.strokeStyle = '#efe9dc';
    g.strokeText(text, 256, y);
    g.fillStyle = '#1b2830';
    g.fillText(text, 256, y);
  };
  write(`${swell.toFixed(1)} m`, period != null ? 104 : 128, 132);
  if (period != null) write(`${Math.round(period)} s`, 206, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round puff, drawn once, for cloud sprites. */
function cloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 34 + Math.random() * 60;
    const y = 44 + Math.random() * 40;
    const r = 18 + Math.random() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SEA_VERT = /* glsl */ `
uniform float uSize;
varying vec3 vPos;
varying vec2 vUv;
varying float vDepthView;

void main() {
  vec3 p = position;
  vUv = p.xz / uSize + 0.5;
  vUv.y = 1.0 - vUv.y;
  vPos = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepthView = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uPhoto;
uniform sampler2D uDist;
uniform vec2 uWindDir;
uniform float uChop;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vPos;
varying vec2 vUv;
varying float vDepthView;

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Slope of one travelling wave (amplitude a, number k, direction d, speed w).
vec2 slope(vec2 xz, vec2 d, float k, float a, float w, float off) {
  return d * (a * k * cos(k * dot(d, xz) - w * uTime + off));
}

void main() {
  vec4 dt = texture2D(uDist, vUv);
  float vDist = dt.r * 600.0;
  float vOpen = dt.g;
  if (vDist < 0.5) discard; // land
  vec2 xz = vPos.xz;
  vec2 g = vec2(0.0);
  // Wind chop: short waves running with the wind. Glassy when calm, ruffled and messy when it blows.
  float c = (0.08 + uChop * 0.9) * (0.3 + 0.7 * vOpen);
  g += slope(xz, uWindDir, 0.55, 0.05 * c, 2.1, 0.0);
  g += slope(xz, rot(uWindDir, 0.6), 0.9, 0.035 * c, 2.8, 2.0);
  g += slope(xz, rot(uWindDir, -0.7), 1.4, 0.025 * c, 3.5, 5.0);
  g += slope(xz, rot(uWindDir, 0.25), 2.3, 0.015 * c, 4.4, 1.0);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  vec3 V = normalize(cameraPosition - vPos);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 refl = mix(uHorizon, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0));

  // Shallow water shows the sea floor from the photo (sand, reef, rock) under a clear tint.
  float shallow = 1.0 - smoothstep(10.0, 220.0, vDist);
  vec3 floorCol = texture2D(uPhoto, vUv).rgb;
  vec3 body = mix(uDeep, mix(uShallow, floorCol, 0.45), shallow);
  float lit = 0.65 + 0.35 * max(dot(n, normalize(uSun)), 0.0);
  vec3 col = mix(body * lit, refl, fres * 0.45);
  vec3 H = normalize(normalize(uSun) + V);
  col += uSunColor * pow(max(dot(n, H), 0.0), 220.0) * 2.2;

  // No drawn swell waves (the size is the number in the swell arrows). Whitecaps out to sea once the wind is up.
  float caps = smoothstep(0.82 - uChop * 0.2, 0.98, noise(xz * 0.05 + uWindDir * uTime * 0.9)) * smoothstep(0.35, 0.9, uChop);
  float foam = caps * 0.8;
  // Lap at the edge of the sand.
  foam = max(foam, (1.0 - smoothstep(0.5, 5.0, vDist)) * 0.7);
  col = mix(col, vec3(0.94, 0.95, 0.93) * (0.4 + 0.6 * lit), foam * vOpen);

  col *= uLight;
  float fogF = smoothstep(uFogNear, uFogFar, vDepthView);
  gl_FragColor = vec4(mix(col, uFogColor, fogF), 1.0);
  #include <colorspace_fragment>
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // always at the back
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uSunVis;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  float s = max(dot(d, normalize(uSun)), 0.0);
  col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25) * uSunVis;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

interface Mover {
  mesh: THREE.Mesh;
  t: number;
  lane: THREE.Vector2;
}

export interface SpotSceneOptions {
  lat: number;
  lng: number;
  /** Which way a beach faces (degrees), to place the camera out at sea looking in. */
  faces: number | null;
  /** Metres a side of ground to show. */
  size: number;
  coastal: boolean;
  /** Screen pixels per CSS pixel: 1 in light mode, up to 2 otherwise. */
  pixelRatio: number;
}

export class SpotScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private ground: Ground | null = null;
  private dist: Float32Array | null = null;
  private sea: THREE.Mesh | null = null;
  private seaU: Record<string, THREE.IUniform> | null = null;
  private skyU: Record<string, THREE.IUniform>;
  private hemi = new THREE.HemisphereLight(0xdfe9f0, 0x5d5a4a, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.4);
  private swellArrows: Mover[] = [];
  private streaks: THREE.InstancedMesh | null = null;
  private streakState: { x: number; z: number; y: number; life: number; speed: number }[] = [];
  private clouds = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private hour: SpotHour | null = null;
  private center = new THREE.Vector3();
  private disposed = false;
  private running = false;
  private resizeObs: ResizeObserver;
  private cloudTex = cloudTexture();

  private sunVec = new THREE.Vector3(0.4, 0.8, 0.2);

  constructor(
    private host: HTMLElement,
    private opts: SpotSceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(opts.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 5, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 120;
    this.controls.maxDistance = opts.size * 0.75;
    this.controls.screenSpacePanning = false;
    this.scene.fog = new THREE.Fog(0xcfdfe6, opts.size * 0.45, opts.size * 1.25);

    const skyGeo = new THREE.SphereGeometry(15000, 32, 16);
    this.skyU = {
      uTop: { value: new THREE.Color('#4f86b8') },
      uHorizon: { value: new THREE.Color('#cfe0e8') },
      uSun: { value: this.sunVec },
      uSunColor: { value: new THREE.Color('#fff2d6') },
      uSunVis: { value: 1 },
    };
    const sky = new THREE.Mesh(
      skyGeo,
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.scene.add(sky, this.hemi, this.sun, this.sun.target, this.clouds);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.placeCamera(0);
  }

  /** Fetch the ground and build the scene. Resolves when there's something worth showing. */
  async load(): Promise<void> {
    const { size } = this.opts;
    let { lat, lng } = this.opts;
    // At the coast, centre on the water's edge nearest the pin (pins are often a little inland).
    if (this.opts.coastal) {
      const shore = await findShore(lat, lng, size * 0.8).catch(() => null);
      if (shore) ({ lat, lng } = shore);
    }
    if (this.disposed) return;
    const [g, detail] = await Promise.all([
      loadGround(lat, lng, size, GRID, PHOTO_PX),
      loadPhoto(lat, lng, DETAIL, PHOTO_PX, 18).catch(() => null),
    ]);
    if (this.disposed) return;
    this.ground = g;
    this.dist = distanceFromLand(g);
    this.buildTerrain(g, detail);
    if (this.opts.coastal && this.dist.some((d) => d > 50)) this.buildSea(g);
    const h0 = this.heightAt(0, 0);
    this.center.set(0, Math.max(0, h0), 0);
    this.placeCamera(Math.max(0, h0));
    if (this.hour) this.setHour(this.hour);
  }

  /** Ground height (m) at local x/z, from the height grid. */
  heightAt(x: number, z: number): number {
    const g = this.ground;
    if (!g) return 0;
    const n = g.grid;
    const c = Math.max(0, Math.min(n - 1, ((x / g.size) + 0.5) * (n - 1)));
    const r = Math.max(0, Math.min(n - 1, ((z / g.size) + 0.5) * (n - 1)));
    const c0 = Math.min(n - 2, Math.floor(c));
    const r0 = Math.min(n - 2, Math.floor(r));
    const tc = c - c0;
    const tr = r - r0;
    const h = g.heights;
    const v = (i: number, j: number) => h[i * n + j];
    return (v(r0, c0) * (1 - tc) + v(r0, c0 + 1) * tc) * (1 - tr) + (v(r0 + 1, c0) * (1 - tc) + v(r0 + 1, c0 + 1) * tc) * tr;
  }

  private distAt(x: number, z: number): number {
    const g = this.ground;
    if (!g || !this.dist) return 0;
    const n = g.grid;
    const c = Math.round(((x / g.size) + 0.5) * (n - 1));
    const r = Math.round(((z / g.size) + 0.5) * (n - 1));
    if (c < 0 || r < 0 || c >= n || r >= n) return 0;
    return this.dist[r * n + c];
  }

  private placeCamera(groundY: number) {
    const faces = this.opts.faces ?? (this.opts.coastal ? this.seaBearing() : 200);
    const out = toward(faces);
    const back = this.opts.coastal ? 820 : this.opts.size * 0.32;
    const up = this.opts.coastal ? 380 : this.opts.size * 0.16;
    // Look at a point a little out to sea, so the frame is half water, half beach and land.
    const lead = this.opts.coastal ? 180 : 0;
    this.camera.position.set(out.x * (back + lead), groundY + up, out.y * (back + lead));
    this.controls.target.set(out.x * lead, groundY, out.y * lead);
    this.controls.update();
  }

  /** Without a facing, guess which way the sea is from the distance field. */
  private seaBearing(): number {
    if (!this.dist) return 90;
    let best = 90;
    let far = -1;
    for (let b = 0; b < 360; b += 15) {
      const v = toward(b);
      const d = this.distAt(v.x * 500, v.y * 500);
      if (d > far) {
        far = d;
        best = b;
      }
    }
    return best;
  }

  private buildTerrain(g: Ground, detailPhoto: HTMLCanvasElement | null) {
    const geo = new THREE.PlaneGeometry(g.size, g.size, g.grid - 1, g.grid - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(-25, g.heights[i]));
    geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(g.photo);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const land = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(land);

    // The sharper middle patch: same heights, finer photo, drawn just in front of the ground under it.
    if (detailPhoto) {
      const n = 121;
      const dgeo = new THREE.PlaneGeometry(DETAIL, DETAIL, n - 1, n - 1);
      dgeo.rotateX(-Math.PI / 2);
      const dp = dgeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dp.count; i++) dp.setY(i, Math.max(-25, this.heightAt(dp.getX(i), dp.getZ(i))));
      dgeo.computeVertexNormals();
      const dtex = new THREE.CanvasTexture(detailPhoto);
      dtex.colorSpace = THREE.SRGBColorSpace;
      dtex.anisotropy = tex.anisotropy;
      // Fade the patch's edge into the coarser photo so there's no visible square.
      const mat = new THREE.MeshLambertMaterial({ map: dtex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 e = min(vMapUv, 1.0 - vMapUv);
          diffuseColor.a *= smoothstep(0.0, 0.12, min(e.x, e.y));`,
        );
      };
      this.scene.add(new THREE.Mesh(dgeo, mat));
    }
  }

  private buildSea(g: Ground) {
    const n = g.grid;
    const dist = this.dist!;
    // Open sea: water joined to water well offshore. Lagoons, creeks and dams stay calm.
    const open = new Uint8Array(n * n);
    const queue: number[] = [];
    for (let i = 0; i < dist.length; i++)
      if (dist[i] >= 150) {
        open[i] = 1;
        queue.push(i);
      }
    while (queue.length) {
      const i = queue.pop()!;
      const r = Math.floor(i / n);
      const c = i % n;
      for (const j of [c > 0 ? i - 1 : -1, c < n - 1 ? i + 1 : -1, r > 0 ? i - n : -1, r < n - 1 ? i + n : -1])
        if (j >= 0 && !open[j] && dist[j] > 0) {
          open[j] = 1;
          queue.push(j);
        }
    }
    const px = new Uint8Array(n * n * 4);
    // Texture rows run south to north; the grid runs north to south.
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const v = Math.min(255, Math.round((dist[r * n + c] / 600) * 255));
        const i = ((n - 1 - r) * n + c) * 4;
        px[i] = v;
        px[i + 1] = open[r * n + c] ? 255 : 0;
        px[i + 3] = 255;
      }
    const distTex = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
    distTex.magFilter = THREE.LinearFilter;
    distTex.minFilter = THREE.LinearFilter;
    distTex.needsUpdate = true;
    const photo = new THREE.CanvasTexture(g.photo);
    photo.colorSpace = THREE.SRGBColorSpace;
    this.seaU = {
      uTime: { value: 0 },
      uDist: { value: distTex },
      uPhoto: { value: photo },
      uSize: { value: g.size },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uChop: { value: 0.2 },
      uSun: { value: this.sunVec },
      uSunColor: { value: new THREE.Color('#fff2d6') },
      uSkyTop: { value: this.skyU.uTop.value },
      uHorizon: { value: this.skyU.uHorizon.value },
      uDeep: { value: new THREE.Color('#1b5670') },
      uShallow: { value: new THREE.Color('#3f9497') },
      uLight: { value: 1 },
      uFogColor: { value: (this.scene.fog as THREE.Fog).color },
      uFogNear: { value: (this.scene.fog as THREE.Fog).near },
      uFogFar: { value: (this.scene.fog as THREE.Fog).far },
    };
    // A flat surface: the ripples are all in the shader, so a few points will do.
    const geo = new THREE.PlaneGeometry(g.size * 1.3, g.size * 1.3, 4, 4);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({ uniforms: this.seaU, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG });
    this.sea = new THREE.Mesh(geo, mat);
    this.scene.add(this.sea);
  }

  /** Show one hour's conditions: waves, arrows, sky, cloud and rain. */
  setHour(h: SpotHour) {
    this.hour = h;
    if (!this.ground) return;
    this.applySky(h);
    this.applySea(h);
    this.buildArrows(h);
    this.buildStreaks(h);
    this.buildClouds(h);
    this.buildRain(h);
  }

  private applySky(h: SpotHour) {
    const { elevation, azimuth } = sunPosition(h.time, this.opts.lat, this.opts.lng);
    const az = toward(azimuth);
    const el = (Math.max(-10, elevation) * Math.PI) / 180;
    this.sunVec.set(az.x * Math.cos(el), Math.sin(el), az.y * Math.cos(el)).normalize();
    const day = THREE.MathUtils.smoothstep(elevation, -6, 6);
    const golden = day * (1 - THREE.MathUtils.smoothstep(elevation, 4, 18));
    const cloud = h.cloud;
    const top = new THREE.Color('#071222').lerp(new THREE.Color('#4f86b8'), day);
    const horizon = new THREE.Color('#142233').lerp(new THREE.Color('#cfe0e8'), day).lerp(new THREE.Color('#e7b07c'), golden * 0.6 * (1 - cloud));
    const grey = new THREE.Color('#9aa3a8').multiplyScalar(0.25 + 0.75 * day);
    top.lerp(grey, cloud * 0.85);
    horizon.lerp(grey.clone().multiplyScalar(1.12), cloud * 0.8);
    (this.skyU.uTop.value as THREE.Color).copy(top);
    (this.skyU.uHorizon.value as THREE.Color).copy(horizon);
    this.skyU.uSunVis.value = day * (1 - cloud * 0.9);
    const sunCol = new THREE.Color('#fff4e0').lerp(new THREE.Color('#ffb36b'), golden);
    (this.skyU.uSunColor.value as THREE.Color).copy(sunCol);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(horizon);
    const thick = h.fog ? 0.35 : h.rain > 0.5 ? 0.6 : 1;
    fog.near = this.opts.size * 0.45 * thick;
    fog.far = this.opts.size * 1.25 * thick;
    if (this.seaU) {
      this.seaU.uFogNear.value = fog.near;
      this.seaU.uFogFar.value = fog.far;
      (this.seaU.uSunColor.value as THREE.Color).copy(sunCol).multiplyScalar((1 - cloud * 0.85) * day);
      this.seaU.uLight.value = 0.25 + 0.75 * day * (1 - cloud * 0.3);
    }
    this.sun.position.copy(this.sunVec).multiplyScalar(2000);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 1.5 * day * (1 - cloud * 0.7);
    this.hemi.intensity = 0.35 + 1.45 * day * (1 - cloud * 0.25);
    this.hemi.color.set(day > 0.3 ? 0xdfe9f0 : 0x6a7f99);
  }

  private applySea(h: SpotHour) {
    const u = this.seaU;
    if (!u) return;
    u.uChop.value = h.chop;
    u.uWindDir.value = toward(h.windFrom + 180);
  }

  private clearList(list: THREE.Object3D[]) {
    for (const o of list) {
      this.scene.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat && 'map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
        mat?.dispose();
      });
    }
  }

  /** Swell arrows riding the water offshore, travelling the way the swell does. */
  private buildArrows(h: SpotHour) {
    this.clearList(this.swellArrows.map((a) => a.mesh));
    this.swellArrows = [];

    if (this.sea && h.swell != null && h.swellFrom != null) {
      // Big enough to carry the number; a little longer for a bigger swell.
      const len = 150 + 25 * Math.min(3, h.swell);
      const label = swellLabel(h.swell, h.period);
      const dir = toward(h.swellFrom + 180);
      const side = new THREE.Vector2(-dir.y, dir.x);
      // Lanes out to sea, upstream of the spot so the arrows travel in toward it.
      const sea = toward(this.opts.faces ?? this.seaBearing());
      for (let i = -1; i <= 1; i++) {
        const lane = new THREE.Vector2(sea.x * 380, sea.y * 380).addScaledVector(side, i * 210);
        if (this.distAt(lane.x, lane.y) < 60) continue;
        const shape = arrowShape(len, len * 0.5);
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.9, depthWrite: false, fog: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.add(outline(shape, mat));
        mesh.rotation.y = Math.atan2(-dir.y, dir.x);
        mesh.renderOrder = 2;
        // The swell size on the arrow, always facing the camera so it reads from any angle.
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: label, transparent: true, depthTest: false, depthWrite: false, fog: false }));
        tag.scale.set(len * 0.62, len * 0.31, 1);
        tag.position.set(0, 6, 0);
        tag.renderOrder = 3;
        tag.onBeforeRender = () => {
          tag.material.opacity = mat.opacity / 0.9;
        };
        mesh.add(tag);
        this.scene.add(mesh);
        this.swellArrows.push({ mesh, t: (i + 1) / 3, lane });
      }
    }

  }

  /** Wind arrows drifting through the air, faster and more of them the stronger it blows. */
  private buildStreaks(h: SpotHour) {
    if (this.streaks) this.clearList([this.streaks]);
    this.streaks = null;
    this.streakState = [];
    // Small open chevrons, all pointing downwind: more, and faster, the harder it blows.
    const count = Math.round(30 + Math.min(50, h.wind * 1.5));
    const len = 40 + Math.min(30, h.wind);
    const geo = new THREE.ShapeGeometry(chevronShape(len));
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const box = this.opts.size * 0.55;
    for (let i = 0; i < count; i++) {
      this.streakState.push({
        x: (Math.random() - 0.5) * box,
        z: (Math.random() - 0.5) * box,
        y: 40 + Math.random() * 140,
        life: Math.random(),
        speed: 0.8 + Math.random() * 0.4,
      });
      mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    this.streaks = mesh;
    this.scene.add(mesh);
  }

  private buildClouds(h: SpotHour) {
    for (const c of [...this.clouds.children]) {
      this.clouds.remove(c);
      ((c as THREE.Sprite).material as THREE.Material).dispose();
    }
    const n = Math.round(h.cloud * 34);
    const dark = h.rain > 0.3 || h.storm ? 0.55 : 0.9;
    const spread = this.opts.size * 1.6;
    // Clouds sit above the highest ground (mountains included), not at a fixed height.
    let top = 0;
    for (const v of this.ground?.heights ?? []) top = Math.max(top, v);
    const base = top + 420;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.cloudTex,
        color: new THREE.Color(dark, dark, dark * 1.02),
        transparent: true,
        opacity: 0.5 + 0.4 * h.cloud,
        depthWrite: false,
        fog: false,
      });
      const s = new THREE.Sprite(mat);
      const size = 350 + Math.random() * 450;
      s.scale.set(size * 1.6, size, 1);
      s.position.set((Math.random() - 0.5) * spread, base + Math.random() * 320, (Math.random() - 0.5) * spread);
      this.clouds.add(s);
    }
  }

  private buildRain(h: SpotHour) {
    if (this.rain) this.clearList([this.rain]);
    this.rain = null;
    if (h.rain < 0.1) return;
    const n = Math.round(500 + 1400 * Math.min(3, h.rain));
    const pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xc6d3de, transparent: true, opacity: 0.45, fog: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.userData.drops = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
    this.scene.add(this.rain);
  }

  // ---- Animation ----

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame(now: number) {
    this.timer.update(now);
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    this.controls.update();
    if (this.seaU) this.seaU.uTime.value = t;
    const h = this.hour;
    if (h) this.animate(h, dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  private animate(h: SpotHour, dt: number, t: number) {
    // Swell arrows glide in with the swell and fade at each end of their run.
    if (h.swellFrom != null) {
      const dir = toward(h.swellFrom + 180);
      const run = 420;
      for (const a of this.swellArrows) {
        a.t = (a.t + dt / 7) % 1;
        const along = (a.t - 0.5) * run;
        const x = a.lane.x + dir.x * along;
        const z = a.lane.y + dir.y * along;
        a.mesh.position.set(x, 3 + Math.sin(t * 1.3 + a.t * 9) * 0.6, z);
        (a.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.sin(a.t * Math.PI) ** 0.6;
      }
    }
    // Wind streaks.
    if (this.streaks) {
      const wd = toward(h.windFrom + 180);
      const speed = (Math.max(3, h.wind) / 3.6) * 9; // drawn faster than real so it reads
      const box = this.opts.size * 0.55;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-wd.y, wd.x));
      const p = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      this.streakState.forEach((s, i) => {
        s.life += dt / 3.2;
        s.x += wd.x * speed * s.speed * dt;
        s.z += wd.y * speed * s.speed * dt;
        if (s.life > 1 || Math.abs(s.x) > box / 2 || Math.abs(s.z) > box / 2) {
          s.life = 0;
          s.x = (Math.random() - 0.5) * box;
          s.z = (Math.random() - 0.5) * box;
          s.y = 40 + Math.random() * 140;
        }
        const ground = Math.max(0, this.heightAt(s.x, s.z));
        p.set(s.x, ground + s.y, s.z);
        m.compose(p, q, one);
        this.streaks!.setMatrixAt(i, m);
        const fade = Math.sin(s.life * Math.PI) * 0.75;
        this.streaks!.setColorAt(i, col.setRGB(fade, fade, fade * 0.95));
      });
      this.streaks.instanceMatrix.needsUpdate = true;
      if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
    }
    // Clouds drift with the wind and wrap round.
    const wd = toward(h.windFrom + 180);
    const spread = this.opts.size * 1.6;
    for (const c of this.clouds.children) {
      c.position.x += wd.x * (h.wind / 3.6) * 2.5 * dt;
      c.position.z += wd.y * (h.wind / 3.6) * 2.5 * dt;
      if (c.position.x > spread / 2) c.position.x -= spread;
      if (c.position.x < -spread / 2) c.position.x += spread;
      if (c.position.z > spread / 2) c.position.z -= spread;
      if (c.position.z < -spread / 2) c.position.z += spread;
    }
    // Rain falls around what the camera is looking at, slanted by the wind.
    if (this.rain) {
      const drops = this.rain.userData.drops as number[][];
      const pos = (this.rain.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const c = this.controls.target;
      const cam = this.camera.position;
      const mid = new THREE.Vector3().lerpVectors(c, cam, 0.45);
      const w = 700;
      const hgt = 380;
      const slant = Math.min(0.6, h.wind / 60);
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d[1] -= dt * 1.4;
        if (d[1] < 0) {
          d[1] += 1;
          d[0] = Math.random();
          d[2] = Math.random();
        }
        const x = mid.x + (d[0] - 0.5) * w;
        const y = mid.y - hgt / 2 + d[1] * hgt;
        const z = mid.z + (d[2] - 0.5) * w;
        const o = i * 6;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        pos[o + 3] = x + wd.x * slant * 9;
        pos[o + 4] = y - 9;
        pos[o + 5] = z + wd.y * slant * 9;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const hgt = this.host.clientHeight || 1;
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        if (mat instanceof THREE.ShaderMaterial) for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) u.value.dispose();
        mat.dispose();
      }
    });
    this.cloudTex.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
