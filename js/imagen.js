// Procesamiento de fotos de producto, todo en el dispositivo:
// quitar fondo → recortar al producto → centrar en cuadrado blanco → mejorar luz/nitidez → WebP.

const CDN_FONDO = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
let modFondo = null;

const crearCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const aBlob = (canvas, tipo, q) => new Promise((ok) => canvas.toBlob(ok, tipo, q));

// Las fotos del iPhone vienen en HEIC. Safari las abre solo; Chrome, Brave y Firefox no: se convierten a JPEG en el propio equipo.
const CDN_HEIC = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.6/+esm';
let modHeic = null;
export const esHeic = (f) => /^image\/hei[cf]/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || '');
export const precargarHeic = () => { modHeic ??= import(CDN_HEIC).catch((e) => { modHeic = null; throw e; }); return modHeic; };
async function heicAJpeg(archivo) {
  const m = await precargarHeic();
  return m.heicTo({ blob: archivo, type: 'image/jpeg', quality: 0.92 });
}

async function cargarBitmap(archivo) {
  try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); }
  catch (e) {
    if (esHeic(archivo)) return createImageBitmap(await heicAJpeg(archivo));
    const url = URL.createObjectURL(archivo);
    const img = new Image(); img.src = url; await img.decode();
    return img;
  }
}

function reducir(fuente, max) {
  const w = fuente.width, h = fuente.height, r = Math.min(1, max / Math.max(w, h));
  const c = crearCanvas(w * r, h * r);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente, 0, 0, c.width, c.height);
  return c;
}

// Foto original (de la cámara o galería) llevada a un tamaño manejable
export async function leerOriginal(archivo, max = 1600) {
  const bmp = await cargarBitmap(archivo);
  const c = reducir(bmp, max);
  bmp.close?.();
  return c;
}

// Se intenta en un Web Worker (la pantalla sigue respondiendo). Si el navegador no lo permite, se hace en la pantalla principal.
let worker = null, workerRoto = false, secuencia = 0;
const pendientes = new Map();
function obtenerWorker() {
  if (workerRoto || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./fondo-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const p = pendientes.get(data.id);
        if (!p) return;
        if (data.progreso) p.alProgreso?.(...data.progreso);
        else { pendientes.delete(data.id); data.ok ? p.ok(data.blob) : p.mal(new Error(data.error)); }
      };
      worker.onerror = (e) => { workerRoto = true; worker = null; for (const [, p] of pendientes) p.mal(new Error('worker: ' + (e.message || 'error'))); pendientes.clear(); };
    } catch { workerRoto = true; worker = null; }
  }
  return worker;
}

async function quitarFondoPrincipal(entrada, alProgreso) {
  modFondo ??= await import(CDN_FONDO);
  return modFondo.removeBackground(entrada, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (clave, actual, total) => alProgreso?.(clave, actual, total),
  });
}

export async function quitarFondo(canvasOriginal, alProgreso) {
  const entrada = await aBlob(canvasOriginal, 'image/png');
  let salida;
  const w = obtenerWorker();
  if (w) {
    try {
      salida = await new Promise((ok, mal) => { const id = ++secuencia; pendientes.set(id, { ok, mal, alProgreso }); w.postMessage({ id, blob: entrada }); });
    } catch (e) { console.warn('Quitar fondo en segundo plano falló, se usa la pantalla principal:', e.message); workerRoto = true; }
  }
  salida ??= await quitarFondoPrincipal(entrada, alProgreso);
  const bmp = await createImageBitmap(salida);
  const c = reducir(bmp, 2000);
  bmp.close?.();
  return c;
}

function cajaOpaca(canvas, umbral = 24) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > umbral) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Estira niveles con límites suaves para no "quemar" la foto. Solo cuenta píxeles opacos.
function autoNiveles(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  const hist = new Uint32Array(256); let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; total++; }
  }
  if (total < 100) return;
  let acc = 0, p1 = 0, p99 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { p1 = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { p99 = v; break; } }
  const lo = Math.min(p1, 30);
  const escala = Math.min(1.3, 255 / Math.max(40, p99 - lo));
  if (escala < 1.03 && lo < 4) return;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] - lo) * escala));
  }
  ctx.putImageData(img, 0, 0);
}

// Nitidez suave (3x3)
function afilar(canvas, a = 0.3) {
  const { width: w, height: h } = canvas, ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h), s = src.data, out = ctx.createImageData(w, h), o = out.data;
  const c = 1 + 4 * a;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; o[i + 3] = 255; continue; }
      for (let k = 0; k < 3; k++) {
        const v = c * s[i + k] - a * (s[i - 4 + k] + s[i + 4 + k] + s[i - w * 4 + k] + s[i + w * 4 + k]);
        o[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// Color de las esquinas, si son parecidas (fondo liso) lo usamos de relleno en vez de blanco
function colorEsquinas(canvas) {
  const { width: w, height: h } = canvas, ctx = canvas.getContext('2d');
  const pts = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data);
  const prom = [0, 1, 2].map((k) => Math.round(pts.reduce((a, p) => a + p[k], 0) / 4));
  const dif = Math.max(...pts.map((p) => Math.abs(p[0] - prom[0]) + Math.abs(p[1] - prom[1]) + Math.abs(p[2] - prom[2])));
  return dif < 40 ? `rgb(${prom[0]},${prom[1]},${prom[2]})` : '#fff';
}

// Arma la foto final según el modo elegido.
//  quitar_fondo → producto recortado sobre blanco | ajustar → foto completa en cuadrado | original → solo tamaño
export function componer(modo, { original, recorte }, { tam = 1200, margen = 0.08, sombra = true, mejorar = true } = {}) {
  if (modo === 'original') return reducir(original, tam * 1.4);

  if (modo === 'ajustar') {
    const base = crearCanvas(original.width, original.height);
    base.getContext('2d').drawImage(original, 0, 0);
    if (mejorar) autoNiveles(base);
    const out = crearCanvas(tam, tam), ctx = out.getContext('2d');
    ctx.fillStyle = colorEsquinas(original); ctx.fillRect(0, 0, tam, tam);
    const r = Math.min(tam / base.width, tam / base.height), w = base.width * r, h = base.height * r;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, (tam - w) / 2, (tam - h) / 2, w, h);
    if (mejorar) afilar(out);
    return out;
  }

  const caja = cajaOpaca(recorte);
  const prod = crearCanvas(caja.w, caja.h);
  prod.getContext('2d').drawImage(recorte, caja.x, caja.y, caja.w, caja.h, 0, 0, caja.w, caja.h);
  if (mejorar) autoNiveles(prod);
  const out = crearCanvas(tam, tam), ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tam, tam);
  const area = tam * (1 - 2 * margen), r = Math.min(area / caja.w, area / caja.h);
  const w = caja.w * r, h = caja.h * r;
  ctx.imageSmoothingQuality = 'high';
  if (sombra) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = tam * 0.025; ctx.shadowOffsetY = tam * 0.012;
    ctx.drawImage(prod, (tam - w) / 2, (tam - h) / 2, w, h);
    ctx.restore();
  } else ctx.drawImage(prod, (tam - w) / 2, (tam - h) / 2, w, h);
  if (mejorar) afilar(out);
  return out;
}

// WebP si el navegador lo permite; si no (Safari antiguo) JPEG.
export async function codificar(canvas, calidad = 0.85) {
  let b = await aBlob(canvas, 'image/webp', calidad);
  if (!b || b.type !== 'image/webp') b = await aBlob(canvas, 'image/jpeg', Math.max(calidad, 0.9));
  return b;
}
export const extDe = (blob) => (blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg');
