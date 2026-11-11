// Tank artwork, painted onto a 2048 x 512 canvas that wraps both sides of the tank.
// x = 1024 is the nose; each side runs out from there (left half and right half), y spans the tank's height.
// Every graphic gets a dark keyline and a pinstripe edge so it reads clearly from across the room.

export const GRAPHICS = [
  ['hotrod', 'Classic flames', 'Solid hot-rod licks'],
  ['flames', 'Ghost flames', 'Airbrushed under the clear'],
  ['scallops', 'Scallops', 'Sixties spears off the nose'],
  ['tribal', 'Tribal', 'Sharp, hooked blades'],
  ['racing', 'Racing stripes', 'Twin stripes over the top'],
  ['pinstripe', 'Pinstripes', 'Hand-pulled double line'],
  ['solid', 'Solid', 'Paint only'],
];
export const GRAPHIC_COLORS = [
  ['silver', 'Silver leaf'], ['gold', 'Gold leaf'], ['white', 'Bone white'],
  ['black', 'Black'], ['fire', 'Hot-rod fire'], ['blue', 'Electric blue'],
];

const W = 2048, H = 512, NOSE = 1024;
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), f = (v) => Math.min(255, Math.round(v * k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
const luma = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; };

let scratch = null;
const layer = () => {
  if (!scratch) scratch = [0, 1, 2].map(() => Object.assign(document.createElement('canvas'), { width: W, height: H }));
  return scratch;
};

// a graphic's fill: a gradient along its length (or up its height) in the chosen color
function fillStyle(g, color, len = 900, along = true) {
  const grad = along
    ? g.createLinearGradient(0, 0, len, 0)   // drawn in "length" space, nose at 0
    : g.createLinearGradient(0, 120, 0, 400);
  const stops = {
    silver: ['#f4f6f8', '#c3c9cf', '#8d949b'],
    gold: ['#fff0b0', '#e2b149', '#9c6a1c'],
    white: ['#fffaf0', '#efe6d4', '#d8ccb4'],
    black: ['#2a2a2c', '#121213', '#050505'],
    fire: ['#fff07a', '#ff9a1f', '#d81f12'],
    blue: ['#b9e6ff', '#2f9cff', '#1048c8'],
  }[color] || ['#eee', '#bbb', '#888'];
  grad.addColorStop(0, stops[0]); grad.addColorStop(0.45, stops[1]); grad.addColorStop(1, stops[2]);
  return grad;
}
// the thin line laid around the edge: a contrasting color so the shape pops off the paint
const EDGE = { silver: '#1b1b1d', gold: '#3a1a08', white: '#7a0d12', black: '#c9ced4', fire: '#2a6dff', blue: '#f2f5f8' };

// draws `shape(g)` for both sides of the tank in length space: x = distance back from the nose
function bothSides(g, shape) {
  [-1, 1].forEach((dir) => { g.save(); g.translate(NOSE, 0); g.scale(dir, 1); shape(g, dir); g.restore(); });
}

// Fill a union of shapes, then outline the whole silhouette: dark keyline, colored pinstripe, then the fill.
function emblem(g, shapes, color, { keyline = 5, stripe = 2.5, alpha = 1, blur = 0 } = {}) {
  const [mask, tint, fill] = layer();
  const m = mask.getContext('2d');
  m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H);
  m.fillStyle = '#fff';
  bothSides(m, (c) => { shapes.forEach((s) => { c.beginPath(); s(c); c.fill(); }); });

  const tinted = (style, alphaK = 1) => {
    const t = tint.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1;
    t.clearRect(0, 0, W, H); t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = 'source-in';
    if (typeof style === 'function') style(t); else { t.fillStyle = style; t.fillRect(0, 0, W, H); }
    t.globalCompositeOperation = 'source-over';
    return [tint, alphaK];
  };
  const ring = (src, r, a) => {
    g.save(); g.globalAlpha = a;
    for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; g.drawImage(src, Math.cos(t) * r, Math.sin(t) * r); }
    g.restore();
  };

  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (blur) g.filter = `blur(${blur}px)`;
  if (keyline) { tinted('rgba(8,6,6,1)'); ring(tint, keyline, 0.55 * alpha); }
  if (stripe) { tinted(EDGE[color] || '#111'); ring(tint, stripe, 0.95 * alpha); }
  // the fill, with its gradient laid along each side from the nose
  const f = fill.getContext('2d');
  f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = 'source-over'; f.clearRect(0, 0, W, H);
  bothSides(f, (c) => {
    c.fillStyle = fillStyle(c, color, 920); c.fillRect(0, 0, W / 2, H);
    // a soft highlight along the top of the leaf, like the clear coat catching it
    const hl = c.createLinearGradient(0, 120, 0, 400);
    hl.addColorStop(0, 'rgba(255,255,255,.28)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(0,0,0,.18)');
    c.fillStyle = hl; c.fillRect(0, 0, W / 2, H);
  });
  f.globalCompositeOperation = 'destination-in'; f.drawImage(mask, 0, 0);
  f.globalCompositeOperation = 'source-over';
  g.globalAlpha = alpha; g.drawImage(fill, 0, 0);
  g.restore();
}

/* ---------- the shapes, in length space (x back from the nose, y down the tank) ---------- */
// a flame lick: wide at the nose, waving back to a tip that kicks up
const lick = (y, len, w, rise) => (c) => {
  c.moveTo(-4, y - w);
  c.bezierCurveTo(len * 0.22, y - w - 4, len * 0.4, y - w * 0.35, len * 0.6, y - w * 0.45 - rise * 0.25);
  c.quadraticCurveTo(len * 0.84, y - w * 0.55 - rise * 0.55, len, y - w * 0.6 - rise * 1.1);   // the tip, kicked up
  c.quadraticCurveTo(len * 0.8, y - rise * 0.2, len * 0.58, y + w * 0.05);
  c.bezierCurveTo(len * 0.38, y + w * 0.2, len * 0.16, y + w * 0.75, -4, y + w);
  c.closePath();
};
const FLAME_LICKS = [lick(164, 520, 22, 26), lick(204, 740, 26, 36), lick(246, 920, 30, 44), lick(290, 800, 28, 36), lick(332, 610, 24, 26), lick(368, 400, 18, 16)];
const flameNose = (c) => { c.ellipse(0, 266, 110, 118, 0, -Math.PI / 2, Math.PI / 2); c.closePath(); };

// scallops: long spears off the nose, each one narrower and shorter than the last
const spear = (y, len, w) => (c) => {
  c.moveTo(-4, y - w);
  c.quadraticCurveTo(len * 0.55, y - w * 0.55, len, y + 4);
  c.quadraticCurveTo(len * 0.55, y + w * 0.75, -4, y + w);
  c.closePath();
};
const SCALLOPS = [spear(192, 860, 40), spear(262, 950, 46), spear(332, 780, 38)];

// tribal: hooked blades that sweep back and flick up
const blade = (y, len, w, hook) => (c) => {
  c.moveTo(-4, y - w);
  c.lineTo(len * 0.5, y - w * 0.9);
  c.quadraticCurveTo(len * 0.85, y - w * 0.8, len, y - w - hook);
  c.quadraticCurveTo(len * 0.9, y - w * 0.1, len * 0.7, y + w * 0.1);
  c.lineTo(len * 0.62, y + w * 0.75);
  c.quadraticCurveTo(len * 0.5, y + w * 0.2, len * 0.4, y + w * 0.55);
  c.lineTo(-4, y + w);
  c.closePath();
};
const TRIBAL = [blade(200, 700, 34, 40), blade(270, 880, 40, 52), blade(338, 600, 30, 34)];

// racing stripes: two wide bands over the crown of the tank (the top edge of each side)
const band = (y0, y1) => (c) => { c.rect(-4, y0, 940, y1 - y0); };
const RACING = [band(4, 58), band(80, 112)];

// pinstripes: a double line that runs back and flicks into a teardrop
function pinstripe(g, color) {
  bothSides(g, (c) => {
    [[0, 14, 'rgba(8,6,6,.6)'], [18, 11, 'rgba(8,6,6,.6)'], [0, 8, null], [18, 5, null]].forEach(([o, lw, col]) => {
      c.strokeStyle = col || fillStyle(c, color, 900); c.lineWidth = lw; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 206 + o);
      c.bezierCurveTo(300, 190 + o, 640, 228 + o, 860, 214 + o);
      c.bezierCurveTo(940, 210 + o, 940, 270 - o, 860, 270 - o);
      c.bezierCurveTo(700, 270 - o, 400, 306 - o, 0, 304 - o);
      c.stroke();
      // the little dagger flick at the tail
      c.beginPath(); c.moveTo(900, 242); c.quadraticCurveTo(960, 236, 990, 220); c.stroke();
    });
  });
}

export function drawTank(g, hex = '#7d0a15', graphics = 'flames', color = 'silver') {
  const light = luma(hex) > 0.5;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, shade(hex, light ? 0.62 : 0.37)); base.addColorStop(.45, shade(hex, 1));
  base.addColorStop(.6, shade(hex, 0.92)); base.addColorStop(1, shade(hex, light ? 0.55 : 0.29));
  g.fillStyle = base; g.fillRect(0, 0, W, H);

  // a graphic the same tone as the paint would vanish: swap to the nearest one that shows
  let c = color;
  if (c === 'black' && luma(hex) < 0.12) c = 'silver';
  if (c === 'white' && light) c = 'black';

  switch (graphics) {
    case 'hotrod': emblem(g, [flameNose, ...FLAME_LICKS], c); break;
    case 'flames': emblem(g, [flameNose, ...FLAME_LICKS], c, { keyline: 0, stripe: 3, alpha: 0.45, blur: 1.5 }); break;
    case 'scallops': emblem(g, SCALLOPS, c); break;
    case 'tribal': emblem(g, TRIBAL, c, { keyline: 4, stripe: 2 }); break;
    case 'racing': emblem(g, RACING, c, { keyline: 4, stripe: 3 }); break;
    case 'pinstripe': pinstripe(g, c); break;
    default: break;
  }
  g.restore();
}
