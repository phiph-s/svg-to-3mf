import './style.css';
import { parseSvg } from './svg.js';
import { groupColors, uniqueColorCount } from './quantize.js';
import { buildMeshes } from './mesh.js';
import { build3mf } from './threemf.js';
import { createPreview } from './preview3d.js';

const $ = (id) => document.getElementById(id);
const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140">
<path fill="#e4572e" d="M10 20 L80 10 L95 60 L50 90 L12 70Z"/>
<path fill="#f3a712" d="M95 60 L80 10 L150 18 L160 70 L120 85Z"/>
<path fill="#29335c" d="M120 85 L160 70 L190 100 L150 130 L105 120Z"/>
<path fill="#a8c686" d="M50 90 L95 60 L120 85 L105 120 L40 125Z"/>
<path fill="#669bbc" fill-rule="evenodd" d="M150 18 L188 30 L190 100 L160 70Z M165 40 L178 44 L178 70 L168 62Z"/>
<circle cx="70" cy="55" r="12" fill="#fdf0d5"/>
<circle cx="140" cy="102" r="7" fill="#f3a712"/>
</svg>`;

const st = { parsed: null, name: '', groups: null, meshes: null, size: null, colors: [], tab: '3d' };
let preview;
let timer;

// ---------- loading ----------
function load(text, name) {
  try {
    const parsed = parseSvg(text);
    st.parsed = parsed; st.name = name.replace(/\.svg$/i, '');
    const n = uniqueColorCount(parsed.shapes);
    const k = $('k');
    k.max = Math.max(2, Math.min(n, 32)); k.disabled = n < 2;
    k.value = Math.min(n, 4); $('kout').textContent = k.value;
    $('fname').textContent = name;
    $('drop').hidden = true; $('view').hidden = false; $('panel').hidden = false;
    preview ??= createPreview($('pane3d'));
    preview.resetFrame();
    update(true);
  } catch (e) {
    const err = $('err'); err.textContent = e.message || String(e); err.hidden = false;
  }
}

async function loadFile(f) {
  if (!f) return;
  load(await f.text(), f.name);
}

// ---------- pipeline ----------
function schedule(refit) { clearTimeout(timer); timer = setTimeout(() => update(refit), 40); }

function update(refit) {
  const { parsed } = st; if (!parsed) return;
  const n = uniqueColorCount(parsed.shapes), k = +$('k').value;
  $('kout').textContent = k;
  const { colors, map } = groupColors(parsed.shapes, k);
  st.colors = colors.map((c) => c.hex);
  st.groupInfo = colors;
  st.groups = colors.map(() => ({ polys: [] }));
  st.shapeGroup = parsed.shapes.map((s) => map.get(s.color));
  parsed.shapes.forEach((s, i) => st.groups[st.shapeGroup[i]].polys.push(...s.polys));
  $('knote').textContent = n <= k ? `${n} color${n === 1 ? '' : 's'} found — nothing to group.` : `${n} colors found — similar ones are merged into ${colors.length}.`;
  rebuild(refit);
  renderSwatches();
}

function rebuild(refit) {
  const w = Math.max(1, +$('w').value || 100), h = Math.max(0.1, +$('h').value || 2);
  const { meshes, size } = buildMeshes(st.groups, st.parsed.bbox, w, h);
  st.meshes = meshes; st.size = size;
  const tris = meshes.reduce((a, m) => a + m.indices.length / 3, 0);
  $('stats').innerHTML = `<span>${st.parsed.shapes.length} shapes</span><span>${size.map((v) => v.toFixed(1)).join(' × ')} mm</span><span>${tris.toLocaleString()} triangles</span>` +
    (st.parsed.gradients ? `<span>⚠ ${st.parsed.gradients} gradient(s) flattened to one color</span>` : '');
  refreshViews(refit);
}

function refreshViews(refit) {
  preview.set(st.meshes, st.colors, st.size, refit);
  render2d();
}

function render2d() {
  const [x0, y0, x1, y1] = st.parsed.bbox, pad = Math.max(x1 - x0, y1 - y0) * 0.02;
  const ring = (r) => 'M' + r.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
  const paths = st.groups.map((g, i) => `<path fill="${st.colors[i]}" fill-rule="evenodd" d="${g.polys.map((p) => ring(p.outer) + p.holes.map(ring).join('')).join('')}"/>`).join('');
  $('pane2d').innerHTML = `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function renderSwatches() {
  const total = st.groupInfo.reduce((a, c) => a + c.weight, 0) || 1;
  $('swatches').innerHTML = st.groupInfo.map((c, i) => `
    <div class="sw"><input type="color" value="${st.colors[i]}" data-i="${i}" aria-label="Color ${i + 1}">
      <div class="nm">Filament ${i + 1}<small>${st.colors[i].toUpperCase()}${c.members.length > 1 ? ` · merges ${c.members.length} colors` : ''}</small></div>
      <div class="bar" title="${(100 * c.weight / total).toFixed(0)}% of area"><i style="width:${100 * c.weight / total}%"></i></div></div>`).join('');
}

// ---------- events ----------
$('k').addEventListener('input', () => schedule(false));
$('w').addEventListener('input', () => schedule(false));
$('h').addEventListener('input', () => schedule(false));
$('swatches').addEventListener('input', (e) => {
  const i = +e.target.dataset.i; st.colors[i] = e.target.value;
  e.target.parentElement.querySelector('small').textContent = e.target.value.toUpperCase() + (st.groupInfo[i].members.length > 1 ? ` · merges ${st.groupInfo[i].members.length} colors` : '');
  refreshViews(false);
});
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('sample').addEventListener('click', () => load(SAMPLE, 'sample.svg'));
$('reset').addEventListener('click', () => { $('drop').hidden = false; $('view').hidden = true; $('panel').hidden = true; $('err').hidden = true; $('file').value = ''; });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('pane3d').hidden = b.dataset.tab !== '3d'; $('pane2d').hidden = b.dataset.tab !== '2d';
}));

for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); });
for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) $('drop').classList.remove('over'); });
window.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

$('dl').addEventListener('click', async () => {
  const btn = $('dl'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Building…';
  try {
    const blob = await build3mf(st.meshes, st.colors, st.size, { name: st.name || 'model', slicerMeta: $('meta').checked });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = (st.name || 'model') + '.3mf'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally { btn.disabled = false; btn.textContent = label; }
});
