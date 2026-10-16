// Almacenamiento local (IndexedDB) + sincronización opcional con la base compartida.
// Regla: la app siempre lee y escribe en el dispositivo; sincronizar solo sube/baja diferencias.
import * as remote from './remote.js';
import { uid } from './util.js';

export const eventos = new EventTarget();
const avisar = (tipo, detalle) => eventos.dispatchEvent(new CustomEvent(tipo, { detail: detalle }));

// ---------- IndexedDB ----------
let _db;
function abrir() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('carga-productos', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('productos', { keyPath: 'id' });
      r.result.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
async function tx(almacen, modo, fn) {
  _db ??= await abrir();
  return new Promise((ok, mal) => {
    const t = _db.transaction(almacen, modo);
    let salida;
    const req = fn(t.objectStore(almacen));
    if (req) req.onsuccess = () => { salida = req.result; };
    t.oncomplete = () => ok(salida);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error || new Error('Transacción cancelada'));
  });
}
export const todosLocal = () => tx('productos', 'readonly', (s) => s.getAll());
export const obtener = (id) => tx('productos', 'readonly', (s) => s.get(id));
export const guardarLocal = (p) => tx('productos', 'readwrite', (s) => s.put(p));
export const borrarLocal = (id) => tx('productos', 'readwrite', (s) => s.delete(id));
export const getMeta = (k) => tx('meta', 'readonly', (s) => s.get(k)).then((r) => r?.v);
export const setMeta = (k, v) => tx('meta', 'readwrite', (s) => s.put({ k, v }));

// ---------- Productos ----------
export function productoNuevo(cfg, operador) {
  const d = cfg.defaults || {};
  return {
    id: uid(), sku: '', nombre: '', marca: '', mpn: '', proveedor: '', barcode: '',
    categoria: '', categoria_extra: '', tags: '',
    descripcion: '', seo_titulo: '', seo_desc: '',
    precio: null, precio_promo: null, precio_mayorista: null, costo: null,
    props: [{ n: '', v: '' }, { n: '', v: '' }, { n: '', v: '' }],
    peso: null, alto: null, ancho: null, prof: null, envio_gratis: !!d.envio_gratis,
    stock: d.stock ?? '', mostrar: d.mostrar !== false, fisico: d.fisico !== false,
    slug: '', notas: '', fotos: [],
    estado: 'borrador',
    creado_por: operador || '', creado_en: new Date().toISOString(),
    actualizado_por: operador || '', actualizado_en: new Date().toISOString(),
    _dirty: true,
  };
}

export async function guardarProducto(p, operador) {
  p.actualizado_en = new Date().toISOString();
  p.actualizado_por = operador || p.actualizado_por || '';
  p._dirty = true;
  await guardarLocal(p);
  avisar('cambio', { id: p.id });
  programarSync();
  return p;
}

export async function eliminarProducto(p, operador) {
  const f = (p.fotos || []).filter((x) => x.path).map((x) => x.path);
  if (!p.remote_ts) { // nunca llegó a la nube: se borra directo
    await borrarLocal(p.id);
  } else {
    p.eliminado = true; p._dirty = true; p._fotos_borradas = [...(p._fotos_borradas || []), ...f];
    p.actualizado_por = operador || p.actualizado_por; p.actualizado_en = new Date().toISOString();
    await guardarLocal(p);
  }
  avisar('cambio', { id: p.id });
  programarSync();
}

export const listaVisible = async () => (await todosLocal()).filter((p) => !p.eliminado);

// Cada foto: { id, ext, tipo, blob?, orig?, path?, url? }  (blob = foto ya procesada)
const urlsObjeto = new Map();
export function srcFoto(f) {
  if (f.blob) {
    if (!urlsObjeto.has(f.id)) urlsObjeto.set(f.id, URL.createObjectURL(f.blob));
    return urlsObjeto.get(f.id);
  }
  return f.url || '';
}
export async function bytesFoto(f) {
  if (f.blob) return f.blob;
  if (!f.url) throw new Error('La foto no está disponible todavía (sin conexión).');
  const r = await fetch(f.url);
  if (!r.ok) throw new Error('No se pudo bajar una foto (' + r.status + ')');
  return r.blob();
}

// ---------- Sincronización ----------
let sincronizando = false;
let temporizador = null;
let estadoSync = { modo: 'local', texto: 'Solo en este equipo', pendientes: 0 };
export const getEstadoSync = () => estadoSync;
function setEstado(e) { estadoSync = { ...estadoSync, ...e }; avisar('sync', estadoSync); }

export async function contarPendientes() {
  const n = (await todosLocal()).filter((p) => p._dirty).length;
  setEstado({ pendientes: n });
  return n;
}

export function programarSync(ms = 1500) {
  clearTimeout(temporizador);
  if (!remote.configurado()) { contarPendientes(); return; }
  temporizador = setTimeout(() => sincronizar().catch(() => {}), ms);
}

const paraNube = (p) => {
  const o = {};
  for (const [k, v] of Object.entries(p)) if (!k.startsWith('_') && !['id', 'remote_ts', 'eliminado'].includes(k)) o[k] = v;
  o.fotos = (p.fotos || []).map((f) => ({ id: f.id, ext: f.ext, tipo: f.tipo, path: f.path }));
  return o;
};

function desdeNube(row, local) {
  const d = row.data || {};
  const fotos = (d.fotos || []).map((f) => {
    const previa = local?.fotos?.find((x) => x.id === f.id);
    return { ...f, url: f.path ? remote.urlFoto(f.path) : '', blob: previa?.blob, orig: previa?.orig };
  });
  return { ...d, fotos, id: row.id, estado: row.estado || d.estado || 'borrador', remote_ts: row.updated_at, eliminado: !!row.eliminado, _dirty: false };
}

async function subirUno(p) {
  const version = p.actualizado_en;
  for (const f of p.fotos || []) {
    if (f.blob && !f.path) {
      const path = `${remote.idNegocio()}/${p.id}/${f.id}.${f.ext}`;
      await remote.subirFoto(path, f.blob);
      f.path = path; f.url = remote.urlFoto(path);
    }
  }
  if (p._fotos_borradas?.length) { await remote.borrarFotos(p._fotos_borradas); p._fotos_borradas = []; }
  const row = { id: p.id, negocio: remote.idNegocio(), sku: p.sku || '', estado: p.estado || 'borrador', actualizado_por: p.actualizado_por || '', eliminado: !!p.eliminado, data: paraNube(p) };
  const res = await remote.subirProducto(row);
  if (p.eliminado) { await borrarLocal(p.id); return; }
  const fresco = (await obtener(p.id)) || p;
  for (const f of fresco.fotos || []) { const sub = p.fotos.find((x) => x.id === f.id); if (sub?.path) { f.path = sub.path; f.url = sub.url; } }
  fresco.remote_ts = res.updated_at;
  fresco._dirty = fresco.actualizado_en !== version; // si lo editaron mientras subía, queda pendiente
  await guardarLocal(fresco);
}

export async function sincronizar() {
  if (!remote.configurado()) return { ok: false, motivo: 'sin base compartida' };
  if (!navigator.onLine) { setEstado({ modo: 'sin-conexion', texto: 'Sin conexión' }); return { ok: false, motivo: 'sin conexión' }; }
  if (!(await remote.sesion())) { setEstado({ modo: 'sin-sesion', texto: 'Sin iniciar sesión' }); return { ok: false, motivo: 'sin sesión' }; }
  if (sincronizando) return { ok: false, motivo: 'ocupado' };
  sincronizando = true; setEstado({ modo: 'sincronizando', texto: 'Sincronizando…' });
  let subidos = 0, bajados = 0, errores = [];
  try {
    for (const p of (await todosLocal()).filter((x) => x._dirty)) {
      try { await subirUno(p); subidos++; } catch (e) { errores.push(`${p.sku || p.id}: ${e.message}`); }
    }
    let desde = await getMeta('ultimo_pull');
    const filas = await remote.traerCambios(desde);
    for (const fila of filas) {
      const local = await obtener(fila.id);
      desde = fila.updated_at;
      if (local && local.remote_ts === fila.updated_at) continue;   // es nuestro propio cambio
      if (local && local._dirty) continue;                          // lo local pendiente gana (se sube en la próxima vuelta)
      if (fila.eliminado) { if (local) await borrarLocal(fila.id); bajados++; continue; }
      await guardarLocal(desdeNube(fila, local)); bajados++;
    }
    if (desde) await setMeta('ultimo_pull', desde);
    const pend = (await todosLocal()).filter((p) => p._dirty).length;
    setEstado({ modo: errores.length ? 'error' : 'ok', texto: errores.length ? 'Error al sincronizar' : 'Sincronizado', pendientes: pend, ultimo: new Date().toISOString() });
    if (subidos || bajados) avisar('cambio', { remoto: true });
    return { ok: !errores.length, subidos, bajados, errores };
  } catch (e) {
    setEstado({ modo: 'error', texto: 'Error: ' + (e.message || e) });
    return { ok: false, motivo: e.message || String(e), errores };
  } finally { sincronizando = false; }
}

// Configuración del negocio (categorías, medidas...): se guarda local y, si hay base compartida, se comparte.
export async function pushConfig(obj) {
  await setMeta('config_override', obj);
  if (!remote.configurado() || !navigator.onLine || !(await remote.sesion())) return false;
  const r = await remote.subirConfig(obj);
  await setMeta('config_override_ts', r.updated_at);
  return true;
}
export async function pullConfig() {
  if (!remote.configurado() || !navigator.onLine || !(await remote.sesion())) return null;
  const nube = await remote.traerConfig();
  if (!nube) { const local = await getMeta('config_override'); if (local) await pushConfig(local); return null; }
  const ts = await getMeta('config_override_ts');
  if (ts && nube.updated_at <= ts) return null;
  await setMeta('config_override', nube.data);
  await setMeta('config_override_ts', nube.updated_at);
  return nube.data;
}

export function iniciarAutoSync() {
  window.addEventListener('online', () => programarSync(500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) programarSync(800); });
  setInterval(() => { if (!document.hidden) programarSync(100); }, 60000);
}

