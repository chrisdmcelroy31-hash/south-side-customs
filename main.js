import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { drawTank, GRAPHICS, GRAPHIC_COLORS } from './tank-art.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('bike');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// placeholder reflections until the real workshop capture arrives
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
// photographed machine shop (Poly Haven, CC0): chrome reflects real windows, lights and clutter
new RGBELoader().load(
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/machine_shop_02_1k.hdr',
  (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  },
  undefined,
  () => { /* keep the studio fallback if the capture can't load */ },
);

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

// window light from behind-left: the main shadow caster, like the reference photos
const sun = new THREE.DirectionalLight(0xffe2b8, 2.0);
sun.position.set(-3.5, 6.5, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 2.8, bottom: -1.4, near: 2, far: 16 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.012;
scene.add(sun);
const tube = new THREE.DirectionalLight(0xe4ecff, 0.55);
tube.position.set(2.5, 7, -2);
scene.add(tube);


/* ---------------- procedural surface maps ---------------- */
function canvasTex(w, h, draw, { srgb = false, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
// metal flake: each 2px cell tilts its normal a little, so the base coat glitters under the clear coat
const flakeNormal = canvasTex(512, 512, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const r = 128 + (Math.random() - 0.5) * 150, gg = 128 + (Math.random() - 0.5) * 150;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y + dy) * w + x + dx) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}, { repeat: [10, 4] });
// smudges and handling marks: breaks up the perfect CG mirror on chrome
const smudge = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() < 0.6 ? 200 : 40;
    gr.addColorStop(0, `rgba(${v},${v},${v},.22)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
}, { repeat: [2, 2] });
// pebbled hide
const leatherNormal = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 1.5 + Math.random() * 3.5;
    const gr = g.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r);
    gr.addColorStop(0, 'rgba(160,160,255,.9)'); gr.addColorStop(1, 'rgba(96,96,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
}, { repeat: [3, 3] });
// fixture table: 100 mm hole grid, mill scale, grinder swirls and scratches
const TABLE_W = 4.8, TABLE_D = 1.7;
function tableSurface(rough) {
  return canvasTex(2048, 726, (g, w, h) => {
    g.fillStyle = rough ? '#9a9a9a' : '#6d7175'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 80;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = rough ? (Math.random() < .5 ? '60,60,60' : '210,210,210') : (Math.random() < .5 ? '40,42,44' : '150,152,155');
      gr.addColorStop(0, `rgba(${c},.12)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI, l = 10 + Math.random() * 90;
      g.strokeStyle = rough ? 'rgba(40,40,40,.35)' : 'rgba(200,204,208,.18)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const sx = w / (TABLE_W * 10), sy = h / (TABLE_D * 10);
    for (let i = 0.5; i < TABLE_W * 10; i++) for (let j = 0.5; j < TABLE_D * 10; j++) {
      g.fillStyle = rough ? '#ffffff' : '#141516';
      g.beginPath(); g.arc(i * sx, j * sy, sx * 0.14, 0, 7); g.fill();
      if (!rough) { g.strokeStyle = 'rgba(190,195,200,.5)'; g.lineWidth = 1.5; g.stroke(); }
    }
  }, { srgb: !rough });
}

/* ---------------- materials ---------------- */
const candy = new THREE.MeshPhysicalMaterial({
  color: 0x6e0410, metalness: 0.5, roughness: 0.34,
  normalMap: flakeNormal, normalScale: new THREE.Vector2(0.25, 0.25),
  clearcoat: 1, clearcoatRoughness: 0.025,
});
const chrome = new THREE.MeshPhysicalMaterial({ color: 0xeef1f4, metalness: 1, roughness: 0.11, roughnessMap: smudge });
const satin = new THREE.MeshPhysicalMaterial({ color: 0xc4c8cc, metalness: 1, roughness: 0.34, anisotropy: 0.75, roughnessMap: smudge });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.35, roughness: 0.55 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.93, metalness: 0 });
const leather = new THREE.MeshPhysicalMaterial({
  color: 0x161412, roughness: 0.6, normalMap: leatherNormal, normalScale: new THREE.Vector2(0.5, 0.5),
  sheen: 0.35, sheenRoughness: 0.5, sheenColor: 0x3a2b2b, clearcoat: 0.12, clearcoatRoughness: 0.55,
});
const stitch = new THREE.MeshStandardMaterial({ color: 0x8e1018, roughness: 0.7 });
const tableMat = new THREE.MeshStandardMaterial({ map: tableSurface(false), roughnessMap: tableSurface(true), metalness: 0.85, roughness: 1 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x5b5f63, metalness: 0.85, roughness: 0.5, roughnessMap: smudge });
const lens = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, emissive: 0xffe6b0, emissiveIntensity: 0.05, roughness: 0.15, metalness: 0.2 });
const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.9 });

// tank artwork (flames, scallops, stripes...) is painted in tank-art.js
function flameTexture() {
  return canvasTex(2048, 512, (g) => drawTank(g), { srgb: true });
}
const tankMat = candy.clone();
tankMat.color.set(0xffffff);
tankMat.map = flameTexture();
tankMat.map.wrapS = tankMat.map.wrapT = THREE.ClampToEdgeWrapping;

/* ---------------- geometry helpers ---------------- */
function cyl(a, b, r, mat, seg = 20, r2 = r) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
function tubeMesh(points, r, mat, seg = 90, tension = 0.2) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 20, false), mat);
  m.userData.curve = curve;
  return m;
}
const shadowed = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
const mirrorZ = (pts) => pts.map((p) => V(p.x, p.y, -p.z));

/* ---------------- key points of the chassis ---------------- */
const R = V(-1.55, 0.42);          // rear axle
const F = V(1.95, 0.40);           // front axle
const N0 = V(1.12, 1.18);          // neck, lower
const A = N0.clone().sub(F).normalize(); // steering axis
const N1 = N0.clone().addScaledVector(A, 0.26); // neck, upper
const TARGET = V(0.2, 1.0);

const bike = new THREE.Group();
scene.add(bike);

/* ---------------- build table (always there) ---------------- */
const table = new THREE.Group();
const top = new THREE.Mesh(new RoundedBoxGeometry(4.8, 0.08, 1.7, 2, 0.01), tableMat);
top.position.y = -0.04;
table.add(top);
[[-2.2, -0.7], [2.2, -0.7], [-2.2, 0.7], [2.2, 0.7]].forEach(([x, z]) => {
  const leg = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.5, 0.08, 2, 0.008), steelMat);
  leg.position.set(x, -0.33, z); table.add(leg);
});
const brace = new THREE.Mesh(new RoundedBoxGeometry(4.5, 0.05, 0.05, 2, 0.006), steelMat);
brace.position.set(0, -0.5, 0.7); table.add(brace);
const rail2 = brace.clone(); rail2.position.z = -0.7; table.add(rail2);
// scissor lift under the frame
const liftBase = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.04, 0.34, 2, 0.01), steelMat);
liftBase.position.set(-0.05, 0.02, 0); table.add(liftBase);
const liftTop = liftBase.clone(); liftTop.position.y = 0.2; table.add(liftTop);
[0.13, -0.13].forEach((z) => {
  table.add(cyl(V(-0.4, 0.04, z), V(0.3, 0.18, z), 0.018, darkMetal));
  table.add(cyl(V(-0.4, 0.18, z), V(0.3, 0.04, z), 0.018, darkMetal));
});
shadowed(table);
scene.add(table);

// contact shadows: soft dark pools where the tires press into the table (shadow maps alone look floaty)
const contactTex = canvasTex(256, 256, (g) => {
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.35, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
});
contactTex.wrapS = contactTex.wrapT = THREE.ClampToEdgeWrapping;
function contactPool(x, sx, sz) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, 0); m.renderOrder = 1;
  scene.add(m);
  return m;
}
const poolRear = contactPool(-1.55, 0.7, 0.55);
const poolFront = contactPool(1.95, 0.5, 0.26);
const poolBody = contactPool(0.1, 3.4, 0.9);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.45 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.58; floor.receiveShadow = true;
scene.add(floor);

/* ---------------- 1. FRAME (drawn like a weld bead) ---------------- */
const frame = new THREE.Group();
const frameTubes = [];
const zs = 0.11;
const backbone = [V(0.95, 1.33), V(0.2, 1.1), V(-0.35, 0.96), V(-0.62, 0.8)];
const downR = [V(1.1, 1.18, 0.06), V(0.82, 0.55, zs), V(0.66, 0.22, zs), V(-0.55, 0.22, zs), V(-1.0, 0.33, zs), V(-1.55, 0.42, zs)];
const stayR = [V(-0.35, 0.96, 0.06), V(-0.7, 0.86, zs), V(-1.1, 0.66, zs), V(-1.55, 0.44, zs)];
const postR = [V(-0.55, 0.22, zs), V(-0.45, 0.6, zs), V(-0.38, 0.94, zs)];
[
  [backbone, 0.034], [downR, 0.03], [mirrorZ(downR), 0.03], [stayR, 0.026], [mirrorZ(stayR), 0.026],
  [postR, 0.026], [mirrorZ(postR), 0.026],
].forEach(([pts, r]) => {
  const m = tubeMesh(pts, r, candy);
  frameTubes.push(m); frame.add(m);
});
const neck = cyl(N0.clone().addScaledVector(A, -0.04), N1.clone().addScaledVector(A, 0.03), 0.052, candy);
frame.add(neck);
// axle plates and gussets
[zs + 0.01, -zs - 0.01].forEach((z) => {
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.12, 0.016, 2, 0.02), candy);
  plate.position.set(-1.53, 0.43, z); frame.add(plate);
});
const gusset = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.14, 0.03, 2, 0.02), candy);
gusset.position.set(0.98, 1.2, 0); gusset.rotation.z = 0.8; frame.add(gusset);
// forward controls
[0.22, -0.22].forEach((z) => {
  frame.add(cyl(V(0.8, 0.38, z * 0.5), V(0.8, 0.38, z * 1.5), 0.016, chrome));
  frame.add(cyl(V(0.8, 0.38, z * 1.5), V(0.95, 0.46, z * 1.5), 0.012, chrome));
});
shadowed(frame);
bike.add(frame);

/* ---------------- 2. ENGINE ---------------- */
const engine = new THREE.Group();
const crank = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.28, 0.26, 5, 0.07), chrome);
crank.position.set(0.15, 0.42, 0); engine.add(crank);
// a cooling fin with a rolled edge, so it catches a highlight instead of a hard CG line
function finGeo(R, core, th) {
  const pts = [new THREE.Vector2(core, -th / 2)];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(new THREE.Vector2(R - th / 2 + Math.cos(a) * th / 2, Math.sin(a) * th / 2));
  }
  pts.push(new THREE.Vector2(core, th / 2));
  return new THREE.LatheGeometry(pts, 56);
}
const boltGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6);
function jug(x, tilt) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.3, 32), satin);
  core.position.y = 0.15; g.add(core);
  for (let i = 0; i < 11; i++) {
    const fin = new THREE.Mesh(finGeo(0.13 - i * 0.0015, 0.08, 0.011), chrome);
    fin.position.y = 0.025 + i * 0.025; g.add(fin);
  }
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.25, 4, 0.035), chrome);
  head.position.y = 0.34; g.add(head);
  for (let i = 0; i < 6; i++) {
    const hf = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.008, 0.26, 2, 0.004), chrome);
    hf.position.y = 0.3 + i * 0.016; g.add(hf);
  }
  const rocker = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.07, 0.2, 4, 0.03), chrome);
  rocker.position.y = 0.42; g.add(rocker);
  [[-0.08, -0.07], [0.08, -0.07], [-0.08, 0.07], [0.08, 0.07]].forEach(([bx, bz]) => {
    const b = new THREE.Mesh(boltGeo, chrome);
    b.position.set(bx, 0.46, bz); g.add(b);
  });
  g.position.set(x, 0.54, 0); g.rotation.z = tilt;
  return g;
}
engine.add(jug(0.26, -0.4), jug(0.04, 0.4));
// domed air cleaner cover with a rolled rim and a candy center badge
const cleanerProfile = [[0, 0.075], [0.06, 0.07], [0.105, 0.055], [0.128, 0.035], [0.138, 0.015], [0.14, 0], [0.13, -0.01], [0.11, -0.012]]
  .map(([r, y]) => new THREE.Vector2(r, y));
const cleaner = new THREE.Mesh(new THREE.LatheGeometry(cleanerProfile, 64), chrome);
cleaner.rotation.x = Math.PI / 2; cleaner.position.set(0.15, 0.78, 0.15); engine.add(cleaner);
const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.012, 40), candy);
badge.rotation.x = Math.PI / 2; badge.position.set(0.15, 0.78, 0.228); engine.add(badge);
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const b = new THREE.Mesh(boltGeo, chrome);
  b.rotation.x = Math.PI / 2; b.position.set(0.15 + Math.cos(a) * 0.1, 0.78 + Math.sin(a) * 0.1, 0.205); engine.add(b);
}
const trans = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.22, 0.22, 5, 0.06), chrome);
trans.position.set(-0.32, 0.4, 0); engine.add(trans);
const primary = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.2, 0.05, 3, 0.022), chrome);
primary.position.set(-0.12, 0.33, -0.16); primary.rotation.z = 0.05; engine.add(primary);
for (let i = 0; i < 9; i++) {
  const b = new THREE.Mesh(boltGeo, chrome);
  b.rotation.x = Math.PI / 2; b.position.set(-0.48 + i * 0.09, i % 2 ? 0.42 : 0.24, -0.19); engine.add(b);
}
const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 32), chrome);
cam.rotation.x = Math.PI / 2; cam.position.set(0.3, 0.42, 0.14); engine.add(cam);
[0.06, -0.06].forEach((dz) => engine.add(cyl(V(0.2, 0.42, 0.1 + dz * 0.3), V(0.3, 0.88, 0.07 + dz * 0.3), 0.012, chrome)));
shadowed(engine);
bike.add(engine);

/* ---------------- wheels ---------------- */
// tread: chevron grooves drawn once, used as a bump + roughness map on both tires
function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = '#000'; g.lineWidth = 7; g.lineCap = 'round';
  for (let x = 0; x < 1024 + 32; x += 32) {
    g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 16, 64); g.lineTo(x, 94); g.stroke();
    g.beginPath(); g.moveTo(x + 16, 8); g.lineTo(x + 26, 24); g.stroke();
    g.beginPath(); g.moveTo(x + 16, 120); g.lineTo(x + 26, 104); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
const tread = treadTexture();
const tireMat = rubber.clone();
Object.assign(tireMat, { bumpMap: tread, bumpScale: 1.6, roughnessMap: tread });
// billet wheel face: a disc with five swept windows cut out, extruded with a machined chamfer
function billetFace(rimR, hubR, spokes, depth) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rimR, 0, Math.PI * 2, false);
  const win = (Math.PI * 2) / spokes, web = 0.34;           // radians of metal left between windows
  const rIn = hubR + 0.035, rOut = rimR - 0.03, sweep = 0.42; // windows twist as they reach the rim
  for (let s = 0; s < spokes; s++) {
    const a0 = s * win + web / 2, a1 = (s + 1) * win - web / 2;
    const h = new THREE.Path();
    h.absarc(0, 0, rOut, a0 + sweep, a1 + sweep, false);
    h.quadraticCurveTo(Math.cos(a1 + sweep * 0.45) * (rIn + rOut) * 0.5, Math.sin(a1 + sweep * 0.45) * (rIn + rOut) * 0.5,
      Math.cos(a1 + 0.12) * rIn, Math.sin(a1 + 0.12) * rIn);
    h.absarc(0, 0, rIn, a1 + 0.12, a0 + 0.3, true);
    h.quadraticCurveTo(Math.cos(a0 + sweep * 0.6) * (rIn + rOut) * 0.5, Math.sin(a0 + sweep * 0.6) * (rIn + rOut) * 0.5,
      Math.cos(a0 + sweep) * rOut, Math.sin(a0 + sweep) * rOut);
    shape.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 3, curveSegments: 64,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
function drilledRotor(r, inner) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, rr = lerp(inner, r, i % 2 ? 0.4 : 0.68);
    const d = new THREE.Path(); d.absarc(Math.cos(a) * rr, Math.sin(a) * rr, 0.0055, 0, Math.PI * 2, true); shape.holes.push(d);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false, curveSegments: 48 });
  geo.translate(0, 0, -0.003);
  return geo;
}
function makeWheel(Rr, width, rimR, spokes) {
  const g = new THREE.Group();
  const w = width / 2, c = Math.min(w * 0.75, (Rr - rimR) * 0.6);
  const prof = [];
  prof.push(new THREE.Vector2(rimR + 0.005, -w * 0.82));
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2); prof.push(new THREE.Vector2(Rr - c + Math.cos(a) * c, -w + c + Math.sin(a) * c)); }
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); prof.push(new THREE.Vector2(Rr - c + Math.cos(a) * c, w - c + Math.sin(a) * c)); }
  prof.push(new THREE.Vector2(rimR + 0.005, w * 0.82));
  const tireGeo = new THREE.LatheGeometry(prof, 128);
  const uv = tireGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    // map the crown (middle of the profile) across the full tread band, sidewalls to plain rubber
    const v = uv.getY(i);
    uv.setXY(i, uv.getX(i) * 4, clamp01((v - 0.22) / 0.56));
  }
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.rotation.x = Math.PI / 2; g.add(tire);
  // rim barrel with rolled lips
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.84, 96, 1, true), chrome);
  rim.material = chrome; rim.rotation.x = Math.PI / 2; g.add(rim);
  [w * 0.84, -w * 0.84].forEach((z) => {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR + 0.004, 0.013, 16, 96), chrome);
    lip.position.z = z; g.add(lip);
  });
  // a billet face on each side; the fat rear wheel sets them wide, the skinny front close together
  const faceGeo = billetFace(rimR - 0.004, 0.075, spokes, 0.022);
  [1, -1].forEach((side) => {
    const face = new THREE.Mesh(faceGeo, chrome);
    face.position.z = side * width * 0.3;
    if (side < 0) face.rotation.y = Math.PI;
    g.add(face);
  });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, width * 0.72, 40), chrome);
  hub.rotation.x = Math.PI / 2; g.add(hub);
  [1, -1].forEach((side) => {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.03, 6), chrome);
    cap.rotation.x = Math.PI / 2; cap.position.z = side * (width * 0.36 + 0.02); g.add(cap);
  });
  return shadowed(g);
}

/* ---------------- 3. REAR WHEEL ---------------- */
const rearWheel = new THREE.Group();
const rearSpin = makeWheel(0.42, 0.34, 0.27, 5);
rearWheel.add(rearSpin);
// toothed sprocket
const sprShape = new THREE.Shape();
for (let i = 0; i < 96; i++) {
  const a = (i / 96) * Math.PI * 2, r = i % 2 ? 0.2 : 0.188;
  i ? sprShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sprShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
}
const sprHole = new THREE.Path(); sprHole.absarc(0, 0, 0.1, 0, Math.PI * 2, true); sprShape.holes.push(sprHole);
const sprocket = new THREE.Mesh(new THREE.ExtrudeGeometry(sprShape, { depth: 0.012, bevelEnabled: false }), satin);
sprocket.position.z = -0.205; rearSpin.add(sprocket);
const rotorR = new THREE.Mesh(drilledRotor(0.17, 0.1), satin);
rotorR.position.z = 0.215; rearSpin.add(rotorR);
const caliperR = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.05, 3, 0.018), chrome);
caliperR.position.set(0.12, 0.08, 0.215); caliperR.rotation.z = -0.6; rearWheel.add(caliperR);
const chainTex = canvasTex(64, 16, (g) => {
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#8d9196'; g.fillRect(2, 3, 28, 10); g.fillRect(34, 1, 28, 14);
  g.fillStyle = '#3a3c3f'; g.beginPath(); g.arc(8, 8, 3, 0, 7); g.arc(24, 8, 3, 0, 7); g.fill();
}, { srgb: true, repeat: [140, 1] });
const chainMat = new THREE.MeshStandardMaterial({ map: chainTex, metalness: 0.8, roughness: 0.45, bumpMap: chainTex, bumpScale: 2 });
rearWheel.add(tubeMesh([V(-0.02, 0.195, -0.2), V(0.6, 0.12, -0.2), V(1.15, 0.05, -0.2), V(1.27, -0.02, -0.2), V(1.15, -0.09, -0.2), V(0.5, -0.16, -0.2), V(-0.02, -0.195, -0.2)], 0.011, chainMat, 160, 0.5));
rearWheel.position.copy(R);
shadowed(rearWheel);
bike.add(rearWheel);

/* ---------------- 4. FRONT END ---------------- */
const front = new THREE.Group(); // positioned at F; children relative to F
const frontSpin = makeWheel(0.4, 0.13, 0.31, 5);
front.add(frontSpin);
const rotorF = new THREE.Mesh(drilledRotor(0.16, 0.095), satin);
rotorF.position.z = 0.085; frontSpin.add(rotorF);
const rel = (v) => v.clone().sub(F);
const upperTree = N1.clone().addScaledVector(A, 0.05);
[0.1, -0.1].forEach((z) => {
  front.add(cyl(rel(V(F.x, F.y, z)), rel(V(upperTree.x, upperTree.y, z)), 0.03, chrome));
  front.add(cyl(rel(V(F.x, F.y, z)), rel(V(F.x + A.x * 0.4, F.y + A.y * 0.4, z)), 0.042, chrome));
});
[N0.clone().addScaledVector(A, -0.06), upperTree].forEach((p) => {
  const tree = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.05, 0.3, 2, 0.015), chrome);
  tree.position.copy(rel(p)); tree.quaternion.setFromUnitVectors(V(0, 1, 0), A); front.add(tree);
});
// arched fork brace over the tire
const braceY = 0.5;
front.add(tubeMesh([V(A.x * braceY, A.y * braceY, 0.1), V(A.x * braceY + 0.02, A.y * braceY + 0.05, 0), V(A.x * braceY, A.y * braceY, -0.1)], 0.014, chrome, 24, 0.5));
const caliperF = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.065, 0.05, 3, 0.018), chrome);
caliperF.position.set(A.x * 0.13 - 0.03, A.y * 0.13, 0.11); caliperF.rotation.z = Math.atan2(A.y, A.x) - Math.PI / 2; front.add(caliperF);
front.position.copy(F);
shadowed(front);
bike.add(front);

/* ---------------- 5. TANK ---------------- */
const tank = new THREE.Group();
// sculpt a unit sphere into a stretched teardrop: tall, domed nose tapering toward the seat
const TANK_S = V(0.52, 0.21, 0.17);
function sculpt(v) {
  const taper = 0.66 + 0.34 * ((v.x + 1) / 2);
  return V(v.x * TANK_S.x, v.y * taper * (v.y > 0 ? 1.18 : 0.9) * TANK_S.y, v.z * taper * TANK_S.z);
}
const tankGeo = new THREE.SphereGeometry(1, 96, 48);
const tp = tankGeo.attributes.position;
for (let i = 0; i < tp.count; i++) {
  const s = sculpt(V(tp.getX(i), tp.getY(i), tp.getZ(i)));
  tp.setXYZ(i, s.x, s.y, s.z);
}
tankGeo.computeVertexNormals();
tank.add(new THREE.Mesh(tankGeo, tankMat));
const dash = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16), chrome);
dash.scale.set(0.32, 0.03, 0.035); dash.position.set(0.06, 0.2, 0); tank.add(dash);
const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 24), chrome);
cap.position.set(0.26, 0.215, 0); tank.add(cap);
// riveted chrome panel border on each side, like the reference build
const rivetGeo = new THREE.SphereGeometry(0.009, 10, 8);
[1, -1].forEach((side) => {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const d = V(Math.cos(a) * 0.72, Math.sin(a) * 0.36 + 0.06, 0);
    d.z = side * Math.sqrt(Math.max(0, 1 - d.x * d.x - d.y * d.y));
    pts.push(sculpt(d).multiplyScalar(1.012));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  tank.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.008, 8, true), chrome));
  for (let i = 0; i < 26; i++) {
    const r = new THREE.Mesh(rivetGeo, chrome);
    r.position.copy(curve.getPointAt(i / 26)); tank.add(r);
  }
});
tank.position.set(0.52, 1.35, 0); tank.rotation.z = 0.3;
shadowed(tank);
bike.add(tank);

/* ---------------- 6. SEAT + FENDER ---------------- */
const seatFender = new THREE.Group();
const seat = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), leather);
seat.scale.set(0.34, 0.075, 0.17); seat.position.set(-0.42, 1.04, 0); seat.rotation.z = 0.14;
seatFender.add(seat);
const stitchPts = [];
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  stitchPts.push(V(Math.cos(a) * 0.86, 0.5, Math.sin(a) * 0.86));
}
// the seat mesh is a scaled sphere, so the stitch line is built in its unit space and scaled with it
const seatStitch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stitchPts, true), 128, 0.03, 6, true), stitch);
seatStitch.scale.copy(seat.scale); seatStitch.position.copy(seat.position); seatStitch.rotation.copy(seat.rotation);
seatStitch.scale.y *= 1.02;
seatFender.add(seatStitch);
const fenderGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.38, 64, 1, true, Math.PI * 0.72, Math.PI * 0.86);
fenderGeo.rotateX(Math.PI / 2);
const fender = new THREE.Mesh(fenderGeo, tankMat.clone());
fender.material.side = THREE.DoubleSide;
fender.material.map = tankMat.map.clone(); fender.material.map.repeat.set(0.6, 1); fender.material.map.offset.set(0.2, 0); fender.material.map.needsUpdate = true;
fender.position.copy(R);
seatFender.add(fender);
// chrome edge trim and rivets along both fender rails
[0.19, -0.19].forEach((z) => {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const th = Math.PI * (0.72 + 0.86 * (i / 40));
    pts.push(V(R.x + 0.505 * Math.sin(th), R.y - 0.505 * Math.cos(th), z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  seatFender.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.011, 8), chrome));
  for (let i = 1; i < 14; i++) {
    const r = new THREE.Mesh(rivetGeo, chrome);
    r.position.copy(curve.getPointAt(i / 14)).add(V(0, 0, z > 0 ? -0.025 : 0.025));
    r.position.add(r.position.clone().sub(V(R.x, R.y, r.position.z)).setLength(0.012));
    seatFender.add(r);
  }
});
const tl = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.05, 0.12, 2, 0.01), tail);
tl.position.set(R.x - 0.5, R.y + 0.08, 0); tl.rotation.z = -0.3; seatFender.add(tl);
[0.2, -0.2].forEach((z) => seatFender.add(cyl(V(-1.48, 0.46, z), V(-1.1, 0.82, z), 0.012, chrome)));
shadowed(seatFender);
bike.add(seatFender);

/* ---------------- 7. EXHAUST ---------------- */
const exhaust = new THREE.Group();
// drag pipes sweep back, then turn down slightly at the tips
const pipeA = [V(0.41, 0.9, 0.08), V(0.56, 0.78, 0.2), V(0.52, 0.52, 0.26), V(0.3, 0.34, 0.28), V(-0.3, 0.31, 0.28), V(-0.86, 0.35, 0.28), V(-1.02, 0.31, 0.28)];
const pipeB = [V(-0.12, 0.9, 0.08), V(-0.22, 0.76, 0.22), V(-0.2, 0.58, 0.33), V(-0.34, 0.47, 0.34), V(-0.9, 0.49, 0.34), V(-1.08, 0.44, 0.34)];
const slashMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9, side: THREE.DoubleSide });
[pipeA, pipeB].forEach((p) => {
  const pipe = tubeMesh(p, 0.042, chrome, 140, 0.35);
  exhaust.add(pipe);
  // slash-cut opening: a dark ellipse tilted 35° off the pipe axis
  const curve = pipe.userData.curve;
  const end = curve.getPointAt(1), dir = curve.getTangentAt(1).normalize();
  const cut = new THREE.Mesh(new THREE.CircleGeometry(0.04, 32), slashMat);
  cut.scale.set(1, 1 / Math.cos(0.6), 1);
  cut.position.copy(end);
  cut.quaternion.setFromUnitVectors(V(0, 0, 1), dir);
  cut.rotateX(0.6);
  exhaust.add(cut);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 8, 32), chrome);
  lip.scale.copy(cut.scale); lip.position.copy(end); lip.quaternion.copy(cut.quaternion);
  exhaust.add(lip);
});
shadowed(exhaust);
bike.add(exhaust);

/* ---------------- 8. BARS + LIGHT ---------------- */
const bars = new THREE.Group();
const ape = [V(0.88, 1.43, 0.09), V(0.86, 1.86, 0.13), V(0.82, 1.98, 0.22), V(0.68, 1.97, 0.36), V(0.58, 1.93, 0.42)];
bars.add(tubeMesh(ape, 0.02, candy, 60, 0.3), tubeMesh(mirrorZ(ape), 0.02, candy, 60, 0.3));
bars.add(cyl(V(0.86, 1.68, 0.11), V(0.86, 1.68, -0.11), 0.014, chrome));
[1, -1].forEach((s) => {
  bars.add(cyl(V(0.6, 1.935, 0.4 * s), V(0.5, 1.9, 0.5 * s), 0.024, rubber));
  bars.add(cyl(V(0.64, 1.96, 0.36 * s), V(0.66, 2.12, 0.38 * s), 0.008, chrome));
  // small oval mirror: curved chrome back so it picks up varied reflections, not a flat white disc
  const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.04, 32, 16), chrome);
  mirror.scale.set(0.32, 0.72, 1); mirror.position.set(0.665, 2.14, 0.385 * s); mirror.rotation.y = -0.25 * s; bars.add(mirror);
  const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.038, 32), new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 1, roughness: 0.02 }));
  glassM.scale.set(1, 0.72, 1); glassM.position.set(0.655, 2.14, 0.385 * s); glassM.rotation.y = -Math.PI / 2 - 0.25 * s; bars.add(glassM);
});
const cableMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55 });
bars.add(tubeMesh([V(0.6, 1.93, 0.36), V(0.74, 1.9, 0.3), V(0.98, 1.6, 0.12), V(1.02, 1.32, 0.08), V(0.9, 1.24, 0.07)], 0.006, cableMat, 60, 0.5));
bars.add(tubeMesh([V(0.6, 1.93, -0.36), V(0.76, 1.88, -0.3), V(1.0, 1.58, -0.12), V(1.03, 1.3, -0.08), V(0.88, 1.2, -0.08)], 0.006, cableMat, 60, 0.5));
bars.add(tubeMesh([V(0.66, 1.95, 0.33), V(0.82, 1.86, 0.24), V(1.06, 1.5, 0.15), V(1.3, 1.0, 0.14), V(1.62, 0.62, 0.12), V(1.86, 0.5, 0.11)], 0.005, satin, 80, 0.5));
const H = V(1.3, 1.17);
const bucketMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), chrome);
bucketMesh.position.copy(H); bucketMesh.rotation.z = Math.PI / 2; bucketMesh.scale.set(1, 1.2, 1);
bars.add(bucketMesh);
const glass = new THREE.Mesh(new THREE.CircleGeometry(0.115, 48), lens);
glass.position.set(H.x + 0.005, H.y, 0); glass.rotation.y = Math.PI / 2; bars.add(glass);
const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.012, 12, 48), chrome);
bezel.position.copy(glass.position); bezel.rotation.y = Math.PI / 2; bars.add(bezel);
bars.add(cyl(V(1.12, 1.17), V(1.2, 1.17), 0.02, chrome));
const headGlow = new THREE.PointLight(0xffe2a8, 0, 3);
headGlow.position.set(H.x + 0.3, H.y, 0); bars.add(headGlow);
shadowed(bars);
bike.add(bars);

/* ---------------- chalk sketch (what the hero shows before any metal) ---------------- */
const chalk = new THREE.LineDashedMaterial({ color: 0xf4eedf, dashSize: 0.07, gapSize: 0.035, transparent: true, opacity: 0.7, depthWrite: false });
const ghost = new THREE.Group();
function sketch(pts, closed = false, wobble = 0.006) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.3);
  // two slightly offset strokes read as a hand-drawn chalk line
  for (let pass = 0; pass < 2; pass++) {
    const sp = curve.getSpacedPoints(Math.max(24, Math.round(curve.getLength() * 40)))
      .map((p) => V(p.x + (Math.random() - 0.5) * wobble, p.y + (Math.random() - 0.5) * wobble, 0));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sp), chalk);
    line.computeLineDistances();
    ghost.add(line);
  }
}
const ring = (c, r, n = 40) => Array.from({ length: n }, (_, i) => V(c.x + Math.cos((i / n) * Math.PI * 2) * r, c.y + Math.sin((i / n) * Math.PI * 2) * r));
sketch(ring(R, 0.42), true); sketch(ring(R, 0.27), true);
sketch(ring(F, 0.4), true); sketch(ring(F, 0.31), true);
sketch(backbone); sketch(downR); sketch(stayR); sketch(postR);
sketch([F, upperTree]);
sketch(ring(V(0, 0), 1, 32).map((p) => V(0.52 + (p.x * 0.52) * Math.cos(0.3) - (p.y * 0.2) * Math.sin(0.3), 1.35 + (p.x * 0.52) * Math.sin(0.3) + (p.y * 0.2) * Math.cos(0.3))), true);
sketch([V(-0.75, 1.0), V(-0.42, 1.1), V(-0.1, 1.04)]);
sketch(ape); sketch([V(0.04, 0.3), V(0.42, 0.3), V(0.5, 0.9), V(-0.2, 0.9)], true);
ghost.position.z = 0.001;
scene.add(ghost);

/* ---------------- assembly choreography ---------------- */
// each part flies in from an offset; frame is drawn instead
const parts = [
  { obj: frame, draw: true },
  { obj: engine, from: V(0, 2.6, 0), rot: V(0, 0.6, 0), weight: 1, hit: V(0.15, 0.3, 0) },        // lowered on the hoist
  { obj: rearWheel, from: V(-3.4, 0, 0), roll: 0.42, weight: 0.7, hit: V(0, -0.4, 0) },            // rolled in from behind
  { obj: front, from: V(3.0, 0, 0), roll: 0.4, weight: 0.55, hit: V(0, -0.38, 0) },                // rolled in from the front
  { obj: tank, from: V(0.2, 1.6, 0), rot: V(0, 0, 0.5), weight: 0.3, hit: V(0, -0.15, 0) },
  { obj: seatFender, from: V(-0.6, 1.5, 0), rot: V(0, 0, -0.25), weight: 0.3, hit: V(-0.5, 1, 0) },
  { obj: exhaust, from: V(0, 0.2, 2.2), rot: V(0.3, 0, 0), weight: 0.35, hit: V(-0.3, 0.3, 0.3) },
  { obj: bars, from: V(0, 1.8, 0), rot: V(0, 0, -0.3), weight: 0.25, hit: V(0.86, 1.45, 0) },
];
const specs = [
  ['Frame', '1¾ in DOM steel, 38° rake'],
  ['Engine', '117 cu in V-twin'],
  ['Rear wheel', '300 mm tire on an 18 in billet wheel'],
  ['Front end', 'Fork 6 in over, 21 in wheel'],
  ['Tank', '3.6 gal, candy apple with ghost flames'],
  ['Seat and fender', 'Hand-stitched leather, rolled steel'],
  ['Exhaust', 'Two-into-two drag pipes, slash cut'],
  ['Bars and light', '16 in apes, 7 in headlight'],
];
parts.forEach((p, i) => {
  p.obj.userData.spec = specs[i];
  p.home = p.obj.position.clone();
  p.homeRot = p.obj.rotation.clone();
  p.landed = false;
});
frameTubes.forEach((m) => { m.userData.count = m.geometry.index.count; });

/* ---------------- photographic model swap ---------------- */
// "Chopper 3D model" by Source 4 (Sketchfab, CC BY 4.0). The hand-built bike above stays as the
// fallback and is shown until this loads. The model ships as 61 unnamed pieces; the map below was
// made by highlighting each piece in models/ and sorting it into one of the eight stations.
const model = { ready: false, clip: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), weldPts: [] };
const STATION_OF = {};
[
  [0, [49, 14, 21, 43, 20, 62, 44, 59, 61]],                         // frame, small brackets, kickstand
  [1, [4, 23, 24, 25, 28, 29, 30, 46, 54]],                          // engine, cases, pushrods, covers
  [2, [9, 10, 12, 22, 32, 33, 39, 41, 52, 55, 56]],                  // rear tire, rim, rotors, sprocket, belts
  [3, [15, 18, 19, 34, 35, 36, 37, 38, 47, 50, 51, 57, 58]],         // springer fork, front wheel and rotors
  [4, [48, 2, 60]],                                                  // tank and dash
  [5, [13, 16, 17, 40, 45, 8, 11, 31, 53]],                          // seat, fender, struts, tail light
  [6, [7]],                                                          // pipes
  [7, [27, 6, 42, 3, 5]],                                            // bars, levers, headlight
].forEach(([st, ids]) => ids.forEach((id) => { STATION_OF[`Object_${id}`] = st; }));
// these pieces fuse frame rails and engine parts into one mesh; they are split by connected island
const STATIC_ON_WHEEL = new Set(['Object_22', 'Object_15', 'Object_18', 'Object_19']);
const FUSED = new Set(['Object_25', 'Object_26', 'Object_28', 'Object_29']);
const FINISH_OF = {};
[
  ['candy', [49, 14, 21, 43, 20, 62, 16, 17, 40, 45, 27]],
  ['tank', [48]],
  ['rubber', [9, 51, 57, 58]],
  ['leather', [13]],
  ['dark', [22, 44, 59, 61, 6, 8, 53]],
  ['satin', [32, 33, 34, 35, 36, 37, 12, 52, 55, 56]],
  ['lens', [5]],
  ['tail', [31]],
].forEach(([f, ids]) => ids.forEach((id) => { FINISH_OF[`Object_${id}`] = f; }));
const FINISHES = { candy, chrome, satin, rubber, leather, lens, tail, dark: darkMetal };

// split an indexed geometry into its disconnected islands (welding duplicate vertices by position)
function islands(geo) {
  const pos = geo.attributes.position, idx = geo.index.array, n = pos.count;
  const key = new Map(), canon = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!key.has(k)) key.set(k, i);
    canon[i] = key.get(k);
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(canon[idx[i]]), b = find(canon[idx[i + 1]]), c = find(canon[idx[i + 2]]);
    parent[b] = a; parent[find(c)] = a;
  }
  const groups = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const r = find(canon[idx[i]]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  return [...groups.values()].map((tri) => { const g = geo.clone(); g.setIndex(tri); return g; });
}

// candy flames projected onto each side of the tank, base at the nose, licking back
function projectTankUVs(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, v = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(mesh);
  const uv = new Float32Array(pos.count * 2), zMid = (box.min.z + box.max.z) / 2;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const back = (box.max.x - v.x) / (box.max.x - box.min.x);
    uv[i * 2] = v.z > zMid ? 0.5 - back * 0.5 : 0.5 + back * 0.5;
    uv[i * 2 + 1] = (v.y - box.min.y) / (box.max.y - box.min.y);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function installModel(gltf) {
  const root = gltf.scene;
  const S = 1.35;                                  // model is ~2.85 m nose to tail; match the table
  root.scale.setScalar(S);
  root.position.set(0.28, 0.01 * S, 0.16 * S);     // wheels sit on the table, centered on its width
  root.rotation.x = 0.13;                          // the scan leans ~6° onto its kickstand; stand it upright on the lift
  root.position.y -= 0.025; root.position.z -= 0.06;
  scene.add(root);
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  // split fused meshes into islands, sorting each: long thin rails are frame, the rest is engine
  for (const m of meshes.filter((o) => FUSED.has(o.name))) {
    for (const geo of islands(m.geometry)) {
      const piece = new THREE.Mesh(geo, m.material);
      m.parent.add(piece);
      piece.position.copy(m.position); piece.quaternion.copy(m.quaternion); piece.scale.copy(m.scale);
      piece.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(piece), sz = b.getSize(new THREE.Vector3());
      const long = Math.max(sz.x, sz.y), thin = Math.min(sz.x, sz.y, sz.z);
      const isRail = long > 0.55 && thin < 0.12;
      piece.name = `${m.name}_${isRail ? 'rail' : 'part'}`;
      STATION_OF[piece.name] = isRail ? 0 : 1;
      FINISH_OF[piece.name] = isRail ? 'candy' : 'chrome';
      meshes.push(piece);
    }
    m.removeFromParent();
  }

  // wheel centers measured in model space (Y-up after Sketchfab's root rotation)
  const rearAxle = root.localToWorld(V(-1.12, 0.39, -0.17));
  const frontAxle = root.localToWorld(V(0.96, 0.37, -0.15));

  const groups = parts.map((p, i) => {
    const g = new THREE.Group();
    g.userData.spec = p.obj.userData.spec;
    if (i === 2 || i === 3) {
      g.position.copy(i === 2 ? rearAxle : frontAxle);
      g.add(new THREE.Group(), new THREE.Group()); // [0] spins when it rolls in, [1] stays put
    }
    bike.add(g);
    g.updateMatrixWorld(true);
    return g;
  });

  const frameMats = new Map();
  for (const m of meshes.filter((o) => o.parent)) {
    const st = STATION_OF[m.name];
    if (st === undefined) continue;
    const fin = FINISH_OF[m.name] || 'chrome';
    if (m.name === 'Object_48') { projectTankUVs(m); m.material = tankMat; }
    else if (st === 0) {
      // frame pieces get clipped copies of their finish so the weld sweep can reveal them
      const base = FINISHES[fin];
      if (!frameMats.has(base)) frameMats.set(base, Object.assign(base.clone(), { clippingPlanes: [model.clip], clipShadows: true }));
      m.material = frameMats.get(base);
    } else m.material = FINISHES[fin];
    m.castShadow = m.receiveShadow = true;
    const g = groups[st];
    // belts and the springer fork stay put while the wheel rolls in; everything else on a wheel station spins
    const holder = st === 2 || st === 3 ? g.children[STATIC_ON_WHEEL.has(m.name) ? 1 : 0] : g;
    holder.attach(m);
  }

  // weld-spark sample points along the frame
  const v = new THREE.Vector3();
  groups[0].traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 7) model.weldPts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
  });
  const fb = new THREE.Box3().setFromObject(groups[0]);
  model.frameMinX = fb.min.x; model.frameMaxX = fb.max.x;

  // headlight glow follows the model's headlight
  const lamp = root.localToWorld(V(0.66, 1.07, -0.26));
  groups[7].attach(headGlow); headGlow.position.copy(groups[7].worldToLocal(lamp.add(V(0.35, 0, 0))));

  // contact shadows under the model's tires
  poolRear.position.x = rearAxle.x; poolRear.position.z = rearAxle.z; poolRear.scale.set(1.15, 1.25, 1);
  poolFront.position.x = frontAxle.x; poolFront.position.z = frontAxle.z; poolFront.scale.set(1.3, 1.2, 1);
  poolBody.position.x = (rearAxle.x + frontAxle.x) / 2; poolBody.position.z = rearAxle.z;

  // chalk sketch traced from the model's own edges
  ghost.clear();
  meshes.filter((m) => /^Object_(49|48|9|51|10|38|19|13|40|7|27|46)(_|$)/.test(m.name)).forEach((m) => {
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 40), chalk);
    lines.applyMatrix4(m.matrixWorld);
    lines.computeLineDistances();
    ghost.add(lines);
  });
  ghost.position.z = 0;

  // swap the stations over to the model and retire the hand-built bike
  parts.forEach((p, i) => {
    bike.remove(p.obj);
    p.obj = groups[i];
    p.home = groups[i].position.clone();
    p.homeRot = groups[i].rotation.clone();
    const b = new THREE.Box3().setFromObject(groups[i]);
    p.hit = V((b.min.x + b.max.x) / 2, b.min.y + 0.02, (b.min.z + b.max.z) / 2).sub(p.home);
    if (p.roll) p.roll = (b.max.y - b.min.y) / 2;
    p.landed = false;
  });
  root.removeFromParent();
  renderer.localClippingEnabled = true;
  Object.assign(model, { groups, rearAxle, frontAxle, frameMats: [...frameMats.values()], frameCandy: frameMats.get(candy), byName: Object.fromEntries(meshes.filter((m) => m.parent).map((m) => [m.name, m])) });
  model.ready = true;
  onModelReady();
}

new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
  'models/pro-street-chopper/chopper.glb',
  installModel,
  undefined,
  (err) => console.warn('Model failed to load; showing the hand-built bike instead.', err),
);

/* ---------------- sparks ---------------- */
const MAXS = 600;
const sGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(MAXS * 3);
const sVel = new Float32Array(MAXS * 3);
const sLife = new Float32Array(MAXS);
sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
const sMat = new THREE.PointsMaterial({ color: 0xffb04a, size: 0.035, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const sparks = new THREE.Points(sGeo, sMat);
sparks.frustumCulled = false;
scene.add(sparks);
let sHead = 0;
function emit(p, n, power = 1) {
  if (reduceMotion) return;
  for (let i = 0; i < n; i++) {
    const k = sHead++ % MAXS;
    sPos.set([p.x, p.y, p.z], k * 3);
    const a = Math.random() * Math.PI * 2, up = Math.random();
    sVel.set([Math.cos(a) * 1.6 * power * Math.random(), (0.6 + up * 2) * power, Math.sin(a) * 1.6 * power * Math.random()], k * 3);
    sLife[k] = 0.5 + Math.random() * 0.5;
  }
}
function stepSparks(dt) {
  for (let k = 0; k < MAXS; k++) {
    if (sLife[k] <= 0) { sPos[k * 3 + 1] = -99; continue; }
    sLife[k] -= dt;
    sVel[k * 3 + 1] -= 9.8 * dt;
    sPos[k * 3] += sVel[k * 3] * dt; sPos[k * 3 + 1] += sVel[k * 3 + 1] * dt; sPos[k * 3 + 2] += sVel[k * 3 + 2] * dt;
    if (sPos[k * 3 + 1] < 0.005 && sVel[k * 3 + 1] < 0) { sPos[k * 3 + 1] = 0.005; sVel[k * 3 + 1] *= -0.3; sVel[k * 3] *= 0.6; sVel[k * 3 + 2] *= 0.6; }
  }
  sGeo.attributes.position.needsUpdate = true;
}

/* ---------------- camera path (azimuth°, elevation°, distance) ---------------- */
// 90° = side view from the exhaust side, 0° = head-on, 180° = from behind
const camKeys = [
  [0.00, 70, 12, 9.4],
  [0.10, 62, 14, 8.6],
  [0.30, 96, 8, 8.0],
  [0.45, 58, 11, 7.6],
  [0.62, 112, 15, 7.4],
  [0.78, 88, 6, 7.8],
  [0.88, 36, 8, 7.0],
  [1.00, 150, 10, 6.4],
];
function camAt(p) {
  let i = 0;
  while (i < camKeys.length - 2 && p > camKeys[i + 1][0]) i++;
  const a = camKeys[i], b = camKeys[i + 1];
  const t = easeInOut(clamp01((p - a[0]) / (b[0] - a[0])));
  return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

/* ---------------- layout + scroll mapping ---------------- */
const stations = [...document.querySelectorAll('.station')];
const railItems = [...document.querySelectorAll('.rail li')];
const rail = document.querySelector('.rail');
const layers = [...document.querySelectorAll('.layer')];
let ranges = [], maxScroll = 1, vw = innerWidth, vh = innerHeight;
// spec sheet camera: blends from the scroll path to a close-up of whatever is being changed
const specCam = { w: 0, range: [1e9, 1e9, 1e9, 1e9], focus: null, cur: null, target: new THREE.Vector3() };

function layout() {
  vw = innerWidth; vh = innerHeight;
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  // wide screens: centre the bike in the space right of the card and pull back if that space is narrow.
  // phones: the card sits low, so the bike moves up.
  const fit = (el) => {
    if (!el || vw <= 760) return { x: 0, k: 1 };
    const left = el.getBoundingClientRect().right + 16, right = vw - 64, free = Math.max(160, right - left);
    return { x: (left + right) / 2 - vw / 2, k: THREE.MathUtils.clamp((0.67 * vw) / free, 1, 1.9) };
  };
  framing.station = fit(document.querySelector('.station .ticket'));
  framing.spec = fit(document.querySelector('.spec-sheet'));
  framing.form = fit(document.querySelector('.ticket-form'));
  const fin = document.getElementById('finale');
  framing.formRange = fin ? [fin.offsetTop - vh, fin.offsetTop - vh * 0.4] : [Infinity, Infinity];
  framing.last = null;
  maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  ranges = stations.map((s) => {
    const start = s.offsetTop - vh * 0.75;
    return [start, start + s.offsetHeight * 0.55];
  });
  layers.forEach((l) => { l.dataset.span = l.getBoundingClientRect().width - vw; });
  const sec = document.getElementById('customize');
  if (sec) {
    const top = sec.offsetTop, bot = top + sec.offsetHeight;
    specCam.range = [top - vh * 0.9, top - vh * 0.3, bot - vh * 0.95, bot - vh * 0.4];
  }
}
addEventListener('resize', layout);
const framing = { station: { x: 0, k: 1 }, spec: { x: 0, k: 1 }, form: { x: 0, k: 1 }, formRange: [Infinity, Infinity], last: null };
function frameView(sw) {
  // the closing card is wider than a station card: as it arrives, frame the bike in the space beside it instead
  const fw = THREE.MathUtils.smoothstep(smooth, framing.formRange[0], framing.formRange[1]);
  const bx = lerp(framing.station.x, framing.form.x, fw), bk = lerp(framing.station.k, framing.form.k, fw);
  const x = lerp(bx, framing.spec.x, sw), k = lerp(bk, framing.spec.k, sw);
  const key = vw > 760 ? Math.round(x) : 'phone';
  if (key !== framing.last) {
    framing.last = key;
    if (vw > 760) camera.setViewOffset(vw, vh, -x, vh * 0.02, vw, vh);
    else camera.setViewOffset(vw, vh, 0, vh * 0.16, vw, vh);
    camera.updateProjectionMatrix();
  }
  return k;
}

let target = scrollY, smooth = scrollY, lastSmooth = smooth;
addEventListener('scroll', () => { target = scrollY; }, { passive: true });

/* ---------------- frame loop ---------------- */
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let shake = 0;          // camera jolt when a heavy part lands
let lightT = -1;        // seconds since the headlight was wired up; -1 = off

function updateParts(dt, forward) {
  let current = -1;
  parts.forEach((p, i) => {
    const [s, e] = ranges[i];
    let t = clamp01((smooth - s) / (e - s));
    if (reduceMotion) t = t > 0 ? 1 : 0;
    p.t = t;
    if (smooth >= s) current = i;

    if (p.draw && model.ready) {
      // the scanned frame is revealed by a weld line sweeping from the neck back to the axle
      p.obj.visible = t > 0;
      const c = lerp(model.frameMaxX + 0.03, model.frameMinX - 0.03, t);
      model.clip.constant = -c;
      if (forward && t > 0 && t < 1) {
        for (let k = 0; k < 40; k++) {
          const v = model.weldPts[(Math.random() * model.weldPts.length) | 0];
          if (Math.abs(v.x - c) < 0.04) { emit(v, 4, 0.6); break; }
        }
      }
      chalk.opacity = 0.7 * (1 - clamp01(t * 1.6));
      ghost.visible = chalk.opacity > 0.01;
      if (t < 1) p.landed = false;
      return;
    }
    if (p.draw) {
      // weld each tube in sequence
      const n = frameTubes.length, f = t * n;
      frameTubes.forEach((m, k) => {
        const local = clamp01(f - k);
        const cnt = Math.floor((local * m.userData.count) / 3) * 3;
        m.geometry.setDrawRange(0, cnt);
        m.visible = cnt > 0;
        if (forward && local > 0 && local < 1 && Math.random() < 0.9) emit(m.userData.curve.getPointAt(local), 3, 0.6);
      });
      frame.children.forEach((c) => { if (!frameTubes.includes(c)) c.visible = t > 0.97; });
      chalk.opacity = 0.7 * (1 - clamp01(t * 1.6));
      ghost.visible = chalk.opacity > 0.01;
      if (t >= 1 && !p.landed && forward) { p.landed = true; }
      if (t < 1) p.landed = false;
      return;
    }

    p.obj.visible = t > 0;
    const k = easeOut(t);
    p.obj.position.copy(p.home).addScaledVector(p.from, 1 - k);
    if (p.rot) p.obj.rotation.set(p.homeRot.x + p.rot.x * (1 - k), p.homeRot.y + p.rot.y * (1 - k), p.homeRot.z + p.rot.z * (1 - k));
    if (p.roll) {
      const spin = p.obj.children[0];
      spin.rotation.z = (p.from.x * (1 - k)) / -p.roll;
    }
    if (t >= 0.995 && !p.landed) {
      p.landed = true;
      if (p === parts[7]) lightT = 0;
      if (forward && !reduceMotion) {
        emit(tmp.copy(p.home).add(p.hit), Math.round(50 + 170 * p.weight), 0.8 + 0.7 * p.weight);
        shake = Math.max(shake, 0.07 * p.weight);
      }
    }
    if (t < 0.99) {
      p.landed = false;
      if (p === parts[7]) lightT = -1;
    }
  });
  poolRear.material.opacity = 0.8 * Math.pow(parts[2].t, 6);
  poolFront.material.opacity = 0.75 * Math.pow(parts[3].t, 6);
  poolBody.material.opacity = 0.35 * parts[1].t;
  // headlight: a few stuttering flickers as it gets power, then steady
  let lit = 0;
  if (lightT >= 0) {
    lightT += dt;
    lit = lightT > 0.9 || reduceMotion ? 1 : (Math.sin(lightT * 47) * Math.sin(lightT * 13) > 0.15 ? 1 : 0.08);
  }
  headGlow.intensity = 1.6 * lit;
  lens.emissiveIntensity = 0.05 + 1.6 * lit;
  return current;
}

function updateLayers(p) {
  if (reduceMotion) return;
  layers.forEach((l, i) => {
    const span = +l.dataset.span || 0;
    l.style.transform = `translate3d(${(-p * span).toFixed(1)}px, ${(-p * (i + 1) * 18).toFixed(1)}px, 0)`;
  });
}

let lastStation = -2;
function updateRail(cur) {
  rail.classList.toggle('on', smooth > vh * 0.4 && smooth < maxScroll - vh * 0.6);
  if (cur === lastStation) return;
  lastStation = cur;
  railItems.forEach((li, i) => {
    li.classList.toggle('done', i < cur);
    li.classList.toggle('now', i === cur);
    const a = li.querySelector('a');
    if (i === cur) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
  });
}

/* ---------------- drag to spin the bike 360° ---------------- */
// Drag sideways anywhere off the cards (mouse or finger) to orbit the camera all the way around.
// A flick keeps it turning for a moment; when you scroll again it eases back to the build's own angle.
let userAz = 0, spinVel = 0, dragging = null, spun = false;
const NOSPIN = '.ticket, .rail, .masthead, .shop-foot, a, button, input, textarea, label, select';
const spinHint = document.querySelector('.spin-hint');
addEventListener('pointerdown', (e) => {
  if (e.button > 0 || e.target.closest?.(NOSPIN)) return;
  // a finger has to move sideways first, so vertical swipes still scroll the page
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: e.pointerType !== 'touch' };
  spinVel = 0;
});
addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  const dx = e.clientX - dragging.x, now = performance.now();
  if (!dragging.on) {
    if (Math.abs(dx) < 8) return;
    if (Math.abs(dx) < Math.abs(e.clientY - dragging.y)) { dragging = null; return; }
    dragging.on = true;
  }
  if (!spun) { spun = true; spinHint?.classList.remove('show'); }
  document.documentElement.classList.add('spinning');
  const deg = (dx * 360) / Math.min(Math.max(vw, 360), 900); // one screen width (up to 900px) = one full turn
  userAz += deg;
  const dts = Math.max(1, now - dragging.t) / 1000;
  spinVel = lerp(spinVel, deg / dts, 0.5);
  dragging.x = e.clientX; dragging.y = e.clientY; dragging.t = now;
}, { passive: true });
const endSpin = (e) => {
  if (!dragging || (e.pointerId !== undefined && e.pointerId !== dragging.id)) return;
  if (performance.now() - dragging.t > 80 || reduceMotion) spinVel = 0; // held still before letting go: no flick
  dragging = null;
  document.documentElement.classList.remove('spinning');
};
addEventListener('pointerup', endSpin);
addEventListener('pointercancel', endSpin);

function frameTick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  smooth = reduceMotion ? target : lerp(smooth, target, 1 - Math.pow(0.0015, dt));
  if (Math.abs(smooth - target) < 0.3) smooth = target;
  const forward = smooth > lastSmooth + 0.05;
  lastSmooth = smooth;
  const p = clamp01(smooth / maxScroll);

  const cur = updateParts(dt, forward);
  updateLayers(p);
  updateRail(smooth >= specCam.range[1] ? 8 : cur);

  let [az, el, d] = reduceMotion ? [90, 8, 6] : camAt(p);
  let tgt = TARGET;
  const [a0, a1, b0, b1] = specCam.range;
  const sw = THREE.MathUtils.smoothstep(smooth, a0, a1) * (1 - THREE.MathUtils.smoothstep(smooth, b0, b1));
  specCam.w = sw;
  if (sw > 0.001 && specCam.focus) {
    const f = specCam.focus, c = (specCam.cur ||= { az: f.az, el: f.el, d: f.d, t: f.t.clone() });
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    c.az = lerp(c.az, f.az, k); c.el = lerp(c.el, f.el, k); c.d = lerp(c.d, f.d, k); c.t.lerp(f.t, k);
    az = lerp(az, c.az, sw); el = lerp(el, c.el, sw); d = lerp(d, c.d, sw);
    tgt = specCam.target.copy(TARGET).lerp(c.t, sw);
  }
  if (!dragging?.on) {
    userAz += spinVel * dt;
    spinVel *= Math.exp(-dt * 3.5);
    if (Math.abs(spinVel) < 1) spinVel = 0;
    // scrolling again: ease back to the camera path's own angle (the nearest full turn, so it never unwinds)
    if (Math.abs(smooth - target) > 2 && !spinVel) userAz = lerp(userAz, Math.round(userAz / 360) * 360, 1 - Math.exp(-dt * 2.5));
  }
  az += userAz;
  if (spinHint) {
    const want = !spun && canvas.classList.contains('ready') && (sw > 0.5 || smooth >= framing.formRange[0]);
    if (want !== spinHint.classList.contains('show')) spinHint.classList.toggle('show', want);
  }
  d *= frameView(sw);
  const aspect = vw / vh;
  if (aspect < 1.3) d *= Math.min(3, 1.32 / Math.max(aspect, 0.4));
  const azr = THREE.MathUtils.degToRad(az), elr = THREE.MathUtils.degToRad(el);
  camera.position.set(
    tgt.x + d * Math.cos(elr) * Math.cos(azr),
    tgt.y + d * Math.sin(elr),
    tgt.z + d * Math.cos(elr) * Math.sin(azr),
  );
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 9);
  }
  camera.lookAt(tgt);

  stepSparks(dt);
  renderer.render(scene, camera);
  if (!canvas.classList.contains('ready')) canvas.classList.add('ready');
  requestAnimationFrame(frameTick);
}

/* ---------------- hover labels on the finished bike ---------------- */
const tip = document.getElementById('part-tip');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = null, tipFrame = 0;
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  addEventListener('pointermove', (e) => {
    pointer = e.target.closest?.('.ticket, .rail, .masthead, a, button, input, textarea') ? null : { x: e.clientX, y: e.clientY };
    if (!tipFrame) tipFrame = requestAnimationFrame(updateTip);
  }, { passive: true });
  addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer = null; tip.hidden = true; });
}
function updateTip() {
  tipFrame = 0;
  if (!pointer || lightT < 0) { tip.hidden = true; return; }
  ndc.set((pointer.x / vw) * 2 - 1, -(pointer.y / vh) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(parts.map((p) => p.obj), true)[0];
  let o = hit?.object;
  while (o && !o.userData.spec) o = o.parent;
  if (!o) { tip.hidden = true; return; }
  const [name, spec] = o.userData.spec;
  tip.querySelector('strong').textContent = name;
  tip.querySelector('span').textContent = spec;
  tip.style.transform = `translate(${pointer.x + 18}px, ${pointer.y + 18}px)`;
  tip.hidden = false;
}

document.fonts.ready.then(layout);
layout();
requestAnimationFrame(frameTick);


/* ---------------- spec sheet: paint, bars, wheels, fenders, finishes ---------------- */
// [name, mid-tone hex for the tank artwork, metalness of the base coat]
const PAINTS = [
  ['Candy apple red', '#7d0a15'], ['Black cherry', '#46061a'], ['Root beer', '#5a240e'],
  ['Tangerine', '#c84a0a'], ['Candy gold', '#b07c0c'], ['Lime gold', '#73900e'],
  ['Organic green', '#1b5428'], ['Teal', '#0b5f69'], ['Cobalt blue', '#16359a'],
  ['Midnight blue', '#0f1a48'], ['Purple haze', '#4a1a78'], ['Magenta', '#961058'],
  ['Gloss black', '#121215', 0.2], ['Gunmetal', '#41464d', 0.75], ['Bone white', '#d9d0b9', 0.08],
];
// close on the tank, from the side, so the graphics read
const TANK_VIEW = { az: 84, el: 16, d: 4.4, t: V(0.35, 1.05, 0) };
const SPEC = [
  { id: 'style', label: 'Style', focus: { az: 70, el: 11, d: 9.0, t: V(0.4, 0.8, 0) }, fields: [
    { key: 'style', label: 'Chopper style', name: 'Style', choices: [
      ['prostreet', 'Pro-street', 'Fat rear tire, low and long'], ['oldschool', 'Old-school rigid', 'Tall apes, skinny tires, sissy bar'],
      ['bobber', 'Bobber', 'Chopped fenders, fat front, flat black'], ['longfork', 'Long-fork chopper', 'Raked out, nose in the air']] },
    { key: 'fork', label: 'Fork length', name: 'Fork', choices: [['0', 'Stock'], ['6', '+6 in'], ['12', '+12 in'], ['18', '+18 in']] },
  ] },
  { id: 'paint', label: 'Paint', focus: { az: 60, el: 14, d: 8.4, t: V(0.3, 0.85, 0) }, fields: [
    { key: 'color', label: 'Color', name: 'Paint', swatch: true, choices: PAINTS.map((c, i) => [String(i), c[0]]) },
    { key: 'graphics', label: 'Graphics', name: 'Graphics', focus: TANK_VIEW, choices: GRAPHICS },
    { key: 'stripe', label: 'Graphic color', name: 'Graphic color', focus: TANK_VIEW, choices: GRAPHIC_COLORS },
  ] },
  { id: 'bars', label: 'Bars', focus: { az: 30, el: 16, d: 5.6, t: V(0.7, 1.35, 0) }, fields: [
    { key: 'bars', label: 'Style', name: 'Bars', choices: [
      ['buckhorn', 'Buckhorns', 'Low rise, pulled back'], ['apes', '16 in apes', 'Hands at shoulder height'],
      ['mini', '10 in apes', 'Tall without the stretch'], ['z', 'Z-bars', 'Angular rise, welded bends'],
      ['drag', 'Drag bars', 'Flat, wide and low'], ['beach', 'Beach bars', 'Wide sweep back to the rider']] },
  ] },
  { id: 'wheels', label: 'Wheels', focus: { az: 84, el: 6, d: 7.6, t: V(0.25, 0.6, 0) }, fields: [
    { key: 'wheel', label: 'Wheels', name: 'Wheels', choices: [['spoke', 'Laced spokes'], ['billet', 'Billet five-spoke'], ['disc', 'Solid discs']] },
    { key: 'rear', label: 'Rear tire', name: 'Rear tire', focus: { az: 118, el: 9, d: 5.6, t: V(-0.95, 0.6, 0) },
      choices: [['200', '200 mm'], ['240', '240 mm'], ['300', '300 mm']] },
    { key: 'frontTire', label: 'Front tire', name: 'Front tire', focus: { az: 40, el: 10, d: 6.4, t: V(1.3, 0.65, 0) },
      choices: [['skinny', 'Skinny'], ['fat', 'Fat']] },
    { key: 'front', label: 'Front wheel', name: 'Front wheel', focus: { az: 58, el: 8, d: 5.8, t: V(1.3, 0.7, 0) },
      choices: [['21', '21 in'], ['23', '23 in'], ['26', '26 in']] },
  ] },
  { id: 'seat', label: 'Seat', focus: { az: 66, el: 22, d: 7.2, t: V(-0.25, 0.95, 0) }, fields: [
    { key: 'seatStyle', label: 'Style', name: 'Seat', choices: [
      ['solo', 'Solo', 'Low, sculpted to the frame'], ['sprung', 'Sprung solo', 'Pan seat on chrome springs'],
      ['bobber', 'Bobber pad', 'Thin, flat and minimal'], ['twoup', 'Two-up', 'Adds a pillion pad'],
      ['kq', 'King and queen', 'Stepped pillion and sissy bar']] },
    { key: 'seat', label: 'Leather', name: 'Leather', choices: [['black', 'Black'], ['brown', 'Saddle brown'], ['tan', 'Tan'], ['oxblood', 'Oxblood']] },
  ] },
  { id: 'fenders', label: 'Fenders', focus: { az: 124, el: 14, d: 6.6, t: V(-0.2, 0.75, 0) }, fields: [
    { key: 'rearFender', label: 'Rear', name: 'Rear fender', choices: [['wrap', 'Full wrap'], ['bob', 'Bobbed'], ['none', 'None']] },
    { key: 'frontFender', label: 'Front', name: 'Front fender', focus: { az: 52, el: 12, d: 5.8, t: V(1.3, 0.75, 0) },
      choices: [['none', 'None'], ['blade', 'Bobbed blade'], ['full', 'Full']] },
  ] },
  { id: 'exhaust', label: 'Exhaust', focus: { az: 84, el: 8, d: 6.8, t: V(-0.25, 0.55, 0) }, fields: [
    { key: 'pipeLen', label: 'Length', name: 'Exhaust length', choices: [
      ['shorty', 'Shorties', 'Cut off behind the engine'], ['short', 'Short drags', 'End ahead of the axle'],
      ['stock', 'Stock drags', 'Run back to the axle'], ['long', 'Long drags', 'Reach past the rear tire']] },
    { key: 'pipes', label: 'Finish', name: 'Exhaust finish', choices: [['chrome', 'Chrome'], ['black', 'Black ceramic'], ['heat', 'Heat-blued']] },
  ] },
  { id: 'finish', label: 'Finishes', focus: { az: 96, el: 9, d: 8.0, t: V(0.3, 0.75, 0) }, fields: [
    { key: 'engine', label: 'Engine', name: 'Engine', choices: [['chrome', 'Chrome'], ['black', 'Gloss black'], ['raw', 'Brushed']] },
    { key: 'rims', label: 'Wheels', name: 'Wheel finish', choices: [['chrome', 'Chrome'], ['black', 'Gloss black']] },
    { key: 'barsFin', label: 'Bars', name: 'Bar finish', choices: [['paint', 'Body color'], ['chrome', 'Chrome'], ['black', 'Gloss black']] },
  ] },
];
const FIELDS = SPEC.flatMap((tab) => tab.fields.map((f) => ({ ...f, tab })));
const SHOP_BUILD = { color: '0', graphics: 'flames', bars: 'buckhorn', wheel: 'spoke', rear: '300', front: '21', rearFender: 'wrap',
  frontFender: 'none', engine: 'chrome', pipes: 'chrome', rims: 'chrome', barsFin: 'paint', seat: 'black', seatStyle: 'solo',
  style: 'prostreet', fork: '0', frontTire: 'skinny', pipeLen: 'stock', stripe: 'silver' }; // new keys go last so old shared links still work
const KEYS = Object.keys(SHOP_BUILD);
// each chopper style is a full set of choices; anything changed afterwards marks the style as modified
const STYLES = {
  prostreet: { ...SHOP_BUILD },
  oldschool: { color: '1', graphics: 'pinstripe', bars: 'apes', wheel: 'spoke', rear: '200', front: '21', rearFender: 'bob', frontFender: 'none',
    engine: 'chrome', pipes: 'chrome', rims: 'chrome', barsFin: 'chrome', seat: 'oxblood', seatStyle: 'kq', fork: '12', frontTire: 'skinny', pipeLen: 'short', stripe: 'gold' },
  bobber: { color: '12', graphics: 'solid', bars: 'drag', wheel: 'spoke', rear: '240', front: '23', rearFender: 'bob', frontFender: 'blade',
    engine: 'black', pipes: 'black', rims: 'black', barsFin: 'black', seat: 'brown', seatStyle: 'sprung', fork: '0', frontTire: 'fat', pipeLen: 'shorty', stripe: 'silver' },
  longfork: { color: '3', graphics: 'hotrod', bars: 'z', wheel: 'billet', rear: '240', front: '21', rearFender: 'bob', frontFender: 'none',
    engine: 'chrome', pipes: 'heat', rims: 'chrome', barsFin: 'chrome', seat: 'black', seatStyle: 'solo', fork: '18', frontTire: 'skinny', pipeLen: 'long', stripe: 'black' },
};
Object.entries(STYLES).forEach(([k, v]) => { v.style = k; });
const styleMatches = () => KEYS.every((k) => spec[k] === STYLES[spec.style][k]);
const labelOf = (key, v) => FIELDS.find((f) => f.key === key).choices.find((c) => c[0] === v)?.[1];

// a build is shareable: ?build=0.flames.buckhorn... in field order
function readBuild() {
  const raw = new URLSearchParams(location.search).get('build');
  if (!raw) return null;
  const vals = raw.split('.'), out = {};
  KEYS.forEach((k, i) => { if (vals[i] && labelOf(k, vals[i])) out[k] = vals[i]; });
  return out;
}
const fromUrl = readBuild();
const spec = { ...SHOP_BUILD, ...fromUrl };
let touched = !!fromUrl;

/* --- finishes the spec sheet adds --- */
const gloss = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
const ceramic = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, metalness: 0.4, roughness: 0.55 });
const heatBlue = new THREE.MeshPhysicalMaterial({ color: 0xe8e2ea, metalness: 1, roughness: 0.14, iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [260, 720] });
const paintShell = candy.clone(); paintShell.side = THREE.DoubleSide; // open fender shells show their underside
const LEATHER = { black: 0x161412, brown: 0x4a2412, tan: 0x8a5a30, oxblood: 0x3a070d };

function applyPaint() {
  const [, hex, metal = 0.5] = PAINTS[+spec.color];
  const body = new THREE.Color(hex).multiplyScalar(0.72);
  [candy, paintShell, model.frameCandy].forEach((m) => { if (m) { m.color.copy(body); m.metalness = metal; } });
  tankMat.metalness = metal;
  drawTank(tankMat.map.image.getContext('2d'), hex, spec.graphics, spec.stripe);
  tankMat.map.needsUpdate = true;
}

/* --- everything below needs the scanned bike --- */
const kit = { seat: new THREE.Group(), bars: new THREE.Group(), rearFender: new THREE.Group(), frontFender: new THREE.Group(), faces: {} };
const barMat = () => ({ paint: candy, chrome, black: gloss })[spec.barsFin];
const rimMat = () => (spec.rims === 'black' ? gloss : chrome);
const swapFinish = (group, map) => group.traverse((m) => { if (m.isMesh && m.userData.base === chrome) m.material = map; });

function measureWheel(g, tire, rim, spokes, hub) {
  const box = (m) => { const b = new THREE.Box3().setFromObject(m); b.min.sub(g.position); b.max.sub(g.position); return b; };
  const t = box(tire), r = box(rim), s = box(spokes), h = box(hub);
  return {
    r: (t.max.y - t.min.y) / 2, half: (t.max.z - t.min.z) / 2, zc: (r.min.z + r.max.z) / 2,
    rimR: (r.max.y - r.min.y) / 2, spokeHalf: Math.max(0.05, (s.max.z - s.min.z) / 2), hubR: (h.max.y - h.min.y) / 2,
  };
}

// billet faces and solid discs for one wheel, built once and toggled
function wheelFaces(info, spin) {
  const billet = new THREE.Group(), disc = new THREE.Group();
  const faceGeo = billetFace(info.rimR * 0.93, Math.max(0.07, info.hubR * 0.8), 5, 0.02);
  const discGeo = new THREE.CylinderGeometry(info.rimR * 0.96, info.rimR * 0.96, 0.012, 96).rotateX(Math.PI / 2);
  const capGeo = new THREE.SphereGeometry(info.hubR * 1.1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  [1, -1].forEach((side) => {
    const z = info.zc + side * info.spokeHalf;
    const f = new THREE.Mesh(faceGeo, chrome); f.position.z = z; if (side < 0) f.rotation.y = Math.PI; billet.add(f);
    const d = new THREE.Mesh(discGeo, chrome); d.position.z = z; disc.add(d);
    const c = new THREE.Mesh(capGeo, chrome); c.scale.z = 0.45; c.position.z = z + side * 0.004; if (side < 0) c.rotation.y = Math.PI; disc.add(c);
  });
  [billet, disc].forEach((g) => { shadowed(g); g.visible = false; spin.add(g); });
  return { billet, disc };
}

// an open shell over a tire, with rolled chrome edges; angles run from the bottom (0) through the front (½π) to the top (π)
function fenderShell(r, w, a0, a1, zc) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(r, r, w, 72, 1, true, a0, a1 - a0).rotateX(Math.PI / 2);
  const shell = new THREE.Mesh(geo, paintShell); shell.position.z = zc; g.add(shell);
  [1, -1].forEach((side) => {
    const pts = [];
    for (let i = 0; i <= 32; i++) { const a = a0 + ((a1 - a0) * i) / 32; pts.push(V(r * Math.sin(a), -r * Math.cos(a), zc + (side * w) / 2)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.011, 8), chrome));
  });
  return shadowed(g);
}

// handlebar shapes, drawn for the +z side from the riser clamp and mirrored
const CLAMP = V(0.76, 1.56, 0);
function barShape(style) {
  const { x, y } = CLAMP, P = (dx, dy, z) => V(x + dx, y + dy, z);
  const both = (half) => [half, half.map((p) => V(p.x, p.y, -p.z))];
  const across = (half) => [[...half.slice(1).reverse().map((p) => V(p.x, p.y, -p.z)), ...half]];
  switch (style) {
    case 'apes': return { risers: 0.02, cross: 0.24, paths: both([P(0.02, 0, 0.085), P(0.03, 0.34, 0.09), P(0.01, 0.5, 0.12), P(-0.05, 0.54, 0.2), P(-0.16, 0.53, 0.4), P(-0.28, 0.5, 0.6)]) };
    case 'mini': return { risers: 0.02, cross: 0.15, paths: both([P(0.02, 0, 0.085), P(0.03, 0.2, 0.09), P(0.01, 0.31, 0.12), P(-0.05, 0.34, 0.2), P(-0.16, 0.33, 0.4), P(-0.28, 0.3, 0.6)]) };
    case 'z': return { risers: 0.02, paths: across([P(0, 0.02, 0), P(0, 0.02, 0.15), P(-0.01, 0.05, 0.21), P(-0.02, 0.3, 0.3), P(-0.03, 0.34, 0.35), P(-0.08, 0.35, 0.42), P(-0.28, 0.35, 0.6)]) };
    case 'drag': return { risers: 0.1, paths: across([P(0, 0.1, 0), P(0, 0.1, 0.3), P(-0.04, 0.1, 0.48), P(-0.12, 0.1, 0.62)]) };
    case 'beach': return { risers: 0.04, paths: across([P(0.02, 0.06, 0), P(0, 0.07, 0.2), P(-0.08, 0.1, 0.4), P(-0.22, 0.14, 0.54), P(-0.38, 0.16, 0.6)]) };
    default: return null;
  }
}
function buildBars() {
  kit.bars.clear();
  const shape = barShape(spec.bars), B = model.byName;
  ['Object_27', 'Object_6', 'Object_42'].forEach((n) => { if (B[n]) B[n].visible = !shape; });
  if (B.Object_27) B.Object_27.material = barMat();
  if (!shape) return;
  const mat = barMat(), r = 0.021;
  shape.paths.forEach((pts) => {
    kit.bars.add(tubeMesh(pts, r, mat, 120, 0.35));
    [pts[0], pts.at(-1)].forEach((end, i) => {
      if (Math.abs(end.z) < 0.4) return;
      const dir = end.clone().sub(i ? pts.at(-2) : pts[1]).normalize();
      kit.bars.add(cyl(end.clone().addScaledVector(dir, -0.17), end.clone().addScaledVector(dir, 0.012), 0.03, rubber));
      kit.bars.add(cyl(end.clone().addScaledVector(dir, 0.012), end.clone().addScaledVector(dir, 0.024), 0.024, chrome));
      // lever on a perch, reaching forward of the grip
      const perch = end.clone().addScaledVector(dir, -0.19);
      kit.bars.add(cyl(perch.clone().add(V(-0.02, 0, 0)), perch.clone().add(V(0.05, 0, 0)), 0.016, chrome));
      kit.bars.add(cyl(perch.clone().add(V(0.05, -0.005, 0)), end.clone().addScaledVector(dir, -0.03).add(V(0.085, -0.02, 0)), 0.008, chrome));
    });
  });
  // risers up from the top clamp, and the bar clamp itself
  [1, -1].forEach((sd) => {
    kit.bars.add(cyl(V(CLAMP.x, 1.38, 0.085 * sd), V(CLAMP.x, CLAMP.y + shape.risers, 0.085 * sd), 0.026, chrome));
  });
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.05, 0.26, 2, 0.014), chrome);
  clamp.position.set(CLAMP.x, CLAMP.y + shape.risers, 0); kit.bars.add(clamp);
  if (shape.cross) kit.bars.add(cyl(V(CLAMP.x + 0.025, CLAMP.y + shape.cross, -0.09), V(CLAMP.x + 0.025, CLAMP.y + shape.cross, 0.09), 0.016, mat));
  shadowed(kit.bars);
}

const REAR_W = { 200: 0.7, 240: 0.83, 300: 1 }, FRONT_S = { 21: 1, 23: 1.08, 26: 1.19 };
function applyWheels() {
  const [rearG, frontG] = [model.groups[2], model.groups[3]], { rear, front } = model.wheels, B = model.byName;
  rearG.children[0].scale.z = REAR_W[spec.rear];
  const s = FRONT_S[spec.front];
  frontG.children[0].scale.set(s, s, s * (spec.frontTire === 'fat' ? 1.45 : 1));
  // longer fork: stretch the fork legs along the steering axis from the top tree, and push the wheel out with them
  const { top, axis } = model.fork, L = +spec.fork * 0.026, len = top.length(), f = (len + L) / len;
  const S = new THREE.Matrix4().set(
    1 + (f - 1) * axis.x * axis.x, (f - 1) * axis.x * axis.y, 0, 0,
    (f - 1) * axis.x * axis.y, 1 + (f - 1) * axis.y * axis.y, 0, 0,
    0, 0, 1, 0, 0, 0, 0, 1);
  const legs = frontG.children[1];
  legs.matrixAutoUpdate = false;
  legs.matrix.makeTranslation(top.x, top.y, 0).multiply(S).multiply(new THREE.Matrix4().makeTranslation(-top.x, -top.y, 0));
  legs.matrixWorldNeedsUpdate = true;
  frontG.children[0].position.copy(axis).multiplyScalar(L);
  poolFront.position.x = model.frontAxle.x + axis.x * L;
  ['Object_41', 'Object_47'].forEach((n) => { B[n].visible = spec.wheel === 'spoke'; });
  for (const f of Object.values(kit.faces)) { f.billet.visible = spec.wheel === 'billet'; f.disc.visible = spec.wheel === 'disc'; }
  const rm = rimMat();
  ['Object_10', 'Object_41', 'Object_39', 'Object_38', 'Object_47', 'Object_50'].forEach((n) => { B[n].material = rm; });
  for (const f of Object.values(kit.faces)) [f.billet, f.disc].forEach((g) => g.traverse((m) => { if (m.isMesh) m.material = rm; }));
  // a taller front wheel lifts the nose: pitch the whole bike about the rear tire's contact patch
  const lift = front.r * (s - 1) - axis.y * L, base = model.frontAxle.x - model.rearAxle.x + axis.x * L, th = Math.atan2(lift, base);
  const px = model.rearAxle.x, py = model.rearAxle.y - rear.r;
  bike.rotation.z = th;
  bike.position.set(px - (px * Math.cos(th) - py * Math.sin(th)), py - (px * Math.sin(th) + py * Math.cos(th)), 0);
  model.groups[2].userData.spec = ['Rear wheel', `${spec.rear} mm tire, ${labelOf('wheel', spec.wheel).toLowerCase()}`];
  model.groups[3].userData.spec = ['Front end', `Springer fork ${spec.fork === '0' ? 'at stock length' : `${labelOf('fork', spec.fork)} over`}, ${spec.front} in ${spec.frontTire} front tire`];
}

function applyFenders() {
  const { rear, front } = model.wheels, B = model.byName;
  ['Object_16', 'Object_40', 'Object_45'].forEach((n) => { B[n].visible = spec.rearFender === 'wrap'; });
  kit.rearFender.clear();
  if (spec.rearFender === 'bob') {
    const w = rear.half * 2 * REAR_W[spec.rear] + 0.07;
    kit.rearFender.add(fenderShell(rear.r + 0.045, w, Math.PI * 0.84, Math.PI * 1.33, rear.zc));
  }
  kit.rearFender.position.copy(model.rearAxle);
  kit.frontFender.clear();
  if (spec.frontFender !== 'none') {
    const w = front.half * 2 + 0.06;
    const [a0, a1] = spec.frontFender === 'blade' ? [0.62, 1.1] : [0.46, 1.24];
    // lives inside the wheel's scaled group, so it grows with the wheel; the gap is kept constant
    kit.frontFender.add(fenderShell(front.r + 0.04 / FRONT_S[spec.front], w, Math.PI * a0, Math.PI * a1, front.zc));
  }
  seatSpec();
}
const seatSpec = () => {
  model.groups[5].userData.spec = ['Seat and fender', `${labelOf('seatStyle', spec.seatStyle)} in ${labelOf('seat', spec.seat).toLowerCase()} leather, ${labelOf('rearFender', spec.rearFender).toLowerCase()} rear fender`];
};

// coil spring for the sprung seat
class Helix extends THREE.Curve {
  constructor(r, h, turns) { super(); Object.assign(this, { r, h, turns }); }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return out.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}
// a stitched leather pad: the same cushion shape as the hand-built seat, scaled to suit
function seatPad(c, sx, sy, sz, tilt) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(seat.geometry, leather), st = new THREE.Mesh(seatStitch.geometry, stitch);
  pad.scale.set(sx, sy, sz); st.scale.set(sx, sy * 1.02, sz);
  g.add(pad, st);
  g.position.copy(c); g.rotation.z = tilt;
  return g;
}
function applySeat() {
  const sb = model.seatBox, { rear } = model.wheels, ax = model.rearAxle;
  const mid = sb.getCenter(new THREE.Vector3());
  // height of the rear fender's crown at a given x, so a pillion sits on it rather than in it
  const R = rear.r + 0.07, crown = (x) => ax.y + Math.sqrt(Math.max(0, R * R - (x - ax.x) ** 2));
  model.byName.Object_13.visible = ['solo', 'twoup', 'kq'].includes(spec.seatStyle);
  kit.seat.clear();
  if (spec.seatStyle === 'sprung') {
    const top = V(mid.x - 0.02, sb.max.y + 0.03, mid.z);
    kit.seat.add(seatPad(top, 0.27, 0.055, 0.17, 0.06));
    const coil = new THREE.TubeGeometry(new Helix(0.032, top.y - 0.03 - (sb.min.y - 0.01), 7), 140, 0.0055, 6);
    [0.08, -0.08].forEach((z) => {
      const sp = new THREE.Mesh(coil, chrome); sp.position.set(top.x - 0.17, sb.min.y - 0.01, mid.z + z); kit.seat.add(sp);
    });
    kit.seat.add(cyl(V(top.x + 0.2, sb.min.y + 0.02, mid.z), V(top.x + 0.22, top.y - 0.03, mid.z), 0.014, chrome)); // nose pivot
  } else if (spec.seatStyle === 'bobber') {
    kit.seat.add(seatPad(V(mid.x + 0.03, sb.min.y + 0.06, mid.z), 0.21, 0.035, 0.13, 0.04));
  } else if (spec.seatStyle === 'twoup' || spec.seatStyle === 'kq') {
    const kq = spec.seatStyle === 'kq', x = sb.min.x - (kq ? 0.2 : 0.18);
    const slope = Math.atan2(-(x - ax.x), Math.sqrt(Math.max(0.001, R * R - (x - ax.x) ** 2)));
    kit.seat.add(seatPad(V(x, crown(x) + (kq ? 0.1 : 0.045), mid.z), kq ? 0.19 : 0.17, kq ? 0.07 : 0.05, kq ? 0.15 : 0.14, -slope * (kq ? 0.55 : 1)));
    if (kq) {
      // sissy bar: bolted at the axle plates, narrowing to a rounded hoop above the pillion
      const bx = ax.x + 0.04, up = (z, y, dx = 0) => V(bx + dx, y, z);
      const half = [up(0.34, ax.y + 0.1), up(0.31, 1.0, -0.02), up(0.2, 1.4, -0.05), up(0.13, 1.66, -0.07), up(0.05, 1.74, -0.08), up(0, 1.75, -0.08)];
      const hoop = [...half, ...half.slice(0, -1).reverse().map((p) => V(p.x, p.y, -p.z))];
      kit.seat.add(tubeMesh(hoop, 0.016, chrome, 160, 0.4));
      kit.seat.add(seatPad(V(bx - 0.035, 1.36, 0), 0.035, 0.12, 0.11, 0.08)); // backrest
    }
  }
  shadowed(kit.seat);
  seatSpec();
}

// pipe length: the headers and slash-cut tips keep their shape; only the straight run between them stretches or shrinks
const PIPE_RUN = { shorty: -0.75, short: -0.38, stock: 0, long: 0.36 };
function applyPipes() {
  const m = model.byName.Object_7, g = model.groups[6], pos = m.geometry.attributes.position;
  if (!m.userData.orig) {
    // vertex positions in the exhaust station's frame, measured once with the station at rest
    g.updateWorldMatrix(true, true);
    const toG = g.matrixWorld.clone().invert().multiply(m.matrixWorld);
    m.userData.toG = toG; m.userData.fromG = toG.clone().invert();
    m.userData.orig = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toG));
    const xs = m.userData.orig.map((v) => v.x);
    const hi = Math.max(...xs), lo = Math.min(...xs);
    m.userData.run = [hi - 0.5, lo + 0.15]; // headers end / tips begin
  }
  const [xs, xt] = m.userData.run, d = PIPE_RUN[spec.pipeLen], k = (xs - xt + d) / (xs - xt), v = new THREE.Vector3();
  m.userData.orig.forEach((o, i) => {
    v.copy(o);
    if (o.x < xt) v.x = o.x - d;                // tips slide back or forward
    else if (o.x < xs) v.x = xs - (xs - o.x) * k; // the straight run scales
    v.applyMatrix4(m.userData.fromG);
    pos.setXYZ(i, v.x, v.y, v.z);
  });
  pos.needsUpdate = true;
  m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere();
  g.userData.spec = ['Exhaust', `${labelOf('pipeLen', spec.pipeLen)}, ${labelOf('pipes', spec.pipes).toLowerCase()}`];
}

function applyFinishes() {
  swapFinish(model.groups[1], { chrome, black: gloss, raw: satin }[spec.engine]);
  swapFinish(model.groups[6], { chrome, black: ceramic, heat: heatBlue }[spec.pipes]);
}

const APPLY = {
  color: applyPaint, graphics: applyPaint, stripe: applyPaint,
  seat: () => { leather.color.setHex(LEATHER[spec.seat]); if (model.ready) seatSpec(); },
  seatStyle: () => model.ready && applySeat(),
  bars: () => model.ready && buildBars(), barsFin: () => model.ready && buildBars(),
  wheel: () => model.ready && applyWheels(), rims: () => model.ready && applyWheels(),
  fork: () => model.ready && applyWheels(), frontTire: () => model.ready && applyWheels(), style: () => {},
  rear: () => model.ready && (applyWheels(), applyFenders()), front: () => model.ready && (applyWheels(), applyFenders()),
  rearFender: () => model.ready && applyFenders(), frontFender: () => model.ready && applyFenders(),
  engine: () => model.ready && applyFinishes(), pipes: () => model.ready && (applyFinishes(), applyPipes()),
  pipeLen: () => model.ready && applyPipes(),
};
function applyAll() { new Set(Object.values(APPLY)).forEach((fn) => fn()); }

function onModelReady() {
  const B = model.byName, G = model.groups;
  ['Object_44', 'Object_59', 'Object_61'].forEach((n) => { if (B[n]) B[n].visible = false; }); // on the lift, no kickstand
  G.forEach((g) => g.traverse((m) => { if (m.isMesh) m.userData.base = m.material; }));
  model.wheels = {
    rear: measureWheel(G[2], B.Object_9, B.Object_10, B.Object_41, B.Object_39),
    front: measureWheel(G[3], B.Object_51, B.Object_38, B.Object_47, B.Object_50),
  };
  {
    let top = null;
    const v = new THREE.Vector3();
    ['Object_15', 'Object_18', 'Object_19'].forEach((n) => {
      const m = B[n], pos = m.geometry.attributes.position;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(G[3].position);
        if (!top || v.y > top.y) top = v.clone();
      }
    });
    top.z = 0;
    model.fork = { top, axis: top.clone().negate().normalize() };
  }
  kit.faces.rear = wheelFaces(model.wheels.rear, G[2].children[0]);
  kit.faces.front = wheelFaces(model.wheels.front, G[3].children[0]);
  model.seatBox = new THREE.Box3().setFromObject(B.Object_13);
  G[5].add(kit.seat);
  G[7].add(kit.bars);
  G[5].add(kit.rearFender);
  G[3].children[0].add(kit.frontFender); // scales with the wheel; its spin is back to zero once the wheel has landed
  applyAll();
}

/* --- the sheet itself --- */
const sheet = document.querySelector('.spec-sheet');
const tabsEl = sheet.querySelector('.spec-tabs'), panelsEl = sheet.querySelector('.spec-panels');
specCam.focus = SPEC[0].focus;

SPEC.forEach((tab, i) => {
  const b = document.createElement('button');
  Object.assign(b, { type: 'button', id: `spec-t-${tab.id}`, textContent: tab.label, tabIndex: i ? -1 : 0 });
  b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(!i)); b.setAttribute('aria-controls', `spec-p-${tab.id}`);
  b.dataset.tab = tab.id;
  tabsEl.append(b);
  const panel = document.createElement('div');
  Object.assign(panel, { className: 'spec-panel', id: `spec-p-${tab.id}`, hidden: !!i });
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id);
  tab.fields.forEach((f) => {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.append(Object.assign(document.createElement('span'), { textContent: f.label }), document.createElement('output'));
    const wrap = document.createElement('div');
    wrap.className = f.swatch ? 'swatches' : 'chips';
    f.choices.forEach(([v, label, hint]) => {
      const l = document.createElement('label');
      const inp = Object.assign(document.createElement('input'), { type: 'radio', name: `spec-${f.key}`, value: v });
      const sp = document.createElement('span');
      if (f.swatch) { inp.setAttribute('aria-label', label); l.title = label; sp.style.setProperty('--c', PAINTS[+v][1]); } else {
        sp.textContent = label;
        if (hint) sp.append(Object.assign(document.createElement('small'), { textContent: hint }));
      }
      l.append(inp, sp); wrap.append(l);
    });
    fs.append(lg, wrap); panel.append(fs);
  });
  panelsEl.append(panel);
});

function selectTab(id, focusBtn) {
  tabsEl.querySelectorAll('[role="tab"]').forEach((b) => {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focusBtn) b.focus();
  });
  panelsEl.querySelectorAll('.spec-panel').forEach((p) => { p.hidden = p.id !== `spec-p-${id}`; });
  specCam.focus = SPEC.find((t) => t.id === id).focus;
}
tabsEl.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.dataset.tab); });
tabsEl.addEventListener('keydown', (e) => {
  const ids = SPEC.map((t) => t.id), cur = ids.indexOf(document.activeElement?.dataset.tab);
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (cur < 0 || !step) return;
  e.preventDefault();
  selectTab(ids[(cur + step + ids.length) % ids.length], true);
});

function summary() {
  return FIELDS.map((f) => `${f.name}: ${labelOf(f.key, spec[f.key])}${f.key === 'style' && !styleMatches() ? ' (modified)' : ''}`).join('; ');
}
function syncSheet() {
  FIELDS.forEach((f) => {
    const inp = panelsEl.querySelector(`input[name="spec-${f.key}"][value="${spec[f.key]}"]`);
    if (inp) {
      inp.checked = true;
      const mod = f.key === 'style' && !styleMatches() ? ', modified' : '';
      inp.closest('fieldset').querySelector('output').textContent = labelOf(f.key, spec[f.key]) + mod;
    }
  });
  const custom = KEYS.some((k) => spec[k] !== SHOP_BUILD[k]);
  const url = new URL(location.href);
  if (custom) url.searchParams.set('build', KEYS.map((k) => spec[k]).join('.')); else url.searchParams.delete('build');
  history.replaceState(null, '', url);
}
panelsEl.addEventListener('change', (e) => {
  const key = e.target.name?.replace(/^spec-/, '');
  if (!(key in spec)) return;
  spec[key] = e.target.value;
  touched = true;
  if (key === 'style') {
    Object.assign(spec, STYLES[spec.style]);
    applyAll();
    specCam.focus = SPEC[0].focus;
    syncSheet();
    return;
  }
  const f = FIELDS.find((x) => x.key === key);
  specCam.focus = f.focus || f.tab.focus;
  APPLY[key]?.();
  syncSheet();
});
sheet.querySelector('.spec-reset').addEventListener('click', () => {
  Object.assign(spec, SHOP_BUILD);
  touched = false;
  applyAll();
  syncSheet();
});
applyPaint();
APPLY.seat();
syncSheet();

/* ---------------- phones: the spec sheet fades out as it leaves ---------------- */
// On a phone the sheet sits under the bike. When the section ends it scrolls up over the bike,
// so it fades away as it rises instead of covering it.
{
  const sheetEl = document.querySelector('.spec-sheet');
  const phone = matchMedia('(max-width: 760px)');
  const fadeSheet = () => {
    if (!sheetEl) return;
    if (!phone.matches) { sheetEl.style.opacity = ''; sheetEl.style.visibility = ''; return; }
    const rise = innerHeight * 0.46 - sheetEl.getBoundingClientRect().top - 12; // how far it has moved up from its pinned spot
    const k = Math.min(1, Math.max(0, 1 - rise / (innerHeight * 0.16)));
    sheetEl.style.opacity = k < 1 ? k.toFixed(3) : '';
    sheetEl.style.visibility = k === 0 ? 'hidden' : '';
  };
  addEventListener('scroll', fadeSheet, { passive: true });
  addEventListener('resize', fadeSheet);
  phone.addEventListener?.('change', fadeSheet);
  fadeSheet();
}
