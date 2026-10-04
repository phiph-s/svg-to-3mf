import earcut from 'earcut';
import { ringArea } from './svg.js';

/**
 * Extrude polygons into one watertight mesh per color group.
 * groups: [{ polys }]; returns { meshes: [{vertices:Float32Array, indices:Uint32Array}], size:[w,d,h] }
 * Coordinates are in mm, y up, with the model sitting on z = 0.
 */
export function buildMeshes(groups, bbox, widthMm, heightMm) {
  const [x0, , x1, y1] = bbox;
  const s = widthMm / Math.max(x1 - x0, 1e-9);
  const depth = (bbox[3] - bbox[1]) * s;
  const tx = (p) => [(p[0] - x0) * s, (y1 - p[1]) * s]; // flip y

  const meshes = groups.map((g) => {
    const V = [], I = [];
    for (const poly of g.polys) {
      const outer = orient(poly.outer.map(tx), true);
      const holes = poly.holes.map((h) => orient(h.map(tx), false));
      const rings = [outer, ...holes];
      const flat = [], holeIdx = [];
      let n = 0;
      rings.forEach((r, ri) => {
        if (ri) holeIdx.push(n);
        for (const p of r) { flat.push(p[0], p[1]); n++; }
      });
      const tri = earcut(flat, holeIdx, 2);
      if (!tri.length) continue;
      const base = V.length / 3;
      for (let i = 0; i < n; i++) V.push(flat[2 * i], flat[2 * i + 1], 0);
      for (let i = 0; i < n; i++) V.push(flat[2 * i], flat[2 * i + 1], heightMm);
      for (let t = 0; t < tri.length; t += 3) {
        let a = tri[t], b = tri[t + 1], c = tri[t + 2];
        const cr = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
        if (cr < 0) [b, c] = [c, b];            // make CCW (normal +z)
        I.push(base + n + a, base + n + b, base + n + c); // top
        I.push(base + a, base + c, base + b);             // bottom (reversed)
      }
      let off = 0;
      for (const r of rings) {
        for (let i = 0; i < r.length; i++) {
          const a = off + i, b = off + (i + 1) % r.length;
          I.push(base + a, base + b, base + n + b, base + a, base + n + b, base + n + a);
        }
        off += r.length;
      }
    }
    return { vertices: new Float32Array(V), indices: new Uint32Array(I) };
  });
  return { meshes, size: [widthMm, depth, heightMm] };
}

// outer rings CCW, holes CW (in y-up space)
function orient(r, ccw) {
  return (ringArea(r) > 0) === ccw ? r : [...r].reverse();
}
