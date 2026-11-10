// Engine cold start: a real Harley recording, with a synthesized V-twin start as the fallback.
// The synthesized version, kept for when the clip can't load:
// Starter solenoid clunk, a second of cranking against compression, the catch, three throttle blips
// with pops on the overrun, then a lumpy idle that fades out.
// Browsers only allow sound after a click, tap or key press, so it fires on the first one (or at once if allowed).

const DUR = 8.4;
const STORE = 'ssc-sound', SESSION = 'ssc-started';
const store = {
  get: (s, k) => { try { return s.getItem(k); } catch { return null; } },
  set: (s, k, v) => { try { s.setItem(k, v); } catch {} },
};

// rpm keyframes [time s, rpm]: crank, catch, four blasts with the revs hung at the top, then idle
const RPM = [
  [0, 0], [0.18, 190], [0.6, 250], [1.08, 270],
  [1.14, 1100], [1.36, 4400], [1.52, 4500], [1.85, 2200], [2.1, 1500],
  [2.3, 1400], [2.48, 5400], [2.9, 5600], [3.3, 1700],
  [3.55, 1500], [3.66, 4200], [3.8, 4300], [4.05, 1800],
  [4.2, 1700], [4.32, 5000], [4.5, 5100], [4.85, 1500],
  [5.4, 1150], [6.2, 1000], [DUR, 960],
];
const CATCH = 1.1;
function rpmAt(t) {
  let i = 1;
  while (i < RPM.length - 1 && RPM[i][0] < t) i++;
  const [t0, r0] = RPM[i - 1], [t1, r1] = RPM[i];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return r0 + (r1 - r0) * (u * u * (3 - 2 * u));
}

// two-pole resonator ringing at f, decaying over tau seconds; f can move.
// in(x): input scaled so a unit impulse rings out at about 1.  noi(x): unit noise comes out at about 1.
function resonator(sr, f, tau) {
  const r = Math.exp(-1 / (sr * tau)), r2 = r * r, nk = Math.sqrt(2 * (1 - r2));
  let c, g, y1 = 0, y2 = 0;
  const set = (nf) => { const w = (2 * Math.PI * nf) / sr; c = 2 * r * Math.cos(w); g = Math.sin(w); };
  set(f);
  const tick = (x) => { const y = c * y1 - r2 * y2 + x; y2 = y1; y1 = y; return y; };
  return { set, in: (x) => tick(x * g), noi: (x) => tick(x * g * nk) };
}
// one-pole low-pass
function lowpass(sr, f) {
  const a = 1 - Math.exp((-2 * Math.PI * f) / sr);
  let y = 0;
  return (x) => (y += (x - y) * a);
}

function synth(sr) {
  const n = Math.floor(DUR * sr), out = new Float32Array(n), dt = 1 / sr;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = () => rnd() * 2 - 1;

  // exhaust: a deep pipe note that climbs a little with revs, its octave, a sub thump and the rasp off the tips
  const pipe = resonator(sr, 46, 0.05), pipe2 = resonator(sr, 92, 0.03), pipe3 = resonator(sr, 141, 0.018);
  const sub = resonator(sr, 34, 0.07);
  const rasp = resonator(sr, 240, 0.01), rasp2 = resonator(sr, 520, 0.006);
  const popR = resonator(sr, 800, 0.006), popR2 = resonator(sr, 1700, 0.003);
  const clunk = resonator(sr, 150, 0.05);
  const valve = resonator(sr, 2600, 0.004), chain = resonator(sr, 900, 0.02);
  const pulseLP = lowpass(sr, 900), mechLP = lowpass(sr, 3000), outLP = lowpass(sr, 2400), outLP2 = lowpass(sr, 5200);
  // garage: concrete floor, brick wall, the far door
  const TAPS = [[0.011, 0.28], [0.029, 0.2], [0.047, 0.14], [0.083, 0.08]].map(([s, g]) => [Math.floor(s * sr), g]);
  const room = new Float32Array(Math.floor(0.1 * sr)); let ri = 0;
  const roomLP = lowpass(sr, 1800);

  const K = 1 / (0.0036 * sr); // makes each firing pulse's area about its strength
  let theta = 0, ph = 0, comp = 0, clunkN = 0, popE = 0, dcx = 0, dcy = 0;
  // each firing is a pressure pulse: fast rise, slower fall (two envelopes subtracted)
  let pA = 0, pB = 0, burst = 0;
  const dA = Math.exp(-dt / 0.0045), dB = Math.exp(-dt / 0.0009), dBurst = Math.exp(-dt / 0.011);
  const dComp = Math.exp(-dt / 0.08), dClunk = Math.exp(-dt / 0.015), dPop = Math.exp(-dt / 0.003);
  // 45° V-twin, uneven firing; a cold motor wanders a few degrees each stroke
  const FIRE = [0, 405];
  let jitter = [0, 0];

  for (let i = 0; i < n; i++) {
    const t = i * dt, rpm = rpmAt(t), rising = rpmAt(t + 0.02) - rpm;
    const throttle = Math.min(1, Math.max(0.15, 0.3 + rising / 60 + (rpm > 3800 ? 0.35 : 0)));
    const prev = theta;
    theta = (theta + (rpm / 60) * 360 * dt) % 720;

    for (let k = 0; k < 2; k++) {
      const a = (FIRE[k] + jitter[k] + 720) % 720;
      const crossed = prev <= theta ? prev < a && theta >= a : prev < a || theta >= a;
      if (!crossed) continue;
      jitter[k] = (rnd() - 0.5) * (rpm < 1600 ? 14 : 5);
      if (t < CATCH) {
        comp = 1; pA += 0.22; pB += 0.22; // cranking: compression only
      } else {
        const weak = rpm < 1600 && rnd() < 0.2 ? 0.4 : 1;
        const a0 = (0.45 + 1.05 * throttle) * (0.75 + 0.5 * rnd()) * weak * (t < CATCH + 0.12 ? 1.5 : 1);
        pA += a0; pB += a0; burst += a0;
      }
    }
    // overrun: unburnt fuel lighting off in the pipes
    if (t > CATCH + 0.3 && rising < -20 && rnd() < 0.0016) popE = 0.8 + rnd() * 1.4;
    if (i === Math.floor(0.02 * sr)) clunkN = 1;

    const pulse = pulseLP(pA - pB);
    const pf = 44 + rpm * 0.0045; // the pipe note rises as the gas heats and speeds up
    pipe.set(pf); pipe2.set(pf * 2.03); pipe3.set(pf * 3.07);
    const air = burst * noise();

    let s = pipe.in(pulse * K) * 0.55
      + pipe2.in(pulse * K) * 0.28
      + pipe3.in(pulse * K) * 0.12
      + sub.in(pulse * K) * 0.45
      + rasp.noi(air) * 0.5 + rasp2.noi(air) * 0.25
      + air * 0.12
      + popR.noi(popE * noise()) * 0.9 + popR2.noi(popE * noise()) * 0.5;

    // mechanical: valve train clatter and the primary chain, rising with revs
    const mech = Math.min(1, rpm / 4000);
    s += mechLP(valve.noi(noise() * (0.3 + 0.7 * Math.abs(Math.sin(theta * Math.PI / 90)))) * 0.03 * (0.4 + mech)
      + chain.noi(noise()) * 0.025 * mech);

    // starter: solenoid clunk, then the motor whine dragging on each compression
    s += clunk.in(i === Math.floor(0.02 * sr) ? 0.8 : 0) + clunkN * noise() * 0.25;
    if (t > 0.05 && t < CATCH + 0.06) {
      const env = Math.min(1, (t - 0.05) / 0.05) * (t > CATCH ? 1 - (t - CATCH) / 0.06 : 1);
      ph += 2 * Math.PI * (1150 * (1 - 0.25 * comp) + 25 * Math.sin(t * 47)) * dt;
      s += env * (Math.sin(ph) * 0.08 + Math.sin(2 * ph + 0.3) * 0.05 + Math.sin(3 * ph) * 0.02 + noise() * 0.07 * (0.5 + comp));
    }
    pA *= dA; pB *= dB; burst *= dBurst; comp *= dComp; clunkN *= dClunk; popE *= dPop;

    // harder drive the more throttle it has, then roll off the top
    const drive = 1.5 + throttle * 1.6;
    s = Math.tanh(s * drive) / Math.tanh(drive) * 1.1;
    s = outLP(outLP2(s)) * 0.85 + s * 0.15;
    const dc = s - dcx + 0.996 * dcy; dcx = s; dcy = dc;
    let wet = dc;
    for (const [d, g] of TAPS) wet += room[(ri - d + room.length) % room.length] * g;
    room[ri] = roomLP(dc); // the room swallows the top end ri = (ri + 1) % room.length;
    out[i] = wet;
  }

  // loud: normalise, then a soft limiter to push the average level up
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fadeFrom = (DUR - 1.6) * sr, k = Math.tanh(1.9);
  for (let i = 0; i < n; i++) {
    let v = Math.tanh((out[i] / peak) * 1.9) / k;
    if (i > fadeFrom) v *= 1 - (i - fadeFrom) / (n - fadeFrom);
    out[i] = v * 0.97;
  }
  return out;
}

// ---------------- playback ----------------
let ctx, buffer, src, gain, analyser, shaking = false;
const btn = document.querySelector('.sound-toggle');
const canvas = document.getElementById('bike');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let muted = store.get(localStorage, STORE) === 'off';

// the real thing: an old Harley cold start (Vrymaa on Freesound, CC0). Fetched early, decoded on first play.
const CLIP = 'audio/harley-cold-start.mp3', CLIP_FROM = 0.15;
const clipBytes = fetch(CLIP).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).catch(() => null);
let fromClip = false;

function ensureCtx() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  // louder and heavier: lift the low end, squash the peaks, then make up the gain
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 110; low.gain.value = 5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26; comp.knee.value = 6; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.12;
  const makeup = ctx.createGain(); makeup.gain.value = 1.8; // about 10 dB louder than the raw recording, peaks rounded by the clipper
  gain = ctx.createGain();
  analyser = ctx.createAnalyser(); analyser.fftSize = 512;
  // soft clipper: rounds off the peaks the makeup gain pushes past full scale, and adds some grit
  const clip = ctx.createWaveShaper(), curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2) * 0.98; }
  clip.curve = curve; clip.oversample = '4x';
  gain.connect(low); low.connect(comp); comp.connect(makeup); makeup.connect(clip); clip.connect(analyser); analyser.connect(ctx.destination);
  return true;
}
async function ensureBuffer() {
  if (buffer) return;
  const bytes = await clipBytes;
  if (bytes) {
    try { buffer = await ctx.decodeAudioData(bytes.slice(0)); fromClip = true; return; } catch {}
  }
  // no clip: fall back to the synthesized start
  const data = synth(ctx.sampleRate);
  buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.copyToChannel(data, 0);
}

async function start() {
  if (muted || !ensureCtx()) return;
  stop(true);
  const resumed = ctx.resume(); // inside the click, before any await
  await ensureBuffer();
  await resumed;
  if (muted) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(1, ctx.currentTime);
  src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  src.onended = () => { src = null; setPlaying(false); };
  src.start(0, fromClip ? CLIP_FROM : 0);
  store.set(sessionStorage, SESSION, '1');
  setPlaying(true);
  if (!calm) shake();
}
function stop(now) {
  if (!src) return;
  const s = src; src = null;
  if (now) { try { s.stop(); } catch {} return; }
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  try { s.stop(ctx.currentTime + 0.4); } catch {}
  setPlaying(false);
}

// the bike shudders with the pulses
function shake() {
  if (shaking) return;
  shaking = true;
  const buf = new Float32Array(analyser.fftSize);
  const step = () => {
    if (!src) { canvas.style.translate = ''; shaking = false; return; }
    analyser.getFloatTimeDomainData(buf);
    let e = 0; for (const v of buf) e += v * v;
    const a = Math.min(1, Math.sqrt(e / buf.length) * 2.2) * 3.2;
    canvas.style.translate = `${((Math.random() - 0.5) * a).toFixed(2)}px ${((Math.random() - 0.5) * a).toFixed(2)}px`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setPlaying(on) { btn?.classList.toggle('running', on); }
function syncButton() {
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(!muted));
  btn.querySelector('.sound-label').textContent = muted ? 'Sound off' : 'Sound on';
}

btn?.addEventListener('click', (e) => {
  e.stopPropagation();
  muted = !muted;
  store.set(localStorage, STORE, muted ? 'off' : 'on');
  syncButton();
  if (muted) stop(); else start(); // turning sound on fires the engine up again
});
syncButton();

// first visit this session: fire it up as soon as the browser lets us
if (!muted && !store.get(sessionStorage, SESSION)) {
  const events = ['pointerdown', 'keydown', 'touchend'];
  const go = (e) => {
    if (btn && btn.contains(e.target)) return; // the button handles itself
    events.forEach((ev) => removeEventListener(ev, go, true));
    if (!store.get(sessionStorage, SESSION)) start();
  };
  events.forEach((ev) => addEventListener(ev, go, true));
  // some browsers already allow sound here (returning visitors): try straight away
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const probe = AC && new AC();
    if (probe && probe.state === 'running') { probe.close(); events.forEach((ev) => removeEventListener(ev, go, true)); start(); }
    else probe?.close();
  } catch {}
}
