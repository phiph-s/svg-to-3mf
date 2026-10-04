// Group colors: weighted k-means in OKLab so merges follow perceived similarity.

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function toOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** shapes: [{color, area}] -> { colors: [{hex, weight}], map: Map(hex -> group index) } */
export function groupColors(shapes, k) {
  const w = new Map();
  for (const s of shapes) w.set(s.color, (w.get(s.color) || 0) + Math.max(s.area, 1e-9));
  const items = [...w].map(([hex, weight]) => ({ hex, weight, lab: toOklab(hex) }))
    .sort((a, b) => b.weight - a.weight);
  k = Math.max(1, Math.min(k, items.length));

  let assign;
  if (k >= items.length) assign = items.map((_, i) => i);
  else {
    // weighted farthest-first seeding (deterministic), then Lloyd iterations
    const seeds = [items[0].lab];
    while (seeds.length < k) {
      let best = -1, bd = -1;
      items.forEach((it, i) => {
        const dist = Math.min(...seeds.map((s) => d2(s, it.lab))) * Math.sqrt(it.weight);
        if (dist > bd) { bd = dist; best = i; }
      });
      seeds.push(items[best].lab);
    }
    let cent = seeds.map((s) => [...s]);
    assign = new Array(items.length).fill(0);
    for (let iter = 0; iter < 30; iter++) {
      let changed = false;
      items.forEach((it, i) => {
        let bi = 0, bd = Infinity;
        cent.forEach((c, ci) => { const d = d2(c, it.lab); if (d < bd) { bd = d; bi = ci; } });
        if (assign[i] !== bi) { assign[i] = bi; changed = true; }
      });
      const sum = cent.map(() => [0, 0, 0, 0]);
      items.forEach((it, i) => { const s = sum[assign[i]]; s[0] += it.lab[0] * it.weight; s[1] += it.lab[1] * it.weight; s[2] += it.lab[2] * it.weight; s[3] += it.weight; });
      cent = cent.map((c, ci) => (sum[ci][3] ? [sum[ci][0] / sum[ci][3], sum[ci][1] / sum[ci][3], sum[ci][2] / sum[ci][3]] : c));
      if (!changed) break;
    }
    // drop empty clusters, then renumber
    const used = [...new Set(assign)];
    assign = assign.map((a) => used.indexOf(a));
    cent = used.map((u) => cent[u]);
    items.cent = cent;
  }

  const n = Math.max(...assign) + 1;
  const colors = Array.from({ length: n }, () => ({ hex: null, weight: 0, best: -1, members: [] }));
  items.forEach((it, i) => {
    const g = colors[assign[i]];
    g.weight += it.weight; g.members.push(it.hex);
    // representative = member with the most area (keeps colors crisp, taken from the file)
    if (it.weight > g.best) { g.best = it.weight; g.hex = it.hex; }
  });
  const order = colors.map((c, i) => i).sort((a, b) => colors[b].weight - colors[a].weight);
  const map = new Map();
  items.forEach((it, i) => map.set(it.hex, order.indexOf(assign[i])));
  return { colors: order.map((i) => ({ hex: colors[i].hex, weight: colors[i].weight, members: colors[i].members })), map };
}

export function uniqueColorCount(shapes) { return new Set(shapes.map((s) => s.color)).size; }
