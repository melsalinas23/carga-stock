// Pantalla principal: lista de productos con búsqueda, filtros y el riel de avance de cada uno.
import { listaVisible, srcFoto, eventos } from './store.js';
import { normSku, cfg } from './config.js';
import { skusRepetidos } from './exportar.js';
import { avance, rielHTML, textoFaltan } from './riel.js';
import { icono } from './iconos.js';
import { esc, $, $$, fmtARS, debounce, sinTildes } from './util.js';

const filtro = { q: '', estado: 'todos' };
const ESTADOS = { borrador: 'Borrador', listo: 'Listo', cargado: 'Cargado' };
const FILTROS = [['todos', 'Todos'], ['borrador', 'Borradores'], ['listo', 'Listos'], ['cargado', 'Cargados'], ['sinfoto', 'Sin foto']];

export async function vistaLista(raiz, ctx) {
  raiz.innerHTML = `
    <div class="buscador">
      ${icono('buscar', 20)}
      <label class="sr-only" for="q">Buscar productos</label>
      <input id="q" type="search" placeholder="Buscar por SKU, nombre o marca" value="${esc(filtro.q)}" autocomplete="off">
    </div>
    <div class="filtros" id="filtros" role="tablist" aria-label="Filtrar por estado"></div>
    <p id="resumen" class="resumen"></p>
    <div id="lista-zona"></div>`;

  async function pintar() {
    const todos = await listaVisible();
    const rep = await skusRepetidos();
    const cuenta = { todos: todos.length, borrador: 0, listo: 0, cargado: 0, sinfoto: 0 };
    for (const p of todos) { cuenta[p.estado] = (cuenta[p.estado] || 0) + 1; if (!(p.fotos || []).length) cuenta.sinfoto++; }

    $('#filtros').innerHTML = FILTROS.map(([k, t]) => `<button type="button" role="tab" class="filtro" aria-selected="${filtro.estado === k}" data-f="${k}">${t} <b>${cuenta[k] || 0}</b></button>`).join('');
    $$('#filtros .filtro').forEach((b) => (b.onclick = () => { filtro.estado = b.dataset.f; pintar(); }));

    const q = sinTildes(filtro.q).toLowerCase().trim();
    const qsku = q.replace(/^0+/, '');
    const lista = todos.filter((p) => {
      if (filtro.estado === 'sinfoto' && (p.fotos || []).length) return false;
      if (['borrador', 'listo', 'cargado'].includes(filtro.estado) && p.estado !== filtro.estado) return false;
      if (!q) return true;
      const sku = String(p.sku || '').toLowerCase();
      return sku.includes(q) || (qsku && sku.replace(/^0+/, '').includes(qsku)) || sinTildes(`${p.nombre} ${p.marca} ${p.categoria}`).toLowerCase().includes(q);
    }).sort((a, b) => (b.actualizado_en || '').localeCompare(a.actualizado_en || ''));

    const zona = $('#lista-zona');
    if (!cfg.categorias.length) {
      $('#filtros').hidden = true; $('.buscador', raiz).hidden = true; $('#resumen').textContent = '';
      zona.innerHTML = `<section class="vacio-panel"><h2>Falta cargar los <em>datos del negocio</em></h2><p>Categorías, proveedores y medidas se cargan una sola vez desde un archivo de configuración.</p><ol><li>${icono('ajustes', 22)} Entrá a Ajustes</li><li>${icono('subir', 22)} Tocá «Cargar configuración» y elegí el archivo</li><li>${icono('check', 22)} Listo: queda guardado para todo el equipo</li></ol><a class="btn primario grande" href="#/ajustes" style="max-width:340px">Ir a Ajustes</a></section>`;
      return;
    }
    $('#resumen').textContent = todos.length ? `${lista.length} de ${todos.length} producto${todos.length === 1 ? '' : 's'}` : '';

    if (!todos.length) {
      $('#filtros').hidden = true;
      $('.buscador', raiz).hidden = true;
      zona.innerHTML = `
        <section class="vacio-panel">
          <h2>Empecemos <em>por el primero</em></h2>
          <p>Cada producto se carga en tres pasos, parado frente al estante.</p>
          <ol>
            <li>${icono('camara', 22)} Sacá la foto: se le quita el fondo en el celular</li>
            <li>${icono('lapiz', 22)} Completá SKU, nombre, categoría y precio</li>
            <li>${icono('check', 22)} Marcalo como listo y exportalo a Tienda Nube</li>
          </ol>
          <a class="btn primario grande" href="#/nuevo" style="max-width:340px">${icono('camara', 22)} Cargar el primer producto</a>
        </section>`;
      return;
    }
    $('#filtros').hidden = false; $('.buscador', raiz).hidden = false;
    if (!lista.length) { zona.innerHTML = '<div class="vacio"><p><b>No hay productos con ese filtro.</b></p><p>Probá con otra búsqueda o tocá «Todos».</p></div>'; return; }

    zona.innerHTML = `
      <div class="cab-lista" aria-hidden="true"><span></span><span>SKU</span><span>Producto</span><span>Categoría</span><span>Precio</span><span>Avance</span><span>Estado</span></div>
      <div class="lista">${lista.slice(0, 300).map((p) => {
        const f = (p.fotos || [])[0];
        const a = avance(p);
        const src = f ? srcFoto(f) : '';
        const repetido = rep.has(normSku(p.sku));
        return `<a class="fila" href="#/producto/${p.id}">
          <div class="foto-mini ${src ? '' : 'sin'}">${src ? `<img src="${src}" alt="" loading="lazy" crossorigin="anonymous">` : icono('camara', 24)}</div>
          <div class="cuerpo">
            <div class="l1"><span class="sku num">${esc(normSku(p.sku) || 'Sin SKU')}</span>
              <span class="estado-wrap"><span class="estado e-${p.estado}">${p.estado === 'cargado' ? icono('check', 14) : ''}${ESTADOS[p.estado] || esc(p.estado)}</span>${p._dirty ? `<span class="pend" title="Pendiente de sincronizar"><span class="sr-only">Pendiente de sincronizar</span></span>` : ''}</span>
            </div>
            <div class="nom">${esc(p.nombre || 'Sin nombre')}</div>
            <div class="meta"><span class="cat">${esc(p.categoria ? p.categoria.split(' > ').pop() : 'Sin categoría')}</span><span class="precio num">${fmtARS(p.precio)}</span></div>
            <div class="avance">${rielHTML(p)}<span class="avance-txt">${esc(p.estado === 'cargado' && a.completo ? 'Cargado en la tienda' : textoFaltan(a))}${repetido ? ' · SKU repetido' : ''}</span></div>
          </div>
        </a>`;
      }).join('')}</div>${lista.length > 300 ? '<p class="resumen">Se muestran 300. Usá la búsqueda para ver el resto.</p>' : ''}`;
  }

  $('#q').oninput = debounce((e) => { filtro.q = e.target.value; pintar(); }, 200);
  const alCambiar = () => pintar();
  eventos.addEventListener('cambio', alCambiar);
  ctx.alSalir(() => eventos.removeEventListener('cambio', alCambiar));
  await pintar();
}
