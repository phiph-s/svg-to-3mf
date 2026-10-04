// Minimal 3MF writer (Bambu Studio / OrcaSlicer flavoured, still valid core 3MF).

const enc = new TextEncoder();
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const num = (v) => (Math.round(v * 10000) / 10000).toString();

// ----- zip -----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function deflate(data) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameB = enc.encode(name);
    const packed = await deflate(data);
    const method = packed && packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + body.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'model/3mf' });
}

/**
 * meshes: [{vertices, indices}], colors: ['#rrggbb'], opts: { name, bed:[x,y], slicerMeta }
 */
export async function build3mf(meshes, colors, size, { name = 'model', bed = [128, 128], slicerMeta = true } = {}) {
  const wrapId = meshes.length + 2;
  let m = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n`;
  m += ` <metadata name="Application">svg-to-3mf</metadata>\n <metadata name="Title">${esc(name)}</metadata>\n <resources>\n`;
  m += `  <basematerials id="1">\n${colors.map((c, i) => `   <base name="Color ${i + 1}" displaycolor="${c.toUpperCase()}"/>`).join('\n')}\n  </basematerials>\n`;
  const out = [m];
  meshes.forEach((mesh, i) => {
    const v = mesh.vertices, ix = mesh.indices;
    out.push(`  <object id="${i + 2}" name="Color ${i + 1}" type="model" pid="1" pindex="${i}">\n   <mesh>\n    <vertices>\n`);
    const vs = new Array(v.length / 3);
    for (let k = 0; k < vs.length; k++) vs[k] = `     <vertex x="${num(v[3 * k])}" y="${num(v[3 * k + 1])}" z="${num(v[3 * k + 2])}"/>`;
    out.push(vs.join('\n'), '\n    </vertices>\n    <triangles>\n');
    const ts = new Array(ix.length / 3);
    for (let k = 0; k < ts.length; k++) ts[k] = `     <triangle v1="${ix[3 * k]}" v2="${ix[3 * k + 1]}" v3="${ix[3 * k + 2]}"/>`;
    out.push(ts.join('\n'), '\n    </triangles>\n   </mesh>\n  </object>\n');
  });
  out.push(`  <object id="${wrapId}" name="${esc(name)}" type="model">\n   <components>\n`);
  meshes.forEach((_, i) => out.push(`    <component objectid="${i + 2}"/>\n`));
  out.push('   </components>\n  </object>\n </resources>\n');
  const tx = bed[0] - size[0] / 2, ty = bed[1] - size[1] / 2;
  out.push(` <build>\n  <item objectid="${wrapId}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} 0" printable="1"/>\n </build>\n</model>\n`);

  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="config" ContentType="text/xml"/>\n</Types>\n`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`],
    ['3D/3dmodel.model', out.join('')],
  ];

  if (slicerMeta) {
    let c = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <object id="${wrapId}">\n  <metadata key="name" value="${esc(name)}"/>\n  <metadata key="extruder" value="1"/>\n`;
    meshes.forEach((_, i) => {
      c += `  <part id="${i + 2}" subtype="normal_part">\n   <metadata key="name" value="Color ${i + 1}"/>\n   <metadata key="extruder" value="${i + 1}"/>\n  </part>\n`;
    });
    c += ` </object>\n <plate>\n  <metadata key="plater_id" value="1"/>\n  <model_instance>\n   <metadata key="object_id" value="${wrapId}"/>\n   <metadata key="instance_id" value="0"/>\n  </model_instance>\n </plate>\n</config>\n`;
    files.push(['Metadata/model_settings.config', c]);
    files.push(['Metadata/project_settings.config', JSON.stringify({
      filament_colour: colors.map((c) => c.toUpperCase()),
      filament_type: colors.map(() => 'PLA'),
    }, null, 2)]);
  }
  return zip(files.map(([n, d]) => [n, enc.encode(d)]));
}
