// Configuración del negocio: archivo base (config/*.json) + ajustes propios guardados en el dispositivo / base compartida.
import * as store from './store.js';

export let cfg = null;
let archivoBase = 'config/base.json';

const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);
function fusionar(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = esObjeto(v) && esObjeto(base[k]) ? fusionar(base[k], v) : v;
  return out;
}

export async function cargarConfig() {
  const r = await fetch(archivoBase, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No se pudo leer ' + archivoBase);
  const base = await r.json();
  const extra = await store.getMeta('config_override');
  cfg = fusionar(base, extra);
  return cfg;
}

// Guarda cambios propios (por ejemplo, la lista de categorías editada) sin tocar el archivo base.
export async function guardarAjustes(parcial) {
  const actual = (await store.getMeta('config_override')) || {};
  const nuevo = fusionar(actual, parcial);
  // las listas y mapas completos se reemplazan, no se mezclan
  for (const k of ['categorias', 'marcas', 'proveedores', 'medidas_por_categoria', 'frases_por_categoria', 'propiedades_sugeridas']) if (k in parcial) nuevo[k] = parcial[k];
  await store.pushConfig(nuevo);
  await cargarConfig();
  return cfg;
}

export async function reemplazarConfig(obj) { await store.pushConfig(obj); return cargarConfig(); }
export async function recargarDesdeMeta() { return cargarConfig(); }

export const categoriasPrincipales = () => cfg.categorias.filter((c) => !c.includes(' > '));
export const principalDe = (cat) => String(cat || '').split(' > ')[0].trim();

export function medidasPara(categoria) {
  const m = cfg.medidas_por_categoria || {};
  return m[categoria] || m[principalDe(categoria)] || cfg.medidas_generales || null;
}

export function normSku(sku) {
  let s = String(sku ?? '').trim().replace(/\s+/g, '');
  const d = cfg?.sku_digitos || 0;
  if (d && /^\d+$/.test(s)) s = s.padStart(d, '0');
  return s;
}

// Proveedores: lista de {nombre, tel, whatsapp, mail, direccion, nota}. Se guarda con la cuenta (base compartida).
export const listaProveedores = () => (cfg.proveedores || []).map((p) => (typeof p === 'string' ? { nombre: p } : p));
export const nombresProveedores = () => listaProveedores().map((p) => p.nombre);
export const buscarProveedor = (n) => { const k = String(n || '').trim().toLowerCase(); return k ? listaProveedores().find((p) => p.nombre.toLowerCase() === k) : null; };
export const guardarProveedores = (lista) => guardarAjustes({ proveedores: lista });

export const operador = () => localStorage.getItem('operador') || '';
export const setOperador = (n) => localStorage.setItem('operador', n.trim());
