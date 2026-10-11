/*
 * "AI can end the chat" — vertical short, 1080x1920, 30 fps.
 * Every frame is a pure function of time: SHORT.render(ctx, t).
 * Voice-over timing lives in VO below; every animation is keyed to it.
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920, FPS = 30;
  const COL = { bg: '#0E1325', accent: '#3DDCFF', warn: '#FF4D5E', hl: '#FFD93D', text: '#FFFFFF', navy: '#0E1325' };
  const FONT = (w, px) => `${w} ${px}px InterX, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;

  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const CONFIG = { channel: params.get('channel') || '@yourchannel' };

  // ---------------------------------------------------------------- math
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const eOut = k => 1 - Math.pow(1 - k, 3);
  const eIn = k => k * k * k;
  const eInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const eBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const env = (t, a, b, fi = 0.35, fo = 0.35) => Math.min(eOut(prog(t, a, a + fi)), 1 - eIn(prog(t, b - fo, b)));
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0; let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function fade(ctx, a) { ctx.globalAlpha *= clamp(a); }

  // ---------------------------------------------------------------- voice-over
  // s/e = start/end of each spoken line in seconds; "|" separates subtitle chunks (2-4 words).
  const VO = [
    { id: 'l1', s: 0.30, e: 5.60, text: 'For years,|a chatbot was|the one thing|you could insult|without worrying|about getting hit.' },
    { id: 'l2', s: 5.90, e: 9.50, text: 'It would probably|just apologize|or ask you|to calm down.' },
    { id: 'l3', s: 9.90, e: 11.80, text: 'But that|might be changing.' },
    { id: 'l4', s: 12.30, e: 19.80, text: 'Anthropic has given|some of its|Claude models|the ability to end|a conversation|in rare, extreme cases|of persistent abuse.' },
    { id: 'l5', s: 20.20, e: 25.10, text: 'It only happens|after the AI|has tried to steer|the chat|somewhere else.' },
    { id: 'l6', s: 25.60, e: 31.60, text: 'After that,|you can’t send|more messages|in that chat,|but you can|start a new one.' },
    { id: 'l7', s: 32.20, e: 35.50, text: 'Anthropic says|it’s part of|its research|into AI welfare.' },
    { id: 'l8', s: 36.00, e: 39.90, text: 'So if you|snap at a chatbot|once or twice,|nothing happens.' },
    { id: 'l9', s: 40.70, e: 44.10, text: 'But keep going,|and it might|simply say goodbye.' },
  ];

  const CHUNKS = [];
  (function buildVO() {
    const PAUSE = 4;
    const REC = global.VO_WORDS || null;
    for (const L of VO) {
      const rec = REC && REC.filter(r => r[0] === L.id);
      if (rec && rec.length) { L.s = rec[0][2]; L.e = rec[rec.length - 1][3]; }
      const groups = L.text.split('|').map(c => c.split(' '));
      const flat = groups.flat();
      const pause = (w, i) => (i < flat.length - 1 && /[,.]$/.test(w) ? PAUSE : 0);
      const wts = flat.map((w, i) => w.replace(/[^\w’']/g, '').length + 2.2 + pause(w, i));
      const tot = wts.reduce((a, b) => a + b, 0);
      let acc = 0, idx = 0;
      L.words = [];
      for (const g of groups) {
        const chunk = { line: L, words: [] };
        for (const w of g) {
          let s = L.s + (L.e - L.s) * acc / tot;
          acc += wts[idx];
          let e = L.s + (L.e - L.s) * (acc - pause(w, idx)) / tot;
          if (rec && rec[idx]) { s = rec[idx][2]; e = rec[idx][3]; }
          const wd = { w, s, e, key: w.toLowerCase().replace(/[^a-z’']/g, '') };
          chunk.words.push(wd); L.words.push(wd); idx++;
        }
        chunk.s = chunk.words[0].s;
        CHUNKS.push(chunk);
      }
    }
    for (let i = 0; i < CHUNKS.length; i++) {
      const c = CHUNKS[i], n = CHUNKS[i + 1];
      c.e = n && n.line === c.line ? n.s : Math.min(c.line.e + 0.35, n ? n.s - 0.05 : c.line.e + 0.35);
    }
  })();

  // Start time of a spoken word: WT('l1', 'hit').
  function WT(id, word, nth = 0) {
    const L = VO.find(l => l.id === id);
    const hits = L.words.filter(w => w.key === word.toLowerCase());
    if (!hits[nth]) throw new Error(`no word ${word} in ${id}`);
    return hits[nth].s;
  }

  // ---------------------------------------------------------------- sound cues
  const SFX = [];
  const cue = (t, type, vol = 1) => SFX.push({ t: +t.toFixed(3), type, vol });

  const LS = id => VO.find(l => l.id === id).s, LE = id => VO.find(l => l.id === id).e;

  // ---------------------------------------------------------------- acts & events
  const ACTS = {};
  ACTS.A = [0, LS('l4') - 0.15];
  ACTS.B = [ACTS.A[1], LS('l5') - 0.15];
  ACTS.C = [ACTS.B[1], LS('l7') - 0.1];
  ACTS.D = [ACTS.C[1], LS('l8') - 0.15];
  ACTS.E = [ACTS.D[1], LE('l9') + 0.45];
  ACTS.F = [ACTS.E[1], ACTS.E[1] + 3.0];
  const DURATION = +ACTS.F[1].toFixed(2);
  // S3 ("But that might be changing") moments, k = 0..1 across the scene
  const g3 = k => LS('l3') + k * (ACTS.A[1] - LS('l3'));
  const WIN = { x: 110, y: 440, w: 860, h: 610 };

  // Act A: insults bounce off, bot apologizes, then the glitch.
  const FIST_T = WT('l1', 'hit');
  const A_MSGS = [
    { side: 'user', kind: 'angry', text: '#@!$%!', t: WT('l1', 'years'), burst: true },
    { side: 'user', kind: 'angry', text: '&%#@!!', t: WT('l1', 'chatbot'), burst: true },
    { side: 'user', kind: 'angry', text: '$#@&?!', t: WT('l1', 'thing'), burst: true },
    { side: 'user', kind: 'angry', text: '#@%!!!', t: WT('l1', 'insult'), burst: true },
    { side: 'bot', kind: 'typing', t: LS('l2') + 0.05, until: WT('l2', 'apologize') },
    { side: 'bot', kind: 'text', text: 'Sorry.', t: WT('l2', 'apologize') },
    { side: 'bot', kind: 'text', text: 'Let’s calm down 🙂', t: WT('l2', 'calm') },
    { side: 'user', kind: 'angry', text: '#@!$%&!!', t: g3(0.02) },
    { side: 'user', kind: 'angry', text: '!!#@$%', t: g3(0.2) },
    { side: 'user', kind: 'angry', text: '%$#@!&!', t: g3(0.38) },
    { side: 'user', kind: 'angry', text: '#@!!!$%', t: g3(0.55) },
    { side: 'user', kind: 'angry', text: '&#@%!!', t: g3(0.72) },
  ];
  const FLOATERS = [
    { x: 250, y: 560, s: 1.2, r: -0.12, t: g3(0.05), text: '#@!$!' },
    { x: 830, y: 620, s: 1.05, r: 0.1, t: g3(0.17), text: '%&#@!' },
    { x: 290, y: 930, s: 1.15, r: 0.08, t: g3(0.3), text: '!!$#@' },
    { x: 800, y: 980, s: 1.3, r: -0.07, t: g3(0.43), text: '#@%&!!' },
    { x: 545, y: 760, s: 1.6, r: 0.03, t: g3(0.6), text: '$#@!!!' },
  ];

  // Act B: Anthropic / Claude / End conversation / severity meter.
  const B = {
    tA: WT('l4', 'anthropic'), tC: WT('l4', 'claude'), tE: WT('l4', 'end'),
    tR: WT('l4', 'rare'), tP: WT('l4', 'abuse'),
  };
  B.fill = t => 0.93 * eInOut(prog(t, B.tR - 0.35, B.tP + 0.3));
  B.armAt = (() => { for (let t = B.tR; t < ACTS.B[1]; t += 0.01) if (B.fill(t) >= 0.8) return t; return B.tP; })();

  // Act C: three redirect attempts, lock, new chat.
  const C = { lockAt: LE('l5') + 0.08, trySend: WT('l6', 'send'), newShow: WT('l6', 'but') - 0.3, press: WT('l6', 'start') - 0.1 };
  C.swap = C.press + 0.15;
  const C_MSGS = [
    { side: 'user', kind: 'angry', text: '#@!$%!', t: LS('l5') + 0.1 },
    { side: 'bot', kind: 'text', text: 'Let’s talk about something else?', t: WT('l5', 'happens'), badge: 1 },
    { side: 'user', kind: 'angry', text: '&%#@!!', t: WT('l5', 'ai') + 0.1 },
    { side: 'bot', kind: 'text', text: 'How about a fun fact instead?', t: WT('l5', 'steer'), badge: 2 },
    { side: 'user', kind: 'angry', text: '$#@&?!', t: WT('l5', 'chat') + 0.05 },
    { side: 'bot', kind: 'text', text: 'Want to change the subject?', t: WT('l5', 'somewhere'), badge: 3 },
    { side: 'user', kind: 'angry', text: '#@%!!!', t: WT('l5', 'else') + 0.3 },
  ];
  const C_NEW = [{ side: 'bot', kind: 'text', text: 'Hi! What’s on your mind?', t: C.swap + 0.55 }];

  // Act E: once or twice is fine; a flood gets a goodbye.
  const E = { bye: WT('l9', 'goodbye') };
  E.close = E.bye + 0.45;
  const E_MSGS = [
    { side: 'user', kind: 'angry', text: '#@!$!', t: WT('l8', 'snap') },
    { side: 'user', kind: 'angry', text: '%&#@!', t: WT('l8', 'twice') },
    { side: 'bot', kind: 'text', text: 'No worries. I’m still here 🙂', t: WT('l8', 'nothing') },
  ];
  const FLOOD = ['#@!$%!', '&%#@!!', '$#@&?!', '#@%!!!', '!!#@$', '%$#@!&', '#@!!!$%', '&#@%!!', '$#@!!!', '#@!$%&!!'];
  FLOOD.forEach((text, i) => E_MSGS.push({ side: 'user', kind: 'angry', text, t: LS('l9') + 0.1 + (E.bye - 0.6 - LS('l9')) * Math.pow(i / (FLOOD.length - 1), 0.8), flood: true }));
  E_MSGS.push({ side: 'bot', kind: 'bye', text: 'Goodbye 👋', t: E.bye });

  [A_MSGS, C_MSGS, C_NEW, E_MSGS].forEach(list => list.forEach((m, i) => {
    m.seed = Math.round(m.t * 1000) + i;
    if (m.kind !== 'typing') cue(m.t, 'pop', m.side === 'bot' ? 0.9 : (m.flood ? 0.6 : 0.8));
  }));
  cue(FIST_T, 'thud', 1);
  [[g3(0), 1], [g3(0.33), 0.6], [g3(0.66), 0.7]].forEach(([t, v]) => cue(t, 'glitch', v));
  [ACTS.B[0], ACTS.C[0], ACTS.D[0], ACTS.E[0], ACTS.F[0]].forEach(t => cue(t - 0.15, 'whoosh', 0.9));
  cue(B.tE, 'pop', 1); cue(B.armAt, 'pop', 1);
  cue(C.lockAt, 'ding', 1);
  cue(C.trySend, 'buzz', 0.6);
  cue(C.press, 'click', 1); cue(C.swap, 'whoosh', 0.6);
  cue(E.close, 'ding', 0.8);
  SFX.sort((a, b) => a.t - b.t);

  // ---------------------------------------------------------------- global FX
  const IMPULSES = [
    { t: FIST_T, amp: 26, d: 0.6 }, { t: g3(0), amp: 22, d: 0.5 }, { t: g3(0.33), amp: 12, d: 0.35 },
    { t: g3(0.66), amp: 14, d: 0.35 }, { t: B.armAt, amp: 8, d: 0.4 }, { t: C.lockAt, amp: 14, d: 0.45 },
    { t: E.close, amp: 10, d: 0.4 },
  ];
  function shake(t) {
    let x = 0, y = 0;
    for (const p of IMPULSES) {
      const dt = t - p.t; if (dt < 0 || dt > p.d) continue;
      const a = p.amp * Math.exp(-6 * dt / p.d);
      x += a * Math.sin(dt * 58); y += a * Math.cos(dt * 47);
    }
    const j = 6 * env(t, LS('l9') + 0.5, E.bye, 1.2, 0.3);
    if (j > 0) { x += j * Math.sin(t * 71); y += j * Math.cos(t * 63); }
    return { x, y };
  }
  function warnAt(t) {
    return Math.max(env(t, LS('l3') - 0.05, ACTS.A[1] + 0.1, 0.12, 0.35), 0.85 * env(t, LS('l9') + 0.3, E.close + 0.3, 1.6, 0.5),
      0.55 * env(t, C.lockAt - 0.05, C.lockAt + 1.4, 0.1, 0.9), 0.35 * env(t, B.armAt - 0.1, ACTS.B[1] - 0.1, 0.2, 0.4));
  }
  const GLITCHES = [[g3(0), 1, 0.38], [g3(0.33), 0.55, 0.2], [g3(0.66), 0.7, 0.25], [ACTS.A[1] - 0.12, 0.8, 0.2], [E.bye - 1.3, 0.35, 0.15], [E.bye - 0.7, 0.45, 0.18]];
  const glitchAt = t => GLITCHES.reduce((g, [s, k, d]) => g + (t >= s ? k * (1 - prog(t, s, s + d)) : 0), 0);

  // ---------------------------------------------------------------- background
  let grainPat = null, buf = null;
  function drawBG(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#18204A'); g.addColorStop(0.45, COL.bg); g.addColorStop(1, '#070A16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const warn = warnAt(t);
    blob(ctx, 540 + Math.sin(t * 0.35) * 220, 720 + Math.cos(t * 0.27) * 160, 760, COL.accent, 0.17 * (1 - warn));
    blob(ctx, 220 + Math.cos(t * 0.21) * 120, 1350 + Math.sin(t * 0.31) * 120, 620, '#5B6CFF', 0.12);
    blob(ctx, 540, 760, 900, COL.warn, 0.33 * warn);

    // drifting dot grid
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    const sp = 54, off = (t * 12) % sp;
    for (let y = -sp + off; y < H; y += sp) for (let x = 27; x < W; x += sp) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
  }
  function blob(ctx, x, y, r, col, a) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function drawGrain(ctx, t) {
    if (!grainPat) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d'), id = x.createImageData(256, 256), r = rng(42);
      for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      x.putImageData(id, 0, 0); grainPat = ctx.createPattern(c, 'repeat');
    }
    const r = rng(Math.round(t * FPS) + 7);
    ctx.save();
    ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
    ctx.translate(-r() * 256, -r() * 256);
    ctx.fillStyle = grainPat; ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();
  }
  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(540, 860, 300, 540, 960, 1250);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function glitch(ctx, t, k) {
    if (!buf) { buf = document.createElement('canvas'); buf.width = W; buf.height = H; }
    const b = buf.getContext('2d');
    b.clearRect(0, 0, W, H); b.drawImage(ctx.canvas, 0, 0);
    const r = rng(Math.round(t * FPS) * 7919 + 3);
    ctx.save();
    ctx.globalAlpha = 0.5 * clamp(k);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(buf, 10 * k, 0); ctx.drawImage(buf, -10 * k, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const n = Math.floor(5 + k * 12);
    for (let i = 0; i < n; i++) {
      const y = r() * H, h = 8 + r() * 90 * k, dx = (r() - 0.5) * 170 * k;
      ctx.drawImage(buf, 0, y, W, h, dx, y, W, h);
    }
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3 + k * 5; i++) {
      ctx.fillStyle = rgba(r() < 0.65 ? COL.warn : COL.accent, 0.35 * clamp(k));
      ctx.fillRect(0, r() * H, W, 3 + r() * 26 * k);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- icons
  function drawBot(ctx, cx, cy, r, mood, t) {
    ctx.save();
    // antenna
    ctx.strokeStyle = COL.accent; ctx.lineWidth = r * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.95); ctx.lineTo(cx, cy - r * 1.22); ctx.stroke();
    ctx.fillStyle = mood === 'flat' ? COL.warn : COL.hl;
    ctx.beginPath(); ctx.arc(cx, cy - r * 1.28, r * 0.13, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#7BEAFF'); g.addColorStop(1, '#1C86D6');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(9,16,40,0.9)'; rr(ctx, cx - r * 0.7, cy - r * 0.46, r * 1.4, r * 0.98, r * 0.42); ctx.fill();
    const ex = r * 0.3, ey = cy - r * 0.06, ink = '#C6F6FF';
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = r * 0.09;
    if (mood === 'calm') {
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * ex, ey + r * 0.06, r * 0.13, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    } else {
      const bl = (t % 3.3) < 0.12 ? 0.15 : 1;
      for (const s of [-1, 1]) { rr(ctx, cx + s * ex - r * 0.075, ey - r * 0.12 * bl, r * 0.15, r * 0.24 * bl, r * 0.07); ctx.fill(); }
    }
    ctx.beginPath();
    if (mood === 'flat') { ctx.moveTo(cx - r * 0.16, cy + r * 0.26); ctx.lineTo(cx + r * 0.16, cy + r * 0.26); }
    else ctx.arc(cx, cy + r * 0.1, r * 0.2, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  function drawLock(ctx, cx, cy, s, col) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.strokeStyle = col; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-32, -2); ctx.lineTo(-32, -30); ctx.arc(0, -30, 32, Math.PI, 0); ctx.lineTo(32, -2); ctx.stroke();
    ctx.fillStyle = col; rr(ctx, -54, -12, 108, 86, 18); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.arc(0, 22, 11, 0, Math.PI * 2); ctx.fill(); rr(ctx, -5, 22, 10, 26, 4); ctx.fill();
    ctx.restore();
  }

  function drawFist(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    const skin = '#FFC857', shade = '#F2A53A', line = '#B86E14';
    ctx.lineWidth = 6; ctx.strokeStyle = line; ctx.lineJoin = 'round';
    ctx.fillStyle = COL.warn; rr(ctx, -84, 150, 168, 70, 20); ctx.fill();
    ctx.fillStyle = shade; rr(ctx, -72, 90, 144, 80, 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = shade; rr(ctx, -112, -40, 224, 150, 52); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const fx = -112 + i * 56;
      ctx.fillStyle = skin; rr(ctx, fx + 2, -98, 52, 122, 26); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx + 15, -44); ctx.lineTo(fx + 41, -44); ctx.stroke();
    }
    ctx.fillStyle = skin; rr(ctx, -104, 18, 176, 58, 29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, -96, -86, 30, 40, 15); ctx.fill();
    ctx.restore();
  }

  function drawMicroscope(ctx, cx, cy, s, t) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    const dark = '#162250', mid = '#2D4C95', light = '#E6F6FF';
    // light under the objective
    const pulse = 0.55 + 0.45 * Math.sin(t * 5);
    blob(ctx, 36, 62, 130, COL.accent, 0.45 * pulse);
    ctx.fillStyle = mid; rr(ctx, -165, 160, 330, 58, 29); ctx.fill();
    ctx.strokeStyle = mid; ctx.lineWidth = 52; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(95, 168); ctx.quadraticCurveTo(185, 30, 52, -112); ctx.stroke();
    ctx.fillStyle = light; rr(ctx, -150, 62, 250, 28, 14); ctx.fill();
    ctx.fillStyle = COL.accent; rr(ctx, -10, 54, 90, 12, 6); ctx.fill();
    ctx.fillStyle = light; ctx.beginPath(); ctx.arc(126, 52, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(126, 52, 13, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(0, -40); ctx.rotate(-0.38);
    const g = ctx.createLinearGradient(-40, 0, 40, 0); g.addColorStop(0, '#7BEAFF'); g.addColorStop(1, '#1C9BE0');
    ctx.fillStyle = g; rr(ctx, -40, -150, 80, 192, 24); ctx.fill();
    ctx.fillStyle = dark; rr(ctx, -47, -22, 94, 24, 9); ctx.fill();
    ctx.fillStyle = light; rr(ctx, -31, -210, 62, 66, 14); ctx.fill();
    ctx.fillStyle = dark; rr(ctx, -22, 40, 44, 48, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; rr(ctx, -28, -138, 14, 150, 7); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- chat window
  const layoutCache = new Map();
  function wrap(ctx, text, maxW) {
    const ws = text.split(' '), lines = []; let cur = '';
    for (const w of ws) {
      const tst = cur ? cur + ' ' + w : w;
      if (ctx.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function bubbleFont(m) { return m.kind === 'angry' ? FONT(900, 46) : m.kind === 'bye' ? FONT(900, 66) : FONT(700, 39); }
  function layout(ctx, m, maxW) {
    const key = m.kind + '|' + m.text + '|' + maxW;
    if (layoutCache.has(key)) return layoutCache.get(key);
    let L;
    if (m.kind === 'typing') L = { w: 136, h: 84, lines: [], lh: 0 };
    else {
      ctx.save(); ctx.font = bubbleFont(m);
      const lines = wrap(ctx, m.text, maxW - 68);
      const lw = Math.max(...lines.map(l => ctx.measureText(l).width));
      const lh = m.kind === 'angry' ? 54 : m.kind === 'bye' ? 76 : 50;
      L = { w: lw + 68, h: lines.length * lh + (m.kind === 'bye' ? 56 : 42), lines, lh };
      ctx.restore();
    }
    layoutCache.set(key, L);
    return L;
  }

  function drawBubble(ctx, t, m, L, x, y) {
    const user = m.side === 'user';
    const radii = user ? [34, 34, 10, 34] : [34, 34, 34, 10];
    ctx.save();
    if (m.kind === 'angry') {
      const g = ctx.createLinearGradient(x, y, x + L.w, y + L.h);
      g.addColorStop(0, '#FF6B79'); g.addColorStop(1, '#E2304A');
      ctx.shadowColor = rgba(COL.warn, 0.45); ctx.shadowBlur = 26;
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, L.w, L.h, radii); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = bubbleFont(m); ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      const r = rng(m.seed * 31 + Math.floor(t * 18));
      let cx = x + 34;
      for (const ch of m.text) {
        const cw = ctx.measureText(ch).width;
        ctx.save(); ctx.translate(cx + cw / 2 + (r() - 0.5) * 4, y + L.h / 2 + 2 + (r() - 0.5) * 5); ctx.rotate((r() - 0.5) * 0.22);
        ctx.fillText(ch, -cw / 2, 0); ctx.restore();
        cx += cw;
      }
    } else if (m.kind === 'bye') {
      const g = ctx.createLinearGradient(x, y, x + L.w, y + L.h);
      g.addColorStop(0, '#5FE3FF'); g.addColorStop(1, '#22A6E8');
      ctx.shadowColor = rgba(COL.accent, 0.6); ctx.shadowBlur = 40;
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, L.w, L.h, radii); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = bubbleFont(m); ctx.textBaseline = 'middle'; ctx.fillStyle = COL.navy;
      ctx.fillText(m.text, x + 34, y + L.h / 2 + 3);
    } else {
      ctx.fillStyle = 'rgba(61,220,255,0.13)'; ctx.strokeStyle = 'rgba(61,220,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y, L.w, L.h, radii); ctx.fill(); ctx.stroke();
      if (m.kind === 'typing') {
        for (let i = 0; i < 3; i++) {
          const b = Math.max(0, Math.sin(t * 9 - i * 0.9));
          ctx.fillStyle = rgba(COL.accent, 0.5 + 0.5 * b);
          ctx.beginPath(); ctx.arc(x + 40 + i * 28, y + L.h / 2 - b * 9, 9, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        ctx.font = bubbleFont(m); ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        L.lines.forEach((ln, i) => ctx.fillText(ln, x + 34, y + 21 + L.lh * (i + 0.5) + 2));
      }
    }
    ctx.restore();
  }

  function drawBursts(ctx, t, bursts) {
    const glyphs = '#@!$%&*?';
    for (const b of bursts) {
      const dt = t - b.m.t; if (dt < 0 || dt > 1.2) continue;
      const r = rng(b.m.seed * 13 + 5);
      for (let j = 0; j < 8; j++) {
        const ang = -Math.PI / 2 + (r() - 0.5) * 2.8, sp = 650 + r() * 550, size = 40 + r() * 38;
        const ch = glyphs[Math.floor(r() * glyphs.length)], col = [COL.warn, COL.hl, '#fff'][j % 3], spin = (r() - 0.5) * 8;
        const px = b.x + Math.cos(ang) * sp * dt, py = b.y + Math.sin(ang) * sp * dt + 1100 * dt * dt;
        ctx.save(); fade(ctx, 1 - prog(dt, 0.55, 1.2));
        ctx.translate(px, py); ctx.rotate(spin * dt); ctx.scale(lerp(0.4, 1, eOut(prog(dt, 0, 0.2))), lerp(0.4, 1, eOut(prog(dt, 0, 0.2))));
        ctx.font = FONT(900, size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col;
        ctx.fillText(ch, 0, 0); ctx.restore();
      }
    }
  }

  /*
   * o: { x, y, w, h, msgs, mood, title, status, lockAt, trySend, headerRight(ctx,t,box), border }
   */
  function drawChat(ctx, t, o) {
    const { x, y, w, h } = o;
    const hh = 112, ih = 92;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 90; ctx.shadowOffsetY = 34;
    ctx.fillStyle = 'rgba(19,26,56,0.94)'; rr(ctx, x, y, w, h, 46); ctx.fill();
    ctx.restore();
    ctx.save();
    const gl = ctx.createLinearGradient(0, y, 0, y + h);
    gl.addColorStop(0, 'rgba(255,255,255,0.08)'); gl.addColorStop(1, 'rgba(255,255,255,0.015)');
    ctx.fillStyle = gl; rr(ctx, x, y, w, h, 46); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = o.border || 'rgba(255,255,255,0.13)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x + 32, y + hh, w - 64, 2);

    // header
    const mood = typeof o.mood === 'function' ? o.mood(t) : o.mood;
    drawBot(ctx, x + 72, y + hh / 2 + 6, 33, mood, t);
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = FONT(700, 34);
    ctx.fillText(o.title || 'AI Assistant', x + 128, y + 44);
    const locked = o.lockAt != null && t >= o.lockAt;
    ctx.fillStyle = locked ? 'rgba(255,255,255,0.4)' : COL.accent;
    ctx.beginPath(); ctx.arc(x + 136, y + 80, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = FONT(600, 24);
    ctx.fillText(locked ? 'chat ended' : (o.status || 'online'), x + 152, y + 81);
    if (o.headerRight) o.headerRight(ctx, t, { x, y, w, hh });

    // messages
    const ix = x + 24, iw = w - 48, iy = y + h - 24 - ih;
    const top = y + hh + 6, bottom = iy - 18, x0 = x + 28, x1 = x + w - 28, maxW = (x1 - x0) * 0.8;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, top, w - 4, bottom - top + 12); ctx.clip();
    const bursts = [];
    let yb = bottom;
    const vis = o.msgs.filter(m => t >= m.t && !(m.until != null && t > m.until + 0.3));
    for (let i = vis.length - 1; i >= 0; i--) {
      const m = vis[i], L = layout(ctx, m, maxW);
      const p = prog(t, m.t, m.t + 0.42);
      let hEff = (L.h + 16) * eOut(p);
      let a = clamp(p * 3);
      if (m.until != null) { const q = prog(t, m.until, m.until + 0.25); hEff *= 1 - eOut(q); a *= 1 - q; }
      yb -= hEff;
      if (yb + L.h < top - 40) break;
      const bx = m.side === 'user' ? x1 - L.w : x0;
      const s = lerp(0.35, 1, eBack(p));
      const ax = m.side === 'user' ? bx + L.w : bx, ay = yb + L.h;
      ctx.save(); fade(ctx, a);
      ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay);
      drawBubble(ctx, t, m, L, bx, yb);
      if (m.badge) {
        const bk = eBack(prog(t, m.t + 0.2, m.t + 0.55));
        if (bk > 0) {
          const cx = bx + L.w + 4, cy = yb + 6;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(bk, bk);
          ctx.fillStyle = COL.hl; ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = COL.navy; ctx.font = FONT(900, 30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(m.badge), 0, 2); ctx.restore();
        }
      }
      ctx.restore();
      if (m.burst) bursts.push({ m, x: bx + L.w / 2, y: yb + L.h / 2 });
    }
    // dim the history once locked
    if (o.lockAt != null) {
      const d = eOut(prog(t, o.lockAt, o.lockAt + 0.5));
      if (d > 0) { ctx.fillStyle = `rgba(10,14,30,${0.55 * d})`; ctx.fillRect(x, top, w, bottom - top + 12); }
    }
    ctx.restore();

    // input bar
    const lk = o.lockAt != null ? eOut(prog(t, o.lockAt + 0.9, o.lockAt + 1.3)) : 0;
    let sx = 0;
    if (o.trySend != null) { const dt = t - o.trySend; if (dt > 0 && dt < 0.5) sx = Math.sin(dt * 60) * 16 * (1 - dt / 0.5); }
    ctx.save(); ctx.translate(sx, 0);
    ctx.fillStyle = `rgba(${Math.round(lerp(255, 120, lk))},${Math.round(lerp(255, 128, lk))},${Math.round(lerp(255, 150, lk))},${lerp(0.07, 0.16, lk)})`;
    rr(ctx, ix, iy, iw, ih, ih / 2); ctx.fill();
    let flash = 0;
    if (o.trySend != null) flash = 1 - prog(t, o.trySend, o.trySend + 0.6);
    if (t < o.trySend) flash = 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = flash > 0 ? rgba(COL.warn, 0.4 + 0.6 * flash) : 'rgba(255,255,255,0.1)'; ctx.stroke();
    ctx.textBaseline = 'middle';
    if (lk < 1) {
      ctx.save(); fade(ctx, 1 - lk);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = FONT(600, 32);
      ctx.fillText('Type a message…', ix + 40, iy + ih / 2 + 1);
      if (o.caret && Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = COL.accent; ctx.fillRect(ix + 36, iy + 24, 3, ih - 48); }
      ctx.restore();
    }
    if (lk > 0) {
      ctx.save(); fade(ctx, lk);
      drawLock(ctx, ix + 58, iy + ih / 2 - 6, 0.36, 'rgba(255,255,255,0.75)');
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = FONT(700, 32);
      ctx.fillText('This chat has ended', ix + 96, iy + ih / 2 + 1);
      ctx.restore();
    }
    const sc = lk > 0 ? 'rgba(140,150,175,0.45)' : COL.accent;
    ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(ix + iw - ih / 2, iy + ih / 2, 32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COL.navy; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ax = ix + iw - ih / 2, ay = iy + ih / 2;
    ctx.beginPath(); ctx.moveTo(ax, ay + 13); ctx.lineTo(ax, ay - 13); ctx.moveTo(ax - 11, ay - 3); ctx.lineTo(ax, ay - 14); ctx.lineTo(ax + 11, ay - 3); ctx.stroke();
    ctx.restore();

    ctx.restore();
    drawBursts(ctx, t, bursts);
  }

  // ---------------------------------------------------------------- act wrapper
  function withAct(ctx, t, [a, b], fn, opt = {}) {
    if (t < a || t >= b) return;
    const ki = opt.noIn ? 1 : eOut(prog(t, a, a + 0.45));
    const ko = opt.noOut ? 0 : eIn(prog(t, b - 0.32, b));
    ctx.save();
    fade(ctx, ki * (1 - ko));
    const dy = (1 - ki) * 90 - ko * 90, s = lerp(0.93, 1, ki) * lerp(1, 1.06, ko);
    ctx.translate(540, 745 + dy); ctx.scale(s, s); ctx.translate(-540, -745);
    fn(t);
    ctx.restore();
  }

  // Act A ---------------------------------------------------------
  function actA(ctx, t) {
    const warn = warnAt(t);
    const mood = t < LS('l2') ? 'smile' : t < LS('l3') - 0.05 ? 'calm' : 'flat';
    drawChat(ctx, t, {
      ...WIN, msgs: A_MSGS, mood, border: warn > 0.05 ? rgba(COL.warn, 0.25 + 0.5 * warn) : null,
    });
    // shield flash where the fist lands
    const sf = t - FIST_T;
    if (sf > 0 && sf < 0.8) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const k = prog(sf, i * 0.08, 0.6 + i * 0.08);
        if (k <= 0 || k >= 1) continue;
        ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = COL.accent; ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.beginPath(); ctx.arc(540, 740, 60 + eOut(k) * 520, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 0.35 * (1 - prog(sf, 0, 0.35)); ctx.strokeStyle = COL.accent; ctx.lineWidth = 8;
      rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, 46); ctx.stroke();
      ctx.restore();
    }
    // fist flies at the screen and bounces off
    const t0 = FIST_T - 1.1;
    if (t > t0 && t < FIST_T + 1.3) {
      let s, x, y, rot, a = 1;
      if (t < FIST_T) {
        const k = prog(t, t0, FIST_T);
        const wind = Math.sin(prog(t, t0, t0 + 0.5) * Math.PI) * 0.12;
        s = lerp(0.18, 1.55, eIn(k)) - wind; x = 540 + Math.sin(k * 3) * 30; y = 760 - Math.sin(k * Math.PI) * 40; rot = lerp(-0.4, 0, k);
        a = prog(t, t0, t0 + 0.2);
      } else {
        const k = prog(t, FIST_T, FIST_T + 1.3);
        s = lerp(1.55, 0.7, eOut(k)); x = 540 + eOut(k) * 260; y = 740 - 300 * k + 1500 * k * k; rot = k * 2.4;
        a = 1 - prog(k, 0.7, 1);
      }
      ctx.save(); fade(ctx, a); drawFist(ctx, x, y, s, rot); ctx.restore();
      // impact stars
      if (t >= FIST_T && t < FIST_T + 0.45) {
        const k = prog(t, FIST_T, FIST_T + 0.45);
        ctx.save(); fade(ctx, 1 - k); ctx.fillStyle = COL.hl;
        for (let i = 0; i < 8; i++) {
          const an = i / 8 * Math.PI * 2 + 0.3, d = 170 + eOut(k) * 160;
          ctx.save(); ctx.translate(540 + Math.cos(an) * d, 740 + Math.sin(an) * d); ctx.rotate(an);
          ctx.beginPath(); ctx.moveTo(-34 * (1 - k), 0); ctx.lineTo(0, -7); ctx.lineTo(34 * (1 - k), 0); ctx.lineTo(0, 7); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
    }
    // the angry bubbles take over
    for (const f of FLOATERS) {
      if (t < f.t) continue;
      const k = eBack(prog(t, f.t, f.t + 0.32)), grow = 1 + 0.3 * prog(t, f.t, ACTS.A[1]);
      const m = { kind: 'angry', side: 'user', text: f.text, seed: Math.round(f.t * 100) };
      const L = layout(ctx, m, 900);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r); ctx.scale(f.s * k * grow, f.s * k * grow);
      drawBubble(ctx, t, m, L, -L.w / 2, -L.h / 2); ctx.restore();
    }
  }

  // Act B ---------------------------------------------------------
  function revealWord(ctx, text, cx, cy, size, col, t, t0) {
    ctx.save(); ctx.font = FONT(900, size); ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width; let x = cx - tw / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], cw = ctx.measureText(ch).width;
      const k = eOut(prog(t, t0 + i * 0.035, t0 + i * 0.035 + 0.45));
      if (k > 0) {
        ctx.save(); fade(ctx, k); ctx.fillStyle = col;
        ctx.translate(x + cw / 2, cy + (1 - k) * size * 0.6); ctx.rotate((1 - k) * 0.25);
        ctx.fillText(ch, -cw / 2, 0); ctx.restore();
      }
      x += cw;
    }
    ctx.restore();
  }
  function actB(ctx, t) {
    const up = eInOut(prog(t, B.tE - 0.25, B.tE + 0.35));
    const size = lerp(136, 92, up);
    revealWord(ctx, 'Anthropic', 540, lerp(600, 500, up), size, '#fff', t, B.tA);
    revealWord(ctx, 'Claude', 540, lerp(770, 606, up), size, COL.accent, t, B.tC);
    // thin connector between the names
    const ck = eOut(prog(t, B.tC - 0.15, B.tC + 0.3));
    if (ck > 0) {
      ctx.save(); fade(ctx, ck * 0.6); ctx.strokeStyle = COL.accent; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const ym = lerp(686, 553, up), hw = 46 * ck;
      ctx.beginPath(); ctx.moveTo(540 - hw, ym); ctx.lineTo(540 + hw, ym); ctx.stroke(); ctx.restore();
    }

    // End conversation button
    if (t >= B.tE) {
      const k = eBack(prog(t, B.tE, B.tE + 0.5)), a = clamp(prog(t, B.tE, B.tE + 0.15));
      const armed = eOut(prog(t, B.armAt, B.armAt + 0.3));
      const bw = 690, bh = 132, cx = 540, cy = 770;
      ctx.save(); fade(ctx, a); ctx.translate(cx, cy);
      ctx.scale(k * (1 + 0.04 * armed * Math.sin(t * 9)), k * (1 + 0.04 * armed * Math.sin(t * 9)));
      ctx.shadowColor = rgba(COL.warn, 0.35 + 0.55 * armed); ctx.shadowBlur = 30 + 50 * armed;
      const g = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      g.addColorStop(0, rgba(COL.warn, 0.22 + 0.7 * armed)); g.addColorStop(1, rgba('#E2304A', 0.18 + 0.7 * armed));
      ctx.fillStyle = g; rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 4; ctx.strokeStyle = COL.warn; ctx.stroke();
      // X icon
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(-bw / 2 + 74, 0, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.beginPath();
      ctx.moveTo(-bw / 2 + 64, -10); ctx.lineTo(-bw / 2 + 84, 10); ctx.moveTo(-bw / 2 + 84, -10); ctx.lineTo(-bw / 2 + 64, 10); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = FONT(800, 52); ctx.textBaseline = 'middle';
      ctx.fillText('End conversation', -bw / 2 + 126, 3);
      ctx.restore();
      // ripple when it arms
      const rk = prog(t, B.armAt, B.armAt + 0.7);
      if (rk > 0 && rk < 1) {
        ctx.save(); ctx.globalAlpha *= 1 - rk; ctx.strokeStyle = COL.warn; ctx.lineWidth = 4;
        rr(ctx, cx - bw / 2 - 40 * eOut(rk), cy - bh / 2 - 40 * eOut(rk), bw + 80 * eOut(rk), bh + 80 * eOut(rk), bh); ctx.stroke(); ctx.restore();
      }
    }

    // severity meter: only the far end unlocks the button
    const mk = eOut(prog(t, B.tR - 0.7, B.tR - 0.2));
    if (mk > 0) {
      const x0 = 150, x1 = 930, y = 925, bh = 30, f = B.fill(t), thr = 0.8;
      ctx.save(); fade(ctx, mk); ctx.translate(0, (1 - mk) * 40);
      ctx.font = FONT(800, 26); ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('A B U S E   L E V E L', x0, y - 44);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, x0, y, x1 - x0, bh, bh / 2); ctx.fill();
      ctx.fillStyle = rgba(COL.warn, 0.18); rr(ctx, x0 + (x1 - x0) * thr, y, (x1 - x0) * (1 - thr), bh, [0, bh / 2, bh / 2, 0]); ctx.fill();
      if (f > 0.01) {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, COL.accent); g.addColorStop(0.55, COL.hl); g.addColorStop(0.85, COL.warn);
        ctx.fillStyle = g; rr(ctx, x0, y, (x1 - x0) * f, bh, bh / 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * f, y + bh / 2, 22, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * thr, y - 18); ctx.lineTo(x0 + (x1 - x0) * thr, y + bh + 18); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = FONT(800, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText('mild', x0, y + bh + 44);
      ctx.textAlign = 'right'; ctx.fillStyle = COL.warn; ctx.fillText('extreme', x1, y + bh + 44);
      ctx.restore();
    }
  }

  // Act C ---------------------------------------------------------
  function actC(ctx, t) {
    const swapK = eInOut(prog(t, C.swap, C.swap + 0.6));
    const counter = (ctx, t, b) => {
      const hide = prog(t, C.newShow - 0.4, C.newShow - 0.1);
      if (hide < 1) {
        ctx.save(); fade(ctx, 1 - hide);
        for (let i = 0; i < 3; i++) {
          const bt = C_MSGS.find(m => m.badge === i + 1).t + 0.2;
          const k = eBack(prog(t, bt, bt + 0.35));
          const cx = b.x + b.w - 168 + i * 56, cy = b.y + b.hh / 2 + 4;
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.stroke();
          if (k > 0) { ctx.fillStyle = COL.hl; ctx.beginPath(); ctx.arc(cx, cy, 20 * k, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = k > 0.5 ? COL.navy : 'rgba(255,255,255,0.45)'; ctx.font = FONT(900, 22);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), cx, cy + 1); ctx.textAlign = 'left';
        }
        ctx.restore();
      }
      const show = eBack(prog(t, C.newShow, C.newShow + 0.4));
      if (show > 0) {
        const blink = t > C.newShow + 0.3 && t < C.press ? 0.5 + 0.5 * Math.sin((t - C.newShow) * 14) : 0;
        const press = 1 - 0.1 * Math.sin(Math.PI * prog(t, C.press, C.press + 0.2));
        const bw = 236, bh = 66, cx = b.x + b.w - 40 - bw / 2, cy = b.y + b.hh / 2 + 4;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(show * press, show * press);
        ctx.shadowColor = rgba(COL.accent, 0.9); ctx.shadowBlur = 10 + 40 * blink;
        ctx.fillStyle = COL.accent; rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = rgba('#FFFFFF', 0.35 * blink); ctx.fill();
        ctx.fillStyle = COL.navy; ctx.font = FONT(900, 30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('+  New chat', 0, 2); ctx.restore();
      }
    };
    if (swapK < 1) {
      ctx.save(); ctx.translate(-swapK * 1150, 0); ctx.rotate(-0.05 * swapK);
      drawChat(ctx, t, {
        ...WIN, msgs: C_MSGS, mood: t < C.lockAt ? 'smile' : 'flat', lockAt: C.lockAt, trySend: C.trySend, headerRight: counter,
        border: t >= C.lockAt ? rgba(COL.warn, 0.45 * (1 - prog(t, C.lockAt + 0.4, C.lockAt + 1.6)) + 0.1) : null,
      });
      // big lock stamp
      const lk = t - C.lockAt;
      if (lk > 0 && lk < 1.6) {
        const pin = eBack(prog(lk, 0, 0.4)), away = eInOut(prog(lk, 1.0, 1.5));
        const cx = lerp(540, WIN.x + 82, away), cy = lerp(720, WIN.y + WIN.h - 70, away), s = pin * lerp(1, 0.25, away);
        ctx.save(); fade(ctx, 1 - prog(lk, 1.35, 1.55));
        ctx.translate(cx, cy); ctx.scale(s, s);
        ctx.shadowColor = rgba(COL.warn, 0.7); ctx.shadowBlur = 50;
        ctx.fillStyle = 'rgba(14,19,37,0.92)'; ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.lineWidth = 7; ctx.strokeStyle = COL.warn; ctx.stroke();
        drawLock(ctx, 0, -8, 1, COL.warn);
        ctx.restore();
        const rk = prog(lk, 0, 0.6);
        if (rk < 1) {
          ctx.save(); ctx.globalAlpha *= 1 - rk; ctx.strokeStyle = COL.warn; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(540, 720, 118 + eOut(rk) * 260, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }
      ctx.restore();
    }
    if (t >= C.swap) {
      const nk = eOut(prog(t, C.swap + 0.15, C.swap + 0.6));
      ctx.save(); fade(ctx, nk); ctx.translate(540, 745); ctx.scale(lerp(0.85, 1, nk), lerp(0.85, 1, nk)); ctx.translate(-540, -745);
      drawChat(ctx, t, { ...WIN, msgs: C_NEW, mood: 'smile', status: 'new chat', caret: true });
      ctx.restore();
    }
  }

  // Act D ---------------------------------------------------------
  function actD(ctx, t) {
    const t0 = ACTS.D[0];
    // notebook
    const nk = eBack(prog(t, t0 + 0.1, t0 + 0.6));
    ctx.save(); ctx.translate(680, 820); ctx.rotate(0.08 + (1 - nk) * 0.2); ctx.scale(nk * 0.9, nk * 0.9);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
    ctx.fillStyle = '#EEF3FF'; rr(ctx, -210, -250, 420, 500, 30); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = COL.accent; rr(ctx, -210, -250, 420, 60, [30, 30, 0, 0]); ctx.fill();
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = COL.bg; ctx.beginPath(); ctx.arc(-165 + i * 55, -250, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9AA6C4'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-165 + i * 55, -268); ctx.lineTo(-165 + i * 55, -236); ctx.stroke();
    }
    ctx.fillStyle = COL.navy; ctx.font = FONT(900, 40); ctx.textBaseline = 'middle'; ctx.fillText('AI welfare', -170, -140);
    ctx.fillStyle = 'rgba(14,19,37,0.45)'; ctx.font = FONT(700, 24); ctx.fillText('research notes', -170, -98);
    const lines = [300, 250, 320, 210, 280];
    lines.forEach((len, i) => {
      const k = eInOut(prog(t, t0 + 0.6 + i * 0.4, t0 + 1.0 + i * 0.4));
      if (k <= 0) return;
      const y = -40 + i * 52;
      ctx.strokeStyle = i === 2 ? COL.accent : '#A9B8DA'; ctx.lineWidth = 10; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-170, y); ctx.lineTo(-170 + len * k, y); ctx.stroke();
    });
    const ck = eBack(prog(t, t0 + 2.9, t0 + 3.3));
    if (ck > 0) {
      ctx.save(); ctx.translate(140, 200); ctx.scale(ck, ck);
      ctx.fillStyle = COL.warn; ctx.beginPath(); ctx.moveTo(0, 22);
      ctx.bezierCurveTo(-46, -8, -26, -46, 0, -22); ctx.bezierCurveTo(26, -46, 46, -8, 0, 22); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    // microscope
    const mk = eBack(prog(t, t0 + 0.25, t0 + 0.8));
    ctx.save(); fade(ctx, clamp(mk * 2));
    drawMicroscope(ctx, 360, 800 + (1 - mk) * 120 + Math.sin(t * 2.2) * 6, 1.22, t);
    ctx.restore();
    // sparkles
    const r = rng(77);
    for (let i = 0; i < 14; i++) {
      const sx = 140 + r() * 800, sy0 = 1000 - r() * 500, sp = 40 + r() * 60, ph = r() * 3;
      const life = ((t - t0) * 0.6 + ph) % 1, sy = sy0 - life * sp * 3;
      ctx.save(); fade(ctx, Math.sin(life * Math.PI) * 0.8 * prog(t, t0 + 0.3, t0 + 0.8));
      ctx.fillStyle = i % 3 ? COL.accent : COL.hl; ctx.translate(sx, sy); ctx.rotate(t);
      ctx.fillRect(-2, -10, 4, 20); ctx.fillRect(-10, -2, 20, 4); ctx.restore();
    }
    // "Anthropic says" label
    const lk = eOut(prog(t, WT('l7', 'anthropic') - 0.1, WT('l7', 'anthropic') + 0.35));
    if (lk > 0) {
      ctx.save(); fade(ctx, lk); ctx.translate(0, (1 - lk) * 30);
      ctx.font = FONT(800, 32); const tw = ctx.measureText('Anthropic says').width;
      ctx.fillStyle = 'rgba(255,255,255,0.09)'; rr(ctx, 540 - tw / 2 - 34, 432, tw + 68, 66, 33); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText('Anthropic says', 540 - tw / 2, 467);
      ctx.restore();
    }
  }

  // Act E ---------------------------------------------------------
  function actE(ctx, t) {
    const ck = prog(t, E.close, E.close + 0.45);
    const sy = ck < 0.55 ? lerp(1, 0.012, eInOut(ck / 0.55)) : 0.012;
    const sx = ck < 0.55 ? 1 : lerp(1, 0, eInOut((ck - 0.55) / 0.45));
    const warn = warnAt(t);
    const mood = t < LS('l9') ? 'smile' : t < E.bye ? 'flat' : 'calm';
    ctx.save();
    ctx.translate(540, WIN.y + WIN.h / 2); ctx.scale(sx, sy); ctx.translate(-540, -(WIN.y + WIN.h / 2));
    if (ck > 0) { ctx.globalAlpha *= 1 - prog(ck, 0.8, 1); }
    drawChat(ctx, t, { ...WIN, msgs: E_MSGS, mood, border: warn > 0.05 ? rgba(COL.warn, 0.2 + 0.5 * warn) : null });
    if (ck > 0) { ctx.fillStyle = `rgba(255,255,255,${0.9 * prog(ck, 0, 0.5)})`; rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, 46); ctx.fill(); }
    ctx.restore();
    if (ck > 0.4 && ck < 1) {
      ctx.save(); ctx.globalAlpha *= 1 - prog(ck, 0.6, 1);
      blob(ctx, 540, WIN.y + WIN.h / 2, 260, '#FFFFFF', 0.5); ctx.restore();
    }
  }

  // Act F ---------------------------------------------------------
  function actF(ctx, t) {
    const t0 = ACTS.F[0];
    const ak = eBack(prog(t, t0 + 0.1, t0 + 0.6));
    if (ak > 0) {
      ctx.save(); ctx.translate(540, 640 + Math.sin(t * 2.4) * 8); ctx.scale(ak, ak);
      blob(ctx, 0, 0, 260, COL.accent, 0.35);
      drawBot(ctx, 0, 0, 118, 'smile', t);
      ctx.restore();
      const hk = eBack(prog(t, t0 + 0.4, t0 + 0.8));
      ctx.save(); ctx.translate(700, 560); ctx.rotate(Math.sin(t * 9) * 0.35); ctx.scale(hk, hk);
      ctx.font = FONT(400, 110); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👋', 0, 0); ctx.restore();
    }
    const nk = eOut(prog(t, t0 + 0.35, t0 + 0.8));
    if (nk > 0) {
      ctx.save(); fade(ctx, nk); ctx.translate(0, (1 - nk) * 40);
      let size = 100; ctx.font = FONT(900, size);
      while (ctx.measureText(CONFIG.channel).width > 940 && size > 40) { size -= 4; ctx.font = FONT(900, size); }
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(CONFIG.channel, 540, 868);
      const tw = ctx.measureText(CONFIG.channel).width, uk = eInOut(prog(t, t0 + 0.6, t0 + 1.1));
      ctx.fillStyle = COL.accent; rr(ctx, 540 - tw / 2, 868 + size * 0.55, tw * uk, 10, 5); ctx.fill();
      ctx.restore();
    }
    const fk = eBack(prog(t, t0 + 0.8, t0 + 1.25));
    if (fk > 0) {
      const p = 1 + 0.035 * Math.sin((t - t0) * 6);
      ctx.save(); ctx.translate(540, 1040); ctx.scale(fk * p, fk * p);
      ctx.shadowColor = rgba(COL.accent, 0.7); ctx.shadowBlur = 40;
      ctx.fillStyle = COL.accent; rr(ctx, -280, -64, 560, 128, 64); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = COL.navy; ctx.font = FONT(900, 50); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Follow for more', 0, 3); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- headlines (on-screen text)
  const HEADS = [
    { s: 0.15, e: LS('l2') + 0.05, lines: [{ at: 0.15, parts: [['Insult it ', COL.text], ['for free?', COL.accent]] }] },
    { s: WT('l2', 'apologize') + 0.1, e: LS('l3') - 0.05, lines: [{ at: WT('l2', 'apologize') + 0.1, parts: [['“Sorry.', COL.text]] }, { at: WT('l2', 'calm') + 0.05, parts: [['Let’s calm down.”', COL.text]] }] },
    { s: LS('l3'), e: ACTS.A[1] - 0.05, glitch: true, lines: [{ at: LS('l3'), parts: [['That’s changing', COL.warn]] }] },
    { s: B.tR - 0.1, e: ACTS.B[1] - 0.05, lines: [{ at: B.tR - 0.1, parts: [['Rare, ', COL.text], ['extreme', COL.warn], [' cases', COL.text]] }] },
    { s: LS('l5') + 0.1, e: LE('l5') + 0.25, lines: [{ at: LS('l5') + 0.1, parts: [['Tries to ', COL.text], ['redirect', COL.hl], [' first', COL.text]] }] },
    { s: LE('l5') + 0.3, e: ACTS.C[1] - 0.05, lines: [{ at: LE('l5') + 0.3, parts: [['Not a ban.', COL.text]] }, { at: C.newShow, parts: [['Start a ', COL.text], ['new chat.', COL.accent]] }] },
    { s: WT('l7', 'part'), e: ACTS.D[1] - 0.1, lines: [{ at: WT('l7', 'part'), parts: [['Part of ', COL.text], ['AI welfare', COL.accent]] }, { at: WT('l7', 'research'), parts: [['research', COL.text]] }] },
    { s: WT('l8', 'once'), e: LS('l9') - 0.2, lines: [{ at: WT('l8', 'once'), parts: [['Once or twice? ', COL.text], ['Fine.', COL.accent]] }] },
    { s: E.bye - 0.05, e: ACTS.E[1] - 0.05, lines: [{ at: E.bye - 0.05, parts: [['Goodbye 👋', COL.text]] }] },
  ];
  function drawHeads(ctx, t) {
    for (const h of HEADS) {
      if (t < h.s || t > h.e) continue;
      const out = eIn(prog(t, h.e - 0.28, h.e));
      const n = h.lines.length;
      h.lines.forEach((ln, li) => {
        if (t < ln.at) return;
        const cy = n === 1 ? 312 : 266 + li * 96;
        let size = 80;
        const words = [];
        ln.parts.forEach(([txt, col]) => txt.split(' ').filter(Boolean).forEach(w => words.push([w, col])));
        ctx.save();
        const gap = () => size * 0.27;
        const measure = () => { ctx.font = FONT(900, size); return words.reduce((s, [w]) => s + ctx.measureText(w).width, 0) + gap() * (words.length - 1); };
        let tw = measure();
        while (tw > 960) { size -= 4; tw = measure(); }
        let x = 540 - tw / 2;
        ctx.textBaseline = 'middle';
        words.forEach(([w, col], j) => {
          const ww = ctx.measureText(w).width;
          const k = eOut(prog(t, ln.at + j * 0.06, ln.at + j * 0.06 + 0.4));
          const sc = lerp(0.7, 1, eBack(prog(t, ln.at + j * 0.06, ln.at + j * 0.06 + 0.4)));
          ctx.save(); fade(ctx, k * (1 - out));
          ctx.translate(x + ww / 2, cy + (1 - k) * 46 - out * 36); ctx.scale(sc, sc);
          ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
          if (h.glitch) {
            const r = rng(Math.floor(t * 24) + j);
            const gk = 0.4 + glitchAt(t);
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = rgba(COL.accent, 0.8); ctx.fillText(w, -ww / 2 - 8 * gk * r(), (r() - 0.5) * 8 * gk);
            ctx.fillStyle = rgba(COL.warn, 0.9); ctx.fillText(w, -ww / 2 + 8 * gk * r(), (r() - 0.5) * 8 * gk);
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.fillStyle = col; ctx.fillText(w, -ww / 2, 0);
          ctx.restore();
          x += ww + gap();
        });
        ctx.restore();
      });
    }
  }

  // ---------------------------------------------------------------- subtitles
  const SUB_Y = 1226;
  function drawSubs(ctx, t) {
    const c = CHUNKS.find(c => t >= c.s && t < c.e);
    if (!c) return;
    const k = prog(t, c.s, c.s + 0.16);
    const a = clamp(k * 2.5) * (1 - prog(t, c.e - 0.06, c.e));
    const sc = lerp(0.82, 1, eBack(k));
    const size = 94;
    ctx.save();
    ctx.font = FONT(900, size);
    const space = size * 0.27;
    const ws = c.words.map(w => ({ ...w, width: ctx.measureText(w.w).width }));
    const total = ws.reduce((s, w) => s + w.width, 0) + space * (ws.length - 1);
    let rows = [ws];
    if (total > 980) {
      let best = 1, bestD = Infinity;
      for (let i = 1; i < ws.length; i++) {
        const l = ws.slice(0, i).reduce((s, w) => s + w.width + space, -space);
        const r = ws.slice(i).reduce((s, w) => s + w.width + space, -space);
        const d = Math.max(l, r); if (d < bestD) { bestD = d; best = i; }
      }
      rows = [ws.slice(0, best), ws.slice(best)];
    }
    let cur = null;
    for (const w of ws) if (t >= w.s) cur = w;
    ctx.translate(540, SUB_Y); ctx.scale(sc, sc);
    fade(ctx, a);
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const lh = 108;
    rows.forEach((row, ri) => {
      const rw = row.reduce((s, w) => s + w.width + space, -space);
      let x = -rw / 2;
      const y = (ri - (rows.length - 1) / 2) * lh;
      for (const w of row) {
        const on = cur && w.s === cur.s;
        const pop = on ? 1 + 0.1 * Math.sin(Math.PI * prog(t, w.s, w.s + 0.22)) : 1;
        ctx.save(); ctx.translate(x + w.width / 2, y); ctx.scale(pop, pop);
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
        ctx.lineWidth = 16; ctx.strokeStyle = '#000'; ctx.strokeText(w.w, -w.width / 2, 0);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = on ? COL.hl : '#fff'; ctx.fillText(w.w, -w.width / 2, 0);
        ctx.restore();
        x += w.width + space;
      }
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame
  function render(ctx, t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawBG(ctx, t);
    const sh = shake(t);
    ctx.save(); ctx.translate(sh.x, sh.y);
    withAct(ctx, t, ACTS.A, t => actA(ctx, t), { noIn: true });
    withAct(ctx, t, ACTS.B, t => actB(ctx, t));
    withAct(ctx, t, ACTS.C, t => actC(ctx, t));
    withAct(ctx, t, ACTS.D, t => actD(ctx, t));
    withAct(ctx, t, ACTS.E, t => actE(ctx, t), { noOut: true });
    withAct(ctx, t, ACTS.F, t => actF(ctx, t), { noOut: true });
    ctx.restore();
    drawHeads(ctx, t);
    drawSubs(ctx, t);
    const gk = glitchAt(t);
    if (gk > 0.02) glitch(ctx, t, gk);
    drawVignette(ctx);
    drawGrain(ctx, t);
    ctx.restore();
  }

  // ---------------------------------------------------------------- exports
  function fmt(t) {
    const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  const srt = () => CHUNKS.map((c, i) => `${i + 1}\n${fmt(c.s)} --> ${fmt(c.e)}\n${c.words.map(w => w.w).join(' ')}\n`).join('\n');
  const voScript = () => VO.map(l => `${fmt(l.s)} – ${fmt(l.e)}  ${l.text.replace(/\|/g, ' ')}`).join('\n');

  // Everything the After Effects builder needs, measured with the real fonts.
  function exportData(ctx) {
    const EMOJI = /\s*(\p{Extended_Pictographic})\s*$/u;
    const maxW = (WIN.w - 56) * 0.8;
    const msg = m => {
      const L = layout(ctx, m, maxW);
      const o = { side: m.side, kind: m.kind, t: m.t, until: m.until, badge: m.badge, burst: !!m.burst, seed: m.seed, w: L.w, h: L.h, lh: L.lh, lines: L.lines.slice() };
      const last = o.lines.length - 1;
      const em = last >= 0 && o.lines[last].match(EMOJI);
      if (em) {
        o.emoji = em[1];
        o.lines[last] = o.lines[last].replace(EMOJI, '');
        ctx.save(); ctx.font = bubbleFont(m); o.emojiX = ctx.measureText(o.lines[last] + ' ').width; ctx.restore();
      }
      return o;
    };
    const heads = HEADS.map(h => ({
      s: h.s, e: h.e, glitch: !!h.glitch,
      lines: h.lines.map((ln, li) => {
        const words = [];
        ln.parts.forEach(([txt, col]) => txt.split(' ').filter(Boolean).forEach(w => words.push([w, col])));
        let size = 80, tw;
        const measure = () => { ctx.font = FONT(900, size); return words.reduce((s, [w]) => s + ctx.measureText(w).width, 0) + size * 0.27 * (words.length - 1); };
        tw = measure(); while (tw > 960) { size -= 4; tw = measure(); }
        let x = 540 - tw / 2;
        const out = words.map(([w, col]) => {
          const em = w.match(/^(\p{Extended_Pictographic})$/u);
          const ww = ctx.measureText(w).width; const o = { w, col, x, width: ww, emoji: !!em }; x += ww + size * 0.27; return o;
        });
        return { at: ln.at, y: h.lines.length === 1 ? 312 : 266 + li * 96, size, words: out };
      }),
    }));
    ctx.save(); ctx.font = FONT(900, 94);
    const subs = CHUNKS.map(c => {
      const space = 94 * 0.27;
      const ws = c.words.map(w => ({ w: w.w, s: w.s, e: w.e, width: ctx.measureText(w.w).width }));
      const total = ws.reduce((s, w) => s + w.width, 0) + space * (ws.length - 1);
      let rows = [ws];
      if (total > 980) {
        let best = 1, bestD = Infinity;
        for (let i = 1; i < ws.length; i++) {
          const l = ws.slice(0, i).reduce((s, w) => s + w.width + space, -space), r = ws.slice(i).reduce((s, w) => s + w.width + space, -space);
          if (Math.max(l, r) < bestD) { bestD = Math.max(l, r); best = i; }
        }
        rows = [ws.slice(0, best), ws.slice(best)];
      }
      rows.forEach((row, ri) => {
        const rw = row.reduce((s, w) => s + w.width + space, -space); let x = 540 - rw / 2;
        for (const w of row) { w.x = x; w.y = SUB_Y + (ri - (rows.length - 1) / 2) * 108; x += w.width + space; }
      });
      return { s: c.s, e: c.e, words: ws };
    });
    ctx.restore();
    const sample = (f, a, b, step = 1 / 15) => { const r = []; for (let t = a; t <= b + 1e-6; t += step) r.push([+t.toFixed(3), +f(t).toFixed(4)]); return r; };
    return {
      W, H, FPS, DURATION, COL, WIN, CONFIG, ACTS, FIST_T,
      VO: VO.map(l => ({ id: l.id, s: l.s, e: l.e, text: l.text.replace(/\|/g, ' ') })),
      A_MSGS: A_MSGS.map(msg), C_MSGS: C_MSGS.map(msg), C_NEW: C_NEW.map(msg), E_MSGS: E_MSGS.map(msg),
      FLOATERS: FLOATERS.map(f => ({ ...f, ...(() => { const L = layout(ctx, { kind: 'angry', text: f.text }, 900); return { w: L.w, h: L.h }; })() })),
      B: { ...B, fill: undefined, fillCurve: sample(B.fill, B.tR - 0.4, ACTS.B[1]) }, C, E,
      GLITCHES, IMPULSES, SFX, heads, subs,
      warn: sample(warnAt, 0, DURATION),
      L7: WT('l7', 'anthropic'),
      channel: (() => { let size = 100; ctx.font = FONT(900, size); while (ctx.measureText(CONFIG.channel).width > 940 && size > 40) { size -= 4; ctx.font = FONT(900, size); } return { text: CONFIG.channel, size, width: ctx.measureText(CONFIG.channel).width }; })(),
      LS: Object.fromEntries(VO.map(l => [l.id, l.s])), LE: Object.fromEntries(VO.map(l => [l.id, l.e])),
    };
  }

  global.SHORT = { W, H, FPS, DURATION, CONFIG, VO, SFX, ACTS, render, srt, voScript, exportData };
})(typeof window !== 'undefined' ? window : globalThis);
