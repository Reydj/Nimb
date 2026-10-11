// Generates the After Effects build script (ae/build_short.jsx), the SVG assets
// (ae/svg/*.svg) and the footage folder (ae/footage) from the same timeline
// the web version uses.
//
//   node ae/build.mjs [--channel "@name"]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));

// ------------------------------------------------------------------ measure in the browser
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.otf': 'font/otf' }[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
const q = new URLSearchParams({ render: '1' });
if (args.channel) q.set('channel', args.channel);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${q}`);
await page.waitForFunction('window.SHORT_READY === true');
const X = await page.evaluate(() => SHORT.exportData(document.getElementById('c').getContext('2d')));
const EMOJI = { '🙂': 'emoji-smile.png', '👋': 'emoji-wave.png' };
const emojiPng = {};
for (const [ch, file] of Object.entries(EMOJI)) {
  emojiPng[file] = await page.evaluate(ch => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.font = '108px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 64, 70);
    return c.toDataURL('image/png');
  }, ch);
}
await browser.close(); server.close();

// ------------------------------------------------------------------ helpers
const { COL } = A;
const D = X.DURATION, WIN = X.WIN;
const r3 = x => Math.round(x * 1000) / 1000;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eOut = k => 1 - Math.pow(1 - k, 3);
const eIn = k => k * k * k;
const BL = size => size * 0.355; // canvas "middle" -> AE baseline offset

// keys: [t, v, easeIn|null, easeOut|null, hold]
const KE = (t, v, i = 75, o = 75) => [r3(t), v, i, o, 0];
const KL = (t, v) => [r3(t), v, null, null, 0];
const KH = (t, v) => [r3(t), v, null, null, 1];
const outM = (t0, t1, v0, v1) => [[r3(t0), v0, 75, null, 0], [r3(t1), v1, 90, 75, 0]];   // fast start, soft landing
const inM = (t0, t1, v0, v1) => [[r3(t0), v0, 75, 90, 0], [r3(t1), v1, null, 75, 0]];    // soft start, fast end
const ioM = (t0, t1, v0, v1) => [KE(t0, v0), KE(t1, v1)];
const pop = (t, s = 100, dur = 0.42, from = 0.35, over = 1.08) => [KL(t, s * from), KE(t + dur * 0.6, s * over, 85, 60), KE(t + dur, s, 60, 75)];
const fadeIn = (t, d = 0.15) => [KL(t, 0), KE(t + d, 100, 85, 75)];
function merge(...lists) {
  const all = lists.flat().filter(Boolean).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const k of all) { if (out.length && Math.abs(out[out.length - 1][0] - k[0]) < 1e-3) out[out.length - 1] = k; else out.push(k); }
  return out;
}
function sampled(f, a, b, step = 1 / 10, thin = 0.002) {
  const ks = []; let last = null;
  for (let t = a; t <= b + 1e-6; t += step) {
    const v = f(t);
    if (last === null || Math.abs(v - last) > thin || t + step > b) ks.push(KL(t, typeof v === 'number' ? +v.toFixed(3) : v));
    last = v;
  }
  return ks;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0; let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const F = A.FONTS;
const txt = (text, font, size, fill = '#FFFFFF', o = {}) => ({ text, font: F[font].ps, size, fill, ...o });
const shadow = (op = 140, dist = 8, soft = 26) => ({ m: 'ADBE Drop Shadow', p: { 1: '#000000', 2: op, 3: 180, 4: dist, 5: soft } });
const blur = px => ({ m: 'ADBE Gaussian Blur 2', p: { 1: px, 3: 1 } });
const FOOT = [];
const foot = (id, path) => { if (!FOOT.find(f => f.id === id)) FOOT.push({ id, path }); return id; };

// ------------------------------------------------------------------ chat window
const G = (() => {
  const { x, y, w, h } = WIN, hh = 112, ih = 92;
  const ix = x + 24, iw = w - 48, iy = y + h - 24 - ih;
  const top = y + hh + 6, bottom = iy - 18, x0 = x + 28, x1 = x + w - 28;
  return { x, y, w, h, hh, ih, ix, iw, iy, top, bottom, x0, x1, areaH: bottom - top + 12 };
})();

function stack(msgs, t) {
  const vis = msgs.map((m, i) => ({ m, i })).filter(({ m }) => t >= m.t - 1e-6 && !(m.until != null && t > m.until + 0.3));
  const res = {};
  let yb = G.bottom;
  for (let k = vis.length - 1; k >= 0; k--) {
    const { m, i } = vis[k];
    const p = prog(t, m.t, m.t + 0.42);
    let hEff = (m.h + 16) * eOut(p);
    if (m.until != null) hEff *= 1 - eOut(prog(t, m.until, m.until + 0.25));
    yb -= hEff;
    res[i] = yb;
  }
  return res;
}

function moodKeys(list) { // [[t, mood], ...]
  const g = {};
  for (const face of ['smile', 'calm', 'flat']) g['face_' + face] = { op: list.map(([t, m]) => KH(t, m === face ? 100 : 0)) };
  return g;
}

let uid = 0;
function messagesComp(id, name, msgs, o = {}) {
  const layers = [];
  const bursts = [];
  const events = [...new Set(msgs.flatMap(m => [m.t, m.t + 0.42, ...(m.until != null ? [m.until, m.until + 0.25] : [])]))].sort((a, b) => a - b);
  if (o.lockAt != null) layers.push({ type: 'solid', name: 'Dim after lock', color: '#0A0E1E', w: WIN.w, h: G.areaH, pos: [WIN.w / 2, G.areaH / 2], keys: { op: ioM(o.lockAt, o.lockAt + 0.5, 0, 55) } });
  const perMsg = [];
  msgs.forEach((m, i) => {
    const n = `${String(i + 1).padStart(2, '0')} ${m.side} ${m.kind}`;
    const user = m.side === 'user';
    const px = (user ? G.x1 : G.x0) - G.x;
    const ys = events.filter(t => t >= m.t).map(t => [t, stack(msgs, t)[i]]).filter(([, y]) => y != null);
    const posKeys = merge(ys.map(([t, y]) => [r3(t), [px, y + m.h - G.top], 85, 15, 0]));
    const scale = m.until != null ? merge(pop(m.t), ioM(m.until, m.until + 0.25, 100, 0)) : pop(m.t);
    const op = m.until != null ? merge(fadeIn(m.t), ioM(m.until, m.until + 0.25, 100, 0)) : fadeIn(m.t);
    const bub = `${n} bubble`;
    const extra = [];
    const textTop = -m.h + 21;
    if (m.kind === 'typing') {
      const dots = [0, 1, 2].map(k => A.group('dot ' + (k + 1), [A.ell(40 + k * 28, -m.h / 2, 9, 9, { fill: COL.accent })]));
      extra.push({ type: 'shape', name: `${n} dots`, parent: bub, prims: dots, anchor: [0, 0], pos: [0, 0], 'in': m.t, out: m.until + 0.3,
        gkeys: Object.fromEntries([0, 1, 2].map(k => ['dot ' + (k + 1), { xpos: `value + [0, -9 * Math.max(0, Math.sin(time * 9 - ${k} * 0.9))]` }])) });
    } else {
      const font = m.kind === 'angry' ? 'black' : m.kind === 'bye' ? 'black' : 'bold';
      const size = m.kind === 'angry' ? 46 : m.kind === 'bye' ? 66 : 39;
      const fill = m.kind === 'bye' ? COL.navy : '#FFFFFF';
      const tx = user ? -m.w + 34 : 34, ty = textTop + m.lh * 0.5 + 2 + BL(size);
      extra.push({ type: 'text', name: `${n} text`, parent: bub, text: txt(m.lines.join('\r'), font, size, fill, { leading: m.lh }), anchor: [0, 0], pos: [tx, ty], 'in': m.t,
        expr: m.kind === 'angry' ? { rot: 'wiggle(14, 2.5)' } : undefined });
      if (m.emoji) {
        const ly = textTop + m.lh * (m.lines.length - 0.5) + 2;
        extra.push({ type: 'footage', name: `${n} emoji`, parent: bub, footage: foot(EMOJI[m.emoji], 'footage/' + EMOJI[m.emoji]), pos: [tx + m.emojiX + size * 0.6, ly], scale: size * 1.2 / 128 * 100, 'in': m.t });
      }
      if (m.badge) {
        extra.push({ type: 'shape', name: `${n} badge`, parent: bub, prims: [A.ell(0, 0, 25, 25, { fill: COL.hl })], anchor: [0, 0], pos: [m.w + 4, -m.h + 6], keys: { scale: pop(m.t + 0.2, 100, 0.35, 0) }, 'in': m.t });
        extra.push({ type: 'text', name: `${n} badge number`, parent: `${n} badge`, text: txt(String(m.badge), 'black', 30, COL.navy, { just: 'center' }), anchor: [0, 0], pos: [0, BL(30) + 1], 'in': m.t });
      }
    }
    if (m.burst) {
      const yAt = stack(msgs, m.t + 0.42)[i];
      bursts.push({ m, x: (user ? G.x1 - m.w / 2 : G.x0 + m.w / 2), y: yAt + m.h / 2 });
    }
    perMsg.push([...extra, {
      type: 'shape', name: bub, prims: [A.group('bubble', A.bubble(m.kind, m.w, m.h), { x: user ? -m.w : 0, y: -m.h })],
      anchor: [0, 0], keys: { pos: posKeys, scale, op }, 'in': m.t, out: m.until != null ? m.until + 0.3 : undefined,
      effects: m.kind === 'angry' ? [{ m: 'ADBE Glo2', p: { 2: 60, 3: 22, 4: 0.5 } }] : m.kind === 'bye' ? [shadow(120, 0, 40)] : undefined,
    }]);
  });
  // newest message on top
  perMsg.reverse().forEach(ls => layers.push(...ls));
  return { comp: { id, name, w: WIN.w, h: G.areaH, dur: D, layers }, bursts };
}

// The chat window as its own precomp (comp space = act space), placed by one comp layer.
function chat(prefix, o) {
  const P = s => `${prefix} ${s}`;
  const mc = messagesComp(`${prefix}-msgs`, `${prefix} messages`, o.msgs, o);
  const layers = [...(o.top || [])];
  const par = {};
  if (o.header) layers.push(...o.header);
  const status = { type: 'text', name: P('status'), ...par, text: txt(o.status || 'online', 'semi', 24, '#FFFFFF', { keys: o.statusKeys }), op: 55, pos: [G.x + 152, G.y + 81 + BL(24)] };
  layers.push(status);
  layers.push({ type: 'shape', name: P('status dot'), ...par, prims: [A.group('dot', [A.ell(0, 0, 6, 6, { fill: COL.accent })])], anchor: [0, 0], pos: [G.x + 136, G.y + 80],
    gkeys: o.lockAt != null ? { dot: { fill: [KH(0, COL.accent), KH(o.lockAt, '#7D849C')] } } : undefined });
  layers.push({ type: 'text', name: P('title'), ...par, text: txt(o.title || 'AI Assistant', 'bold', 34), pos: [G.x + 128, G.y + 44 + BL(34)] });
  layers.push({ type: 'shape', name: P('avatar'), ...par, prims: A.bot(33), anchor: [0, 0], pos: [G.x + 72, G.y + G.hh / 2 + 6], gkeys: moodKeys(o.mood) });
  // input row
  const IN = P('INPUT');
  const icy = G.iy + G.ih / 2;
  const lk = o.lockAt != null ? [o.lockAt + 0.9, o.lockAt + 1.3] : null;
  if (lk) {
    layers.push({ type: 'text', name: P('chat ended label'), parent: IN, text: txt('This chat has ended', 'bold', 32, '#FFFFFF'), op: 75, pos: [G.ix + 96, icy + 1 + BL(32)], keys: { op: ioM(lk[0], lk[1], 0, 75) } });
    layers.push({ type: 'shape', name: P('chat ended lock'), parent: IN, prims: A.lock('#FFFFFF'), anchor: [0, 0], pos: [G.ix + 58, icy - 6], scale: 36, keys: { op: ioM(lk[0], lk[1], 0, 75) } });
    layers.push({ type: 'shape', name: P('send attempt flash'), parent: IN, prims: [A.rect(G.ix, G.iy, G.iw, G.ih, G.ih / 2, { stroke: COL.warn, sw: 3 })], anchor: [0, 0], pos: [0, 0], keys: { op: [KH(0, 0), KL(o.trySend, 100), KL(o.trySend + 0.6, 0)] } });
  }
  if (o.caret) layers.push({ type: 'shape', name: P('caret'), parent: IN, prims: [A.rect(G.ix + 36, G.iy + 24, 3, G.ih - 48, 0, { fill: COL.accent })], anchor: [0, 0], pos: [0, 0], expr: { op: 'Math.floor(time * 2) % 2 == 0 ? 100 : 0' } });
  layers.push({ type: 'text', name: P('placeholder'), parent: IN, text: txt('Type a message…', 'semi', 32, '#FFFFFF'), op: 40, pos: [G.ix + 40, icy + 1 + BL(32)], keys: lk ? { op: ioM(lk[0], lk[1], 40, 0) } : undefined });
  layers.push({ type: 'shape', name: P('send button'), parent: IN, prims: A.sendButton(), anchor: [0, 0], pos: [G.ix + G.iw - G.ih / 2, icy],
    gkeys: lk ? { circle: { fill: [KH(0, COL.accent), KH(lk[0], '#5F6884')] } } : undefined });
  layers.push({ type: 'shape', name: P('input bar'), parent: IN, prims: [A.group('bar', [A.rect(G.ix, G.iy, G.iw, G.ih, G.ih / 2, { fill: '#FFFFFF', op: 7, stroke: '#FFFFFF', sw: 2.5, sop: 10 })])], anchor: [0, 0], pos: [0, 0],
    gkeys: lk ? { bar: { fill: ioM(lk[0], lk[1], '#FFFFFF', '#78809A'), fillOp: ioM(lk[0], lk[1], 7, 16) } } : undefined });
  layers.push({ type: 'null', name: IN, ...par, anchor: [540, icy], pos: [540, icy],
    expr: o.trySend != null ? { pos: `var t = time - ${r3(o.trySend)}; (t > 0 && t < 0.5) ? value + [Math.sin(t * 60) * 16 * (1 - t / 0.5), 0] : value` } : undefined });
  layers.push({ type: 'comp', name: P('messages'), comp: mc.comp.id, ...par, pos: [G.x + WIN.w / 2, G.top + G.areaH / 2] });
  layers.push({ type: 'shape', name: P('window'), ...par, prims: A.windowFrame(WIN.w, WIN.h).map(p => ({ ...p, x: p.x + G.x, y: p.y + G.y })), anchor: [0, 0], pos: [0, 0], effects: [shadow(140, 34, 90)] });
  const comp = { id: `${prefix}-chat`, name: `${prefix} chat window`, layers };
  return { comps: [mc.comp, comp], bursts: mc.bursts, layer: { type: 'comp', name: P('chat window'), comp: comp.id, anchor: [540, 745], pos: [540, 745], ...(o.nul || {}) } };
}

function burstLayers(bursts) {
  const out = [];
  const glyphs = '#@!$%&*?';
  for (const b of bursts) {
    const r = rng(b.m.seed * 13 + 5);
    for (let j = 0; j < 8; j++) {
      const ang = -Math.PI / 2 + (r() - 0.5) * 2.8, sp = 650 + r() * 550, size = Math.round(40 + r() * 38);
      const ch = glyphs[Math.floor(r() * glyphs.length)], col = [COL.warn, COL.hl, '#FFFFFF'][j % 3], spin = (r() - 0.5) * 8;
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp, t0 = b.m.t;
      out.push({
        type: 'text', name: `burst ${b.m.seed} ${j + 1}`, text: txt(ch, 'black', size, col, { just: 'center' }), anchor: [0, -BL(size)], 'in': t0, out: t0 + 1.2,
        pos: [b.x, b.y],
        expr: {
          pos: `var t = time - ${r3(t0)}; [${r3(b.x)} + ${r3(vx)} * t, ${r3(b.y)} + ${r3(vy)} * t + 1100 * t * t]`,
          rot: `(time - ${r3(t0)}) * ${r3(spin * 57.3)}`,
        },
        keys: { scale: outM(t0, t0 + 0.2, 40, 100), op: [KH(t0, 100), KL(t0 + 0.55, 100), KL(t0 + 1.2, 0)] },
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ acts
const comps = [];
const LS = X.LS, LE = X.LE;

function actA() {
  const [a, b] = X.ACTS.A;
  const moods = [[0, 'smile'], [LS.l2, 'calm'], [LS.l3 - 0.05, 'flat']];
  const ch = chat('A', { msgs: X.A_MSGS, mood: moods });
  comps.push(...ch.comps);
  const L = [];
  // floaters
  X.FLOATERS.forEach((f, i) => {
    const n = `angry floater ${i + 1}`;
    L.push({ type: 'text', name: n + ' text', parent: n, text: txt(f.text, 'black', 46, '#FFFFFF'), pos: [-f.w / 2 + 34, BL(46) + 2], expr: { rot: 'wiggle(14, 2.5)' } });
    L.push({ type: 'shape', name: n, prims: A.bubble('angry', f.w, f.h).map(p => ({ ...p, x: -f.w / 2, y: -f.h / 2 })), anchor: [0, 0], pos: [f.x, f.y], rot: f.r * 57.3, 'in': f.t,
      keys: { scale: merge(pop(f.t, f.s * 100, 0.32, 0, 1.08), [KL(b, f.s * 130)]) }, effects: [{ m: 'ADBE Glo2', p: { 2: 60, 3: 22, 4: 0.5 } }] });
  });
  // fist
  const T = X.FIST_T, t0 = T - 1.1;
  const fist = t => {
    if (t < T) {
      const k = prog(t, t0, T), wind = Math.sin(prog(t, t0, t0 + 0.5) * Math.PI) * 0.12;
      return { s: lerp(0.18, 1.55, eIn(k)) - wind, x: 540 + Math.sin(k * 3) * 30, y: 760 - Math.sin(k * Math.PI) * 40, rot: lerp(-0.4, 0, k), a: prog(t, t0, t0 + 0.2) };
    }
    const k = prog(t, T, T + 1.3);
    return { s: lerp(1.55, 0.7, eOut(k)), x: 540 + eOut(k) * 260, y: 740 - 300 * k + 1500 * k * k, rot: k * 2.4, a: 1 - prog(k, 0.7, 1) };
  };
  const ts = []; for (let t = t0; t < T; t += 0.1) ts.push(t); ts.push(T); for (let t = T + 0.1; t <= T + 1.3 + 1e-6; t += 0.1) ts.push(t);
  L.push({ type: 'shape', name: 'fist', prims: A.fist(), anchor: [0, 0], 'in': t0, out: T + 1.3,
    keys: { pos: ts.map(t => KL(t, [fist(t).x, fist(t).y])), scale: ts.map(t => KL(t, fist(t).s * 100)), rot: ts.map(t => KL(t, fist(t).rot * 57.3)), op: ts.map(t => KL(t, fist(t).a * 100)) } });
  // impact stars + shield rings + glass flash
  const stars = [];
  for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2 + 0.3; stars.push(A.group('star ' + (i + 1), A.star(), { x: Math.cos(an) * 170, y: Math.sin(an) * 170, rot: an * 57.3 })); }
  L.push({ type: 'shape', name: 'impact stars', prims: stars, anchor: [0, 0], pos: [540, 740], 'in': T, out: T + 0.45, keys: { scale: outM(T, T + 0.45, 100, 190), op: inM(T, T + 0.45, 100, 0) } });
  for (let i = 0; i < 3; i++) {
    const s = T + i * 0.08;
    L.push({ type: 'shape', name: 'shield ring ' + (i + 1), prims: [A.group('ring', [A.ell(0, 0, 60, 60, { stroke: COL.accent, sw: 12 })])], anchor: [0, 0], pos: [540, 740], 'in': s, out: s + 0.52,
      gkeys: { ring: { size: outM(s, s + 0.52, [120, 120], [1160, 1160]), sw: [KL(s, 12), KL(s + 0.52, 2)] } }, keys: { op: [KL(s, 90), KL(s + 0.52, 0)] } });
  }
  L.push({ type: 'shape', name: 'glass flash', prims: [A.rect(G.x, G.y, G.w, G.h, 46, { stroke: COL.accent, sw: 8 })], anchor: [0, 0], pos: [0, 0], 'in': T, out: T + 0.4, keys: { op: [KL(T, 35), KL(T + 0.35, 0)] } });
  L.push(...burstLayers(ch.bursts));
  L.push(ch.layer);
  return { id: 'actA', name: 'S1-S3 Insults & glitch', layers: L };
}

function actB() {
  const B = X.B;
  const L = [];
  const up = [B.tE - 0.25, B.tE + 0.35];
  const word = (name, text, col, t0, y0, y1) => ({
    type: 'text', name, text: txt(text, 'black', 136, col, { just: 'center' }), anchor: [0, -BL(136)], 'in': t0 - 0.05,
    keys: { pos: ioM(up[0], up[1], [540, y0], [540, y1]), scale: ioM(up[0], up[1], 100, 92 / 136 * 100) },
    reveal: { dy: 80, rot: 14, keys: outM(t0, t0 + text.length * 0.035 + 0.45, 0, 100) },
  });
  L.push(word('Anthropic', 'Anthropic', '#FFFFFF', B.tA, 600, 500));
  L.push(word('Claude', 'Claude', COL.accent, B.tC, 770, 606));
  L.push({ type: 'shape', name: 'connector', prims: [A.rect(-46, -2, 92, 4, 2, { fill: COL.accent })], anchor: [0, 0], op: 60, 'in': B.tC - 0.15,
    keys: { pos: ioM(up[0], up[1], [540, 686], [540, 553]), scale: merge(outM(B.tC - 0.15, B.tC + 0.3, [0, 100], [100, 100])) } });
  // End conversation button
  const BTN = 'END BUTTON', bw = 690, bh = 132;
  L.push({ type: 'text', name: 'End conversation label', parent: BTN, text: txt('End conversation', 'xbold', 52), pos: [540 - bw / 2 + 126, 770 + 3 + BL(52)] });
  L.push({ type: 'shape', name: 'End x icon', parent: BTN, prims: A.xIcon(), anchor: [0, 0], pos: [540 - bw / 2 + 74, 770] });
  L.push({ type: 'shape', name: 'End pill', parent: BTN, prims: [A.group('pill', A.pill(bw, bh, { fill: COL.warn, op: 22, stroke: COL.warn, sw: 4 }))], anchor: [0, 0], pos: [540, 770],
    gkeys: { pill: { fillOp: ioM(B.armAt, B.armAt + 0.3, 22, 92) } } });
  L.push({ type: 'shape', name: 'End glow', parent: BTN, prims: A.pill(bw, bh, { fill: COL.warn }), anchor: [0, 0], pos: [540, 770], effects: [blur(60)], keys: { op: ioM(B.armAt, B.armAt + 0.3, 30, 85) } });
  L.push({ type: 'null', name: BTN, anchor: [540, 770], pos: [540, 770], 'in': B.tE,
    keys: { scale: pop(B.tE, 100, 0.5, 0, 1.1) }, expr: { scale: `var t = time - ${r3(B.armAt)}; t > 0 ? value * (1 + 0.04 * Math.min(1, t / 0.3) * Math.sin(time * 9)) : value` } });
  L.push({ type: 'shape', name: 'End ripple', prims: A.pill(bw, bh, { stroke: COL.warn, sw: 4 }), anchor: [0, 0], pos: [540, 770], 'in': B.armAt, out: B.armAt + 0.7,
    keys: { scale: outM(B.armAt, B.armAt + 0.7, [100, 100], [112, 160]), op: [KL(B.armAt, 100), KL(B.armAt + 0.7, 0)] } });
  // severity meter
  const M = 'METER', x0 = 150, x1 = 930, y = 925, mh = 30, Lm = x1 - x0, thr = 0.8;
  const mk0 = B.tR - 0.7;
  const fillCol = f => {
    const mix = (c1, c2, k) => '#' + [1, 3, 5].map(i => Math.round(lerp(parseInt(c1.substr(i, 2), 16), parseInt(c2.substr(i, 2), 16), clamp(k))).toString(16).padStart(2, '0')).join('');
    return f < 0.55 ? mix(COL.accent, COL.hl, f / 0.55) : mix(COL.hl, COL.warn, (f - 0.55) / 0.3);
  };
  const fc = B.fillCurve.filter((_, i) => i % 2 === 0 || i === B.fillCurve.length - 1);
  L.push({ type: 'text', name: 'meter label', parent: M, text: txt('A B U S E   L E V E L', 'xbold', 26), op: 55, pos: [x0, y - 44 + BL(26)] });
  L.push({ type: 'text', name: 'meter mild', parent: M, text: txt('mild', 'xbold', 28), op: 50, pos: [x0, y + mh + 44 + BL(28)] });
  L.push({ type: 'text', name: 'meter extreme', parent: M, text: txt('extreme', 'xbold', 28, COL.warn, { just: 'right' }), pos: [x1, y + mh + 44 + BL(28)] });
  L.push({ type: 'shape', name: 'meter knob', parent: M, prims: [A.ell(0, 0, 22, 22, { fill: '#FFFFFF' })], anchor: [0, 0], keys: { pos: fc.map(([t, f]) => KL(t, [x0 + Lm * f, y + mh / 2])) } });
  L.push({ type: 'shape', name: 'meter threshold', parent: M, prims: [A.line([[0, -18], [0, mh + 18]], { stroke: '#FFFFFF', sw: 3, sop: 50 })], anchor: [0, 0], pos: [x0 + Lm * thr, y] });
  L.push({ type: 'shape', name: 'meter fill', parent: M, prims: [A.group('fill', [A.rect(0, 0, Lm, mh, mh / 2, { fill: COL.accent })])], anchor: [0, 0], pos: [x0, y],
    keys: { scale: fc.map(([t, f]) => KL(t, [Math.max(0.1, f * 100), 100])) }, gkeys: { fill: { fill: fc.filter((_, i) => i % 2 === 0).map(([t, f]) => KL(t, fillCol(f))) } } });
  L.push({ type: 'shape', name: 'meter track', parent: M, prims: [A.rect(x0, y, Lm, mh, mh / 2, { fill: '#FFFFFF', op: 8 }), A.rect(x0 + Lm * thr, y, Lm * (1 - thr), mh, mh / 2, { fill: COL.warn, op: 18 })], anchor: [0, 0], pos: [0, 0] });
  L.push({ type: 'null', name: M, anchor: [540, y], pos: [540, y], 'in': mk0, keys: { op: outM(mk0, mk0 + 0.5, 0, 100), pos: outM(mk0, mk0 + 0.5, [540, y + 40], [540, y]) } });
  return { id: 'actB', name: 'S4 Anthropic - End conversation', layers: L };
}

function actC() {
  const C = X.C;
  const moods = [[0, 'smile'], [C.lockAt, 'flat']];
  const badgeT = n => X.C_MSGS.find(m => m.badge === n).t + 0.2;
  const header = [];
  for (let i = 0; i < 3; i++) {
    const cx = G.x + G.w - 168 + i * 56, cy = G.y + G.hh / 2 + 4, bt = badgeT(i + 1);
    header.push({ type: 'text', name: `counter ${i + 1} number`, parent: `counter ${i + 1}`, text: txt(String(i + 1), 'black', 22, '#FFFFFF', { just: 'center', keys: undefined }), pos: [0, BL(22) + 1],
      keys: { op: [KH(0, 45), KH(bt + 0.15, 100)] } });
    header.push({ type: 'shape', name: `counter ${i + 1}`, parent: 'COUNTER', prims: [A.ell(0, 0, 20, 20, { stroke: '#FFFFFF', sw: 3, sop: 25 }), A.group('dot', [A.ell(0, 0, 20, 20, { fill: COL.hl })], { sc: 0 })], anchor: [0, 0], pos: [cx, cy],
      gkeys: { dot: { scale: pop(bt, 100, 0.35, 0) } } });
  }
  header.push({ type: 'null', name: 'COUNTER', anchor: [540, 745], pos: [540, 745], keys: { op: ioM(C.newShow - 0.4, C.newShow - 0.1, 100, 0) } });
  const bw = 236, bh = 66, nx = G.x + G.w - 40 - bw / 2, ny = G.y + G.hh / 2 + 4;
  header.push({ type: 'text', name: 'New chat label', parent: 'NEW CHAT BUTTON', text: txt('+  New chat', 'black', 30, COL.navy, { just: 'center' }), pos: [nx, ny + 2 + BL(30)] });
  header.push({ type: 'shape', name: 'New chat pill', parent: 'NEW CHAT BUTTON', prims: A.pill(bw, bh, { fill: COL.accent }), anchor: [0, 0], pos: [nx, ny] });
  header.push({ type: 'shape', name: 'New chat glow', parent: 'NEW CHAT BUTTON', prims: A.pill(bw, bh, { fill: COL.accent }), anchor: [0, 0], pos: [nx, ny], effects: [blur(30)],
    expr: { op: `(time > ${r3(C.newShow + 0.3)} && time < ${r3(C.press)}) ? 50 + 50 * Math.sin((time - ${r3(C.newShow)}) * 14) : 20` } });
  header.push({ type: 'null', name: 'NEW CHAT BUTTON', anchor: [nx, ny], pos: [nx, ny], 'in': C.newShow,
    keys: { scale: merge(pop(C.newShow, 100, 0.4, 0, 1.1), [KE(C.press, 100), KE(C.press + 0.1, 90), KE(C.press + 0.2, 100)]) } });
  const swapEnd = C.swap + 0.6;
  const old = chat('C', {
    msgs: X.C_MSGS, mood: moods, lockAt: C.lockAt, trySend: C.trySend, header, statusKeys: [[0, 'online'], [C.lockAt, 'chat ended']],
    nul: { out: swapEnd, keys: { pos: ioM(C.swap, swapEnd, [540, 745], [540 - 1150, 745]), rot: ioM(C.swap, swapEnd, 0, -2.9) } },
  });
  const neu = chat('C new', {
    msgs: X.C_NEW, mood: [[0, 'smile']], status: 'new chat', caret: true,
    nul: { 'in': C.swap, keys: { op: outM(C.swap + 0.15, C.swap + 0.6, 0, 100), scale: outM(C.swap + 0.15, C.swap + 0.6, 85, 100) } },
  });
  comps.push(...old.comps, ...neu.comps);
  const L = [];
  // lock stamp
  const lk = C.lockAt;
  L.push({ type: 'shape', name: 'lock stamp', prims: [A.ell(0, 0, 118, 118, { fill: '#0E1325', op: 92, stroke: COL.warn, sw: 7 }), A.group('lock', A.lock(COL.warn), { y: -8 })], anchor: [0, 0], 'in': lk, out: lk + 1.6,
    keys: { scale: merge(pop(lk, 100, 0.4, 0, 1.08), ioM(lk + 1.0, lk + 1.5, 100, 25)), pos: ioM(lk + 1.0, lk + 1.5, [540, 720], [G.x + 82, G.y + G.h - 70]), op: [KH(lk, 100), KL(lk + 1.35, 100), KL(lk + 1.55, 0)] },
    effects: [{ m: 'ADBE Drop Shadow', p: { 1: COL.warn, 2: 180, 3: 180, 4: 0, 5: 60 } }] });
  L.push({ type: 'shape', name: 'lock ripple', prims: [A.ell(0, 0, 118, 118, { stroke: COL.warn, sw: 6 })], anchor: [0, 0], pos: [540, 720], 'in': lk, out: lk + 0.6, keys: { scale: outM(lk, lk + 0.6, 100, 320), op: [KL(lk, 100), KL(lk + 0.6, 0)] } });
  L.push(neu.layer, old.layer);
  return { id: 'actC', name: 'S5-S6 Redirect, lock, new chat', layers: L };
}

function actD() {
  const [t0] = X.ACTS.D;
  const L = [];
  const lt = X.L7;
  L.push({ type: 'text', name: 'Anthropic says', parent: 'SAYS PILL', text: txt('Anthropic says', 'xbold', 32, '#FFFFFF', { just: 'center' }), pos: [540, 467 + BL(32)] });
  L.push({ type: 'shape', name: 'says pill', parent: 'SAYS PILL', prims: A.pill(300, 66, { fill: '#FFFFFF', op: 9, stroke: '#FFFFFF', sw: 2, sop: 18 }), anchor: [0, 0], pos: [540, 465] });
  L.push({ type: 'null', name: 'SAYS PILL', anchor: [540, 465], pos: [540, 465], 'in': lt - 0.1, keys: { op: outM(lt - 0.1, lt + 0.35, 0, 100), pos: outM(lt - 0.1, lt + 0.35, [540, 495], [540, 465]) } });
  const r = rng(77);
  for (let i = 0; i < 14; i++) {
    const sx = 140 + r() * 800, sy0 = 1000 - r() * 500, sp = 40 + r() * 60, ph = r() * 3;
    L.push({ type: 'shape', name: 'sparkle ' + (i + 1), prims: A.plus(i % 3 ? COL.accent : COL.hl), anchor: [0, 0], pos: [sx, sy0],
      expr: {
        pos: `var life = ((time - ${r3(t0)}) * 0.6 + ${r3(ph)}) % 1; [${r3(sx)}, ${r3(sy0)} - life * ${r3(sp * 3)}]`,
        op: `var life = ((time - ${r3(t0)}) * 0.6 + ${r3(ph)}) % 1; Math.sin(life * Math.PI) * 80 * Math.min(1, Math.max(0, (time - ${r3(t0 + 0.3)}) / 0.5))`,
        rot: 'time * 57.3',
      } });
  }
  L.push({ type: 'shape', name: 'microscope', prims: A.microscope(), anchor: [0, 0], 'in': t0 + 0.25,
    keys: { scale: pop(t0 + 0.25, 122, 0.55, 0, 1.08), pos: outM(t0 + 0.25, t0 + 0.8, [360, 920], [360, 800]) }, expr: { pos: 'value + [0, Math.sin(time * 2.2) * 6]' } });
  L.push({ type: 'shape', name: 'microscope light', parent: 'microscope', prims: [A.ell(0, 0, 90, 90, { fill: COL.accent })], anchor: [0, 0], pos: [36, 62], effects: [blur(60)], expr: { op: '45 * (0.55 + 0.45 * Math.sin(time * 5))' } });
  const nbGk = {};
  A.NOTE_LINES.forEach((_, i) => { const s = t0 + 0.6 + i * 0.4; nbGk['line ' + (i + 1)] = { trimEnd: ioM(s, s + 0.4, 0, 100) }; });
  nbGk.heart = { scale: pop(t0 + 2.9, 100, 0.4, 0) };
  L.push({ type: 'text', name: 'notebook subtitle', parent: 'notebook', text: txt('research notes', 'bold', 24, COL.navy), op: 45, pos: [-170, -98 + BL(24)] });
  L.push({ type: 'text', name: 'notebook title', parent: 'notebook', text: txt('AI welfare', 'black', 40, COL.navy), pos: [-170, -140 + BL(40)] });
  L.push({ type: 'shape', name: 'notebook', prims: A.notebook(), anchor: [0, 0], pos: [680, 820], 'in': t0 + 0.1, gkeys: nbGk,
    keys: { scale: pop(t0 + 0.1, 90, 0.5, 0, 1.08), rot: outM(t0 + 0.1, t0 + 0.6, 16, 4.6) }, effects: [shadow(130, 24, 60)] });
  return { id: 'actD', name: 'S7 AI welfare research', layers: L };
}

function actE() {
  const E = X.E;
  const moods = [[0, 'smile'], [LS.l9, 'flat'], [E.bye, 'calm']];
  const c0 = E.close, c1 = c0 + 0.45;
  const flash = { type: 'shape', name: 'close flash', prims: [A.rect(G.x, G.y, G.w, G.h, 46, { fill: '#FFFFFF' })], anchor: [0, 0], pos: [0, 0], 'in': c0, keys: { op: [KL(c0, 0), KL(c0 + 0.22, 90)] } };
  const ch = chat('E', { msgs: X.E_MSGS, mood: moods, top: [flash], nul: { keys: { scale: [KE(c0, [100, 100]), KE(c0 + 0.25, [100, 1.2]), KE(c1, [0, 1.2])], op: [KH(c0, 100), KL(c0 + 0.36, 100), KL(c1, 0)] } } });
  comps.push(...ch.comps);
  const L = [];
  L.push({ type: 'shape', name: 'close glow', prims: [A.ell(0, 0, 200, 200, { fill: '#FFFFFF' })], anchor: [0, 0], pos: [540, 745], 'in': c0 + 0.18, out: c1 + 0.1, effects: [blur(120)], keys: { op: [KL(c0 + 0.18, 50), KL(c1 + 0.1, 0)] } });
  L.push(ch.layer);
  return { id: 'actE', name: 'S8 Goodbye', layers: L };
}

function actF() {
  const [t0] = X.ACTS.F;
  const L = [];
  const ch = X.channel;
  L.push({ type: 'text', name: 'Follow label', parent: 'FOLLOW', text: txt('Follow for more', 'black', 50, COL.navy, { just: 'center' }), pos: [540, 1043 + BL(50)] });
  L.push({ type: 'shape', name: 'Follow pill', parent: 'FOLLOW', prims: A.pill(560, 128, { fill: COL.accent }), anchor: [0, 0], pos: [540, 1040], effects: [{ m: 'ADBE Drop Shadow', p: { 1: COL.accent, 2: 180, 3: 180, 4: 0, 5: 40 } }] });
  L.push({ type: 'null', name: 'FOLLOW', anchor: [540, 1040], pos: [540, 1040], 'in': t0 + 0.8, keys: { scale: pop(t0 + 0.8, 100, 0.45, 0, 1.1) }, expr: { scale: `value * (1 + 0.035 * Math.sin((time - ${r3(t0)}) * 6))` } });
  L.push({ type: 'shape', name: 'channel underline', prims: [A.rect(0, 0, ch.width, 10, 5, { fill: COL.accent })], anchor: [0, 0], pos: [540 - ch.width / 2, 868 + ch.size * 0.55], 'in': t0 + 0.6, keys: { scale: ioM(t0 + 0.6, t0 + 1.1, [0, 100], [100, 100]) } });
  L.push({ type: 'text', name: 'CHANNEL NAME', text: txt(ch.text, 'black', ch.size, '#FFFFFF', { just: 'center' }), pos: [540, 868 + BL(ch.size)], 'in': t0 + 0.35, keys: { op: outM(t0 + 0.35, t0 + 0.8, 0, 100) }, effects: [shadow(120, 6, 24)] });
  L.push({ type: 'footage', name: 'wave emoji', footage: foot(EMOJI['👋'], 'footage/' + EMOJI['👋']), pos: [700, 560], 'in': t0 + 0.4, keys: { scale: pop(t0 + 0.4, 100, 0.4, 0, 1.1) }, expr: { rot: 'Math.sin(time * 9) * 20' } });
  L.push({ type: 'shape', name: 'end card bot', prims: A.bot(118), anchor: [0, 0], pos: [540, 640], 'in': t0 + 0.1, keys: { scale: pop(t0 + 0.1, 100, 0.5, 0, 1.08) }, expr: { pos: 'value + [0, Math.sin(time * 2.4) * 8]' } });
  L.push({ type: 'shape', name: 'end card glow', parent: 'end card bot', prims: [A.ell(0, 0, 200, 200, { fill: COL.accent })], anchor: [0, 0], pos: [0, 0], op: 40, effects: [blur(140)] });
  return { id: 'actF', name: 'S9 End card', layers: L };
}

// ------------------------------------------------------------------ overlays
function headlines() {
  const L = [];
  X.heads.forEach((h, hi) => h.lines.forEach((ln, li) => ln.words.forEach((w, j) => {
    const t1 = ln.at + j * 0.06, y = ln.y, cx = w.x + w.width / 2;
    const name = `H${hi + 1}.${li + 1} ${w.w}`;
    const keys = {
      op: merge(outM(t1, t1 + 0.4, 0, 100), inM(h.e - 0.28, h.e, 100, 0)),
      pos: merge(outM(t1, t1 + 0.4, [cx, y + 46], [cx, y]), inM(h.e - 0.28, h.e, [cx, y], [cx, y - 36])),
      scale: [KL(t1, 70), KE(t1 + 0.26, 103, 85, 60), KE(t1 + 0.4, 100)],
    };
    if (w.emoji) {
      L.push({ type: 'footage', name, footage: foot(EMOJI[w.w], 'footage/' + EMOJI[w.w]), 'in': t1, out: h.e, keys: { ...keys, scale: keys.scale.map(k => [k[0], k[1] * ln.size * 1.1 / 128, k[2], k[3], k[4]]) } });
      return;
    }
    const base = { type: 'text', text: txt(w.w, 'black', ln.size, w.col), anchor: [w.width / 2, -BL(ln.size)], 'in': t1, out: h.e };
    L.push({ ...base, name, keys, effects: [shadow(140, 6, 28)] });
    if (h.glitch) {
      for (const [col, sgn] of [[COL.accent, -1], [COL.warn, 1]]) {
        L.push({ ...base, name: `${name} (${sgn < 0 ? 'cyan' : 'red'} split)`, text: txt(w.w, 'black', ln.size, col), parent: name, pos: [w.width / 2, -BL(ln.size)], blend: 'screen',
          keys: { op: keys.op.map(k => [k[0], k[1] * 0.8, k[2], k[3], k[4]]) },
          expr: { pos: `seedRandom(Math.floor(time * 24) + ${j}, true); value + [${sgn} * random(0, 10), random(-5, 5)]` } });
      }
    }
  })));
  return { id: 'heads', name: 'Headlines (on-screen text)', layers: L };
}

function subtitles() {
  const L = [];
  X.subs.forEach((c, ci) => {
    const N = `SUB ${String(ci + 1).padStart(2, '0')}`;
    const k = c.s + 0.16;
    c.words.forEach((w, wi) => {
      const next = c.words[wi + 1];
      const hlKeys = [KH(c.s, 0), KH(w.s, 100), ...(next ? [KH(next.s, 0)] : [])];
      L.push({
        type: 'text', name: `${N}.${wi + 1} ${w.w}`, parent: N, text: txt(w.w, 'black', 94, '#FFFFFF', { stroke: '#000000', sw: 16 }),
        anchor: [w.width / 2, -BL(94)], pos: [w.x + w.width / 2, w.y], 'in': c.s, out: c.e,
        keys: { scale: [KH(c.s, 100), KE(w.s, 100), KE(w.s + 0.11, 110), KE(w.s + 0.22, 100)] },
        hl: { color: COL.hl, keys: hlKeys },
        effects: [shadow(150, 8, 24)],
      });
    });
    L.push({ type: 'null', name: N, anchor: [540, 1226], pos: [540, 1226], 'in': c.s, out: c.e,
      keys: { scale: [KL(c.s, 82), KE(c.s + 0.1, 103, 85, 60), KE(k, 100)], op: merge([KL(c.s, 0), KL(c.s + 0.064, 100)], [KL(c.e - 0.06, 100), KL(c.e, 0)]) } });
  });
  return { id: 'subs', name: 'Subtitles', layers: L, markers: X.subs.map(c => [c.s, c.words.map(w => w.w).join(' ')]) };
}

function background() {
  return {
    id: 'bg', name: 'Background', layers: [
      { type: 'shape', name: 'dot grid', prims: [A.group('dots', [A.ell(27, 27, 1.5, 1.5, { fill: '#FFFFFF', op: 6 }), { t: 'rep', copies: 21, dx: 54, dy: 0 }, { t: 'rep', copies: 38, dx: 0, dy: 54 }])], anchor: [0, 0], pos: [0, -54],
        expr: { pos: '[value[0], value[1] + (time * 12) % 54]' } },
      { type: 'shape', name: 'glow violet', prims: [A.ell(0, 0, 620, 620, { fill: '#5B6CFF' })], anchor: [0, 0], op: 12, effects: [blur(260)], expr: { pos: '[220 + Math.cos(time * 0.21) * 120, 1350 + Math.sin(time * 0.31) * 120]' } },
      { type: 'shape', name: 'glow cyan', prims: [A.ell(0, 0, 650, 650, { fill: COL.accent })], anchor: [0, 0], op: 17, effects: [blur(300)], expr: { pos: '[540 + Math.sin(time * 0.35) * 220, 720 + Math.cos(time * 0.27) * 160]' } },
      { type: 'solid', name: 'gradient', color: COL.bg, effects: [{ m: 'ADBE Ramp', p: { 1: [540, 0], 2: '#18204A', 3: [540, 1920], 4: '#070A16' } }] },
    ],
  };
}

// ------------------------------------------------------------------ main
const acts = [actA(), actB(), actC(), actD(), actE(), actF()];
const order = ['A', 'B', 'C', 'D', 'E', 'F'];
const actLayers = acts.map((ac, i) => {
  const [a, b] = X.ACTS[order[i]];
  const noIn = i === 0, noOut = i >= 4;
  const keys = {};
  const op = [], pos = [], sc = [];
  if (!noIn) { op.push(...outM(a, a + 0.45, 0, 100)); pos.push(...outM(a, a + 0.45, [540, 835], [540, 745])); sc.push(...outM(a, a + 0.45, 93, 100)); }
  if (!noOut) { op.push(...inM(b - 0.32, b, 100, 0)); pos.push(...inM(b - 0.32, b, [540, 745], [540, 655])); sc.push(...inM(b - 0.32, b, 100, 106)); }
  if (op.length) Object.assign(keys, { op: merge(op), pos: merge(pos), scale: merge(sc) });
  return { type: 'comp', name: ac.name, comp: ac.id, parent: 'CAMERA SHAKE', anchor: [540, 745], pos: [540, 745], 'in': a, out: b, keys, label: i + 2 };
});
const glitchCurve = t => X.GLITCHES.reduce((g, [s, k, d]) => g + (t >= s ? k * (1 - prog(t, s, s + d)) : 0), 0);
const gKeys = [];
for (const [s, , d] of X.GLITCHES) { for (let t = s - 1 / 30; t <= s + d + 1 / 30; t += 1 / 30) gKeys.push(KL(t, Math.min(100, glitchCurve(t) * 100))); }
const gk = merge(gKeys);
const impulses = JSON.stringify(X.IMPULSES.map(p => [r3(p.t), p.amp, p.d]));
const main = {
  id: 'main', name: 'MAIN - AI ends chat', main: true,
  markers: [[0, 'S1 Insult for free?'], [LS.l2, 'S2 Sorry'], [LS.l3, 'S3 That’s changing'], [X.ACTS.B[0], 'S4 Anthropic / End conversation'], [X.ACTS.C[0], 'S5 Redirects'],
    [X.C.lockAt, 'S6 Chat ended / New chat'], [X.ACTS.D[0], 'S7 AI welfare'], [X.ACTS.E[0], 'S8 Goodbye'], [X.ACTS.F[0], 'S9 End card']],
  layers: [
    { type: 'footage', name: 'VOICE', footage: foot('voice', 'footage/voice.wav'), audio: 0 },
    { type: 'footage', name: 'SFX', footage: foot('sfx', 'footage/sfx.wav'), audio: -2 },
    { type: 'adjust', name: 'FX grain', effects: [{ m: 'ADBE Noise', p: { 1: 4, 2: 0 } }] },
    { type: 'solid', name: 'FX vignette', color: '#000000', op: 55, masks: [{ x: -260, y: -60, w: 1600, h: 2040, feather: 700, inverted: true }] },
    { type: 'shape', name: 'FX glitch bars', blend: 'screen', anchor: [0, 0], pos: [0, 0], keys: { op: gk },
      prims: [0, 1, 2, 3, 4, 5].map(i => A.group('bar ' + (i + 1), [A.rect(0, -10 - i * 2, 1080, 20 + i * 4, 0, { fill: i % 3 ? COL.warn : COL.accent, op: 40 })])),
      gkeys: Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => ['bar ' + (i + 1), { xpos: `seedRandom(Math.floor(time * 30) * ${i + 1} + 7, true); [random(-60, 60), random(0, 1920)]` }])) },
    { type: 'adjust', name: 'FX glitch warp', effects: [{ m: 'ADBE Wave Warp', p: { 1: 2, 3: 220, 4: 180, 5: 3 }, k: { 2: gk.map(k => [k[0], k[1] * 0.6, k[2], k[3], k[4]]) } }] },
    { type: 'comp', name: 'Subtitles', comp: 'subs', label: 9 },
    { type: 'comp', name: 'Headlines (on-screen text)', comp: 'heads', label: 9 },
    ...actLayers,
    { type: 'null', name: 'CAMERA SHAKE', anchor: [540, 745], pos: [540, 745],
      expr: { pos: `var I = ${impulses}; var x = 0, y = 0;\nfor (var i = 0; i < I.length; i++) { var dt = time - I[i][0]; if (dt < 0 || dt > I[i][2]) continue; var a = I[i][1] * Math.exp(-6 * dt / I[i][2]); x += a * Math.sin(dt * 58); y += a * Math.cos(dt * 47); }\nvar s = ${r3(LS.l9 + 0.5)}, e = ${r3(X.E.bye)};\nvar j = 6 * Math.min(Math.min(1, Math.max(0, (time - s) / 1.2)), 1 - Math.pow(Math.min(1, Math.max(0, (time - (e - 0.3)) / 0.3)), 3));\nif (time > s && time < e) { x += j * Math.sin(time * 71); y += j * Math.cos(time * 63); }\nvalue + [x, y]` } },
    { type: 'shape', name: 'FX warning glow', prims: [A.ell(0, 0, 820, 820, { fill: COL.warn })], anchor: [0, 0], pos: [540, 760], effects: [blur(300)], keys: { op: merge(X.warn.filter((_, i) => i % 2 === 0).map(([t, v]) => KL(t, +(v * 30).toFixed(2)))) } },
    { type: 'comp', name: 'Background', comp: 'bg', label: 1 },
  ],
};
function inheritParents(comp) {
  const by = Object.fromEntries(comp.layers.map(l => [l.name, l]));
  for (const l of comp.layers) {
    const ops = [];
    let p = l.parent && by[l.parent];
    while (p) {
      if (p['in'] != null) l['in'] = Math.max(l['in'] ?? 0, p['in']);
      if (p.out != null) l.out = Math.min(l.out ?? D, p.out);
      if ((p.keys && p.keys.op) || p.op != null) ops.push(p.name);
      p = p.parent && by[p.parent];
    }
    if (ops.length && !(l.expr && l.expr.op)) {
      l.expr = { ...(l.expr || {}), op: 'value' + ops.map(n => ` * thisComp.layer("${n}").transform.opacity / 100`).join('') };
    }
  }
  return comp;
}
const allComps = [main, ...[...acts, headlines(), subtitles(), background()], ...comps].map(c => ({ w: 1080, h: 1920, dur: D, ...c }));
allComps.forEach(inheritParents);
const DATA = { title: 'AI ends chat short', fps: X.FPS, footage: FOOT, comps: allComps };

// ------------------------------------------------------------------ write
await mkdir(join(HERE, 'footage'), { recursive: true });
await mkdir(join(HERE, 'svg'), { recursive: true });
for (const [file, url] of Object.entries(emojiPng)) await writeFile(join(HERE, 'footage', file), Buffer.from(url.split(',')[1], 'base64'));
for (const [src, dst] of [['audio/voice.wav', 'voice.wav'], ['out/sfx.wav', 'sfx.wav']]) if (existsSync(join(ROOT, src))) await copyFile(join(ROOT, src), join(HERE, 'footage', dst));
for (const f of ['InterDisplay-Black.otf', 'InterDisplay-ExtraBold.otf', 'Inter-Bold.otf', 'Inter-SemiBold.otf']) {
  await mkdir(join(HERE, 'fonts'), { recursive: true });
  await copyFile(join(ROOT, 'fonts', f), join(HERE, 'fonts', f));
}
const runtime = await readFile(join(HERE, 'runtime.jsx'), 'utf8');
const jsx = runtime.replace('__DATA__', JSON.stringify(DATA));
await writeFile(join(HERE, 'build_short.jsx'), '﻿' + jsx);

// SVG library
const T = (text, font, size, fill, x, y, just = 'left', op) => ({ t: 'text', text, font, size, fill, x, y, just, op });
const svgs = {
  'bot-smile': [A.bot(100), [-110, -150, 220, 260]],
  'bot-calm': [A.bot(100).map(p => p.name === 'face_smile' ? { ...p, op: 0 } : p.name === 'face_calm' ? { ...p, op: 100 } : p), [-110, -150, 220, 260]],
  'bot-flat': [A.bot(100).map(p => p.name === 'face_smile' ? { ...p, op: 0 } : p.name === 'face_flat' ? { ...p, op: 100 } : p).map(p => p.name === 'antenna ball' ? { ...p, fill: COL.warn } : p), [-110, -150, 220, 260]],
  'lock': [A.lock(COL.warn), [-70, -80, 140, 165]],
  'lock-white': [A.lock('#FFFFFF'), [-70, -80, 140, 165]],
  'fist': [A.fist(), [-125, -110, 250, 340]],
  'microscope': [A.microscope(), [-200, -270, 420, 500]],
  'notebook': [[...A.notebook(), T('AI welfare', 'black', 40, COL.navy, -170, -140 + BL(40)), T('research notes', 'bold', 24, COL.navy, -170, -98 + BL(24), 'left', 45)], [-230, -280, 460, 550]],
  'heart': [A.heart(), [-50, -50, 100, 80]],
  'send-button': [A.sendButton(), [-36, -36, 72, 72]],
  'impact-star': [A.star(), [-36, -10, 72, 20]],
  'bubble-angry': [[...A.bubble('angry', 260, 96), T('#@!$%!', 'black', 46, '#FFFFFF', 34, 48 + BL(46))], [0, 0, 260, 96]],
  'bubble-bot': [[...A.bubble('text', 420, 92), T('Let’s calm down', 'bold', 39, '#FFFFFF', 34, 46 + BL(39))], [-2, -2, 424, 96]],
  'bubble-goodbye': [[...A.bubble('bye', 380, 132), T('Goodbye', 'black', 66, COL.navy, 34, 66 + BL(66))], [0, 0, 380, 132]],
  'button-end-conversation': [[...A.pill(690, 132, { fill: COL.warn, op: 92, stroke: COL.warn, sw: 4 }), A.group('x', A.xIcon(), { x: -345 + 74 }), T('End conversation', 'xbold', 52, '#FFFFFF', -345 + 126, 3 + BL(52))], [-350, -70, 700, 140]],
  'button-new-chat': [[...A.pill(236, 66, { fill: COL.accent }), T('+  New chat', 'black', 30, COL.navy, 0, 2 + BL(30), 'center')], [-120, -35, 240, 70]],
  'button-follow': [[...A.pill(560, 128, { fill: COL.accent }), T('Follow for more', 'black', 50, COL.navy, 0, 3 + BL(50), 'center')], [-282, -66, 564, 132]],
  'chat-window': [[...A.windowFrame(WIN.w, WIN.h),
    A.group('avatar', A.bot(33), { x: 72, y: 62 }), T('AI Assistant', 'bold', 34, '#FFFFFF', 128, 44 + BL(34)), A.ell(136, 80, 6, 6, { fill: COL.accent }), T('online', 'semi', 24, '#FFFFFF', 152, 81 + BL(24), 'left', 55),
    A.rect(24, WIN.h - 116, WIN.w - 48, 92, 46, { fill: '#FFFFFF', op: 7, stroke: '#FFFFFF', sw: 2.5, sop: 10 }), T('Type a message…', 'semi', 32, '#FFFFFF', 64, WIN.h - 70 + 1 + BL(32), 'left', 40),
    A.group('send', A.sendButton(), { x: WIN.w - 24 - 46, y: WIN.h - 70 })], [-2, -2, WIN.w + 4, WIN.h + 4]],
};
for (const [name, [prims, vb]] of Object.entries(svgs)) await writeFile(join(HERE, 'svg', name + '.svg'), A.toSVG(prims, vb));

const nLayers = allComps.reduce((s, c) => s + c.layers.length, 0);
console.log(`build_short.jsx: ${allComps.length} comps, ${nLayers} layers, ${(jsx.length / 1024).toFixed(0)} KB; ${Object.keys(svgs).length} SVGs`);
