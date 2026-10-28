// Tiendas de Tienda Nube a las que esta app puede enviar (las define app-config.js) y cuál está elegida en este equipo.
import appConfig from '../app-config.js';
import * as remote from './remote.js';
import { esc } from './util.js';

const CLAVE = 'tn_tienda';
export const tiendas = () => appConfig.tiendanube?.tiendas || [];

export function tiendaActual() {
  let guardada = '';
  try { guardada = localStorage.getItem(CLAVE) || ''; } catch { /* sin almacenamiento */ }
  const lista = tiendas();
  return lista.find((t) => t.id === guardada) || lista.find((t) => t.id === appConfig.tiendanube?.tienda) || lista[0] || null;
}
export function fijarTienda(id) { try { localStorage.setItem(CLAVE, id); } catch { /* sin almacenamiento */ } }

// Tiendas que ya instalaron la app (lo informa el servidor, sin mostrar ningún permiso)
let conectadas = null;
export async function tiendasConectadas() {
  if (!conectadas) conectadas = (await remote.tiendaNube('estado')).tiendas || [];
  return conectadas;
}

// Selector de tienda de destino, con un aviso bien visible cuando es la tienda real
export function selectorTiendaHtml(actual, conectadasIds) {
  const opciones = tiendas().map((t) => {
    const ok = conectadasIds.includes(t.id);
    return `<option value="${esc(t.id)}" ${t.id === actual?.id ? 'selected' : ''} ${ok ? '' : 'disabled'}>${esc(t.nombre)}${t.real ? ' (tienda real)' : ' (prueba)'}${ok ? '' : ' · sin conectar'}</option>`;
  }).join('');
  return `<label class="campo" style="margin:0 0 6px"><span>Tienda de destino</span><select id="tn-tienda">${opciones}</select></label>
    <p class="${actual?.real ? 'rojo' : 'ayuda'}" style="margin:0 0 10px"><b>${actual?.real ? `Estás enviando a la tienda REAL: ${esc(actual.nombre)}.` : 'Tienda de prueba: no afecta a la tienda real.'}</b></p>`;
}
