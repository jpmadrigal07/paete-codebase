// Paete, Laguna — real-data 3D scenes (three.js r170)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Water } from "three/addons/objects/Water.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------- math / noise ----------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const sstep = (a, b, x) => sm((x - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let xf = x - xi, yf = y - yi; xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x, y, s = 0, o = 4) {
  let a = 0.5, t = 0, f = 1, n = 0;
  for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 17); n += a; f *= 2.03; a *= 0.5; }
  return t / n;
}
let seed = 11;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function ctex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Normal map from a height canvas (Sobel)
function normalFromHeight(hc, strength = 2, wrap = true) {
  const w = hc.width, h = hc.height, src = hc.getContext("2d").getImageData(0, 0, w, h).data;
  const out = canvas(w, h), g = out.getContext("2d"), img = g.createImageData(w, h);
  const H = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
    return src[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
function woodCanvas(w, h, dark, light, s = 1) {
  const c = canvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.5 + 0.5 * Math.sin((x * 0.11 + fbm(x * 0.012, y * 0.0035, s, 3) * 10) * 2.2);
    const k = clamp(v * 0.75 + vnoise(x * 0.9, y * 0.03, s + 5) * 0.25, 0, 1), i = (y * w + x) * 4;
    img.data[i] = lerp(dark[0], light[0], k); img.data[i + 1] = lerp(dark[1], light[1], k); img.data[i + 2] = lerp(dark[2], light[2], k); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// =====================================================================
// Sound: everything is synthesized with Web Audio (no audio files)
// =====================================================================
const SCENE = { churchNight: 0, krusNight: 0, krusU: 0 };
const AU = { ctx: null, master: null, on: false, noise: null, beds: [] };
function auEnsure() {
  if (AU.ctx) return true;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return false;
  const ctx = (AU.ctx = new C());
  const comp = ctx.createDynamicsCompressor();
  AU.master = ctx.createGain(); AU.master.gain.value = 0;
  AU.master.connect(comp); comp.connect(ctx.destination);
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  AU.noise = buf;
  buildBeds();
  return true;
}
const anow = () => AU.ctx.currentTime;
const sfxOn = () => AU.on && AU.ctx && AU.ctx.state === "running";
function noiseSrc(loop) { const s = AU.ctx.createBufferSource(); s.buffer = AU.noise; s.loop = loop; return s; }
function panned(dest, pan) { if (!AU.ctx.createStereoPanner) return dest; const p = AU.ctx.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p; }
function burst({ dur = 0.1, type = "bandpass", f = 2000, f2 = null, q = 1, gain = 0.3, attack = 0.003, when = anow(), dest = AU.master, pan = 0 } = {}) {
  const ctx = AU.ctx, s = noiseSrc(false), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, when);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, when + dur);
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(gain, when + attack); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  s.connect(flt); flt.connect(g); g.connect(panned(dest, pan));
  s.start(when, Math.random() * 2); s.stop(when + dur + 0.05);
}
function tone({ f = 200, f2 = null, dur = 0.2, type = "sine", gain = 0.3, attack = 0.002, when = anow(), dest = AU.master, pan = 0 } = {}) {
  const ctx = AU.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, when);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, when + dur);
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(gain, when + attack); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(panned(dest, pan)); o.start(when); o.stop(when + dur + 0.05);
}
const SFX = {
  knock(p = 1, gain = 0.4) { if (!sfxOn()) return; tone({ f: 210 * p, f2: 95 * p, dur: 0.16, type: "triangle", gain }); burst({ dur: 0.035, f: 1600 * p, q: 2, gain: gain * 0.6 }); },
  scrape(gain = 0.12) { if (!sfxOn()) return; burst({ dur: 0.06 + Math.random() * 0.05, f: 2400 + Math.random() * 1800, f2: 1400, q: 3, gain, pan: (Math.random() - 0.5) * 0.4 }); },
  rustle(n = 8, span = 0.6, gain = 0.1) { if (!sfxOn()) return; const t = anow(); for (let k = 0; k < n; k++) burst({ when: t + Math.random() * span, dur: 0.03 + Math.random() * 0.07, type: "highpass", f: 2200 + Math.random() * 3500, gain: gain * (0.5 + Math.random()), pan: (Math.random() - 0.5) * 0.8 }); },
  rip() { if (!sfxOn()) return; const t = anow(); burst({ when: t, dur: 0.5, f: 700, f2: 3800, q: 1.4, gain: 0.22 }); for (let k = 0; k < 10; k++) burst({ when: t + k * 0.045, dur: 0.03, type: "highpass", f: 3000, gain: 0.08 }); },
  pop() { if (!sfxOn()) return; tone({ f: 420, f2: 160, dur: 0.12, type: "sine", gain: 0.25 }); burst({ dur: 0.05, type: "lowpass", f: 900, gain: 0.2 }); },
  brush(when = 0) { if (!sfxOn()) return; burst({ when: anow() + when, dur: 0.55, type: "bandpass", f: 1100, f2: 2600, q: 0.7, gain: 0.13, attack: 0.18, pan: (Math.random() - 0.5) * 0.6 }); },
  click() { if (!sfxOn()) return; tone({ f: 1500, f2: 1100, dur: 0.04, type: "square", gain: 0.035 }); },
  step(gain = 0.22) { if (!sfxOn()) return; burst({ dur: 0.1, type: "lowpass", f: 420, gain }); burst({ dur: 0.06, f: 2600, q: 0.8, gain: gain * 0.25 }); },
  bell(when, f, dest) {
    const partials = [[0.5, 0.6, 7], [1, 1, 4.5], [1.19, 0.45, 3.5], [1.56, 0.35, 2.8], [2, 0.4, 2.4], [2.51, 0.2, 1.8], [3.01, 0.12, 1.4]];
    const out = AU.ctx.createGain(); out.gain.value = 0.16; out.connect(dest || AU.master);
    for (const [r, a, d] of partials) tone({ f: f * r, dur: d, gain: a, attack: 0.005, when, dest: out });
  },
};

// Ambient beds: each fades with how much of its scene is on screen
function stageVis(id) {
  const el = document.getElementById(id); if (!el) return 0;
  const r = el.getBoundingClientRect(), vh = innerHeight;
  const overlap = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  return clamp(overlap / Math.min(r.height, vh), 0, 1);
}
function makeBed(stageId, levelFn, schedule) {
  const g = AU.ctx.createGain(); g.gain.value = 0; g.connect(AU.master);
  const bed = { g, stageId, levelFn, schedule, timer: 0, level: 0 };
  AU.beds.push(bed);
  return bed;
}
function windLoop(dest, { f = 420, q = 0.6, gain = 0.5, lfo = 0.07 } = {}) {
  const ctx = AU.ctx, s = noiseSrc(true), flt = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
  flt.type = "bandpass"; flt.frequency.value = f; flt.Q.value = q; g.gain.value = gain;
  o.frequency.value = lfo; og.gain.value = f * 0.55; o.connect(og); og.connect(flt.frequency);
  s.connect(flt); flt.connect(g); g.connect(dest); s.start(); o.start();
}
function waterLoop(dest) {
  const ctx = AU.ctx, s = noiseSrc(true), flt = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
  flt.type = "lowpass"; flt.frequency.value = 380; g.gain.value = 0.55;
  o.frequency.value = 0.22; og.gain.value = 0.35; o.connect(og); og.connect(g.gain);
  s.connect(flt); flt.connect(g); g.connect(dest); s.start(); o.start();
}
function cicadaLoop(dest) {
  const ctx = AU.ctx, s = noiseSrc(true), flt = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
  flt.type = "bandpass"; flt.frequency.value = 5200; flt.Q.value = 7; g.gain.value = 0.14;
  o.frequency.value = 0.09; og.gain.value = 0.1; o.connect(og); og.connect(g.gain);
  s.connect(flt); flt.connect(g); g.connect(dest); s.start(); o.start();
}
const birds = (bed, dt) => {
  bed.timer -= dt; if (bed.timer > 0) return;
  bed.timer = 1.2 + Math.random() * 3.2;
  const t = anow() + 0.05, base = 2200 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 4), pan = (Math.random() - 0.5) * 1.4;
  for (let k = 0; k < n; k++) tone({ f: base * (1 + (Math.random() - 0.5) * 0.15), f2: base * (1.3 + Math.random() * 0.5), dur: 0.06 + Math.random() * 0.06, gain: 0.05, when: t + k * (0.09 + Math.random() * 0.05), dest: bed.g, pan });
};
const crickets = (bed, dt) => {
  bed.timer -= dt; if (bed.timer > 0) return;
  bed.timer = 0.35 + Math.random() * 0.5;
  const t = anow() + 0.02, f = 4200 + Math.random() * 500, pan = (Math.random() - 0.5) * 1.6;
  for (let k = 0; k < 3; k++) tone({ f, dur: 0.028, gain: 0.03, when: t + k * 0.045, dest: bed.g, pan });
};
function buildBeds() {
  const day = (n) => 1 - n;
  const heroWind = makeBed("hero-stage", (v) => v * 0.35); windLoop(heroWind.g, { f: 380 });
  const heroWater = makeBed("hero-stage", (v) => v * 0.5); waterLoop(heroWater.g);
  makeBed("hero-stage", (v) => v * 0.8, birds);
  const chWind = makeBed("church-stage", (v) => v * 0.18); windLoop(chWind.g, { f: 500 });
  makeBed("church-stage", (v) => v * day(SCENE.churchNight), birds);
  makeBed("church-stage", (v) => v * SCENE.churchNight, crickets);
  const krWind = makeBed("krus-stage", (v) => v * (0.2 + 0.6 * SCENE.krusU)); windLoop(krWind.g, { f: 340, lfo: 0.11, gain: 0.6 });
  const krCic = makeBed("krus-stage", (v) => v * day(SCENE.krusNight) * (1 - 0.6 * SCENE.krusU)); cicadaLoop(krCic.g);
  makeBed("krus-stage", (v) => v * day(SCENE.krusNight) * 0.7, birds);
  makeBed("krus-stage", (v) => v * SCENE.krusNight, crickets);
}
function audioTick(dt) {
  if (!AU.ctx || !AU.on) return;
  const t = anow();
  for (const b of AU.beds) {
    const target = b.levelFn(stageVis(b.stageId));
    b.g.gain.setTargetAtTime(target, t, 0.4);
    b.level = target;
    if (b.schedule && target > 0.04) b.schedule(b, dt);
  }
}
function setSound(on) {
  if (on && !auEnsure()) return;
  AU.on = on;
  if (AU.ctx) {
    if (on && AU.ctx.state !== "running") AU.ctx.resume();
    AU.master.gain.setTargetAtTime(on ? 0.9 : 0, AU.ctx.currentTime, 0.12);
  }
  const b = $("#sound-toggle");
  if (b) { b.setAttribute("aria-pressed", String(on)); $(".label", b).textContent = on ? "Sound on" : "Sound off"; }
}

// =====================================================================
// Stage framework
// =====================================================================
const STAGES = [];
function makeStage(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  const pr = Math.min(window.devicePixelRatio || 1, opts.maxPR || 1.5);
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  if (opts.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  if (opts.clipping) renderer.localClippingEnabled = true;
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || 40, 1, opts.near || 0.1, opts.far || 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false; controls.enableZoom = false;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (opts.ao) { ao = new GTAOPass(scene, camera, 4, 4); ao.blendIntensity = opts.ao; composer.addPass(ao); }
  let bloom = null;
  if (opts.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), opts.bloom, 0.5, 0.85); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  const st = { el, renderer, scene, camera, controls, composer, ao, bloom, visible: false, update: null, labels: [], layer: $(".labels", el), ready: false, pr, maxPR: pr, ft: 1 / 60, adaptT: 0 };
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(el); resize();
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }, { rootMargin: "120px" }).observe(el);
  STAGES.push(st);
  return st;
}
function addTag(st, text, pos, cls = "tag") {
  const el = document.createElement(cls === "hotspot" ? "button" : "div");
  el.className = cls; el.textContent = text;
  st.layer.appendChild(el);
  const L = { el, pos: pos.clone(), hidden: false };
  st.labels.push(L);
  return L;
}
const pv = new THREE.Vector3();
function placeLabels(st) {
  if (!st.labels.length) return;
  const w = st.el.clientWidth, h = st.el.clientHeight;
  for (const L of st.labels) {
    pv.copy(L.pos).project(st.camera);
    const off = L.hidden || pv.z > 1 || Math.abs(pv.x) > 1.02 || Math.abs(pv.y) > 1.02;
    L.el.style.opacity = off ? "0" : "1";
    L.el.style.pointerEvents = off ? "none" : "";
    if (L.el.tagName === "BUTTON") L.el.tabIndex = off ? -1 : 0;
    const x = (pv.x * 0.5 + 0.5) * w, y = (-pv.y * 0.5 + 0.5) * h;
    L.el.style.transform = L.el.classList.contains("hotspot") ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  audioTick(dt);
  for (const st of STAGES) {
    if (!st.visible || !st.ready) continue;
    if (st.update) st.update(dt, now / 1000);
    st.controls.update();
    st.composer.render(dt);
    placeLabels(st);
    // keep each scene smooth: scale its resolution to the frame time
    st.ft = st.ft * 0.9 + dt * 0.1; st.adaptT += dt;
    if (st.adaptT > 1.2) {
      st.adaptT = 0;
      let pr = st.pr;
      if (st.ft > 1 / 30 && pr > 0.55) pr = Math.max(0.55, pr * 0.82);
      else if (st.ft < 1 / 52 && pr < st.maxPR) pr = Math.min(st.maxPR, pr * 1.12);
      if (pr !== st.pr) { st.pr = pr; st.renderer.setPixelRatio(pr); st.composer.setPixelRatio(pr); const w = st.el.clientWidth, h = st.el.clientHeight; st.renderer.setSize(w, h, false); st.composer.setSize(w, h); }
    }
  }
  requestAnimationFrame(tick);
}
function stageMessage(el, text) {
  let d = $(".nogl", el);
  if (!d) { d = document.createElement("div"); d.className = "nogl"; el.appendChild(d); }
  d.textContent = text; d.hidden = !text;
}

// =====================================================================
// Real-world data
// =====================================================================
async function imageData(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = canvas(img.width, img.height), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}
class Grid {
  constructor(meta, img) {
    Object.assign(this, meta);
    const n = this.w * this.h; this.data = new Float32Array(n);
    for (let i = 0; i < n; i++) this.data[i] = ((img.data[i * 4] << 8) + img.data[i * 4 + 1]) / 50 - 100;
  }
  inside(x, z) { return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1; }
  sample(x, z) {
    const fx = clamp((x - this.x0) / (this.x1 - this.x0), 0, 1) * (this.w - 1), fz = clamp((z - this.z0) / (this.z1 - this.z0), 0, 1) * (this.h - 1);
    const i = Math.min(this.w - 2, Math.floor(fx)), j = Math.min(this.h - 2, Math.floor(fz)), ax = fx - i, az = fz - j, d = this.data, w = this.w;
    return (d[j * w + i] * (1 - ax) + d[j * w + i + 1] * ax) * (1 - az) + (d[(j + 1) * w + i] * (1 - ax) + d[(j + 1) * w + i + 1] * ax) * az;
  }
}
let W = null; // world data + shared geometry
async function loadWorld() {
  const [json, tImg, cImg, sImg] = await Promise.all([
    fetch("paete.json").then((r) => r.json()), imageData("terrain.png"), imageData("context.png"), imageData("satellite.jpg"),
  ]);
  const detail = new Grid(json.detail, tImg), context = new Grid(json.context, cImg);
  const heightAt = (x, z) => (detail.inside(x, z) ? detail.sample(x, z) : context.sample(x, z));
  const satAt = (x, z) => {
    const u = clamp((x - detail.x0) / (detail.x1 - detail.x0), 0, 0.9999), v = clamp((z - detail.z0) / (detail.z1 - detail.z0), 0, 0.9999);
    const i = (Math.floor(v * sImg.height) * sImg.width + Math.floor(u * sImg.width)) * 4;
    return [sImg.data[i], sImg.data[i + 1], sImg.data[i + 2]];
  };
  W = { json, detail, context, heightAt, satAt, krus: V3(json.krus[0], 0, json.krus[1]) };
  W.krus.y = heightAt(W.krus.x, W.krus.z);
  buildShared();
  return W;
}

// ---------- shared geometry/materials ----------
function gridGeometry(G) {
  const geo = new THREE.PlaneGeometry(G.x1 - G.x0, G.z1 - G.z0, G.w - 1, G.h - 1);
  geo.rotateX(-Math.PI / 2); geo.translate((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, G.data[i]);
  geo.computeVertexNormals();
  return geo;
}
const TERRAIN_NOISE = `
float tHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(tHash(i), tHash(i+vec2(1,0)), f.x), mix(tHash(i+vec2(0,1)), tHash(i+vec2(1,1)), f.x), f.y); }
float tFbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * tNoise(p); p *= 2.07; a *= 0.5; } return s; }
`;
function terrainMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\n" + TERRAIN_NOISE)
      .replace("#include <map_fragment>", `#include <map_fragment>
        float dn = tFbm(vWPos.xz * 0.11) * 0.55 + tFbm(vWPos.xz * 0.9) * 0.45;
        diffuseColor.rgb *= 0.72 + 0.56 * dn;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 1.05, 0.85), 0.35);`);
  };
  return m;
}

function buildShared() {
  const S = (W.shared = {});
  const loader = new THREE.TextureLoader();
  const sat = loader.load("satellite.jpg"); sat.colorSpace = THREE.SRGBColorSpace; sat.anisotropy = 8;
  const ctx = loader.load("context.jpg"); ctx.colorSpace = THREE.SRGBColorSpace;
  S.waterNormals = loader.load("waternormals.jpg", (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  S.terrainGeo = gridGeometry(W.detail);
  S.contextGeo = gridGeometry(W.context);
  S.terrainMat = terrainMaterial(sat);
  S.contextMat = terrainMaterial(ctx);
  buildTown(S);
  buildRoads(S);
  buildTrail(S);
  buildTrees(S);
}

// ---------- buildings from OSM footprints ----------
function buildTown(S) {
  // wall texture: windows on a plain wall (tinted per building by vertex color)
  const wc = canvas(128, 128), wg = wc.getContext("2d");
  wg.fillStyle = "#f2f0ea"; wg.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) { wg.fillStyle = `rgba(90,80,70,${Math.random() * 0.06})`; wg.fillRect(Math.random() * 128, Math.random() * 128, 6, 6); }
  wg.fillStyle = "#8a8f94"; wg.fillRect(34, 30, 60, 52);
  wg.fillStyle = "#2c3640"; wg.fillRect(38, 34, 52, 44);
  wg.fillStyle = "rgba(200,215,225,0.35)"; for (let y = 36; y < 78; y += 5) wg.fillRect(38, y, 52, 2);
  wg.fillStyle = "rgba(60,50,40,0.25)"; wg.fillRect(0, 120, 128, 8);
  const wallTex = ctex(wc, { repeat: true });
  const rc = canvas(128, 128), rg = rc.getContext("2d");
  for (let x = 0; x < 128; x++) { const v = 200 + 40 * Math.sin((x / 128) * Math.PI * 2 * 8); rg.fillStyle = `rgb(${v},${v},${v})`; rg.fillRect(x, 0, 1, 128); }
  for (let i = 0; i < 120; i++) { rg.fillStyle = `rgba(80,50,30,${Math.random() * 0.12})`; rg.fillRect(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 20, 4 + Math.random() * 10); }
  const roofTex = ctex(rc, { repeat: true });

  const wallPos = [], wallUv = [], wallCol = [], roofPos = [], roofUv = [], roofCol = [];
  const WALLS = ["#efe9dd", "#e9d8b8", "#dfe7e4", "#f2cfae", "#d9dfbf", "#f1e2e2", "#cfd8e3", "#f3e6c4"].map((c) => new THREE.Color(c));
  const ROOFS = ["#8c3a2c", "#a14a2e", "#3c6c7a", "#7d8079", "#9c5a33", "#5f7140", "#b8b4aa", "#6b3226"].map((c) => new THREE.Color(c));
  const church = W.json.church;
  const cx0 = Math.min(...church.map((p) => p[0])) - 4, cx1 = Math.max(...church.map((p) => p[0])) + 4;
  const cz0 = Math.min(...church.map((p) => p[1])) - 4, cz1 = Math.max(...church.map((p) => p[1])) + 4;
  seed = 101;
  S.occupied = [];
  for (const b of W.json.buildings) {
    let pts = b.p;
    if (pts.length < 3) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (cx > cx0 && cx < cx1 && cz > cz0 && cz < cz1) continue;
    if (Math.hypot(cx - W.krus.x, cz - W.krus.z) < 40) continue;
    let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; area += a[0] * c[1] - c[0] * a[1]; } area = Math.abs(area) / 2;
    if (area < 6) continue;
    let base = Infinity; for (const p of pts) base = Math.min(base, W.heightAt(p[0], p[1]));
    base -= 0.6;
    const floors = b.l || (rnd() < 0.55 ? 1 : rnd() < 0.85 ? 2 : 3);
    const top = base + 0.6 + floors * 3.1;
    const wc2 = WALLS[Math.floor(rnd() * WALLS.length)], rcol = ROOFS[Math.floor(rnd() * ROOFS.length)];
    // walls
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      let a = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = -dz, nz = dx, mx = (a[0] + c[0]) / 2 - cx, mz = (a[1] + c[1]) / 2 - cz;
      if (nx * mx + nz * mz < 0) { const t = a; a = c; c = t; }
      const quad = [[a[0], base, a[1], per, 0], [c[0], base, c[1], per + len, 0], [c[0], top, c[1], per + len, top - base], [a[0], top, a[1], per, top - base]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const q = quad[k]; wallPos.push(q[0], q[1], q[2]); wallUv.push(q[3] / 3.6, (q[4] - 0.6) / 3.1); wallCol.push(wc2.r, wc2.g, wc2.b); }
      per += len;
    }
    // roof: hip roof on the oriented bounding box, or flat cap for large/irregular shapes
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of pts) { const x = p[0] - cx, z = p[1] - cz; sxx += x * x; szz += z * z; sxz += x * z; }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    let ux = Math.cos(th), uz = Math.sin(th);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of pts) { const x = p[0] - cx, z = p[1] - cz, pu = x * ux + z * uz, pv2 = -x * uz + z * ux; a0 = Math.min(a0, pu); a1 = Math.max(a1, pu); b0 = Math.min(b0, pv2); b1 = Math.max(b1, pv2); }
    const ocx = cx + ux * (a0 + a1) / 2 - uz * (b0 + b1) / 2, ocz = cz + uz * (a0 + a1) / 2 + ux * (b0 + b1) / 2;
    let ha = (a1 - a0) / 2 + 0.45, hb = (b1 - b0) / 2 + 0.45;
    let vx = -uz, vz = ux;
    if (hb > ha) { [ha, hb] = [hb, ha]; [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; }
    const rect = (4 * (ha - 0.45) * (hb - 0.45));
    if (area < 700 && area / rect > 0.62) {
      const rh = hb * 0.42;
      const P = (s, t, y) => [ocx + ux * s + vx * t, y, ocz + uz * s + vz * t];
      const c1 = P(-ha, -hb, top), c2 = P(ha, -hb, top), c3 = P(ha, hb, top), c4 = P(-ha, hb, top);
      const r1 = P(-(ha - hb), 0, top + rh), r2 = P(ha - hb, 0, top + rh);
      const tri = (p, q, r) => {
        const e1 = V3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), e2 = V3(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
        if (e1.cross(e2).y < 0) [q, r] = [r, q];
        for (const v of [p, q, r]) { roofPos.push(...v); roofUv.push(((v[0] - ocx) * ux + (v[2] - ocz) * uz) / 2.2, ((v[0] - ocx) * vx + (v[2] - ocz) * vz) / 2.2); roofCol.push(rcol.r, rcol.g, rcol.b); }
      };
      tri(c1, c2, r2); tri(c1, r2, r1); tri(c3, c4, r1); tri(c3, r1, r2); tri(c2, c3, r2); tri(c4, c1, r1);
    } else {
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const flat = new THREE.Color(0x9a958c);
      for (const t of tris) {
        let [i0, i1, i2] = t;
        const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2];
        const cr = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
        const order = cr < 0 ? [p0, p1, p2] : [p0, p2, p1];
        for (const v of order) { roofPos.push(v[0], top + 0.05, v[1]); roofUv.push(v[0] / 2.2, v[1] / 2.2); roofCol.push(flat.r, flat.g, flat.b); }
      }
    }
    S.occupied.push([cx, cz, Math.sqrt(area) * 0.75 + 2]);
  }
  const mk = (pos, uv, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  S.wallGeo = mk(wallPos, wallUv, wallCol);
  S.roofGeo = mk(roofPos, roofUv, roofCol);
  S.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.85, emissive: 0xffb062, emissiveIntensity: 0, emissiveMap: null });
  S.roofMat = new THREE.MeshStandardMaterial({ map: roofTex, vertexColors: true, roughness: 0.55, metalness: 0.25 });
}

// ---------- ribbons (roads, streams, trail) ----------
function ribbon(pts, width, yOff, { step = 3, vScale = 1 } = {}) {
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) dense.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  dense.push(pts[pts.length - 1]);
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i], prev = dense[Math.max(0, i - 1)], next = dense[Math.min(dense.length - 1, i + 1)];
    let tx = next[0] - prev[0], tz = next[1] - prev[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz * width / 2, nz = tx * width / 2;
    if (i > 0) dist += Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1]);
    const yl = W.heightAt(p[0] + nx, p[1] + nz), yr = W.heightAt(p[0] - nx, p[1] - nz), yc = W.heightAt(p[0], p[1]);
    const y = Math.max(yl, yr, yc) + yOff;
    pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
    uv.push(0, dist / vScale, 1, dist / vScale);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, dense };
}
function buildRoads(S) {
  const groups = { asphalt: [], concrete: [], path: [] };
  for (const r of W.json.roads) {
    const k = ["primary", "primary_link", "secondary", "tertiary"].includes(r.k) ? "asphalt" : ["residential", "unclassified", "service", "pedestrian"].includes(r.k) ? "concrete" : "path";
    groups[k].push(ribbon(r.p, r.w, k === "asphalt" ? 0.35 : 0.28).geo);
  }
  const mat = (c, rough) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  S.roads = [
    [mergeGeometries(groups.asphalt), mat(0x4a4d50, 0.8)],
    [mergeGeometries(groups.concrete), mat(0x9d9a92, 0.9)],
    [mergeGeometries(groups.path), mat(0xa89c84, 1)],
  ].filter((x) => x[0]);
  const st = W.json.streams.map((s) => ribbon(s.p, s.w, 0.15).geo);
  S.streams = st.length ? [mergeGeometries(st), new THREE.MeshStandardMaterial({ color: 0x3b5a55, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })] : null;
}
function buildTrail(S) {
  // OSM trail (to the fork), then estimated switchback stairs to the summit site
  const t = W.json.trail.slice();
  const end = t[t.length - 1], k = [W.krus.x, W.krus.z];
  const dx = k[0] - end[0], dz = k[1] - end[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const zig = 9;
  for (let i = 1; i <= zig; i++) {
    const f = i / (zig + 1), side = (i % 2 ? 1 : -1) * 26 * (1 - f * 0.6);
    t.push([end[0] + dx * f + nx * side, end[1] + dz * f + nz * side]);
  }
  t.push([k[0] + 20, k[1] + 14]);
  // smooth with Catmull-Rom in 2D
  const curve = new THREE.CatmullRomCurve3(t.map((p) => V3(p[0], 0, p[1])), false, "centripetal", 0.5);
  const pts = curve.getSpacedPoints(420).map((p) => [p.x, p.z]);
  S.forkIndex = (() => { let best = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - end[0], p[1] - end[1]); if (d < bd) { bd = d; best = i; } }); return best / (pts.length - 1); })();
  const { geo, dense } = ribbon(pts, 2.4, 0.3, { step: 1.5, vScale: 0.32 });
  S.trailGeo = geo;
  const sc = canvas(64, 64), sg = sc.getContext("2d");
  sg.fillStyle = "#cfc7b6"; sg.fillRect(0, 0, 64, 64);
  sg.fillStyle = "#8e877a"; sg.fillRect(0, 54, 64, 10);
  sg.fillStyle = "#e3dccd"; sg.fillRect(0, 0, 64, 6);
  for (let i = 0; i < 60; i++) { sg.fillStyle = `rgba(70,60,50,${Math.random() * 0.15})`; sg.fillRect(Math.random() * 64, Math.random() * 54, 3, 3); }
  S.trailMat = new THREE.MeshStandardMaterial({ map: ctex(sc, { repeat: true }), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  S.trailPath = new THREE.CatmullRomCurve3(dense.map((p) => V3(p[0], W.heightAt(p[0], p[1]) + 0.3, p[1])), false, "centripetal");
  S.trailLen = S.trailPath.getLength();
}

// ---------- trees (placed where the satellite image shows vegetation) ----------
function buildTrees(S) {
  const tp = S.trailPath.getSpacedPoints(900);
  const nearTrailExact = (x, z) => { let d = 1e12; for (const p of tp) { const e = (p.x - x) ** 2 + (p.z - z) ** 2; if (e < d) d = e; } return Math.sqrt(d); };
  // broadleaf canopy
  const parts = [];
  const blob = (r, x, y, z, det) => { const g = new THREE.IcosahedronGeometry(r, det); g.translate(x, y, z); return g; };
  const canopy = [blob(1, 0, 1.15, 0, 1), blob(0.72, 0.6, 1.35, 0.25, 0), blob(0.68, -0.55, 1.25, -0.3, 0)];
  for (const g of canopy) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.82 + 0.3 * vnoise(x * 3 + 7, z * 3 + y * 2, 3); p.setXYZ(i, x * n, y * (0.9 + 0.12 * n), z * n); }
  }
  const trunk = new THREE.CylinderGeometry(0.07, 0.11, 1, 6); trunk.translate(0, 0.5, 0);
  for (const g of [...canopy, trunk]) { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute("uv"); parts.push(ng); }
  const broad = mergeGeometries(parts);
  const bc = [], bp = broad.attributes.position, trunkStart = bp.count - parts[parts.length - 1].attributes.position.count;
  for (let i = 0; i < bp.count; i++) {
    if (i >= trunkStart) { bc.push(0.32, 0.24, 0.17); continue; }
    const y = bp.getY(i), s = 0.62 + 0.38 * clamp((y - 0.4) / 1.6, 0, 1);
    bc.push(s, s, s);
  }
  broad.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
  broad.computeVertexNormals();

  // coconut palm
  const pparts = [], pcol = [];
  const pt = new THREE.CylinderGeometry(0.13, 0.2, 9, 6, 8, true); pt.translate(0, 4.5, 0);
  { const p = pt.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + 0.55 * (y / 9) ** 2); } }
  pparts.push(pt.index ? pt.toNonIndexed() : pt);
  for (let f = 0; f < 11; f++) {
    const fr = new THREE.PlaneGeometry(0.85, 4.2, 1, 7); fr.translate(0, 2.1, 0);
    const p = fr.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 4.2; p.setX(i, p.getX(i) * (1 - t * 0.75)); p.setZ(i, -1.9 * t * t + 0.25 * t); }
    fr.rotateX(-Math.PI / 2 + 0.55 + (f % 3) * 0.12);
    fr.rotateY((f / 11) * Math.PI * 2 + f * 0.3);
    fr.translate(0.55, 9.0, 0);
    pparts.push(fr.index ? fr.toNonIndexed() : fr);
  }
  pparts.forEach((g) => g.deleteAttribute("uv"));
  const palm = mergeGeometries(pparts);
  const tc = pparts[0].attributes.position.count;
  for (let i = 0; i < palm.attributes.position.count; i++) i < tc ? pcol.push(0.45, 0.39, 0.3) : pcol.push(0.36, 0.5, 0.22);
  palm.setAttribute("color", new THREE.Float32BufferAttribute(pcol, 3));
  palm.computeVertexNormals();

  // placement: lookup grids instead of per-candidate loops
  const RX0 = -450, RX1 = 2550, RZ0 = -2300, RZ1 = 2300;
  const trail = S.trailPath.getSpacedPoints(200);
  const DC = 20, dw = Math.ceil((RX1 - RX0) / DC), dh = Math.ceil((RZ1 - RZ0) / DC), dist = new Float32Array(dw * dh);
  for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
    const x = RX0 + (i + 0.5) * DC, z = RZ0 + (j + 0.5) * DC; let d = 1e12;
    for (const p of trail) { const e = (p.x - x) ** 2 + (p.z - z) ** 2; if (e < d) d = e; }
    dist[j * dw + i] = Math.sqrt(d);
  }
  const nearTrail = (x, z) => dist[clamp(Math.floor((z - RZ0) / DC), 0, dh - 1) * dw + clamp(Math.floor((x - RX0) / DC), 0, dw - 1)];
  const OC = 4, ow = Math.ceil((RX1 - RX0) / OC), oh = Math.ceil((RZ1 - RZ0) / OC), occ = new Uint8Array(ow * oh);
  const mark = (x, z, r) => {
    const i0 = Math.floor((x - r - RX0) / OC), i1 = Math.floor((x + r - RX0) / OC), j0 = Math.floor((z - r - RZ0) / OC), j1 = Math.floor((z + r - RZ0) / OC);
    for (let j = Math.max(0, j0); j <= Math.min(oh - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(ow - 1, i1); i++) occ[j * ow + i] = 1;
  };
  for (const o of S.occupied) mark(o[0], o[1], o[2]);
  for (const r of W.json.roads) for (let k = 0; k < r.p.length - 1; k++) {
    const a = r.p[k], b = r.p[k + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3);
    for (let t = 0; t <= n; t++) mark(lerp(a[0], b[0], t / n), lerp(a[1], b[1], t / n), r.w / 2 + 1.5);
  }
  const blocked = (x, z) => occ[clamp(Math.floor((z - RZ0) / OC), 0, oh - 1) * ow + clamp(Math.floor((x - RX0) / OC), 0, ow - 1)] === 1;
  const B = [], P = [];
  seed = 7;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3(), p = V3(), up = V3(0, 1, 0), c = new THREE.Color();
  const MAXB = 22000, MAXP = 2400;
  for (let tries = 0; tries < 260000 && (B.length < MAXB || P.length < MAXP); tries++) {
    const x = RX0 + rnd() * (RX1 - RX0), z = RZ0 + rnd() * (RZ1 - RZ0);
    const dt = nearTrail(x, z), near = dt < 420 || Math.hypot(x + 10, z) < 350;
    if (!near && rnd() > 0.4) continue;
    if (dt < 30 && nearTrailExact(x, z) < 8) continue;
    const h = W.heightAt(x, z);
    if (h < 3.4) continue;
    if (Math.hypot(x - W.krus.x, z - W.krus.z) < 30 || (x < W.krus.x && x > W.krus.x - 70 && Math.abs(z - W.krus.z) < 22 && rnd() < 0.85)) continue;
    if (Math.hypot(x + 10, z) < 60) continue;
    if (Math.hypot(x - W.krus.x - 30, z - W.krus.z) < 28) continue; // summit viewpoint
    const [r, g, b] = W.satAt(x, z), green = g - (r + b) / 2, bright = (r + g + b) / 3;
    if (h < 28) {
      if (green < 7 || bright > 140 || blocked(x, z)) continue;
      if (rnd() < 0.6) { if (P.length < MAXP) P.push([x, h, z, r, g, b]); }
      else if (B.length < MAXB) B.push([x, h, z, r, g, b, 0.7]);
    } else {
      if (green < -6 || bright > 150 || blocked(x, z)) continue;
      if (B.length < MAXB) B.push([x, h, z, r, g, b, 1]);
    }
  }
  const mkInst = (geo, list, scaleFn) => {
    const mats = new Float32Array(list.length * 16), cols = new Float32Array(list.length * 3);
    list.forEach((t, i) => {
      const sc = scaleFn(t);
      m.compose(p.set(t[0], t[1] - 0.4, t[2]), q.setFromAxisAngle(up, rnd() * Math.PI * 2), s.set(sc[0], sc[1], sc[0]));
      m.toArray(mats, i * 16);
      c.setRGB(t[3] / 255, t[4] / 255, t[5] / 255, THREE.SRGBColorSpace);
      const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h + (rnd() - 0.5) * 0.04, clamp(hsl.s * 1.15, 0.25, 0.8), clamp(hsl.l * (0.75 + rnd() * 0.35), 0.035, 0.22));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    });
    return { geo, mats, cols, count: list.length };
  };
  S.broad = mkInst(broad, B, (t) => { const k = t[6] * (3.2 + rnd() * 2.8); return [k, k * (1.1 + rnd() * 0.5)]; });
  S.palms = mkInst(palm, P, () => { const k = 0.8 + rnd() * 0.45; return [k, k]; });
  S.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
}

// =====================================================================
// World scene builder (shared by hero, church, krus)
// =====================================================================
function instanced({ geo, mats, cols, count }, mat, shadows) {
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.instanceMatrix = new THREE.InstancedBufferAttribute(mats, 16);
  im.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
  im.castShadow = false; im.receiveShadow = !!shadows;
  im.layers.set(1);
  im.computeBoundingSphere();
  im.frustumCulled = false;
  return im;
}
function sunDir(elevDeg, azDeg) {
  const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
  return V3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
function buildWorld(st, { shadows = false, waterRes = 512 } = {}) {
  const S = W.shared, scene = st.scene;
  const terrain = new THREE.Mesh(S.terrainGeo, S.terrainMat); terrain.receiveShadow = shadows; scene.add(terrain);
  const ctxT = new THREE.Mesh(S.contextGeo, S.contextMat); scene.add(ctxT);
  const walls = new THREE.Mesh(S.wallGeo, S.wallMat); walls.castShadow = walls.receiveShadow = shadows;
  const roofs = new THREE.Mesh(S.roofGeo, S.roofMat); roofs.castShadow = roofs.receiveShadow = shadows;
  scene.add(walls, roofs);
  for (const [g, m] of S.roads) { const r = new THREE.Mesh(g, m); r.receiveShadow = shadows; scene.add(r); }
  if (S.streams) scene.add(new THREE.Mesh(S.streams[0], S.streams[1]));
  const trail = new THREE.Mesh(S.trailGeo, S.trailMat); trail.receiveShadow = shadows; scene.add(trail);
  scene.add(instanced(S.broad, S.treeMat, shadows), instanced(S.palms, S.treeMat, shadows));

  // sky, sun, fog, water
  const sky = new Sky(); sky.scale.setScalar(400000); scene.add(sky);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.2; su.rayleigh.value = 1.3; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
  scene.fog = new THREE.FogExp2(0xbfd0dc, 0.000075);
  const water = new Water(new THREE.PlaneGeometry(80000, 80000), {
    textureWidth: waterRes, textureHeight: waterRes, waterNormals: S.waterNormals, sunDirection: V3(0, 1, 0), sunColor: 0xffffff,
    waterColor: 0x2f4f46, distortionScale: 2.2, fog: true,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = W.json.frame.lake; water.material.uniforms.size.value = 6;
  scene.add(water);
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a3f2c, 0.5); scene.add(hemi);
  if (shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 1600 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  }
  // stars for night
  const sp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 30000, y = Math.abs(u); const k = Math.sqrt(1 - y * y); sp.set([Math.cos(a) * k * r, y * r, Math.sin(a) * k * r], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  // environment from the sky
  const pmrem = new THREE.PMREMGenerator(st.renderer);
  const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(900); envScene.add(envSky);
  let envRT = null;
  const focus = V3();
  st.camera.layers.enable(1);
  const world = { sky, sun, hemi, water, stars, focus, terrain, dir: sunDir(30, 260) };
  world.setSun = (elev, az, { night = 0 } = {}) => {
    const d = sunDir(elev, az);
    su.sunPosition.value.copy(d);
    water.material.uniforms.sunDirection.value.copy(d.y > 0 ? d : sunDir(35, 120)).normalize();
    const day = sstep(-4, 10, elev);
    const warm = 1 - sstep(4, 30, elev);
    sun.color.setRGB(1, lerp(0.95, 0.62, warm), lerp(0.88, 0.38, warm));
    sun.intensity = lerp(0.0, 6.5, day);
    world.dir = d.y > 0 ? d : sunDir(40, 300);
    if (night > 0.5 || elev < -2) { sun.color.setRGB(0.62, 0.72, 1); sun.intensity = 0.35; world.dir = sunDir(48, 250); }
    hemi.intensity = lerp(0.1, 0.32, day);
    hemi.color.setRGB(lerp(0.25, 0.8, day), lerp(0.3, 0.88, day), lerp(0.5, 1, day));
    stars.material.opacity = 1 - sstep(-8, 2, elev);
    const fogc = new THREE.Color().setRGB(lerp(0.03, 0.75, day), lerp(0.05, 0.8, day), lerp(0.1, 0.86, day));
    if (warm > 0.3 && day > 0.2) fogc.lerp(new THREE.Color(0.95, 0.72, 0.55), (warm - 0.3) * 0.7);
    scene.fog.color.copy(fogc);
    water.material.uniforms.sunColor.value.setRGB(day, day * lerp(0.95, 0.7, warm), day * lerp(0.9, 0.5, warm));
    // environment map
    Object.keys(su).forEach((k) => envSky.material.uniforms[k].value = su[k].value);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = lerp(0.06, 0.38, day);
    world.placeSun();
  };
  world.placeSun = () => {
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(world.dir, 600);
  };
  world.update = (dt) => { water.material.uniforms.time.value += dt * 0.5; };
  return world;
}

// =====================================================================
// Church model (St. James the Apostle), built from photos + OSM footprint
// =====================================================================
function tuffTile() {
  const N = 512, hc = canvas(N, N), hg = hc.getContext("2d"), ac = canvas(N, N), ag = ac.getContext("2d");
  hg.fillStyle = "#202020"; hg.fillRect(0, 0, N, N);
  ag.fillStyle = "#8b7a5c"; ag.fillRect(0, 0, N, N);
  seed = 55;
  const rows = 8, rh = N / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 80;
    while (x < N) {
      const w = 70 + rnd() * 90, v = rnd();
      const y = r * rh;
      const col = `rgb(${165 + v * 40 | 0},${142 + v * 34 | 0},${102 + v * 30 | 0})`;
      for (const ox of [-N, 0, N]) {
        hg.fillStyle = `rgb(${150 + v * 50 | 0},${150 + v * 50 | 0},${150 + v * 50 | 0})`; hg.fillRect(x + ox + 3, y + 3, w - 6, rh - 6);
        ag.fillStyle = col; ag.fillRect(x + ox + 2, y + 2, w - 4, rh - 4);
      }
      x += w;
    }
  }
  // pitting + weathering
  const hd = hg.getImageData(0, 0, N, N), ad = ag.getImageData(0, 0, N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, n = fbm(x * 0.05, y * 0.05, 3, 4), p = vnoise(x * 0.6, y * 0.6, 9);
    const pit = p > 0.82 ? -60 : 0;
    hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = clamp(hd.data[i] * (0.75 + 0.5 * n) + pit, 0, 255);
    const dark = 0.72 + 0.4 * n - (p > 0.82 ? 0.18 : 0) - 0.25 * sstep(0.55, 0.8, fbm(x * 0.012, y * 0.02, 8, 3));
    ad.data[i] *= dark; ad.data[i + 1] *= dark * 0.98; ad.data[i + 2] *= dark * 0.94;
  }
  hg.putImageData(hd, 0, 0); ag.putImageData(ad, 0, 0);
  const map = ctex(ac, { repeat: true }), nrm = ctex(normalFromHeight(hc, 3.5), { srgb: false, repeat: true });
  return new THREE.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(1, 1), roughness: 0.93 });
}
function stoneBox(w, h, d, tile = 2.6) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
// Facade elevation texture: carved reliefs drawn as a height field.
// Canvas spans the nave facade: 14.8 m wide (z), 18.2 m tall.
function facadeTextures() {
  const FW = 14.8, FH = 18.2, PX = 64, w = Math.round(FW * PX), h = Math.round(FH * PX);
  const hc = canvas(w, h), g = hc.getContext("2d");
  const X = (z) => (z + FW / 2) * PX, Y = (y) => h - y * PX;     // z: -7.4..7.4 (left..right), y: 0..18.2
  g.fillStyle = "#7a7a7a"; g.fillRect(0, 0, w, h);
  // ashlar courses
  seed = 77;
  for (let y = 0; y < FH; y += 0.42) {
    g.fillStyle = "#4a4a4a"; g.fillRect(0, Y(y) - 2, w, 3);
    let z = -FW / 2 - rnd();
    while (z < FW / 2) { g.fillRect(X(z) - 1, Y(y + 0.42), 3, 0.42 * PX); z += 0.6 + rnd() * 0.6; }
  }
  const light = "#d0d0d0", mid = "#a8a8a8", deep = "#3a3a3a";
  const scroll = (cx, cy, r, dir = 1, rot = 0) => {
    g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(dir, 1);
    g.strokeStyle = light; g.lineWidth = r * 0.28; g.lineCap = "round";
    g.beginPath();
    for (let t = 0; t < Math.PI * 3.2; t += 0.1) { const rr = r * (1 - t / (Math.PI * 4)); const x = Math.cos(t) * rr, y = Math.sin(t) * rr; t === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    g.fillStyle = light; g.beginPath(); g.ellipse(r * 1.1, -r * 0.5, r * 0.55, r * 0.22, -0.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(r * 1.0, r * 0.6, r * 0.5, r * 0.2, 0.7, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  const rosette = (cx, cy, r) => {
    g.fillStyle = light;
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.2, a, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = deep; g.beginPath(); g.arc(cx, cy, r * 0.22, 0, Math.PI * 2); g.fill();
  };
  const panel = (z0, z1, y0, y1) => {
    g.fillStyle = mid; g.fillRect(X(z0), Y(y1), (z1 - z0) * PX, (y1 - y0) * PX);
    g.fillStyle = "#5a5a5a"; g.fillRect(X(z0) + 4, Y(y1) + 4, (z1 - z0) * PX - 8, (y1 - y0) * PX - 8);
    const cx = X((z0 + z1) / 2), r = Math.min(z1 - z0, 1.2) * PX * 0.32;
    for (let y = y0 + 0.5; y < y1 - 0.3; y += 1.15) { scroll(cx - r * 0.6, Y(y + 0.4), r, 1); scroll(cx + r * 0.6, Y(y + 0.4), r, -1); }
  };
  // pilaster panels (lower and upper storeys)
  for (const [z0, z1] of [[-7.4, -6.3], [-2.9, -1.9], [1.9, 2.9], [6.3, 7.4]]) { panel(z0, z1, 0.9, 8.9); panel(z0, z1, 9.9, 13.0); }
  // spandrels around the door arch: foliage scrolls
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) scroll(X(s * (2.1 + k * 0.05)), Y(5.2 + k * 0.85), 0.32 * PX, -s, s * 0.3);
  // fields between pilasters: scattered scroll + rosette reliefs
  for (const [z0, z1] of [[-6.3, -2.9], [2.9, 6.3]]) {
    for (let y = 1.6; y < 8.4; y += 1.7) for (let z = z0 + 0.6; z < z1 - 0.4; z += 1.3) { rnd() < 0.5 ? rosette(X(z), Y(y), 0.32 * PX) : scroll(X(z), Y(y), 0.24 * PX, rnd() < 0.5 ? 1 : -1, rnd()); }
  }
  // frieze bands
  for (const yb of [9.25, 13.25]) for (let z = -7.1; z < 7.2; z += 0.75) rosette(X(z), Y(yb), 0.26 * PX);
  // central relief: Santiago on horseback, framed
  {
    const z0 = -1.4, z1 = 1.4, y0 = 9.9, y1 = 12.6;
    g.fillStyle = "#4e4e4e"; g.fillRect(X(z0), Y(y1), (z1 - z0) * PX, (y1 - y0) * PX);
    g.save(); g.translate(X(0), Y(11.0)); g.fillStyle = light; g.strokeStyle = light; g.lineCap = "round";
    const s = PX;
    g.beginPath(); g.ellipse(0, 0, 0.75 * s, 0.33 * s, -0.1, 0, Math.PI * 2); g.fill();                    // horse body
    g.lineWidth = 0.16 * s;
    g.beginPath(); g.moveTo(0.55 * s, -0.15 * s); g.lineTo(0.95 * s, -0.75 * s); g.stroke();             // neck
    g.beginPath(); g.ellipse(1.08 * s, -0.86 * s, 0.24 * s, 0.13 * s, 0.5, 0, Math.PI * 2); g.fill();     // head
    g.lineWidth = 0.1 * s;
    for (const [x0, y0, x1, y1] of [[0.5, 0.2, 0.95, 0.35], [0.4, 0.2, 0.6, 0.85], [-0.5, 0.2, -0.75, 0.85], [-0.4, 0.2, -0.25, 0.85]]) { g.beginPath(); g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); g.stroke(); }
    g.beginPath(); g.moveTo(-0.72 * s, -0.05 * s); g.quadraticCurveTo(-1.1 * s, 0.1 * s, -1.0 * s, 0.55 * s); g.stroke();   // tail
    g.lineWidth = 0.2 * s; g.beginPath(); g.moveTo(-0.05 * s, -0.2 * s); g.lineTo(0.0, -0.85 * s); g.stroke(); // rider
    g.beginPath(); g.arc(0.02 * s, -1.02 * s, 0.13 * s, 0, Math.PI * 2); g.fill();
    g.lineWidth = 0.06 * s; g.beginPath(); g.moveTo(0.05 * s, -0.7 * s); g.lineTo(0.55 * s, -1.25 * s); g.stroke();  // sword arm
    g.beginPath(); g.moveTo(0.0, -0.75 * s); g.lineTo(-0.35 * s, -1.0 * s); g.stroke();
    g.restore();
  }
  // pediment field: big scrolls around the oculus
  for (const s of [-1, 1]) { scroll(X(s * 2.6), Y(14.6), 0.45 * PX, -s, s * 0.2); scroll(X(s * 4.6), Y(13.95), 0.32 * PX, -s); scroll(X(s * 1.4), Y(16.4), 0.28 * PX, -s); }
  // blur slightly for carved softness
  const soft = canvas(w, h), sg = soft.getContext("2d"); sg.filter = "blur(1.2px)"; sg.drawImage(hc, 0, 0);
  const hsrc = sg.filter === "none" ? hc : soft;
  const nrm = normalFromHeight(hsrc, 4.5, false);
  // albedo: tuff + grime in recesses + rain streaks + lichen
  const ac = canvas(w, h), ag = ac.getContext("2d"), hd = hsrc.getContext("2d").getImageData(0, 0, w, h).data, img = ag.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, hv = hd[i] / 255;
    const n = fbm(x * 0.03, y * 0.03, 4, 4), streak = fbm(x * 0.08, y * 0.004, 12, 3), lich = sstep(0.6, 0.78, fbm(x * 0.012, y * 0.012, 21, 4));
    let r = 172, gg = 156, b = 124;
    const k = (0.58 + 0.55 * n) * (0.55 + 0.6 * hv) * (1 - 0.35 * sstep(0.5, 0.8, streak));
    r *= k; gg *= k; b *= k;
    r = lerp(r, 52, lich * 0.75); gg = lerp(gg, 52, lich * 0.75); b = lerp(b, 44, lich * 0.75);
    const yy = (h - y) / PX; if (yy < 1.2) { const m = (1.2 - yy) / 1.2 * 0.35; r = lerp(r, 70, m); gg = lerp(gg, 78, m); b = lerp(b, 52, m); }
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ag.putImageData(img, 0, 0);
  const map = ctex(ac); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const normalMap = ctex(nrm, { srgb: false });
  return { mat: new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }), FW, FH };
}
function doorTexture() {
  const w = 256, h = 512, c = canvas(w, h), g = c.getContext("2d"), hcv = canvas(w, h), hg = hcv.getContext("2d");
  g.fillStyle = "#7a2f18"; g.fillRect(0, 0, w, h);
  hg.fillStyle = "#555"; hg.fillRect(0, 0, w, h);
  const cols = 4, rows = 9;
  for (let leaf = 0; leaf < 2; leaf++) for (let r = 0; r < rows; r++) for (let k = 0; k < cols / 2; k++) {
    const x = leaf * w / 2 + 10 + k * (w / 2 - 20) / 2, y = 14 + r * (h - 28) / rows, pw = (w / 2 - 20) / 2 - 8, ph = (h - 28) / rows - 8;
    g.fillStyle = "#8f3a1e"; g.fillRect(x + 4, y + 4, pw, ph);
    g.fillStyle = "rgba(255,190,140,0.12)"; g.fillRect(x + 4, y + 4, pw, 3);
    hg.fillStyle = "#bbb"; hg.fillRect(x + 4, y + 4, pw, ph); hg.fillStyle = "#ddd"; hg.fillRect(x + 10, y + 10, pw - 12, ph - 12);
  }
  g.fillStyle = "#2a120a"; g.fillRect(w / 2 - 2, 0, 4, h);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = 0.85 + Math.random() * 0.2; img.data[i] *= n; img.data[i + 1] *= n; img.data[i + 2] *= n; }
  g.putImageData(img, 0, 0);
  return new THREE.MeshStandardMaterial({ map: ctex(c), normalMap: ctex(normalFromHeight(hcv, 3, false), { srgb: false }), roughness: 0.55 });
}
function archShape(Cls, w, h) { const s = new Cls(); s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0); return s; }
function archUV(geo, w, h) { // map extruded front faces 0..1 across the arch
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, p.getY(i) / h);
  return geo;
}
let CHURCH_MATS = null;
function buildChurch() {
  const group = new THREE.Group();
  CHURCH_MATS = CHURCH_MATS || { tuff: tuffTile(), F: facadeTextures(), door: doorTexture() };
  const { tuff, F, door } = CHURCH_MATS;
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.6, emissive: 0xffa04a, emissiveIntensity: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.5, metalness: 0.7 });
  const roofTex = (() => { const c = canvas(64, 64), g = c.getContext("2d"); for (let x = 0; x < 64; x++) { const v = 150 + 50 * Math.sin((x / 64) * Math.PI * 8); g.fillStyle = `rgb(${v},${v * 0.55 | 0},${v * 0.45 | 0})`; g.fillRect(x, 0, 1, 64); } return ctex(c, { repeat: true }); })();
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, color: 0xb05a40, roughness: 0.5, metalness: 0.3 });
  const tileMat = (() => {
    const c = canvas(128, 128), g = c.getContext("2d"); g.fillStyle = "#7c3322"; g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) { const v = Math.random(); g.fillStyle = `rgb(${150 + v * 50 | 0},${70 + v * 25 | 0},${45 + v * 20 | 0})`; g.beginPath(); g.ellipse(k * 16 + (r % 2) * 8, r * 16 + 10, 7, 9, 0, 0, Math.PI); g.fill(); }
    const t = ctex(c, { repeat: true }); t.repeat.set(4, 3); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 });
  })();
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  const box = (w, h, d, x, y, z, mat = tuff) => add(stoneBox(w, h, d), mat, x, y, z);

  // Local frame: facade plane at x = FX facing -x (west). z = across facade (north -, south +). y up from ground.
  const FX = -31.2, ZC = -0.6, FW = F.FW;
  // nave + sanctuary block (footprint from OSM)
  box(39.5, 12, 16.4, FX + 1.6 + 39.5 / 2, 6, ZC - 0.4);
  box(21, 13, 20.2, 20.5, 6.5, -2.4);
  // gable roofs
  const gable = (len, span, rise, x, y, z, alongX = true) => {
    const s = new THREE.Shape(); s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.lineTo(-span / 2, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * 0.25);
    const m = add(geo, roofMat, x, y, z); if (alongX) m.rotation.y = Math.PI / 2; return m;
  };
  gable(38.5, 17.6, 4.6, FX + 2, 12, ZC - 0.4);
  gable(21.6, 21.4, 5, 10, 13, -2.4);
  // buttresses along both nave walls
  for (const x of [-20, -11, -2, 6]) for (const s of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(2.6, 0); sh.lineTo(0.9, 10.5); sh.lineTo(0, 10.5); sh.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 1.8, bevelEnabled: false });
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.6, uv.getY(i) / 2.6);
    const m = add(geo, tuff, x - 0.9, 0, ZC - 0.4 + s * 8.2);
    m.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; m.position.x = x + (s > 0 ? -0.9 : 0.9);
  }
  // side windows
  for (const x of [-24, -15, -6.5, 2]) for (const s of [-1, 1]) {
    const g = archUV(new THREE.ExtrudeGeometry(archShape(THREE.Shape, 1.3, 2.6), { depth: 0.1, bevelEnabled: false }), 1.3, 2.6);
    add(g, darkGlass, x, 6.4, ZC - 0.4 + s * 8.22, s > 0 ? 0 : Math.PI);
  }

  // ---- facade ----
  // main wall slab
  box(2.2, 13.4, FW, FX + 1.1, 6.7, ZC);
  // textured skin (rectangle + pediment triangle) using one elevation texture
  {
    const rectH = 13.4;
    const rg = new THREE.PlaneGeometry(FW, rectH);
    const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * rectH / F.FH);
    add(rg, F.mat, FX - 0.01, rectH / 2, ZC, -Math.PI / 2);
    const tri = new THREE.Shape(); tri.moveTo(-FW / 2, 0); tri.lineTo(FW / 2, 0); tri.lineTo(0, F.FH - rectH); tri.lineTo(-FW / 2, 0);
    const tg = new THREE.ShapeGeometry(tri); const tuv = tg.attributes.uv, tp = tg.attributes.position;
    for (let i = 0; i < tuv.count; i++) tuv.setXY(i, (tp.getX(i) + FW / 2) / FW, (tp.getY(i) + rectH) / F.FH);
    add(tg, F.mat, FX - 0.01, rectH, ZC, -Math.PI / 2);
    // pediment mass behind skin
    const pm = new THREE.ExtrudeGeometry(tri, { depth: 2.2, bevelEnabled: false });
    const m = add(pm, tuff, FX + 2.2, rectH, ZC, -Math.PI / 2); m.position.x = FX + 2.19;
  }
  // plinth, cornices, pilasters (real protrusions)
  box(0.5, 0.8, FW + 0.4, FX - 0.2, 0.4, ZC);
  for (const [y, hgt, out] of [[8.95, 0.35, 0.55], [9.3, 0.3, 0.35], [13.05, 0.35, 0.55], [13.4, 0.25, 0.3]]) box(out, hgt, FW + 0.6, FX - out / 2 + 0.05, y, ZC);
  for (const zc of [-6.85, -2.4, 2.4, 6.85]) { box(0.28, 8.1, 1.1, FX - 0.14, 4.85, ZC + zc); box(0.28, 3.4, 1.1, FX - 0.14, 11.35, ZC + zc); }
  // raking cornices + scroll crest along the pediment edges
  const rise = F.FH - 13.4, half = FW / 2, slope = Math.atan2(rise, half), rl = Math.hypot(rise, half);
  for (const s of [-1, 1]) {
    const rc = add(stoneBox(0.6, 0.4, rl + 0.4), tuff, FX - 0.15, 13.4 + rise / 2 + 0.15, ZC + s * half / 2);
    rc.rotation.x = s * slope;
    const scrollGeo = new THREE.TorusGeometry(0.22, 0.075, 8, 16, Math.PI * 1.45);
    for (let k = 1; k < 9; k++) {
      const f = k / 9, zz = ZC + s * half * (1 - f), yy = 13.4 + rise * f + 0.48;
      const sc = add(scrollGeo, tuff, FX - 0.1, yy, zz, Math.PI / 2);
      sc.rotation.set(0, Math.PI / 2, s * (Math.PI * 0.25) + f);
      const ball = add(new THREE.SphereGeometry(0.11, 10, 8), tuff, FX - 0.1, yy + 0.3, zz);
      ball.castShadow = true;
    }
  }
  // apex finial + cross, corner pinnacle (north corner; the south side meets the tower)
  box(0.9, 0.9, 0.9, FX + 0.1, F.FH + 0.3, ZC);
  box(0.24, 1.9, 0.24, FX + 0.1, F.FH + 1.65, ZC); box(0.24, 0.24, 1.1, FX + 0.1, F.FH + 2.05, ZC);
  {
    const urn = new THREE.LatheGeometry([[0, 0], [0.42, 0], [0.42, 0.3], [0.25, 0.45], [0.38, 0.9], [0.18, 1.3], [0.05, 1.9], [0, 2.0]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    box(1.0, 1.0, 1.0, FX + 0.3, 13.9 + 0.5, ZC - half + 0.3);
    add(urn, tuff, FX + 0.3, 14.9, ZC - half + 0.3);
  }
  // door: arched, wooden panels, with carved archivolt
  {
    const dw = 3.3, dh = 5.6;
    const dg = archUV(new THREE.ExtrudeGeometry(archShape(THREE.Shape, dw, dh), { depth: 0.08, bevelEnabled: false }), dw, dh);
    add(dg, door, FX - 0.02, 0.8, ZC, -Math.PI / 2);
    const fr = archShape(THREE.Shape, dw + 1.1, dh + 0.55); fr.holes.push(archShape(THREE.Path, dw, dh));
    const fg = new THREE.ExtrudeGeometry(fr, { depth: 0.35, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.6, uv.getY(i) / 2.6);
    add(fg, tuff, FX - 0.02, 0.8, ZC, -Math.PI / 2);
    // keystone
    box(0.4, 0.7, 0.6, FX - 0.3, 0.8 + dh + 0.35, ZC);
  }
  // small arched window right of the door (as in photos), plus barred windows of the upper storey
  {
    const g = archUV(new THREE.ExtrudeGeometry(archShape(THREE.Shape, 0.7, 1.3), { depth: 0.06, bevelEnabled: false }), 0.7, 1.3);
    add(g, darkGlass, FX - 0.02, 3.4, ZC + 4.6, -Math.PI / 2);
    for (const zc of [-4.6, 4.6]) {
      const ww = 1.25, wh = 1.75, wy = 10.3;
      box(0.1, wh, ww, FX - 0.02, wy + wh / 2, ZC + zc, darkGlass);
      for (let k = 0; k < 6; k++) add(new THREE.CylinderGeometry(0.025, 0.025, wh, 6), iron, FX - 0.12, wy + wh / 2, ZC + zc - ww / 2 + (k + 0.5) * ww / 6);
      box(0.3, 0.2, ww + 0.5, FX - 0.15, wy - 0.1, ZC + zc); box(0.3, 0.2, ww + 0.5, FX - 0.15, wy + wh + 0.1, ZC + zc);
      box(0.3, wh + 0.4, 0.22, FX - 0.15, wy + wh / 2, ZC + zc - ww / 2 - 0.13); box(0.3, wh + 0.4, 0.22, FX - 0.15, wy + wh / 2, ZC + zc + ww / 2 + 0.13);
    }
    // relief panel frame
    box(0.3, 0.2, 3.2, FX - 0.15, 9.8, ZC); box(0.3, 0.2, 3.2, FX - 0.15, 12.7, ZC);
    box(0.3, 3.1, 0.2, FX - 0.15, 11.25, ZC - 1.5); box(0.3, 3.1, 0.2, FX - 0.15, 11.25, ZC + 1.5);
  }
  // oculus
  {
    const o = add(new THREE.TorusGeometry(0.62, 0.16, 12, 32), tuff, FX - 0.12, 15.35, ZC, Math.PI / 2);
    add(new THREE.CircleGeometry(0.62, 32), darkGlass, FX - 0.02, 15.35, ZC, -Math.PI / 2);
    o.castShadow = true;
  }

  // ---- bell tower (south side of the facade) ----
  const TX = FX + 3.3, TZ = ZC + FW / 2 + 3.2, TS = 6.4;
  box(TS, 13.4, TS, TX, 6.7, TZ);
  box(TS + 0.5, 0.8, TS + 0.5, TX, 0.4, TZ);
  for (const [y, hh, ex] of [[8.95, 0.35, 0.6], [13.05, 0.35, 0.7], [13.4, 0.25, 0.5]]) box(TS + ex, hh, TS + ex, TX, y, TZ);
  {
    const g = archUV(new THREE.ExtrudeGeometry(archShape(THREE.Shape, 0.9, 1.8), { depth: 0.06, bevelEnabled: false }), 0.9, 1.8);
    add(g, darkGlass, TX - TS / 2 - 0.02, 4.0, TZ, -Math.PI / 2);
    add(g.clone(), darkGlass, TX - TS / 2 - 0.02, 10.6, TZ, -Math.PI / 2);
  }
  // balustrades (instanced balusters)
  const balGeo = new THREE.LatheGeometry([[0, 0], [0.11, 0], [0.11, 0.06], [0.06, 0.12], [0.13, 0.36], [0.06, 0.6], [0.09, 0.66], [0.09, 0.72], [0, 0.72]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const balList = [];
  const balustrade = (y, size) => {
    const n = Math.round(size / 0.42);
    for (let s = 0; s < 4; s++) for (let k = 0; k < n; k++) {
      const t = -size / 2 + (k + 0.5) * size / n, off = size / 2 - 0.15;
      const [x, z] = [[-off, t], [off, t], [t, -off], [t, off]][s];
      balList.push([TX + x, y, TZ + z]);
    }
    for (let s = 0; s < 4; s++) {
      const off = size / 2 - 0.15;
      const r = s < 2 ? box(0.3, 0.16, size, TX + (s ? off : -off), y + 0.8, TZ) : box(size, 0.16, 0.3, TX, y + 0.8, TZ + (s === 3 ? off : -off));
      r.castShadow = true;
    }
  };
  balustrade(13.55, TS + 0.3);
  // stage 2
  const S2 = 5.6;
  box(S2, 5.0, S2, TX, 14.4 + 2.5, TZ);
  for (const [dx, dz, ry] of [[-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2], [0, -1, Math.PI], [0, 1, 0]]) {
    const g = archUV(new THREE.ExtrudeGeometry(archShape(THREE.Shape, 1.1, 2.2), { depth: 0.06, bevelEnabled: false }), 1.1, 2.2);
    add(g, darkGlass, TX + dx * (S2 / 2 + 0.02), 15.6, TZ + dz * (S2 / 2 + 0.02), ry);
    for (let k = 0; k < 4; k++) {
      const bar = add(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6), iron, 0, 16.45, 0);
      const t = -0.4 + k * 0.27;
      bar.position.set(TX + dx * (S2 / 2 + 0.1) + (dz ? t : 0), 16.45, TZ + dz * (S2 / 2 + 0.1) + (dx ? t : 0));
    }
  }
  box(S2 + 0.6, 0.35, S2 + 0.6, TX, 19.55, TZ);
  balustrade(19.7, S2 + 0.4);
  // stage 3: open belfry (corner piers + arches) with a bell
  const S3 = 4.8, by = 20.6, bh = 4.0;
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(1.0, bh, 1.0, TX + dx * (S3 / 2 - 0.5), by + bh / 2, TZ + dz * (S3 / 2 - 0.5));
  for (const [dx, dz, ry] of [[-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2], [0, -1, Math.PI], [0, 1, 0]]) {
    const fr = new THREE.Shape(); fr.moveTo(-1.75, 0); fr.lineTo(1.75, 0); fr.lineTo(1.75, 1.8); fr.lineTo(-1.75, 1.8); fr.lineTo(-1.75, 0);
    const hole = new THREE.Path(); hole.moveTo(-1.3, 0.1); hole.absarc(0, 0.1, 1.3, Math.PI, 0, true); hole.lineTo(-1.3, 0.1);
    fr.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(fr, { depth: 0.7, bevelEnabled: false });
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.6, uv.getY(i) / 2.6);
    const m = add(g, tuff, 0, 0, 0, ry);
    m.position.set(TX + dx * (S3 / 2 - 0.7), by + bh - 1.8, TZ + dz * (S3 / 2 - 0.7));
  }
  box(S3, 0.4, S3, TX, by + 0.2, TZ);
  box(S3 + 0.7, 0.45, S3 + 0.7, TX, by + bh + 0.22, TZ);
  // cap: octagonal red-tiled roof
  const cap = add(new THREE.ConeGeometry(3.1, 2.9, 8, 1), tileMat, TX, by + bh + 0.45 + 1.45, TZ);
  cap.rotation.y = Math.PI / 8;
  const brass = new THREE.MeshStandardMaterial({ color: 0x9a8a5a, metalness: 0.8, roughness: 0.35 });
  add(new THREE.SphereGeometry(0.22, 12, 8), brass, TX, by + bh + 3.15, TZ);
  add(new THREE.BoxGeometry(0.12, 1.5, 0.12), iron, TX, by + bh + 3.9, TZ);
  add(new THREE.BoxGeometry(0.12, 0.12, 0.8), iron, TX, by + bh + 4.2, TZ);
  // bell
  const bellGeo = new THREE.LatheGeometry([[0, 1.45], [0.42, 1.4], [0.5, 1.2], [0.56, 0.85], [0.78, 0.32], [0.92, 0.07], [0.88, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const bellPivot = new THREE.Group(); bellPivot.position.set(TX, by + bh - 0.6, TZ); group.add(bellPivot);
  const bell = new THREE.Mesh(bellGeo, new THREE.MeshStandardMaterial({ color: 0x6b5a32, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
  bell.position.y = -1.5; bell.castShadow = true; bellPivot.add(bell);
  // low annex east of the tower
  box(5.2, 7, 5.6, TX + 7.3, 3.5, TZ - 0.3);

  const balusters = new THREE.InstancedMesh(balGeo, tuff, balList.length);
  balList.forEach((p, i) => balusters.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])));
  balusters.castShadow = true; group.add(balusters);

  // plaza in front of the facade
  const plazaMat = (() => { const c = canvas(256, 256), g = c.getContext("2d"); g.fillStyle = "#a59f93"; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${60 + Math.random() * 60},${60 + Math.random() * 50},50,${Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 2 + Math.random() * 10); } g.strokeStyle = "rgba(60,55,50,0.35)"; for (let k = 0; k <= 256; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); } const t = ctex(c, { repeat: true }); t.repeat.set(8, 10); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); })();
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 42), plazaMat); plaza.position.set(FX - 17, -0.45, ZC + 2); plaza.receiveShadow = true; group.add(plaza);

  return { group, bellPivot, darkGlass, door, FX, ZC, TX, TZ, by, bh };
}

// =====================================================================
// Tatlong Krus model: three concrete crosses, bronze corpus on the centre cross
// =====================================================================
function buildCrosses() {
  const g = new THREE.Group();
  const conc = (() => { const c = canvas(128, 128), cg = c.getContext("2d"); cg.fillStyle = "#e9e3d3"; cg.fillRect(0, 0, 128, 128); for (let i = 0; i < 500; i++) { cg.fillStyle = `rgba(90,85,70,${Math.random() * 0.08})`; cg.fillRect(Math.random() * 128, Math.random() * 128, 2, 2 + Math.random() * 14); } const t = ctex(c, { repeat: true }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissive: 0xfff2d8, emissiveIntensity: 0 }); })();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x4f6b55, metalness: 0.75, roughness: 0.45 });
  const mk = (s) => {
    const c = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; c.add(o); return o; };
    add(new THREE.BoxGeometry(2.6, 0.6, 2.6), conc, 0, 0.3, 0);
    add(new THREE.BoxGeometry(1.8, 0.7, 1.8), conc, 0, 0.95, 0);
    add(new THREE.BoxGeometry(1.0, 0.5, 1.0), conc, 0, 1.55, 0);
    add(new THREE.BoxGeometry(0.55, 8.6 * s, 0.55), conc, 0, 1.8 + 4.3 * s, 0);
    add(new THREE.BoxGeometry(0.5, 0.5, 3.8 * s), conc, 0, 1.8 + 6.5 * s, 0);
    return { c, add };
  };
  const spacing = 9.5;
  for (const [z, s, corpus] of [[-spacing, 1, false], [0, 1.08, true], [spacing, 1, false]]) {
    const { c, add } = mk(s);
    c.position.z = z;
    if (corpus) {
      const top = 1.8 + 6.5 * s, x = -0.42;
      add(new THREE.CapsuleGeometry(0.2, 0.75, 6, 10), bronze, x, top - 1.05, 0);                 // torso
      add(new THREE.SphereGeometry(0.17, 12, 10), bronze, x - 0.05, top - 0.25, 0.08);            // head, bowed
      for (const sd of [-1, 1]) {
        const arm = add(new THREE.CapsuleGeometry(0.07, 1.25, 4, 8), bronze, x, top - 0.25, sd * 0.85);
        arm.rotation.x = sd * (Math.PI / 2 - 0.35);
      }
      const legs = add(new THREE.CapsuleGeometry(0.11, 1.35, 4, 8), bronze, x, top - 2.35, 0); legs.rotation.x = 0.05;
      add(new THREE.CylinderGeometry(0.24, 0.16, 0.45, 10), bronze, x, top - 1.6, 0);             // loincloth
    }
    g.add(c);
  }
  // signboard (generic lines, not readable text)
  const sc = canvas(128, 192), sg = sc.getContext("2d");
  sg.fillStyle = "#f7f5ef"; sg.fillRect(0, 0, 128, 192); sg.fillStyle = "#c23b2c"; sg.fillRect(40, 10, 48, 34);
  sg.fillStyle = "#333"; for (let y = 56; y < 184; y += 6) sg.fillRect(10, y, 108 - Math.random() * 20, 2);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), new THREE.MeshStandardMaterial({ map: ctex(sc), roughness: 0.6, side: THREE.DoubleSide }));
  board.position.set(-1.6, 2.2, -spacing - 3.2); board.rotation.y = -Math.PI / 2; g.add(board);
  for (const dz of [-0.7, 0.7]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), conc); post.position.set(-1.55, 1.3, -spacing - 3.2 + dz); g.add(post); }
  return { group: g, conc };
}
function clearing(center, radius) {
  const geo = new THREE.CircleGeometry(radius, 64, 0, Math.PI * 2); geo.rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(0.01, radius, 64, 12); ring.rotateX(-Math.PI / 2);
  const p = ring.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + center.x, z = p.getZ(i) + center.z; p.setY(i, W.heightAt(x, z) + 0.35); p.setX(i, x); p.setZ(i, z); }
  ring.computeVertexNormals();
  const c = canvas(256, 256), g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grd.addColorStop(0, "rgba(150,118,82,1)"); grd.addColorStop(0.55, "rgba(122,128,72,1)"); grd.addColorStop(1, "rgba(98,120,60,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 120; g.fillStyle = `rgba(${60 + Math.random() * 60},${80 + Math.random() * 50},40,${Math.random() * 0.25})`; g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2, 4); }
  const uv = ring.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) - center.x) / (2 * radius) + 0.5, (p.getZ(i) - center.z) / (2 * radius) + 0.5);
  const m = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ map: ctex(c), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  m.receiveShadow = true;
  return m;
}

// =====================================================================
// HERO
// =====================================================================
function initHero() {
  const el = $("#hero-stage");
  const st = makeStage(el, { fov: 34, far: 120000, near: 5, exposure: 0.8, bloom: 0.25 });
  const world = buildWorld(st, { waterRes: 512 });
  const church = buildChurch(); st.scene.add(church.group);
  const crosses = buildCrosses(); crosses.group.position.copy(W.krus); st.scene.add(crosses.group);
  world.focus.set(0, 0, 0);
  world.setSun(19, 258);
  st.camera.position.set(-2350, 720, 1250);
  st.controls.target.set(420, 110, -60);
  st.controls.autoRotate = !REDUCED; st.controls.autoRotateSpeed = 0.18;
  st.controls.minPolarAngle = 0.75; st.controls.maxPolarAngle = 1.42;
  st.controls.minAzimuthAngle = -3.0; st.controls.maxAzimuthAngle = 0.2;
  st.controls.rotateSpeed = 0.6;
  let dirRot = 1, idle = 0, dragging = false;
  st.controls.addEventListener("start", () => { dragging = true; st.controls.autoRotate = false; $(".drag-hint", el).hidden = true; });
  st.controls.addEventListener("end", () => { dragging = false; idle = 0; });
  addTag(st, "Tatlong Krus", W.krus.clone().add(V3(0, 40, 0)));
  addTag(st, "Simbahan ng Paete", V3(-30, 50, 0));
  addTag(st, "Paete town", V3(-60, 30, -700));
  addTag(st, "Laguna de Bay", V3(-1500, 20, 400));
  const sem = W.json.sembrano; addTag(st, "Mt. Sembrano", V3(sem[0], W.heightAt(sem[0], sem[1]) + 80, sem[1]));
  addTag(st, "Sierra Madre", V3(2600, 600, 1200));
  st.update = (dt) => {
    world.update(dt);
    // sweep back and forth across the lake-side view
    if (!dragging && !st.controls.autoRotate && !REDUCED) { idle += dt; if (idle > 5) st.controls.autoRotate = true; }
    const az = st.controls.getAzimuthalAngle();
    if (az <= st.controls.minAzimuthAngle + 0.01) dirRot = -1; else if (az >= st.controls.maxAzimuthAngle - 0.01) dirRot = 1;
    st.controls.autoRotateSpeed = 0.18 * dirRot;
  };
  st.ready = true; stageMessage(el, "");
}

// =====================================================================
// CHURCH
// =====================================================================
function initChurch() {
  const el = $("#church-stage");
  const st = makeStage(el, { fov: 40, far: 120000, near: 0.5, shadows: true, exposure: 0.8, bloom: 0.3 });
  const { scene, camera, controls } = st;
  const world = buildWorld(st, { shadows: true, waterRes: 256 });
  const C = buildChurch(); scene.add(C.group);
  C.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const ground = W.heightAt(C.FX - 6, C.ZC);
  C.group.position.y = ground;
  world.focus.set(C.FX + 10, ground, C.ZC);
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.52; controls.minDistance = 14; controls.maxDistance = 120;

  // lamps on the plaza
  const lamps = [];
  for (const dz of [-13, 15]) {
    const x = C.FX - 7, z = C.ZC + dz, y = ground;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.5, metalness: 0.5 })); post.position.set(x, y + 2.1, z); scene.add(post);
    const bm = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc27a, emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), bm); bulb.position.set(x, y + 4.35, z); scene.add(bulb);
    const pl = new THREE.PointLight(0xffb866, 0, 40, 2); pl.position.set(x, y + 4.2, z); scene.add(pl);
    lamps.push({ bm, pl });
  }
  const flood = new THREE.SpotLight(0xffd29a, 0, 90, 0.45, 0.6, 1.2); flood.position.set(C.FX - 30, ground + 2, C.ZC); flood.target.position.set(C.FX, ground + 10, C.ZC); scene.add(flood, flood.target);

  const KEYS = [
    { at: 0.0, name: "Dawn", el: 2, az: 95 },
    { at: 0.22, name: "Morning", el: 32, az: 100 },
    { at: 0.45, name: "Noon", el: 78, az: 170 },
    { at: 0.68, name: "Afternoon", el: 30, az: 262 },
    { at: 0.86, name: "Dusk", el: 4, az: 268 },
    { at: 1.0, name: "Night", el: -16, az: 280 },
  ];
  const timeName = $("#church-time-name");
  let pendingT = null;
  function setTime(s) {
    let i = 0; while (i < KEYS.length - 2 && s > KEYS[i + 1].at) i++;
    const A = KEYS[i], B = KEYS[i + 1], k = sm((s - A.at) / (B.at - A.at));
    const elev = lerp(A.el, B.el, k), az = lerp(A.az, B.az, k);
    const night = sstep(0.86, 0.98, s);
    SCENE.churchNight = night;
    world.setSun(elev, az, { night });
    const glow = Math.max(night, 0.35 * sstep(0.78, 0.9, s));
    C.darkGlass.emissiveIntensity = 2.2 * glow;
    W.shared.wallMat.emissiveIntensity = 0;
    lamps.forEach((l) => { l.bm.emissiveIntensity = 6 * glow; l.pl.intensity = 260 * glow; });
    flood.intensity = 1600 * night;
    st.bloom.strength = lerp(0.2, 0.7, glow);
    timeName.textContent = (k < 0.5 ? A : B).name;
  }
  const timeEl = $("#church-time");
  timeEl.addEventListener("input", () => { pendingT = +timeEl.value; });
  setTime(+timeEl.value);

  const HOT = [
    { n: "1", t: "Carved façade", p: [C.FX - 0.4, 6.5, C.ZC - 4.6], cam: [C.FX - 14, 6, C.ZC - 9], d: "The façade is volcanic tuff, carved almost all over with scrolls, flowers and foliage in shallow relief. A frieze band divides the storeys." },
    { n: "2", t: "Santiago Matamoros", p: [C.FX - 0.4, 11.2, C.ZC], cam: [C.FX - 12, 11, C.ZC + 2], d: "Above the door, between two barred windows, is the image of the patron St. James the Apostle on horseback, as Santiago Matamoros." },
    { n: "3", t: "Pediment and oculus", p: [C.FX - 0.4, 15.4, C.ZC], cam: [C.FX - 16, 15, C.ZC - 3], d: "A triangular pediment, edged with carved stone curls, crowns the façade. A round window (oculus) sits above the image of the saint." },
    { n: "4", t: "Bell tower", p: [C.TX - 3.4, C.by + 2, C.TZ], cam: [C.FX - 22, 22, C.TZ + 14], d: "The bell tower rises beside the façade in stages ringed with balustrades and arched openings, under a red-tiled cap.", bells: true },
    { n: "5", t: "Buttresses", p: [-11, 6, C.ZC + 9.4], cam: [-4, 9, C.ZC + 34], d: "Large buttresses line both sides to help the walls resist earthquakes. Quakes damaged or destroyed the church in 1717, 1880 and 1937, and it was rebuilt each time." },
    { n: "6", t: "Inside: the murals", p: [-14, 8, C.ZC - 8.4], cam: [-10, 12, C.ZC - 34], d: "José Luciano Dans painted Langit, Lupa at Impiyerno (Heaven, Earth and Hell) using natural pigments mixed with volcanic ash. The church also keeps two San Cristobal paintings on wood panels and a Last Judgment mural from around 1720." },
  ];
  const card = document.createElement("div"); card.className = "card3d"; card.hidden = true; el.appendChild(card);
  const camGoal = { pos: null, tgt: null };
  const off = V3(0, ground, 0);
  const HOME = { pos: V3(C.FX - 46, ground + 7, C.ZC + 20), tgt: V3(C.FX + 4, ground + 10, C.ZC + 2) };
  camera.position.copy(HOME.pos); controls.target.copy(HOME.tgt);
  const hotEls = HOT.map((h) => {
    const L = addTag(st, h.n, V3(...h.p).add(off), "hotspot");
    L.el.type = "button"; L.el.setAttribute("aria-label", h.t);
    L.el.addEventListener("click", () => {
      hotEls.forEach((b) => b.classList.toggle("active", b === L.el));
      card.hidden = false;
      card.innerHTML = `<h3>${h.n} · ${h.t}</h3><p>${h.d}</p><div class="row">${h.bells ? '<button class="btn" type="button" data-act="bells">Ring the bells</button>' : ""}<button class="btn" type="button" data-act="close">Close</button></div>`;
      camGoal.pos = V3(...h.cam).add(off); camGoal.tgt = V3(...h.p).add(off);
    });
    return L.el;
  });
  card.addEventListener("click", (e) => {
    const a = e.target.dataset && e.target.dataset.act;
    if (a === "close") { card.hidden = true; hotEls.forEach((b) => b.classList.remove("active")); }
    if (a === "bells") ringBells();
  });
  $("#church-reset").addEventListener("click", () => { camGoal.pos = HOME.pos.clone(); camGoal.tgt = HOME.tgt.clone(); card.hidden = true; hotEls.forEach((b) => b.classList.remove("active")); });
  controls.addEventListener("start", () => { camGoal.pos = null; });

  let swing = 0, swingT = 0;
  function ringBells() {
    swing = 0.5; swingT = 0;
    if (!AU.on) setSound(true);
    if (!AU.ctx) return;
    const t0 = anow() + 0.05;
    [196, 233, 196, 233, 196].forEach((f, i) => SFX.bell(t0 + i * 1.15, f));
  }
  $("#church-bells").addEventListener("click", ringBells);

  const occRay = new THREE.Raycaster(), occMeshes = [];
  C.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) occMeshes.push(o); });
  let occT = 0;
  st.update = (dt) => {
    world.update(dt);
    occT += dt;
    if (occT > 0.2) {
      occT = 0;
      for (const L of st.labels) {
        const d = L.pos.distanceTo(camera.position);
        occRay.set(camera.position, L.pos.clone().sub(camera.position).normalize()); occRay.far = d - 0.8;
        L.el.classList.toggle("behind", occRay.intersectObjects(occMeshes, false).length > 0);
      }
    }
    if (pendingT !== null) { setTime(pendingT); pendingT = null; }
    if (camGoal.pos) {
      const k = 1 - Math.pow(0.02, dt);
      camera.position.lerp(camGoal.pos, k); controls.target.lerp(camGoal.tgt, k);
      if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal.pos = null;
    }
    if (swing > 0.001) { swingT += dt; C.bellPivot.rotation.x = swing * Math.sin(swingT * 5.5); swing *= Math.pow(0.86, dt * 4); }
    else C.bellPivot.rotation.x = 0;
  };
  st.ready = true; stageMessage(el, "");
}

// =====================================================================
// TATLONG KRUS
// =====================================================================
function initKrus() {
  const el = $("#krus-stage");
  const st = makeStage(el, { fov: 50, far: 120000, near: 0.5, shadows: true, exposure: 0.8, bloom: 0.3 });
  const { scene, camera, controls } = st;
  const world = buildWorld(st, { shadows: true, waterRes: 512 });
  const X = buildCrosses(); X.group.position.copy(W.krus).add(V3(0, -0.2, 0)); scene.add(X.group);
  scene.add(clearing(W.krus, 24));
  const church = buildChurch(); church.group.position.y = W.heightAt(church.FX - 6, church.ZC); scene.add(church.group);
  controls.enabled = false; controls.minPolarAngle = 0.2; controls.maxPolarAngle = 2.3;

  const path = W.shared.trailPath, fork = W.shared.forkIndex;
  const forkPos = path.getPointAt(fork);
  const forkTag = addTag(st, "Fork · about 300 steps", forkPos.clone().add(V3(0, 6, 0)));
  addTag(st, "Tatlong Krus", W.krus.clone().add(V3(0, 14, 0)));
  addTag(st, "Simbahan", V3(-20, W.heightAt(-20, 0) + 34, 0));
  addTag(st, "Laguna de Bay", V3(-1400, 20, 300));
  const sem = W.json.sembrano; addTag(st, "Mt. Sembrano", V3(sem[0], W.heightAt(sem[0], sem[1]) + 80, sem[1]));

  // walker
  const walker = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0xd8354d, roughness: 0.6 });
  const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.75, 4, 10), shirt); bodyM.position.y = 1.05;
  const legM = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.8 })); legM.position.y = 0.45;
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7 })); headM.position.y = 1.75;
  walker.add(bodyM, legM, headM); walker.traverse((o) => { o.castShadow = true; }); scene.add(walker);

  // pilgrims' candles
  const N = 260, cpos = new Float32Array(N * 3), ps = new Float32Array(N), off = [];
  seed = 77;
  for (let i = 0; i < N; i++) { ps[i] = rnd(); off.push([(rnd() - 0.5) * 1.6, 1.1 + rnd() * 0.4, (rnd() - 0.5) * 1.6]); }
  const cgeo = new THREE.BufferGeometry(); cgeo.setAttribute("position", new THREE.BufferAttribute(cpos, 3));
  const sprite = canvas(64, 64), sg = sprite.getContext("2d"), grd = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,240,200,1)"); grd.addColorStop(0.25, "rgba(255,190,90,0.8)"); grd.addColorStop(1, "rgba(255,140,40,0)");
  sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
  const cmat = new THREE.PointsMaterial({ size: 0.9, map: ctex(sprite), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xffffff });
  const candles = new THREE.Points(cgeo, cmat); candles.frustumCulled = false; scene.add(candles);
  const crossLights = [];
  for (const dz of [-9.5, 0, 9.5]) { const l = new THREE.PointLight(0xffd6a0, 0, 30, 2); l.position.copy(W.krus).add(V3(-4, 3, dz)); scene.add(l); crossLights.push(l); }

  const climbEl = $("#krus-climb"), stepsEl = $("#krus-steps"), nightBtn = $("#krus-night"), lookBtn = $("#krus-look"), playBtn = $("#krus-play");
  let u = +climbEl.value, playing = false, night = 0, nightGoal = 0, look = false, lastNightApplied = -1;
  const endPos = W.krus.clone().add(V3(34, 17, 2));
  const endLook = W.krus.clone().add(V3(-700, -230, 0));
  const tA = V3(), tB = V3();
  function camAt(uu) {
    const here = path.getPointAt(clamp(uu, 0, 0.999), tA).clone();
    walker.position.copy(here).add(V3(0, -0.25, 0));
    const ahead = path.getPointAt(clamp(uu + 0.02, 0, 1), tB).clone();
    walker.lookAt(ahead.x, walker.position.y, ahead.z);
    const dir = ahead.clone().sub(here); dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
    // drone view from behind and out to the downhill (lake) side
    const side = V3(-dir.z, 0, dir.x); if (side.x > 0) side.negate();
    const p = here.clone().addScaledVector(dir, -20).addScaledVector(side, 16).add(V3(0, 16, 0));
    p.y = Math.max(p.y, W.heightAt(p.x, p.z) + 10, here.y + 12);
    const look = path.getPointAt(clamp(uu + 0.05, 0, 1), tB).clone().lerp(here, 0.5).add(V3(0, 1, 0));
    const w = sstep(0.9, 1, uu);
    p.lerp(endPos, w); look.lerp(endLook, w);
    return { p, look };
  }
  function stepsText(uu) {
    const s = uu < fork ? (uu / fork) * 300 : 300 + ((uu - fork) / (1 - fork)) * 700;
    if (uu >= 0.995) return "Summit · about 1,000 steps";
    if (Math.abs(uu - fork) < 0.02) return "Fork · about 300 steps · side trail to Matabungka Falls";
    return `Step ${(Math.round(s / 10) * 10).toLocaleString("en-US")} of about 1,000 · ${Math.round(path.getPointAt(clamp(uu, 0, 1)).y)} m up`;
  }
  let stepT = 0, lastStepU = 0;
  function setU(v) { u = clamp(v, 0, 1); SCENE.krusU = u; climbEl.value = u; stepsEl.textContent = stepsText(u); forkTag.hidden = u > fork + 0.08; }
  climbEl.addEventListener("input", () => { playing = false; playBtn.textContent = "Play climb"; setLook(false); setU(+climbEl.value); });
  playBtn.addEventListener("click", () => { playing = !playing; if (playing && u >= 1) setU(0); playBtn.textContent = playing ? "Pause" : "Play climb"; setLook(false); });
  nightBtn.addEventListener("click", () => { SFX.click(); nightGoal = nightGoal ? 0 : 1; nightBtn.setAttribute("aria-pressed", String(!!nightGoal)); });
  function setLook(on) {
    look = on; lookBtn.setAttribute("aria-pressed", String(on)); controls.enabled = on;
    if (on) { const d = controls.target.clone().sub(camera.position).normalize(); controls.target.copy(camera.position).addScaledVector(d, 0.6); }
  }
  lookBtn.addEventListener("click", () => setLook(!look));
  setU(u);
  { const { p, look: lk } = camAt(u); camera.position.copy(p); controls.target.copy(lk); }

  st.update = (dt, t) => {
    world.update(dt);
    if (playing) { setU(u + dt / 32); if (u >= 1) { playing = false; playBtn.textContent = "Play climb"; } }
    stepT -= dt;
    if (Math.abs(u - lastStepU) > 0.0004 && stepT <= 0 && u < 0.995) { SFX.step(); stepT = 0.42; }
    lastStepU = u;
    if (!look) {
      const { p, look: lk } = camAt(u), k = 1 - Math.pow(0.002, dt);
      camera.position.lerp(p, k); controls.target.lerp(lk, k);
    }
    world.focus.copy(u > 0.92 ? W.krus : walker.position); world.placeSun();
    night = lerp(night, nightGoal, 1 - Math.pow(0.04, dt));
    SCENE.krusNight = night;
    const nq = Math.round(night * 40) / 40;
    if (nq !== lastNightApplied) {
      lastNightApplied = nq;
      world.setSun(lerp(16, -18, nq), lerp(258, 275, nq), { night: nq });
      W.shared.wallMat.emissiveIntensity = 0;
      X.conc.emissiveIntensity = 0.03 * nq;
      crossLights.forEach((l) => (l.intensity = 45 * nq));
      st.bloom.strength = lerp(0.2, 0.5, nq);
    }
    cmat.opacity = night * (0.85 + 0.15 * Math.sin(t * 13));
    if (night > 0.02) {
      for (let i = 0; i < N; i++) {
        ps[i] += dt * 0.004; if (ps[i] > 0.99) ps[i] = 0;
        path.getPointAt(ps[i], tA);
        cpos[i * 3] = tA.x + off[i][0]; cpos[i * 3 + 1] = tA.y + off[i][1]; cpos[i * 3 + 2] = tA.z + off[i][2];
      }
      cgeo.attributes.position.needsUpdate = true;
    }
  };
  st.ready = true; stageMessage(el, "");
}

// =====================================================================
// UKIT (interactive relief carving)
// =====================================================================
async function initUkit() {
  const el = $("#ukit-stage");
  const st = makeStage(el, { fov: 34, exposure: 1.0, ao: 1.0, maxPR: 1.75 });
  const { scene, camera, controls, renderer } = st;
  scene.background = new THREE.Color(0x1b130d);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  camera.position.set(1.4, 0.5, 7.4); controls.target.set(0, 0, 0); controls.enabled = false;
  controls.minPolarAngle = 0.6; controls.maxPolarAngle = 2.3; controls.minAzimuthAngle = -1.2; controls.maxAzimuthAngle = 1.2;

  const Wd = 384, Hd = 480, PW = 3.2, PH = 4.0;
  try { await document.fonts.load('76px "Gloock"'); await document.fonts.load('500 18px "DM Mono"'); } catch (e) { /* fallback fonts */ }
  const dc = canvas(Wd, Hd), g = dc.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, Wd, Hd);
  g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineJoin = "round"; g.lineCap = "round";
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.lineWidth = 22; rr(22, 22, Wd - 44, Hd - 44, 16); g.stroke();
  g.lineWidth = 4; rr(48, 48, Wd - 96, Hd - 96, 8); g.stroke();
  const cx = 192, cy = 158;
  for (let i = 0; i < 8; i++) { g.save(); g.translate(cx, cy); g.rotate(i * Math.PI / 4); g.beginPath(); g.ellipse(0, -44, 16, 34, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  for (const side of [-1, 1]) {
    g.lineWidth = 7; g.beginPath(); g.moveTo(cx + side * 66, cy + 34); g.bezierCurveTo(cx + side * 118, cy + 76, cx + side * 150, cy - 6, cx + side * 122, cy - 78); g.stroke();
    for (const [lx, ly, a] of [[132, 52, 0.9], [146, -18, 0.2], [112, -62, -0.5], [100, 66, 1.6]]) { g.save(); g.translate(cx + side * lx, cy + ly); g.rotate(side * a); g.beginPath(); g.ellipse(0, 0, 9, 19, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  }
  g.strokeStyle = "#000"; g.lineWidth = 2.6;
  for (let i = 0; i < 8; i++) { g.save(); g.translate(cx, cy); g.rotate(i * Math.PI / 4); g.beginPath(); g.moveTo(0, -24); g.lineTo(0, -68); g.stroke(); g.restore(); }
  g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, 25, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, cy, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#000"; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, 2.6, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.font = '76px "Gloock", Georgia, serif'; g.fillText("PAETE", cx, 326);
  g.font = '500 18px "DM Mono", monospace'; g.fillText("U K I T  ·  L A G U N A", cx, 364);
  for (let x = 84; x <= 300; x += 27) { g.beginPath(); g.arc(x, 408, 10, 0, Math.PI * 2); g.fill(); }
  const dd = g.getImageData(0, 0, Wd, Hd).data;
  let m = new Float32Array(Wd * Hd);
  for (let i = 0; i < Wd * Hd; i++) m[i] = dd[i * 4] / 255;
  const blur = (a, r) => {
    const o = new Float32Array(Wd * Hd);
    for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < Wd) { s += a[y * Wd + xx]; n++; } } o[y * Wd + x] = s / n; }
    const o2 = new Float32Array(Wd * Hd);
    for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < Hd) { s += o[yy * Wd + x]; n++; } } o2[y * Wd + x] = s / n; }
    return o2;
  };
  m = blur(blur(m, 1), 1);
  const T = new Float32Array(Wd * Hd), Hh = new Float32Array(Wd * Hd), grain = new Float32Array(Wd * Hd);
  for (let i = 0; i < Wd * Hd; i++) T[i] = 0.3 + 0.7 * m[i];
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) grain[y * Wd + x] = clamp(0.5 + 0.5 * Math.sin((x * 0.13 + fbm(x * 0.012, y * 0.004, 4, 3) * 10) * 2.0) * 0.8 + (vnoise(x * 0.8, y * 0.03, 9) - 0.5) * 0.3, 0, 1);
  const bgIdx = []; for (let i = 0; i < Wd * Hd; i += 3) if (T[i] < 0.5) bgIdx.push(i);
  const hc = canvas(Wd, Hd), hctx = hc.getContext("2d"), hImg = hctx.createImageData(Wd, Hd);
  const cc = canvas(Wd, Hd), cctx = cc.getContext("2d"), cImg = cctx.createImageData(Wd, Hd);
  let varnish = 0;
  function shade(i) {
    const h = Hh[i], gr = grain[i], carved = sm((0.985 - h) / 0.12), ds = 0.72 + 0.28 * h;
    let r = lerp(0.70 + 0.10 * gr, (0.92 + 0.06 * gr) * ds, carved), gg = lerp(0.50 + 0.08 * gr, (0.75 + 0.06 * gr) * ds, carved), b = lerp(0.33 + 0.05 * gr, (0.53 + 0.05 * gr) * ds, carved);
    if (varnish > 0) { const dv = 0.5 + 0.5 * h; r = lerp(r, (0.47 + 0.14 * gr) * dv, varnish); gg = lerp(gg, (0.25 + 0.08 * gr) * dv, varnish); b = lerp(b, (0.12 + 0.04 * gr) * dv, varnish); }
    const j = i * 4;
    cImg.data[j] = r * 255; cImg.data[j + 1] = gg * 255; cImg.data[j + 2] = b * 255; cImg.data[j + 3] = 255;
    const hv = h * 255; hImg.data[j] = hImg.data[j + 1] = hImg.data[j + 2] = hv; hImg.data[j + 3] = 255;
  }
  function resetBlock() { Hh.fill(1); for (let i = 0; i < Wd * Hd; i++) shade(i); hctx.putImageData(hImg, 0, 0); cctx.putImageData(cImg, 0, 0); }
  resetBlock();
  const hTex = ctex(hc, { srgb: false }), cTex = ctex(cc);
  const mat = new THREE.MeshStandardMaterial({ map: cTex, displacementMap: hTex, displacementScale: 0.26, displacementBias: -0.26, bumpMap: hTex, bumpScale: 2.5, roughness: 0.72 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH, 256, 320), mat);
  const sideMat = new THREE.MeshStandardMaterial({ map: ctex(woodCanvas(256, 256, [120, 78, 46], [170, 120, 76], 7)), roughness: 0.8 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 0.6), [sideMat, sideMat, sideMat, sideMat, new THREE.MeshBasicMaterial({ visible: false }), sideMat]);
  block.position.z = -0.3;
  const board = new THREE.Group(); board.add(plane, block); board.rotation.y = -0.16; scene.add(board);
  scene.add(new THREE.HemisphereLight(0xfff1de, 0x2a1a10, 0.8));
  const key = new THREE.DirectionalLight(0xffe2bd, 4.2); key.position.set(-4, 4.5, 3.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.9); rim.position.set(4, -2, 2); scene.add(rim);

  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 1, roughness: 0.25 });
  const chisel = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.025), metal); blade.position.y = 0.25;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 16), metal); ferrule.position.y = 0.54;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.45 })); handle.position.y = 1.03;
  chisel.add(blade, ferrule, handle); chisel.visible = false; scene.add(chisel);
  const shavGeo = new THREE.TorusGeometry(0.05, 0.014, 4, 10, Math.PI * 1.4), shavMat = new THREE.MeshStandardMaterial({ color: 0xe6c79c, roughness: 0.8 });
  const shavings = [];
  for (let i = 0; i < 70; i++) { const s = new THREE.Mesh(shavGeo, shavMat); s.visible = false; scene.add(s); shavings.push({ m: s, v: V3(), life: 0 }); }
  let shavI = 0;
  const spawnShaving = (p) => { const s = shavings[shavI++ % shavings.length]; s.m.position.copy(p); s.m.visible = true; s.life = 1.1; s.v.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, 0.6 + Math.random() * 0.8); s.m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); };
  let dirty = null;
  function stamp(px, py, r = 15, str = 0.2) {
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(Wd - 1, Math.ceil(px + r)), y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(Hd - 1, Math.ceil(py + r));
    let removed = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - px, y - py) / r; if (d >= 1) continue;
      const i = y * Wd + x, before = Hh[i];
      Hh[i] = Math.max(T[i], before - str * (1 - d * d));
      if (Hh[i] !== before) { removed += before - Hh[i]; shade(i); }
    }
    if (!dirty) dirty = { x0, y0, x1, y1 }; else { dirty.x0 = Math.min(dirty.x0, x0); dirty.y0 = Math.min(dirty.y0, y0); dirty.x1 = Math.max(dirty.x1, x1); dirty.y1 = Math.max(dirty.y1, y1); }
    return removed;
  }
  function flush() {
    if (!dirty) return;
    const { x0, y0, x1, y1 } = dirty;
    hctx.putImageData(hImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1); cctx.putImageData(cImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    hTex.needsUpdate = cTex.needsUpdate = true; dirty = null;
  }
  const localToWorld = (px, py) => plane.localToWorld(V3((px / Wd - 0.5) * PW, (0.5 - py / Hd) * PH, 0));
  const progEl = $("#ukit-progress"), varnishBtn = $("#ukit-varnish");
  function progress() {
    let done = 0; for (const i of bgIdx) if (Hh[i] - T[i] < 0.08) done++;
    const pct = Math.round((done / bgIdx.length) * 100);
    progEl.textContent = pct >= 98 ? "Carved 100% · finished" : `Carved ${pct}%`;
    varnishBtn.hidden = pct < 85 || varnish > 0;
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let mode = "chisel", down = false, last = null, tap = 0, autoRun = false, autoX = 40, autoY = 40, autoDir = 1, varnishT = -1;
  const hit = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObject(plane)[0];
    return h ? { px: h.uv.x * Wd, py: (1 - h.uv.y) * Hd, p: h.point } : null;
  };
  const placeChisel = (p) => { chisel.visible = true; chisel.position.copy(p); chisel.position.y += tap * 0.04; chisel.rotation.set(0.95, -0.16, 0.38); };
  const cvs = renderer.domElement;
  cvs.addEventListener("pointerdown", (e) => {
    if (mode !== "chisel") return;
    const h = hit(e); if (!h) return;
    down = true; last = h; cvs.setPointerCapture(e.pointerId); autoRun = false;
    SFX.knock(1, 0.35);
    if (stamp(h.px, h.py) > 0.5) spawnShaving(h.p);
    placeChisel(h.p); tap = 1;
  });
  cvs.addEventListener("pointermove", (e) => {
    if (mode !== "chisel") return;
    const h = hit(e);
    if (!h) { if (!down) chisel.visible = false; return; }
    placeChisel(h.p);
    if (!down || !last) return;
    const dist = Math.hypot(h.px - last.px, h.py - last.py), n = Math.max(1, Math.ceil(dist / 4));
    let removed = 0;
    for (let k = 1; k <= n; k++) removed += stamp(lerp(last.px, h.px, k / n), lerp(last.py, h.py, k / n));
    if (removed > 0.8 && Math.random() < 0.7) spawnShaving(h.p);
    if (removed > 0.2 && performance.now() - lastScrape > 70) { lastScrape = performance.now(); SFX.scrape(); }
    tap = 1; last = h;
  });
  let lastScrape = 0, autoTap = 0;
  const end = () => { down = false; last = null; progress(); };
  cvs.addEventListener("pointerup", end); cvs.addEventListener("pointercancel", end);
  cvs.addEventListener("pointerleave", () => { if (!down) chisel.visible = false; });
  $("#ukit-auto").addEventListener("click", () => { autoRun = true; if (autoY > 445) { autoY = 40; autoX = 40; autoDir = 1; } });
  $("#ukit-reset").addEventListener("click", () => { SFX.knock(0.55, 0.5); autoRun = false; autoY = 40; autoX = 40; autoDir = 1; varnish = 0; mat.roughness = 0.72; resetBlock(); hTex.needsUpdate = cTex.needsUpdate = true; progress(); });
  varnishBtn.addEventListener("click", () => { varnishT = 0; varnishBtn.hidden = true; SFX.brush(); SFX.brush(0.45); SFX.brush(0.9); });
  const setMode = (md) => {
    mode = md;
    $("#ukit-chisel").setAttribute("aria-pressed", String(md === "chisel")); $("#ukit-rotate").setAttribute("aria-pressed", String(md === "rotate"));
    controls.enabled = md === "rotate"; chisel.visible = false; cvs.style.cursor = md === "chisel" ? "crosshair" : "grab";
  };
  $("#ukit-chisel").addEventListener("click", () => setMode("chisel"));
  $("#ukit-rotate").addEventListener("click", () => setMode("rotate"));
  setMode("chisel");
  let progT = 0;
  st.update = (dt) => {
    if (autoRun) {
      let removed = 0, lpx = autoX, lpy = autoY;
      for (let k = 0; k < 26 && autoRun; k++) {
        removed += stamp(autoX, autoY, 14, 0.5); lpx = autoX; lpy = autoY;
        autoX += 6 * autoDir;
        if (autoX > 344 || autoX < 40) { autoDir *= -1; autoX = clamp(autoX, 40, 344); autoY += 9; }
        if (autoY > 445) { autoRun = false; progress(); }
      }
      const p = localToWorld(lpx, lpy); placeChisel(p); tap = 1; if (removed > 1) spawnShaving(p);
      autoTap -= dt; if (autoTap <= 0) { autoTap = 0.17; if (removed > 0.5) { SFX.knock(1.15, 0.22); SFX.scrape(0.08); } }
    }
    if (varnishT >= 0) {
      varnishT = Math.min(1, varnishT + dt * 0.8); varnish = sm(varnishT); mat.roughness = lerp(0.72, 0.32, varnish);
      for (let i = 0; i < Wd * Hd; i++) shade(i);
      dirty = { x0: 0, y0: 0, x1: Wd - 1, y1: Hd - 1 };
      if (varnishT >= 1) { varnishT = -1; progEl.textContent = "Varnished · finished"; }
    }
    flush();
    tap = Math.max(0, tap - dt * 8);
    for (const s of shavings) { if (s.life <= 0) continue; s.life -= dt; s.v.y -= 4 * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotation.x += dt * 6; if (s.life <= 0) s.m.visible = false; }
    progT += dt; if (progT > 0.4 && (autoRun || down)) { progT = 0; progress(); }
  };
  st.ready = true;
}

// =====================================================================
// TAKA (papier-mâché horse, modelled on real Paete taka)
// =====================================================================
function makeHorse(mats, inflate = 1) {
  const g = new THREE.Group();
  const sph = new THREE.SphereGeometry(1, 56, 36);
  const add = (geo, mat, pos, rot = [0, 0, 0], scl = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot);
    m.scale.set(scl[0] * inflate, scl[1] * inflate, scl[2] * inflate); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  add(sph, mats.body, [0, 1.95, 0], [0, 0, 0], [1.45, 0.82, 0.74]);
  add(sph, mats.body, [0.92, 2.08, 0], [0, 0, 0.25], [0.76, 0.74, 0.68]);
  add(sph, mats.body, [-0.98, 2.02, 0], [0, 0, 0], [0.8, 0.78, 0.7]);
  add(new THREE.CylinderGeometry(0.42, 0.62, 1.55, 40), mats.body, [1.3, 2.9, 0], [0, 0, -0.38]);
  add(sph, mats.body, [1.72, 3.66, 0], [0, 0, -0.95], [0.62, 0.42, 0.38]);
  add(sph, mats.body, [2.02, 3.28, 0], [0, 0, -0.6], [0.38, 0.32, 0.31]);
  for (const z of [-0.16, 0.16]) add(new THREE.ConeGeometry(0.11, 0.38, 16), mats.body, [1.55, 4.12, z], [0, 0, -0.25]);
  for (const z of [-0.33, 0.33]) { add(new THREE.SphereGeometry(0.085, 14, 10), mats.eye, [1.92, 3.68, z]); add(new THREE.SphereGeometry(0.05, 10, 8), mats.mane, [1.97, 3.69, z * 1.06]); }
  const legGeo = new THREE.CylinderGeometry(0.25, 0.21, 1.3, 32);
  const hoofGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.26, 32);
  for (const [x, z, r] of [[0.95, 0.34, -0.06], [0.95, -0.34, -0.06], [-1.0, 0.34, 0.06], [-1.0, -0.34, 0.06]]) {
    add(legGeo, mats.leg, [x, 0.88, z], [0, 0, r]);
    add(hoofGeo, mats.mane, [x - r * 0.6, 0.13, z]);
  }
  for (let i = 0; i < 9; i++) { const t = i / 8; add(new THREE.SphereGeometry(0.24, 20, 14), mats.mane, [lerp(0.92, 1.58, t) - 0.18, lerp(2.95, 4.0, t) + 0.12, 0], [0, 0, 0], [1, 1.15, 0.55]); }
  add(new THREE.SphereGeometry(0.2, 16, 12), mats.mane, [1.8, 4.0, 0], [0, 0, 0], [1, 0.8, 0.6]);
  add(new THREE.ConeGeometry(0.26, 1.5, 20), mats.mane, [-1.9, 1.55, 0], [0, 0, -0.35]);
  return g;
}
function initTaka() {
  const el = $("#taka-stage");
  const st = makeStage(el, { fov: 36, shadows: true, clipping: true, exposure: 1.0, maxPR: 1.75 });
  const { scene, camera, controls, renderer } = st;
  scene.background = new THREE.Color(0x231710);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  camera.position.set(6.2, 4.4, 8.2); controls.target.set(0, 1.9, 0);
  controls.autoRotate = !REDUCED; controls.autoRotateSpeed = 1.0; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.5;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2516, 0.9));
  const key = new THREE.DirectionalLight(0xfff0dc, 4.0); key.position.set(4, 9, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -2, near: 1, far: 30 }); key.shadow.bias = -0.0008;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffc6a0, 1.2); fill.position.set(-6, 3, -4); scene.add(fill);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 64), new THREE.MeshStandardMaterial({ map: ctex(woodCanvas(256, 256, [70, 42, 24], [115, 74, 44], 2)), roughness: 0.6 }));
  table.position.y = -0.15; table.receiveShadow = true; scene.add(table);

  const woodMat = new THREE.MeshStandardMaterial({ map: ctex(woodCanvas(512, 512, [128, 82, 46], [190, 138, 88], 5)), roughness: 0.55, transparent: true });
  const pc = canvas(512, 512), pg = pc.getContext("2d");
  pg.fillStyle = "#b39470"; pg.fillRect(0, 0, 512, 512); seed = 5;
  for (let i = 0; i < 90; i++) {
    pg.save(); pg.translate(rnd() * 512, rnd() * 512); pg.rotate(rnd() * Math.PI);
    const w = 40 + rnd() * 90, h = 30 + rnd() * 60, news = rnd() < 0.45;
    pg.fillStyle = news ? "rgba(226,220,206,0.95)" : "rgba(160,124,86,0.95)"; pg.fillRect(-w / 2, -h / 2, w, h);
    if (news) { pg.fillStyle = "rgba(90,86,80,0.55)"; for (let yy = -h / 2 + 5; yy < h / 2 - 3; yy += 5) for (let xx = -w / 2 + 4; xx < w / 2 - 6; xx += 7 + rnd() * 9) pg.fillRect(xx, yy, 3 + rnd() * 6, 1.6); }
    pg.restore();
  }
  const paperTex = ctex(pc);
  const sideL = new THREE.Plane(V3(0, 0, -1), 0), sideR = new THREE.Plane(V3(0, 0, 1), 0);
  const buildPlane = new THREE.Plane(V3(0, -1, 0), 10), paintPlane = new THREE.Plane(V3(0, -1, 0), 10);
  const paperL = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 1, clippingPlanes: [sideL, buildPlane], side: THREE.DoubleSide });
  const paperR = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 1, clippingPlanes: [sideR, buildPlane], side: THREE.DoubleSide });
  const bodyC = canvas(1024, 512), legC = canvas(512, 256), bodyTex = ctex(bodyC), legTex = ctex(legC);
  const paintBody = new THREE.MeshPhysicalMaterial({ map: bodyTex, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, clippingPlanes: [paintPlane] });
  const paintLeg = new THREE.MeshPhysicalMaterial({ map: legTex, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, clippingPlanes: [paintPlane] });
  const paintMane = new THREE.MeshPhysicalMaterial({ color: 0x141210, roughness: 0.3, clearcoat: 0.7, clippingPlanes: [paintPlane] });
  const paintEye = new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.3, clippingPlanes: [paintPlane] });
  function paint(base) {
    const g = bodyC.getContext("2d"); seed = 9;
    g.fillStyle = base; g.fillRect(0, 0, 1024, 512);
    const light = ["#f2c230", "#f4efe6", "#ef6f9a"].includes(base);
    const line = light ? "#1d1a17" : "#fff7e8", acc1 = base === "#2f80c7" ? "#f2c230" : "#2f80c7", acc2 = "#2f9a52", acc3 = base === "#f2c230" ? "#d7263d" : "#f2c230";
    const medallion = (x, y, R) => {
      g.lineWidth = 6; g.strokeStyle = line;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.fillStyle = k % 2 ? acc1 : acc3; g.beginPath(); g.ellipse(x + Math.cos(a) * R * 0.55, y + Math.sin(a) * R * 0.55, R * 0.42, R * 0.2, a, 0, Math.PI * 2); g.fill(); g.stroke(); }
      g.fillStyle = acc2; g.beginPath(); g.arc(x, y, R * 0.28, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = line; for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * R * 1.12, y + Math.sin(a) * R * 1.12, 5, 0, Math.PI * 2); g.fill(); }
      for (const s of [-1, 1]) { g.fillStyle = acc2; g.beginPath(); g.ellipse(x + s * R * 1.5, y + R * 0.3, R * 0.45, R * 0.16, s * 0.4, 0, Math.PI * 2); g.fill(); g.stroke(); }
    };
    medallion(256, 250, 105); medallion(768, 250, 105);
    for (const yb of [118, 392]) { g.fillStyle = line; g.fillRect(0, yb, 1024, 7); g.fillStyle = acc3; for (let x = 8; x < 1024; x += 22) { g.beginPath(); g.arc(x, yb + 18, 6, 0, Math.PI * 2); g.fill(); } }
    for (let i = 0; i < 14; i++) { const x = 60 + rnd() * 900, y = 40 + rnd() * 60; g.fillStyle = rnd() < 0.5 ? acc1 : acc3; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.strokeStyle = line; g.lineWidth = 3; g.stroke(); }
    const lg = legC.getContext("2d");
    lg.fillStyle = base; lg.fillRect(0, 0, 512, 256);
    lg.fillStyle = line; lg.fillRect(0, 200, 512, 8); lg.fillRect(0, 30, 512, 6);
    lg.fillStyle = acc3; for (let x = 10; x < 512; x += 30) { lg.beginPath(); lg.arc(x, 120, 7, 0, Math.PI * 2); lg.fill(); }
    bodyTex.needsUpdate = legTex.needsUpdate = true;
  }
  paint("#d7263d");
  const wood = makeHorse({ body: woodMat, leg: woodMat, mane: woodMat, eye: woodMat }, 1);
  const halfL = makeHorse({ body: paperL, leg: paperL, mane: paperL, eye: paperL }, 1.03);
  const halfR = makeHorse({ body: paperR, leg: paperR, mane: paperR, eye: paperR }, 1.03);
  const painted = makeHorse({ body: paintBody, leg: paintLeg, mane: paintMane, eye: paintEye }, 1.04);
  const rig = new THREE.Group(); rig.add(wood, halfL, halfR, painted); rig.position.x = -0.1; scene.add(rig);

  const CAPS = [
    ["Takaan · the wooden mold", "A carver shapes the horse in wood, then coats it with wax or starch paste so the paper won't stick."],
    ["Paper layers", "Pieces of brown paper and newsprint are pasted on, layer over layer, then dried in the sun."],
    ["Cut and unmold", "The dry shell is slit open, the wooden form comes out to be used again, and the two halves are joined."],
    ["Paint", "Like the taka sold in Paete: a bright base coat, a black mane and hooves, and big painted flowers outlined in white. Pick a color."],
  ];
  const capEl = $("#taka-caption"), stepBtns = $$("[data-step]", el);
  let step = 0, u = 1, playAll = false, holdT = 0;
  const DURS = [1.2, 3.2, 4.2, 3.2];
  let cues = {};
  function goStep(n) {
    step = n; u = 0; cues = {};
    if (n === 0) SFX.knock(0.8, 0.4);
    if (n === 3) { SFX.brush(); SFX.brush(0.9); SFX.brush(1.8); }
    stepBtns.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.step === n)));
    capEl.innerHTML = `<b>Step ${n + 1} of 4 · ${CAPS[n][0]}</b>${CAPS[n][1]}`;
    $("#taka-colors").style.display = n === 3 ? "flex" : "none";
  }
  stepBtns.forEach((b) => b.addEventListener("click", () => { playAll = false; goStep(+b.dataset.step); }));
  $("#taka-play").addEventListener("click", () => { playAll = true; goStep(0); });
  const COLORS = [["Pula (red)", "#d7263d"], ["Rosas (pink)", "#ef6f9a"], ["Dilaw (yellow)", "#f2c230"], ["Asul (blue)", "#2f80c7"], ["Berde (green)", "#3aa76d"], ["Puti (white)", "#f4efe6"]];
  const colorsEl = $("#taka-colors");
  COLORS.forEach(([name, hex], i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.style.background = hex;
    b.setAttribute("aria-label", name); b.title = name; b.setAttribute("aria-pressed", String(i === 0));
    b.addEventListener("click", () => { SFX.click(); SFX.brush(); paint(hex); $$(".chip", colorsEl).forEach((c) => c.setAttribute("aria-pressed", String(c === b))); });
    colorsEl.appendChild(b);
  });
  function apply() {
    wood.visible = true; wood.position.y = 0; woodMat.opacity = 1;
    halfL.visible = halfR.visible = false; halfL.position.z = halfR.position.z = 0;
    painted.visible = false; buildPlane.constant = 10; paintPlane.constant = 10;
    if (step === 0) { wood.position.y = (1 - sm(u)) * 0.6; woodMat.opacity = sm(u); }
    if (step >= 1) halfL.visible = halfR.visible = true;
    if (step === 1) buildPlane.constant = -0.1 + sm(u) * 4.6;
    if (step === 2) {
      const apart = 1.3 * sstep(0, 0.28, u) * (1 - sstep(0.68, 1, u));
      halfL.position.z = -apart; halfR.position.z = apart;
      wood.position.y = 6 * sstep(0.3, 0.62, u); woodMat.opacity = 1 - sstep(0.4, 0.62, u); wood.visible = u < 0.62;
    }
    if (step === 3) { wood.visible = false; painted.visible = true; paintPlane.constant = -0.1 + sm(u) * 4.6; if (u >= 1) halfL.visible = halfR.visible = false; }
  }
  goStep(0); u = 1;
  st.update = (dt) => {
    const hf = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const fit = Math.max(10.5, 3.2 / Math.tan(hf / 2));
    controls.minDistance = controls.maxDistance = fit;
    if (u < 1) {
      u = Math.min(1, u + dt / DURS[step]);
      const cue = (k, at, fn) => { if (u >= at && !cues[k]) { cues[k] = 1; fn(); } };
      if (step === 1) for (let k = 0; k < 5; k++) cue("r" + k, k * 0.2, () => SFX.rustle(7, 0.5, 0.09));
      if (step === 2) { cue("rip", 0.02, () => SFX.rip()); cue("lift", 0.34, () => SFX.knock(0.7, 0.3)); cue("join", 0.72, () => SFX.pop()); }
    }
    else if (playAll) { if (step < 3) { holdT += dt; if (holdT > 0.8) { holdT = 0; goStep(step + 1); } } else playAll = false; }
    apply();
  };
  st.ready = true;
}

// =====================================================================
// boot
// =====================================================================
function boot() {
  // Sound is on by default. Browsers only allow audio after a user gesture,
  // so it starts on the first click, tap or key press (or right away if allowed).
  const sb = $("#sound-toggle");
  if (sb) sb.addEventListener("click", () => { unlockArmed = false; setSound(!AU.on); });
  let unlockArmed = true;
  setSound(true);
  const unlock = (e) => {
    if (!unlockArmed || (sb && sb.contains(e.target))) return;
    unlockArmed = false;
    if (AU.on) setSound(true);
    ["pointerdown", "keydown", "touchend"].forEach((t) => removeEventListener(t, unlock, true));
  };
  ["pointerdown", "keydown", "touchend"].forEach((t) => addEventListener(t, unlock, true));
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) { $$(".stage").forEach((el) => stageMessage(el, "These 3D scenes need WebGL 2, which is turned off or unsupported in this browser.")); return; }
  ["#hero-stage", "#church-stage", "#krus-stage"].forEach((s) => stageMessage($(s), "Loading real terrain, imagery and map data…"));
  initUkit();
  initTaka();
  requestAnimationFrame((n) => { lastT = n; tick(n); });
  loadWorld().then(() => {
    // stagger the heavy world scenes so the page stays responsive
    initHero();
    setTimeout(initChurch, 60);
    setTimeout(initKrus, 120);
  }).catch((e) => {
    console.error(e);
    ["#hero-stage", "#church-stage", "#krus-stage"].forEach((s) => stageMessage($(s), "The map data couldn't load. Reload the page to try again."));
  });
}
boot();
