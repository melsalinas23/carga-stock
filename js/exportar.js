// Exportación: CSV de carga masiva de Tienda Nube (Latin-1, separador ";"), ZIP de fotos y copia de seguridad.
import { cfg, normSku, principalDe } from './config.js';
import { slugify, fmtPrecioCSV, fmtPesoCSV, fmtMedidaCSV, esc, aLatin1, limpiarTexto, cargarScript } from './util.js';
import { bytesFoto, listaVisible } from './store.js';
import { extDe } from './imagen.js';

export const COLUMNAS = ['Identificador de URL', 'Nombre', 'Categorías', 'Nombre de propiedad 1', 'Valor de propiedad 1', 'Nombre de propiedad 2', 'Valor de propiedad 2', 'Nombre de propiedad 3', 'Valor de propiedad 3', 'Precio', 'Precio promocional', 'Peso (kg)', 'Alto (cm)', 'Ancho (cm)', 'Profundidad (cm)', 'Stock', 'SKU', 'Código de barras', 'Mostrar en tienda', 'Envío sin cargo', 'Descripción', 'Tags', 'Título para SEO', 'Descripción para SEO', 'Marca', 'Producto Físico', 'MPN (Número de pieza del fabricante)', 'Sexo', 'Rango de edad', 'Costo', 'Visibilidad'];

const SI_NO = (b) => (b ? 'SI' : 'NO');

// Texto plano → HTML simple. **negrita**, líneas con "- " como lista, línea en blanco = párrafo nuevo.
export function textoAHtml(txt) {
  const bloques = String(txt || '').replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  return bloques.map((b) => {
    const lineas = b.split('\n');
    if (lineas.every((l) => /^\s*[-•]\s+/.test(l))) return '<ul>' + lineas.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    return `<p>${inline(b)}</p>`;
  }).join('');
}

export function slugDe(p) {
  if (p.slug) return p.slug;
  const sku = normSku(p.sku).toLowerCase().replace(/[^a-z0-9]/g, '');
  return slugify(p.nombre, 80) + (sku ? '-' + sku : '');
}

// Qué le falta a un producto. critico = no se puede exportar sin eso.
export function revisar(p, duplicados = new Set()) {
  const faltas = [];
  const f = (campo, texto, critico) => faltas.push({ campo, texto, critico });
  if (!String(p.sku || '').trim()) f('sku', 'SKU', true);
  if (!String(p.nombre || '').trim()) f('nombre', 'Nombre', true);
  if (!p.categoria) f('categoria', 'Categoría', true);
  else if (cfg && !cfg.categorias.includes(p.categoria)) f('categoria', 'Categoría que no existe en la lista', false);
  if (!(p.precio > 0)) f('precio', 'Precio', true);
  if (duplicados.has(normSku(p.sku))) f('sku', 'SKU repetido', true);
  if (!(p.fotos || []).length) f('fotos', 'Foto', false);
  if (!(p.peso > 0) || !(p.alto > 0) || !(p.ancho > 0) || !(p.prof > 0)) f('medidas', 'Peso y medidas (necesarias para calcular el envío)', false);
  if (!String(p.descripcion || '').trim()) f('descripcion', 'Descripción', false);
  return faltas;
}

export async function skusRepetidos() {
  const vistos = new Map(), rep = new Set();
  for (const p of await listaVisible()) {
    const k = normSku(p.sku); if (!k) continue;
    if (vistos.has(k)) rep.add(k); else vistos.set(k, 1);
  }
  return rep;
}

function filaCSV(p) {
  const props = (p.props || []).filter((x) => x?.n?.trim() && x?.v?.trim()).map((x) => [x.n.trim(), x.v.trim()]).slice(0, 3);
  while (props.length < 3) props.push(['', '']);
  const cats = [p.categoria, p.categoria_extra].filter(Boolean).join(', ');
  const visible = !!p.mostrar;
  const seoT = (p.seo_titulo || '').slice(0, 70), seoD = (p.seo_desc || '').slice(0, 320);
  return [
    slugDe(p), p.nombre.trim(), cats,
    props[0][0], props[0][1], props[1][0], props[1][1], props[2][0], props[2][1],
    fmtPrecioCSV(p.precio), fmtPrecioCSV(p.precio_promo > 0 ? p.precio_promo : null),
    fmtPesoCSV(p.peso), fmtMedidaCSV(p.alto), fmtMedidaCSV(p.ancho), fmtMedidaCSV(p.prof),
    String(p.stock ?? '').trim(), normSku(p.sku), (p.barcode || '').trim(),
    SI_NO(visible), SI_NO(p.envio_gratis),
    textoAHtml(p.descripcion), (p.tags || '').trim(), seoT, seoD,
    (p.marca || '').trim(), SI_NO(p.fisico !== false), (p.mpn || '').trim(), '', '',
    fmtPrecioCSV(p.costo > 0 ? p.costo : null),
    visible ? 'Visible' : 'Oculto',
  ];
}

const celda = (v) => {
  const s = limpiarTexto(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function construirCSV(productos) {
  const lineas = [COLUMNAS.map(celda).join(';')];
  for (const p of productos) lineas.push(filaCSV(p).map(celda).join(';'));
  return lineas.join('\r\n') + '\r\n';
}
export const csvABytes = (texto) => aLatin1(texto);

// Planilla interna (con precio mayorista, proveedor, quién cargó) — NO se sube a Tienda Nube.
export function construirInterno(productos) {
  const cols = ['SKU', 'Nombre', 'Categoría', 'Marca', 'Proveedor', 'Precio público', 'Precio mayorista', 'Costo', 'Estado', 'Cargado por', 'Última modificación', 'Notas'];
  const filas = productos.map((p) => [normSku(p.sku), p.nombre, p.categoria, p.marca, p.proveedor, fmtPrecioCSV(p.precio), fmtPrecioCSV(p.precio_mayorista), fmtPrecioCSV(p.costo), p.estado, p.creado_por, p.actualizado_en, p.notas]);
  return [cols, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}

// ---------- ZIP de fotos: SKU.webp, SKU_2.webp, ... ----------
export const nombreFoto = (p, i, blobOExt) => {
  const ext = typeof blobOExt === 'string' ? blobOExt : extDe(blobOExt);
  const base = normSku(p.sku).replace(/[\\/:*?"<>|]/g, '-');
  return i === 0 ? `${base}.${ext}` : `${base}_${i + 1}.${ext}`;
};

export async function construirZipFotos(productos, alProgreso) {
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = new window.JSZip();
  let n = 0, total = productos.reduce((a, p) => a + (p.fotos?.length || 0), 0);
  for (const p of productos) {
    for (let i = 0; i < (p.fotos || []).length; i++) {
      const b = await bytesFoto(p.fotos[i]);
      zip.file(nombreFoto(p, i, b), b);
      alProgreso?.(++n, total);
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

// ---------- Copia de seguridad (todo el contenido de este teléfono) ----------
export async function construirBackup(alProgreso) {
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = new window.JSZip();
  const prods = await listaVisible();
  const meta = prods.map((p) => ({ ...p, fotos: (p.fotos || []).map((f) => ({ id: f.id, ext: f.ext, tipo: f.tipo, path: f.path })) }));
  for (const m of meta) { delete m._dirty; }
  zip.file('productos.json', JSON.stringify({ version: 1, creado: new Date().toISOString(), productos: meta }, null, 1));
  let n = 0;
  for (const p of prods) {
    for (const f of p.fotos || []) {
      try { zip.file(`fotos/${p.id}__${f.id}.${f.ext}`, await bytesFoto(f)); } catch { /* foto remota sin conexión: queda en la nube */ }
    }
    alProgreso?.(++n, prods.length);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function leerBackup(archivo) {
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = await window.JSZip.loadAsync(archivo);
  const j = JSON.parse(await zip.file('productos.json').async('string'));
  const salida = [];
  for (const p of j.productos) {
    const fotos = [];
    for (const f of p.fotos || []) {
      const e = zip.file(`fotos/${p.id}__${f.id}.${f.ext}`);
      const blob = e ? new Blob([await e.async('arraybuffer')], { type: f.ext === 'webp' ? 'image/webp' : f.ext === 'png' ? 'image/png' : 'image/jpeg' }) : undefined;
      fotos.push({ ...f, blob });
    }
    salida.push({ ...p, fotos, _dirty: true });
  }
  return salida;
}

export { principalDe };
