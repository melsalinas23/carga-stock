// Arranque de la app: configuración, base compartida, navegación entre pantallas.
import appConfig from '../app-config.js';
import * as store from './store.js';
import * as remote from './remote.js';
import * as acceso from './acceso.js';
import { cargarConfig, cfg } from './config.js';
import { $, $$, toast } from './util.js';
import { icono } from './iconos.js';
import { aplicarTema, temaGuardado } from './tema.js';
import { vistaLista } from './vista-lista.js';
import { vistaProducto } from './vista-producto.js';
import { vistaExportar } from './vista-exportar.js';
import { vistaFotos } from './vista-fotos.js';
import { vistaAjustes, vistaLogin } from './vista-ajustes.js';

const HOST_LOCAL = ['localhost', '127.0.0.1', '[::1]'];

const raiz = () => $('#vista');
let limpiezas = [];
const ctx = {
  antesDeSalir: null,
  alSalir: (fn) => limpiezas.push(fn),
  recargar: () => navegar(true),
  ir: (hash) => { ctx.antesDeSalir = null; if (location.hash === hash) navegar(true); else location.hash = hash; },
  alIniciarSesion: async () => { await store.sincronizar(); const c = await store.pullConfig(); if (c) await cargarConfig(); },
};
let hashAnterior = location.hash;
let ignorarHash = false;

const RUTAS = {
  '': { vista: vistaLista, tab: 'lista', titulo: 'Mis <em>productos</em>' },
  nuevo: { vista: (r, c) => vistaProducto(r, c, 'nuevo'), tab: 'nuevo', titulo: 'Nuevo <em>producto</em>' },
  producto: { vista: (r, c, id) => vistaProducto(r, c, id), tab: 'lista', titulo: 'Editar <em>producto</em>' },
  fotos: { vista: vistaFotos, tab: 'fotos', titulo: 'Fotos <em>rápidas</em>' },
  exportar: { vista: vistaExportar, tab: 'exportar', titulo: 'Exportar a <em>Tienda Nube</em>' },
  ajustes: { vista: vistaAjustes, tab: 'ajustes', titulo: 'Ajustes de la <em>cuenta</em>' },
  login: { vista: vistaLogin, tab: 'ajustes', titulo: 'Iniciar <em>sesión</em>' },
};

async function navegar(forzar = false) {
  if (ignorarHash) { ignorarHash = false; return; }
  if (!forzar && ctx.antesDeSalir && !ctx.antesDeSalir()) { ignorarHash = true; location.hash = hashAnterior; return; }
  ctx.antesDeSalir = null;
  limpiezas.forEach((f) => { try { f(); } catch { /* ya no existe */ } });
  limpiezas = [];
  hashAnterior = location.hash;
  const [r, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const ruta = RUTAS[r || ''] || RUTAS[''];
  document.body.dataset.ruta = RUTAS[r || ''] ? (r || 'lista') : 'lista';
  $$('#tabs a.item-nav').forEach((a) => { const on = a.dataset.tab === ruta.tab; a.classList.toggle('activa', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#titulo').innerHTML = ruta.titulo;
  raiz().innerHTML = '<div class="lista" aria-busy="true" aria-label="Cargando"><div class="esq"></div><div class="esq"></div><div class="esq"></div></div>';
  try { await ruta.vista(raiz(), ctx, arg); }
  catch (e) { console.error(e); raiz().innerHTML = `<div class="vacio"><p><b>Algo falló.</b></p><p>${String(e.message || e)}</p><a class="btn" href="#/">Volver al inicio</a></div>`; }
  if (!forzar) window.scrollTo(0, 0);
}

function pintarSync() {
  const e = store.getEstadoSync();
  const el = $('#sync-estado');
  const n = e.pendientes || 0;
  const txt = {
    local: n ? `${n} sin respaldo` : 'Solo este equipo', ok: n ? `${n} pendientes` : 'Sincronizado', sincronizando: 'Sincronizando…',
    'sin-conexion': n ? `Sin conexión · ${n} pendientes` : 'Sin conexión', 'sin-sesion': 'Iniciá sesión', error: 'Error de sincronización',
  }[e.modo] || e.texto;
  const ic = { local: 'nube_off', ok: 'nube', sincronizando: 'nube', 'sin-conexion': 'nube_off', 'sin-sesion': 'usuario', error: 'alerta' }[e.modo] || 'nube';
  el.innerHTML = `${icono(ic, 18)}<span>${txt}</span>`; el.className = 'sync ' + e.modo;
}

// Pantalla de acceso cuando no hay sesión (o no hay base de usuarios): no se muestra nada del negocio.
function mostrarAcceso(modo, detalle = '', conf = null) {
  document.body.dataset.acceso = 'cerrado';
  $('#titulo').innerHTML = 'Acceso <em>privado</em>';
  const r = raiz();
  const recargarEnInicio = async () => { history.replaceState(null, '', location.pathname + location.search); location.reload(); };
  if (modo === 'login') { vistaLogin(r, ctx, { obligatorio: true, alEntrar: recargarEnInicio }); return; }
  if (modo === 'clave') { acceso.pantallaClave(r, conf, recargarEnInicio); return; }
  const texto = {
    'sin-base': ['Esta aplicación es de uso interno.', 'Todavía no está configurado el acceso. Si administrás la app, seguí la sección 2 del LEEME.'],
    'sin-permiso': ['Tu usuario todavía no tiene permiso.', 'Pedile a quien administra la app que agregue tu mail a la lista de personas autorizadas.'],
    error: ['No se pudo conectar.', detalle || 'Revisá tu conexión y volvé a intentar.'],
  }[modo];
  r.innerHTML = `<section class="login-pantalla"><h2>Acceso <em>privado</em></h2><p class="ayuda"><b>${texto[0]}</b></p><p class="ayuda">${texto[1]}</p>${modo === 'login' ? '' : '<div class="fila-botones"><button class="btn primario" id="a-reintentar">Reintentar</button></div>'}</section>`;
  const b = $('#a-reintentar'); if (b) b.onclick = () => location.reload();
}

async function arrancar() {
  const url = localStorage.getItem('sb_url') || appConfig.supabaseUrl;
  const key = localStorage.getItem('sb_key') || appConfig.supabaseKey;
  try { await cargarConfig(); } catch (e) { raiz().innerHTML = `<div class="vacio"><p><b>No se pudo cargar la configuración del negocio.</b></p><p>${e.message}</p></div>`; return; }
  document.title = (cfg.app_nombre || 'Carga de productos') + ' · Marketing KAI';
  aplicarTema(temaGuardado());
  $$('[data-i]').forEach((el) => { el.innerHTML = icono(el.dataset.i, 22); });

  // --- puerta de acceso: sin sesión no se ve ni se usa nada ---
  // Con base de usuarios (Supabase) manda el login real. Sin ella, si hay clave compartida (config/acceso.json), se pide esa clave.
  const hayBase = !!(url && key);
  const conf = !hayBase && appConfig.acceso ? await acceso.cargarAcceso(appConfig.acceso) : null;
  acceso.fijar(conf);
  const exige = appConfig.requiereLogin !== false && (hayBase || !!conf || !HOST_LOCAL.includes(location.hostname));
  let sesion = null;
  if (hayBase) {
    try { await remote.iniciar({ url, key, negocio: appConfig.negocio || cfg.id }); sesion = await remote.sesion(); }
    catch (e) { console.error(e); if (exige) { mostrarAcceso('error', String(e.message || e)); return; } toast('No se pudo conectar con la base compartida: ' + (e.message || e), 'error'); }
  }
  if (exige && !hayBase) {
    if (!conf) { mostrarAcceso('sin-base'); return; }
    if (!acceso.recordado(conf)) { mostrarAcceso('clave', '', conf); return; }
  } else if (exige && !sesion) { mostrarAcceso('login'); return; }
  if (exige && sesion) {
    let permitido = false;
    try { permitido = await remote.esEquipo(); } catch (e) { console.error(e); mostrarAcceso('error', 'No se pudo comprobar tu permiso: ' + (e.message || e)); return; }
    if (!permitido) { await remote.salir(); mostrarAcceso('sin-permiso'); return; }
  }
  if (hayBase && remote.configurado()) remote.escucharSesion((evento) => { if (evento === 'SIGNED_OUT') location.reload(); });

  store.eventos.addEventListener('sync', pintarSync);
  store.eventos.addEventListener('cambio', () => store.contarPendientes().then(pintarSync));
  $('#sync-estado').onclick = async () => {
    if (!remote.configurado()) { location.hash = '#/ajustes'; return; }
    if (!(await remote.sesion())) { location.hash = '#/login'; return; }
    const r = await store.sincronizar(); toast(r.ok ? 'Sincronizado' : 'No se pudo sincronizar: ' + (r.motivo || (r.errores || []).join('; ')), r.ok ? '' : 'error');
  };

  let ir = null;
  if (remote.configurado()) {
    store.iniciarAutoSync();
    if (!sesion) { store.eventos.dispatchEvent(new CustomEvent('sync', { detail: {} })); ir = '#/login'; }
    else { try { await ctx.alIniciarSesion(); } catch (e) { console.error(e); toast('No se pudo sincronizar al entrar: ' + (e.message || e), 'error'); } }
  }
  await store.contarPendientes();
  pintarSync();
  window.addEventListener('hashchange', () => navegar());
  if (ir && !location.hash) location.hash = ir; else await navegar(true);
  avisoTiendaNube();
}

// Al instalar la app en una tienda, la función de Supabase vuelve acá con ?tiendanube=<resultado>.
const AVISOS_TN = {
  conectada: 'Tienda Nube conectada. La tienda quedó autorizada.',
  'sin-codigo': 'Tienda Nube no mandó el código de autorización. Volvé a instalar la app.',
  'falta-configuracion': 'Falta configurar la conexión con Tienda Nube en el servidor.',
  'error-token': 'Tienda Nube rechazó la autorización. Volvé a instalar la app.',
  'error-guardar': 'Se autorizó, pero no se pudo guardar el permiso de la tienda en el servidor.',
};
function avisoTiendaNube() {
  const q = new URLSearchParams(location.search);
  const estado = q.get('tiendanube');
  if (!estado) return;
  q.delete('tiendanube');
  history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  alert(AVISOS_TN[estado] || 'Tienda Nube: ' + estado);
}

// Service worker: modo sin conexión + encabezados para usar varios núcleos (si el hosting no los trae, se recarga una vez).
if ('serviceWorker' in navigator) {
  const recargarUnaVez = () => { if (!sessionStorage.getItem('coi-recarga')) { sessionStorage.setItem('coi-recarga', '1'); location.reload(); } };
  navigator.serviceWorker.register('sw.js').then(() => {
    if (window.crossOriginIsolated) return;
    if (navigator.serviceWorker.controller) recargarUnaVez();
    else navigator.serviceWorker.addEventListener('controllerchange', recargarUnaVez, { once: true });
  }).catch(() => {});
}
window.__app = { store, remote, ctx };
arrancar();
