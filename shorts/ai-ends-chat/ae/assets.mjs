// Vector assets described once as primitives. build.mjs turns them into
// After Effects shape layers, and into standalone SVG files.
//
// Primitives (coordinates in px, y down):
//   { t: 'rect', x, y, w, h, r, fill, op, stroke, sw, sop, name }
//   { t: 'ell', cx, cy, rx, ry, fill, op, stroke, sw, sop, name }
//   { t: 'path', v: [[x, y]...], i: [[dx, dy]...], o: [[dx, dy]...], closed, fill, stroke, sw, cap, name }
//   { t: 'group', name, x, y, rot (deg), sc (%), op, kids: [...] }
//   { t: 'rep', copies, dx, dy }          (AE repeater, applies to what is above it in the group)
//   { t: 'trim', start, end }             (AE trim paths)
//   { t: 'text', x, y, text, font, size, fill, op, just }  (becomes a text layer in AE)

export const COL = { bg: '#0E1325', accent: '#3DDCFF', warn: '#FF4D5E', hl: '#FFD93D', text: '#FFFFFF', navy: '#0E1325' };
export const FONTS = {
  black: { ps: 'InterDisplay-Black', family: 'Inter Display', weight: 900 },
  xbold: { ps: 'InterDisplay-ExtraBold', family: 'Inter Display', weight: 800 },
  bold: { ps: 'Inter-Bold', family: 'Inter', weight: 700 },
  semi: { ps: 'Inter-SemiBold', family: 'Inter', weight: 600 },
};

export const rect = (x, y, w, h, r, style = {}) => ({ t: 'rect', x, y, w, h, r, ...style });
export const ell = (cx, cy, rx, ry, style = {}) => ({ t: 'ell', cx, cy, rx, ry: ry ?? rx, ...style });
export const group = (name, kids, tf = {}) => ({ t: 'group', name, x: 0, y: 0, rot: 0, sc: 100, op: 100, ...tf, kids });
export const line = (pts, style = {}) => ({ t: 'path', v: pts, i: pts.map(() => [0, 0]), o: pts.map(() => [0, 0]), closed: false, ...style });

// Circular arc (canvas angle convention) as a bezier path.
export function arc(cx, cy, r, a0, a1, style = {}) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const da = (a1 - a0) / n, k = (4 / 3) * Math.tan(da / 4);
  const v = [], i = [], o = [];
  for (let s = 0; s <= n; s++) {
    const a = a0 + da * s, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const tx = -Math.sin(a) * r * k, ty = Math.cos(a) * r * k;
    v.push([x, y]); i.push(s === 0 ? [0, 0] : [-tx, -ty]); o.push(s === n ? [0, 0] : [tx, ty]);
  }
  return { t: 'path', v, i, o, closed: false, ...style };
}
// Quadratic segment p0-q-p2 as a cubic path.
export function quad(p0, q, p2, style = {}) {
  const c1 = [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])];
  const c2 = [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1])];
  return { t: 'path', v: [p0, p2], i: [[0, 0], [c2[0] - p2[0], c2[1] - p2[1]]], o: [[c1[0] - p0[0], c1[1] - p0[1]], [0, 0]], closed: false, ...style };
}

// ------------------------------------------------------------------ assets
export function bot(r = 100) {
  const ink = '#C6F6FF', ex = r * 0.3, ey = -r * 0.06, lw = r * 0.09;
  const eyes = () => [-1, 1].map(s => rect(s * ex - r * 0.075, ey - r * 0.12, r * 0.15, r * 0.24, r * 0.07, { fill: ink }));
  const smile = () => arc(0, r * 0.1, r * 0.2, Math.PI * 0.2, Math.PI * 0.8, { stroke: ink, sw: lw, cap: 'round' });
  return [
    line([[0, -r * 0.95], [0, -r * 1.22]], { stroke: COL.accent, sw: lw, cap: 'round', name: 'antenna' }),
    ell(0, -r * 1.28, r * 0.13, r * 0.13, { fill: COL.hl, name: 'antenna ball' }),
    ell(0, 0, r, r, { fill: '#2FB6EE', name: 'head' }),
    ell(-r * 0.32, -r * 0.5, r * 0.42, r * 0.26, { fill: '#8BEDFF', op: 45, name: 'shine' }),
    rect(-r * 0.7, -r * 0.46, r * 1.4, r * 0.98, r * 0.42, { fill: '#091028', name: 'face plate' }),
    group('face_smile', [...eyes(), smile()]),
    group('face_calm', [...[-1, 1].map(s => arc(s * ex, ey + r * 0.06, r * 0.13, Math.PI * 1.1, Math.PI * 1.9, { stroke: ink, sw: lw, cap: 'round' })), smile()], { op: 0 }),
    group('face_flat', [...eyes(), line([[-r * 0.16, r * 0.26], [r * 0.16, r * 0.26]], { stroke: ink, sw: lw, cap: 'round' })], { op: 0 }),
  ];
}

export function lock(col = COL.warn) {
  const shackle = arc(0, -30, 32, Math.PI, Math.PI * 2);
  shackle.v.unshift([-32, -2]); shackle.i.unshift([0, 0]); shackle.o.unshift([0, 0]);
  shackle.v.push([32, -2]); shackle.i.push([0, 0]); shackle.o.push([0, 0]);
  return [
    { ...shackle, stroke: col, sw: 14, cap: 'round', name: 'shackle' },
    rect(-54, -12, 108, 86, 18, { fill: col, name: 'body' }),
    ell(0, 22, 11, 11, { fill: '#000000', op: 38 }),
    rect(-5, 22, 10, 26, 4, { fill: '#000000', op: 38 }),
  ];
}

export function fist() {
  const skin = '#FFC857', shade = '#F2A53A', ln = { stroke: '#B86E14', sw: 6 };
  const kids = [
    rect(-84, 150, 168, 70, 20, { fill: COL.warn, name: 'cuff' }),
    rect(-72, 90, 144, 80, 22, { fill: shade, ...ln, name: 'wrist' }),
    rect(-112, -40, 224, 150, 52, { fill: shade, ...ln, name: 'palm' }),
  ];
  for (let i = 0; i < 4; i++) {
    const fx = -112 + i * 56;
    kids.push(rect(fx + 2, -98, 52, 122, 26, { fill: skin, ...ln, name: 'finger ' + (i + 1) }));
    kids.push(line([[fx + 15, -44], [fx + 41, -44]], { ...ln, cap: 'round' }));
  }
  kids.push(rect(-104, 18, 176, 58, 29, { fill: skin, ...ln, name: 'thumb' }));
  kids.push(rect(-96, -86, 30, 40, 15, { fill: '#FFFFFF', op: 35, name: 'shine' }));
  return kids;
}

export function microscope() {
  const dark = '#162250', mid = '#2D4C95', light = '#E6F6FF';
  return [
    rect(-165, 160, 330, 58, 29, { fill: mid, name: 'base' }),
    quad([95, 168], [185, 30], [52, -112], { stroke: mid, sw: 52, cap: 'round', name: 'arm' }),
    rect(-150, 62, 250, 28, 14, { fill: light, name: 'stage' }),
    rect(-10, 54, 90, 12, 6, { fill: COL.accent, name: 'slide' }),
    ell(126, 52, 30, 30, { fill: light, name: 'knob' }),
    ell(126, 52, 13, 13, { fill: dark }),
    group('tube', [
      rect(-40, -150, 80, 192, 24, { fill: '#36C0F0', name: 'body' }),
      rect(-47, -22, 94, 24, 9, { fill: dark, name: 'band' }),
      rect(-31, -210, 62, 66, 14, { fill: light, name: 'eyepiece' }),
      rect(-22, 40, 44, 48, 10, { fill: dark, name: 'objective' }),
      rect(-28, -138, 14, 150, 7, { fill: '#FFFFFF', op: 45, name: 'shine' }),
    ], { y: -40, rot: -0.38 * 180 / Math.PI }),
  ];
}

export function heart(col = COL.warn) {
  return [{ t: 'path', v: [[0, 22], [0, -22]], i: [[46, -30], [-26, -24]], o: [[-46, -30], [26, -24]], closed: true, fill: col, name: 'heart' }];
}

export const NOTE_LINES = [300, 250, 320, 210, 280];
export function notebook() {
  const kids = [
    rect(-210, -250, 420, 500, 30, { fill: '#EEF3FF', name: 'page' }),
    rect(-210, -250, 420, 60, 30, { fill: COL.accent, name: 'band' }),
    rect(-210, -222, 420, 32, 0, { fill: COL.accent }),
  ];
  for (let i = 0; i < 7; i++) {
    const x = -165 + i * 55;
    kids.push(ell(x, -250, 11, 11, { fill: COL.bg }));
    kids.push(line([[x, -268], [x, -236]], { stroke: '#9AA6C4', sw: 6, cap: 'round' }));
  }
  NOTE_LINES.forEach((len, i) => kids.push(group('line ' + (i + 1), [
    line([[-170, -40 + i * 52], [-170 + len, -40 + i * 52]], { stroke: i === 2 ? COL.accent : '#A9B8DA', sw: 10, cap: 'round' }),
    { t: 'trim', start: 0, end: 100 },
  ])));
  kids.push(group('heart', heart(), { x: 140, y: 200 }));
  return kids;
}

export function sendButton(col = COL.accent) {
  return [
    ell(0, 0, 32, 32, { fill: col, name: 'circle' }),
    { t: 'path', v: [[0, 13], [0, -13]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], closed: false, stroke: COL.navy, sw: 6, cap: 'round' },
    line([[-11, -3], [0, -14], [11, -3]], { stroke: COL.navy, sw: 6, cap: 'round' }),
  ];
}

export function xIcon(col = '#FFFFFF') {
  return [
    ell(0, 0, 28, 28, { stroke: col, sw: 5 }),
    line([[-10, -10], [10, 10]], { stroke: col, sw: 6, cap: 'round' }),
    line([[10, -10], [-10, 10]], { stroke: col, sw: 6, cap: 'round' }),
  ];
}

export function plus(col) {
  return [rect(-2, -10, 4, 20, 0, { fill: col }), rect(-10, -2, 20, 4, 0, { fill: col })];
}

export function star() {
  return [{ t: 'path', v: [[-34, 0], [0, -7], [34, 0], [0, 7]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true, fill: COL.hl }];
}

// Chat window frame (origin = top-left of the window).
export function windowFrame(w, h) {
  return [
    rect(0, 0, w, h, 46, { fill: '#131A38', op: 96, stroke: '#FFFFFF', sw: 2, sop: 13, name: 'glass' }),
    rect(32, 112, w - 64, 2, 0, { fill: '#FFFFFF', op: 7, name: 'divider' }),
  ];
}

export function bubble(kind, w, h) {
  if (kind === 'angry') return [rect(0, 0, w, h, 34, { fill: '#F2455B', name: 'bubble' })];
  if (kind === 'bye') return [rect(0, 0, w, h, 34, { fill: '#3BC9F6', name: 'bubble' })];
  return [rect(0, 0, w, h, 34, { fill: COL.accent, op: 13, stroke: COL.accent, sw: 2, sop: 50, name: 'bubble' })];
}

export function pill(w, h, style) { return [rect(-w / 2, -h / 2, w, h, h / 2, { name: 'pill', ...style })]; }

// ------------------------------------------------------------------ SVG
const f = n => +(+n).toFixed(2);
function styleAttr(p) {
  const a = [];
  a.push(`fill="${p.fill || 'none'}"`);
  if (p.fill && p.op != null && p.op !== 100) a.push(`fill-opacity="${p.op / 100}"`);
  if (p.stroke) {
    a.push(`stroke="${p.stroke}" stroke-width="${f(p.sw || 1)}"`);
    if (p.sop != null && p.sop !== 100) a.push(`stroke-opacity="${p.sop / 100}"`);
    if (p.cap === 'round') a.push('stroke-linecap="round" stroke-linejoin="round"');
  }
  return a.join(' ');
}
export function toSVGBody(prims) {
  return prims.map(p => {
    if (p.t === 'rect') return `<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" rx="${f(Math.min(p.r, p.w / 2, p.h / 2))}" ${styleAttr(p)}/>`;
    if (p.t === 'ell') return `<ellipse cx="${f(p.cx)}" cy="${f(p.cy)}" rx="${f(p.rx)}" ry="${f(p.ry)}" ${styleAttr(p)}/>`;
    if (p.t === 'path') {
      let d = `M${f(p.v[0][0])} ${f(p.v[0][1])}`;
      const seg = (a, b) => ` C${f(p.v[a][0] + p.o[a][0])} ${f(p.v[a][1] + p.o[a][1])} ${f(p.v[b][0] + p.i[b][0])} ${f(p.v[b][1] + p.i[b][1])} ${f(p.v[b][0])} ${f(p.v[b][1])}`;
      for (let k = 1; k < p.v.length; k++) d += seg(k - 1, k);
      if (p.closed) d += seg(p.v.length - 1, 0) + 'Z';
      return `<path d="${d}" ${styleAttr(p)}/>`;
    }
    if (p.t === 'group') {
      const op = p.op != null && p.op !== 100 ? ` opacity="${p.op / 100}"` : '';
      return `<g id="${(p.name || '').replace(/\s+/g, '-')}" transform="translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.rot || 0)}) scale(${f((p.sc ?? 100) / 100)})"${op}>${toSVGBody(p.kids)}</g>`;
    }
    if (p.t === 'text') {
      const fo = FONTS[p.font];
      const anchor = p.just === 'center' ? 'middle' : p.just === 'right' ? 'end' : 'start';
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<text x="${f(p.x)}" y="${f(p.y)}" font-family="${fo.family}, Inter, sans-serif" font-weight="${fo.weight}" font-size="${p.size}" fill="${p.fill}"${p.op != null && p.op !== 100 ? ` fill-opacity="${p.op / 100}"` : ''} text-anchor="${anchor}">${esc(p.text)}</text>`;
    }
    return '';
  }).join('\n  ');
}
export function toSVG(prims, [x, y, w, h], bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">\n  ${bg ? `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${bg}"/>\n  ` : ''}${toSVGBody(prims)}\n</svg>\n`;
}
