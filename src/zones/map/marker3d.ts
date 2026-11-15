import * as maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import {
  Camera,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { FlyPlace } from './flythrough';

/** Marker sizes, in metres. Big enough to read from the orbit height. */
const BEAM_HEIGHT = 520;
const GEM_SIZE = 95;

/**
 * A MapLibre custom layer that draws the three.js marker into the map's own WebGL canvas,
 * following the pattern in MapLibre's "Add a 3D model with three.js" example.
 * The scene is in metres: x east, y north, z up, with the origin on the ground at the place.
 */
export function markerLayer(map: maplibregl.Map, place: FlyPlace, id: string): CustomLayerInterface {
  const lngLat: [number, number] = [place.lng, place.lat];
  const scene = new Scene();
  const camera = new Camera();
  let renderer: WebGLRenderer;
  const accent = new Color(place.color);
  const paper = new Color('#f1ead9');

  // Soft daylight from the north-west, plus fill light so the shadow side isn't black.
  const sky = new HemisphereLight(0xdfeaf0, 0x30404a, 1.4);
  sky.position.set(0, 0, 1);
  scene.add(sky);
  const sun = new DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-0.6, 0.8, 1);
  scene.add(sun);

  // Beam: a thin tapered column that fades out towards the top. Drawn over the terrain, like a beacon,
  // so the place can be found even when a ridge is in the way.
  const fade = fadeTexture();
  const beam = new Mesh(
    new CylinderGeometry(7, 18, BEAM_HEIGHT, 20, 1, true),
    new MeshBasicMaterial({ color: paper, alphaMap: fade, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: DoubleSide }),
  );
  beam.rotation.x = Math.PI / 2; // three.js cylinders stand on Y; ours stands on Z
  beam.position.z = BEAM_HEIGHT / 2;
  scene.add(beam);

  // Gem: a faceted octahedron in the category colour, turning slowly above the beam.
  const gem = new Mesh(
    new OctahedronGeometry(GEM_SIZE, 0),
    new MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.1, flatShading: true, emissive: accent, emissiveIntensity: 0.25 }),
  );
  gem.scale.set(0.75, 0.75, 1.25);
  scene.add(gem);
  const gemEdges = new LineSegments(
    new EdgesGeometry(gem.geometry),
    new LineBasicMaterial({ color: paper, transparent: true, opacity: 0.6 }),
  );
  gem.add(gemEdges);

  // Ground ring: a pulse that spreads out from the base, drawn over the terrain so slopes don't hide it.
  const ring = new Mesh(
    new RingGeometry(0.86, 1, 64),
    new MeshBasicMaterial({ color: accent, transparent: true, depthTest: false, depthWrite: false }),
  );
  const base = new Mesh(
    new CircleGeometry(22, 32),
    new MeshBasicMaterial({ color: paper, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
  );
  scene.add(ring, base);

  const t0 = performance.now();

  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    onRemove() {
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material as Material | undefined;
        mat?.dispose();
      });
      fade.dispose();
      renderer?.dispose();
    },
    render(_gl, args: CustomRenderMethodInput) {
      const t = (performance.now() - t0) / 1000;
      // Ground height includes the terrain exaggeration, so the marker sits on the visible ground.
      const ground = map.queryTerrainElevation(lngLat) ?? 0;
      const origin = maplibregl.MercatorCoordinate.fromLngLat(lngLat, ground);
      const s = origin.meterInMercatorCoordinateUnits();
      const model = new Matrix4().makeTranslation(origin.x, origin.y, origin.z ?? 0).scale(new Vector3(s, -s, s));
      camera.projectionMatrix = new Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(model);

      gem.position.z = BEAM_HEIGHT + GEM_SIZE * 1.1 + Math.sin(t * 1.4) * 12;
      gem.rotation.z = t * 0.6;
      const pulse = (t % 2.4) / 2.4;
      ring.scale.setScalar(40 + 260 * pulse);
      (ring.material as MeshBasicMaterial).opacity = 0.7 * (1 - pulse);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };
}

/** A tiny vertical gradient (solid at the bottom, clear at the top) used to fade the beam. */
function fadeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.35, '#555');
  grad.addColorStop(1, '#fff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  return new CanvasTexture(c);
}
