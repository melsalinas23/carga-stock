// Acceso con clave compartida (versión inicial, BAJA SEGURIDAD; mejora prevista: login por persona con Supabase, ver ARQUITECTURA.md).
// Una sola clave para todo el equipo, verificada en el propio dispositivo: frena a quien llega por casualidad,
// pero no a alguien con conocimientos técnicos que quiera saltear la pantalla. Lo que sí queda protegido de verdad
// es la configuración del negocio (categorías, proveedores con contactos): viaja cifrada con esa clave.
import * as store from './store.js';
import { $, toast } from './util.js';

const enc = new TextEncoder();
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aB64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };

let confActiva = null;
export const activo = () => !!confActiva;
export const fijar = (conf) => { confActiva = conf; };

// La clave se escribe en el teléfono: se ignoran mayúsculas, espacios y guiones.
export const normalizar = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function derivar(clave, sal, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizar(clave)), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(sal), iterations: iter }, base, 256);
}

export async function cargarAcceso(ruta) {
  try {
    const r = await fetch(ruta, { cache: 'no-cache' });
    if (!r.ok) return null;
    const conf = await r.json();
    return conf && conf.hash && conf.salVerif && conf.iter ? conf : null;
  } catch { return null; }
}

export function recordado(conf) {
  try { return localStorage.getItem('acceso_ok') === conf.hash; } catch { return false; }
}
export function olvidar() { try { localStorage.removeItem('acceso_ok'); } catch { /* sin almacenamiento */ } }
function recordar(conf) { try { localStorage.setItem('acceso_ok', conf.hash); } catch { /* sin almacenamiento */ } }

async function verificar(clave, conf) {
  return aB64(await derivar(clave, conf.salVerif, conf.iter)) === conf.hash;
}

async function descifrarConfig(clave, conf) {
  const r = await fetch(conf.config, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No se pudo leer la configuración cifrada');
  const p = await r.json();
  const llave = await crypto.subtle.importKey('raw', await derivar(clave, p.sal, p.iter), 'AES-GCM', false, ['decrypt']);
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(p.iv) }, llave, deB64(p.datos));
  return { datos: JSON.parse(new TextDecoder().decode(plano)), version: p.version };
}

// Deja en el equipo los datos del negocio si todavía no están o si el archivo cifrado es de una versión más nueva.
async function importarConfig(clave, conf) {
  if (!conf.config) return;
  const { datos, version } = await descifrarConfig(clave, conf);
  const actual = await store.getMeta('config_override');
  const vacio = !actual || !Array.isArray(actual.categorias) || !actual.categorias.length;
  if (vacio || (await store.getMeta('config_cifrada_v')) !== version) {
    await store.pushConfig(datos);
    await store.setMeta('config_cifrada_v', version);
  }
}

// Pantalla de la clave. `alEntrar` se llama una vez que la clave fue correcta y quedó recordada.
export function pantallaClave(raiz, conf, alEntrar) {
  raiz.innerHTML = `
  <form class="login-pantalla" id="c-form" autocomplete="off">
    <h2>Acceso <em>privado</em></h2>
    <p class="ayuda">Esta aplicación es de uso interno. Ingresá la clave de acceso del equipo.</p>
    <label class="campo"><span>Clave de acceso</span><input id="c-clave" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="text" aria-describedby="c-ver-txt"></label>
    <label class="ayuda" id="c-ver-txt"><input type="checkbox" id="c-ver"> Mostrar la clave</label>
    <div class="fila-botones"><button class="btn primario grande" id="c-ok" type="submit">Entrar</button></div>
  </form>`;
  $('#c-ver').onchange = (e) => { $('#c-clave').type = e.target.checked ? 'text' : 'password'; };
  $('#c-form').onsubmit = async (e) => {
    e.preventDefault();
    const clave = $('#c-clave').value;
    if (!normalizar(clave)) { toast('Escribí la clave de acceso', 'error'); return; }
    const boton = $('#c-ok'); boton.classList.add('cargando'); boton.disabled = true;
    try {
      if (!(await verificar(clave, conf))) { toast('Clave incorrecta.', 'error'); $('#c-clave').select(); return; }
      try { await importarConfig(clave, conf); } catch (err) { console.error(err); toast('Entraste, pero no se pudieron cargar los datos del negocio: ' + (err.message || err), 'error'); }
      recordar(conf);
      await alEntrar();
    } catch (err) { console.error(err); toast('No se pudo comprobar la clave: ' + (err.message || err), 'error'); }
    finally { boton.classList.remove('cargando'); boton.disabled = false; }
  };
  setTimeout(() => $('#c-clave').focus({ preventScroll: true }), 80);
}
