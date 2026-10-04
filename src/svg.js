// SVG -> flat, colored polygons. Everything runs in the browser.
import polygonClipping from 'polygon-clipping';

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'lineargradient',
  'radialgradient', 'filter', 'style', 'title', 'desc', 'metadata', 'script', 'foreignobject', 'image', 'text']);

// ---------- matrices ----------
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!str) return m;
  for (const [, name, args] of str.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).map(Number);
    let t = [1, 0, 0, 1, 0, 0];
    if (name === 'matrix' && a.length >= 6) t = a.slice(0, 6);
    else if (name === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (name === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (name === 'rotate') {
      const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      t = [c, s, -s, c, 0, 0];
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (name === 'skewX') t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (name === 'skewY') t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

// ---------- path flattening ----------
const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;

function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2, tol, out) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) { out.push([x2, y2]); return; }
  const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.min(256, Math.ceil(Math.abs(dt) * Math.max(rx, ry) / tol / 1.5)));
  for (let k = 1; k <= steps; k++) {
    const t = t1 + dt * k / steps, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  out[out.length - 1] = [x2, y2];
}

function flattenPath(d, tol) {
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', prev = '', lcx = 0, lcy = 0, i = 0;
  const n = d.length;
  const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
  const num = () => { skip(); NUM.lastIndex = i; const m = NUM.exec(d); if (!m) throw 0; i = NUM.lastIndex; return +m[0]; };
  const flag = () => { skip(); const c = d[i]; if (c !== '0' && c !== '1') throw 0; i++; return +c; };
  const begin = (px, py) => { cur = [[px, py]]; subs.push({ pts: cur, closed: false }); x = sx = px; y = sy = py; };
  const ensure = () => { if (!cur) begin(x, y); };
  const steps = (len) => Math.max(3, Math.min(200, Math.ceil(len / tol)));
  const dist = (a, b, c, e) => Math.hypot(c - a, e - b);
  try {
    while (true) {
      skip();
      if (i >= n) break;
      const c = d[i];
      if (/[a-zA-Z]/.test(c)) {
        cmd = c; i++;
        if (cmd === 'z' || cmd === 'Z') {
          if (cur) subs[subs.length - 1].closed = true;
          x = sx; y = sy; cur = null; prev = 'z'; continue;
        }
      } else if (!cmd || cmd === 'z' || cmd === 'Z') break;
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'M') {
        const nx = num() + ox, ny = num() + oy; begin(nx, ny); cmd = rel ? 'l' : 'L'; prev = 'M';
      } else if (C === 'L' || C === 'H' || C === 'V') {
        ensure();
        let nx = x, ny = y;
        if (C === 'L') { nx = num() + ox; ny = num() + oy; }
        else if (C === 'H') nx = num() + ox; else ny = num() + oy;
        cur.push([nx, ny]); x = nx; y = ny; prev = C;
      } else if (C === 'C' || C === 'S') {
        ensure();
        let x1, y1;
        if (C === 'C') { x1 = num() + ox; y1 = num() + oy; }
        else if (prev === 'C' || prev === 'S') { x1 = 2 * x - lcx; y1 = 2 * y - lcy; }
        else { x1 = x; y1 = y; }
        const x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy;
        const k = steps(dist(x, y, x1, y1) + dist(x1, y1, x2, y2) + dist(x2, y2, x3, y3));
        for (let s = 1; s <= k; s++) {
          const t = s / k, u = 1 - t;
          cur.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
        }
        lcx = x2; lcy = y2; x = x3; y = y3; prev = C;
      } else if (C === 'Q' || C === 'T') {
        ensure();
        let x1, y1;
        if (C === 'Q') { x1 = num() + ox; y1 = num() + oy; }
        else if (prev === 'Q' || prev === 'T') { x1 = 2 * x - lcx; y1 = 2 * y - lcy; }
        else { x1 = x; y1 = y; }
        const x2 = num() + ox, y2 = num() + oy;
        const k = steps(dist(x, y, x1, y1) + dist(x1, y1, x2, y2));
        for (let s = 1; s <= k; s++) {
          const t = s / k, u = 1 - t;
          cur.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]);
        }
        lcx = x1; lcy = y1; x = x2; y = y2; prev = C;
      } else if (C === 'A') {
        ensure();
        const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag();
        const nx = num() + ox, ny = num() + oy;
        arcPoints(x, y, rx, ry, phi, fa, fs, nx, ny, tol, cur);
        x = nx; y = ny; prev = C;
      } else break;
    }
  } catch { /* malformed tail: keep what we have */ }
  return subs;
}

function shapeToPath(el) {
  const tag = el.localName.toLowerCase();
  const g = (k, def = 0) => parseFloat(el.getAttribute(k)) || def;
  if (tag === 'path') return el.getAttribute('d') || '';
  if (tag === 'rect') {
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    if (w <= 0 || h <= 0) return '';
    let rx = el.hasAttribute('rx') ? g('rx') : g('ry'), ry = el.hasAttribute('ry') ? g('ry') : rx;
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
      `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = g('cx'), cy = g('cy');
    const rx = tag === 'circle' ? g('r') : g('rx'), ry = tag === 'circle' ? rx : g('ry');
    if (rx <= 0 || ry <= 0) return '';
    return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}Z`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    if (p.length < 6) return '';
    let s = `M${p[0]} ${p[1]}`;
    for (let k = 2; k + 1 < p.length; k += 2) s += `L${p[k]} ${p[k + 1]}`;
    return s + 'Z';
  }
  return '';
}

// ---------- geometry helpers ----------
export const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
  return a / 2;
};

function inRing(px, py, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

// does ring `c` contain ring `r`? (majority vote over a few sample vertices)
function contains(c, r) {
  if (c.bb[0] > r.bb[0] || c.bb[1] > r.bb[1] || c.bb[2] < r.bb[2] || c.bb[3] < r.bb[3]) return false;
  const k = Math.min(5, r.pts.length);
  let votes = 0;
  for (let s = 0; s < k; s++) {
    const p = r.pts[Math.floor(s * r.pts.length / k)];
    if (inRing(p[0], p[1], c.pts)) votes++;
  }
  return votes * 2 > k;
}

// rings of one element -> [{outer, holes}]
function classify(subs, evenodd) {
  const rings = subs.map((s) => {
    const pts = [];
    for (const p of s.pts) {
      const q = pts[pts.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) pts.push(p);
    }
    while (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
    return { pts, area: ringArea(pts) };
  }).filter((r) => r.pts.length >= 3 && Math.abs(r.area) > 1e-12);
  rings.forEach((r) => { r.bb = bboxOf(r.pts); });

  for (const r of rings) {
    const parents = rings.filter((c) => c !== r && contains(c, r));
    r.parents = parents;
    if (evenodd) r.isHole = parents.length % 2 === 1;
    else {
      const wOut = parents.reduce((s, c) => s + Math.sign(c.area), 0);
      const wIn = wOut + Math.sign(r.area);
      r.isHole = wOut !== 0 && wIn === 0;
      r.isOuter = wOut === 0 && wIn !== 0;
      if (!r.isHole && !r.isOuter) r.skip = true; // interior of an already-filled region
    }
    if (evenodd) r.isOuter = !r.isHole;
  }
  const polys = [];
  const outers = rings.filter((r) => r.isOuter && !r.skip);
  const map = new Map(outers.map((o) => [o, { outer: o.pts, holes: [] }]));
  for (const h of rings.filter((r) => r.isHole)) {
    const owner = h.parents.filter((p) => map.has(p)).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0];
    if (owner) map.get(owner).holes.push(h.pts);
  }
  for (const p of map.values()) polys.push(p);
  return polys;
}

// ---------- colors ----------
let ctx2d;
function toHex(css) {
  if (!css) return null;
  css = css.trim();
  let m = css.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/);
  if (!m) {
    ctx2d ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx2d.clearRect(0, 0, 1, 1); ctx2d.fillStyle = '#000'; ctx2d.fillStyle = css; ctx2d.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('');
}

// Paint order: where a later shape of another color covers an earlier one, cut it out
// so every region of the model belongs to exactly one color.
const toMulti = (polys) => polys.map((p) => [p.outer, ...p.holes].map((r) => [...r, r[0]]));
const fromMulti = (mp) => mp.map((rings) => ({ outer: rings[0].slice(0, -1), holes: rings.slice(1).map((r) => r.slice(0, -1)) }));
const bbOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function resolveOverlaps(shapes) {
  shapes.forEach((s) => { s.bb = bboxOf(s.polys.flatMap((p) => p.outer)); });
  let removed = 0;
  for (let i = 0; i < shapes.length; i++) {
    const a = shapes[i];
    const cutters = [];
    for (let j = i + 1; j < shapes.length; j++) {
      const b = shapes[j];
      if (b.color !== a.color && bbOverlap(a.bb, b.bb)) cutters.push(...toMulti(b.polys));
    }
    if (!cutters.length) continue;
    try {
      const res = polygonClipping.difference(toMulti(a.polys), cutters);
      a.polys = fromMulti(res);
      removed++;
    } catch { /* keep original geometry if clipping fails */ }
  }
  return shapes.filter((s) => s.polys.length);
}

// ---------- main ----------
function sanitize(doc) {
  doc.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/href/i.test(a.name) && /^\s*(javascript|data):/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
}

export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') throw new Error('That does not look like a valid SVG file.');
  sanitize(doc);

  // Mount in an isolated shadow root so the SVG's own <style> rules can resolve
  // (classes etc.) without leaking into this page.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const shadow = host.attachShadow({ mode: 'open' });
  const svg = document.importNode(root, true);
  shadow.appendChild(svg);
  document.body.appendChild(host);

  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const diag = vb.length === 4 && vb[2] > 0 ? Math.hypot(vb[2], vb[3]) : Math.hypot(parseFloat(svg.getAttribute('width')) || 1000, parseFloat(svg.getAttribute('height')) || 1000);
  const tol = diag / 1500;

  let shapes = [];
  let unsupported = 0;
  const byId = (id) => shadow.querySelector(`[id="${CSS.escape(id)}"]`);

  const gradientColor = (ref) => {
    let g = byId(ref), guard = 0;
    while (g && !g.querySelector('stop') && guard++ < 8) g = byId((g.getAttribute('href') || g.getAttribute('xlink:href') || '').replace(/^#/, ''));
    const stops = g ? [...g.querySelectorAll('stop')] : [];
    if (!stops.length) return null;
    return toHex(getComputedStyle(stops[Math.floor(stops.length / 2)]).stopColor);
  };

  const walk = (el, m, depth) => {
    if (depth > 40) return;
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    m = mul(m, parseTransform(el.getAttribute('transform')));
    if (tag === 'use') {
      const t = byId((el.getAttribute('href') || el.getAttribute('xlink:href') || '').replace(/^#/, ''));
      if (t) walk(t, mul(m, [1, 0, 0, 1, parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0]), depth + 1);
      return;
    }
    if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch') {
      for (const c of el.children) walk(c, m, depth + 1);
      return;
    }
    const d = shapeToPath(el);
    if (!d) return;
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || parseFloat(cs.fillOpacity) === 0) return;
    let fill = cs.fill;
    if (!fill || fill === 'none') return;
    let hex;
    const u = fill.match(/url\(["']?#([^"')]+)/);
    if (u) { hex = gradientColor(u[1]); unsupported++; } else hex = toHex(fill);
    if (!hex) return;
    const subs = flattenPath(d, tol).filter((s) => s.pts.length >= 3);
    for (const s of subs) s.pts = s.pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const polys = classify(subs, cs.fillRule === 'evenodd');
    if (polys.length) shapes.push({ color: hex, polys, name: el.getAttribute('id') || el.getAttribute('name') || '' });
  };

  try { walk(svg, [1, 0, 0, 1, 0, 0], 0); } finally { host.remove(); }
  if (!shapes.length) throw new Error('No filled shapes found. Strokes-only SVGs are not supported yet.');

  shapes = resolveOverlaps(shapes);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (const p of s.polys) for (const [x, y] of p.outer) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  for (const s of shapes) s.area = s.polys.reduce((a, p) => a + Math.abs(ringArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
  return { shapes, bbox: [x0, y0, x1, y1], gradients: unsupported };
}
