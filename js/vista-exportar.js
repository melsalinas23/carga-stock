// Pantalla de exportación en tres pasos: elegir, descargar CSV + fotos, importar y marcar como cargados.
import { listaVisible, guardarProducto } from './store.js';
import { normSku, operador } from './config.js';
import { revisar, skusRepetidos, construirCSV, csvABytes, construirInterno, construirZipFotos, slugDe } from './exportar.js';
import { icono } from './iconos.js';
import { esc, $, $$, descargar, toast } from './util.js';

const TAM_ZIP = 40; // productos por ZIP de fotos (para no saturar el celular)
const sello = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const elegidos = new Set();
let iniciado = false;
const ESTADOS = { borrador: 'Borrador', listo: 'Listo', cargado: 'Cargado' };

export async function vistaExportar(raiz, ctx) {
  const todos = await listaVisible();
  const rep = await skusRepetidos();
  todos.sort((a, b) => normSku(a.sku).localeCompare(normSku(b.sku), 'es', { numeric: true }));
  if (!iniciado) { todos.filter((p) => p.estado === 'listo').forEach((p) => elegidos.add(p.id)); iniciado = true; }
  for (const id of [...elegidos]) if (!todos.find((p) => p.id === id)) elegidos.delete(id);

  const info = new Map(todos.map((p) => [p.id, revisar(p, rep)]));
  const bloqueado = (p) => info.get(p.id).some((x) => x.critico);

  raiz.innerHTML = `
    <div class="exp-cols">
      <section class="panel paso">
        <div>
          <h3 class="paso-t"><span class="nro" aria-hidden="true">1</span>Elegí qué exportar</h3>
          <p class="ayuda">Vienen tildados los productos en estado «Listo». Los que tienen datos obligatorios sin completar no se pueden exportar.</p>
          <div class="fila-botones" style="margin:8px 0 0">
            <button class="btn chico" id="sel-listos">Los listos</button>
            <button class="btn chico" id="sel-todos">Todos los completos</button>
            <button class="btn chico" id="sel-nada">Ninguno</button>
          </div>
          <div id="items" class="items"></div>
        </div>
      </section>

      <div class="col-der">
        <section class="panel paso" id="acciones"></section>
        <section class="panel paso">
          <div>
            <h3 class="paso-t"><span class="nro" aria-hidden="true">3</span>Importá en Tienda Nube</h3>
            <ol class="pasos">
              <li>En Tienda Nube: <b>Productos, Importar y exportar, Importar</b>. Elegí el CSV. Si los productos ya existían, tildá <i>«Modificar productos ya existentes»</i>.</li>
              <li>Las fotos no viajan en el CSV. Subí el contenido del ZIP con tu app de carga masiva de imágenes: cada foto se llama como el SKU.</li>
              <li>Volvé y tocá <b>«Marcar como cargados»</b> para no repetir productos.</li>
            </ol>
            <div class="fila-botones col"><button class="btn" id="b-cargados">${icono('check', 20)}Marcar como cargados en la tienda</button></div>
          </div>
        </section>
      </div>
    </div>`;

  function pintarItems() {
    $('#items').innerHTML = todos.length ? todos.map((p) => {
      const faltas = info.get(p.id);
      const crit = faltas.filter((x) => x.critico), av = faltas.filter((x) => !x.critico);
      return `<label class="item ${bloqueado(p) ? 'bloq' : ''}">
        <input type="checkbox" data-id="${p.id}" ${elegidos.has(p.id) ? 'checked' : ''} ${bloqueado(p) ? 'disabled' : ''}>
        <div style="min-width:0"><span class="sku num">${esc(normSku(p.sku) || 'Sin SKU')}</span> <span class="estado e-${p.estado}">${ESTADOS[p.estado] || esc(p.estado)}</span>
          <div>${esc(p.nombre || 'Sin nombre')}</div>
          ${crit.length ? `<div class="faltas rojo">No se puede exportar: falta ${esc(crit.map((x) => x.texto).join(', '))}</div>` : ''}
          ${av.length ? `<div class="faltas">Conviene completar: ${esc(av.map((x) => x.texto.split(' (')[0]).join(', '))}</div>` : ''}
        </div>
      </label>`;
    }).join('') : `<div class="vacio"><p><b>Todavía no hay productos.</b></p><a class="btn primario" href="#/nuevo">${icono('camara', 20)}Cargar el primero</a></div>`;
    $$('#items input').forEach((c) => (c.onchange = () => { c.checked ? elegidos.add(c.dataset.id) : elegidos.delete(c.dataset.id); pintarAcciones(); }));
    pintarAcciones();
  }

  const seleccion = () => todos.filter((p) => elegidos.has(p.id) && !bloqueado(p));

  function pintarAcciones() {
    const sel = seleccion();
    const conFotos = sel.filter((p) => (p.fotos || []).length);
    const nFotos = conFotos.reduce((a, p) => a + p.fotos.length, 0);
    const partes = Math.ceil(conFotos.length / TAM_ZIP);
    $('#acciones').innerHTML = `
      <div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">2</span>Descargá los archivos</h3>
        <p class="ayuda"><b class="num">${sel.length}</b> producto${sel.length === 1 ? '' : 's'} elegido${sel.length === 1 ? '' : 's'} · <span class="num">${nFotos}</span> foto${nFotos === 1 ? '' : 's'}</p>
        <div class="fila-botones col">
          <button class="btn primario" id="b-csv" ${sel.length ? '' : 'disabled'}>${icono('descargar', 20)}CSV para Tienda Nube</button>
          ${partes ? Array.from({ length: partes }, (_, i) => `<button class="btn b-zip" data-parte="${i}">${icono('imagen', 20)}Fotos${partes > 1 ? ` (parte ${i + 1} de ${partes})` : ''}</button>`).join('') : '<p class="ayuda" style="margin:0">Los productos elegidos no tienen fotos.</p>'}
          <button class="btn fantasma" id="b-int" ${sel.length ? '' : 'disabled'}>${icono('copia', 20)}Planilla interna con precio mayorista</button>
        </div>
        <div id="prog" class="progreso" hidden><div class="barra"><i id="barra"></i></div><span id="txt"></span></div>
        <p class="ayuda">El CSV usa «;» como separador y codificación Latin-1, igual que los archivos que ya importaste.</p>
      </div>`;

    $('#b-csv') && ($('#b-csv').onclick = async () => {
      const sel2 = seleccion();
      for (const p of sel2) { if (!p.slug) { p.slug = slugDe(p); await guardarProducto(p, operador()); } } // el slug queda fijo para poder actualizar después
      descargar(new Blob([csvABytes(construirCSV(sel2))], { type: 'text/csv;charset=iso-8859-1' }), `productos-tiendanube-${sello()}.csv`);
      toast(`CSV con ${sel2.length} producto${sel2.length === 1 ? '' : 's'} descargado`);
    });
    $('#b-int') && ($('#b-int').onclick = () => descargar(new Blob(['﻿' + construirInterno(seleccion())], { type: 'text/csv;charset=utf-8' }), `planilla-interna-${sello()}.csv`));
    $$('.b-zip').forEach((b) => (b.onclick = async () => {
      const grupo = conFotos.slice(+b.dataset.parte * TAM_ZIP, (+b.dataset.parte + 1) * TAM_ZIP);
      const prog = $('#prog'); prog.hidden = false;
      try {
        const zip = await construirZipFotos(grupo, (n, t) => { $('#barra').style.width = Math.round((n / t) * 100) + '%'; $('#txt').textContent = `Armando el ZIP: ${n} de ${t} fotos`; });
        descargar(zip, `fotos-productos-${sello()}-parte${+b.dataset.parte + 1}.zip`);
        toast('ZIP de fotos descargado');
      } catch (e) { toast('No se pudo armar el ZIP: ' + e.message, 'error'); }
      prog.hidden = true;
    }));
  }

  $('#b-cargados').onclick = async () => {
    const sel2 = seleccion();
    if (!sel2.length) { toast('Elegí primero qué productos importaste.', 'error'); return; }
    if (!confirm(`¿Marcar ${sel2.length} producto${sel2.length === 1 ? '' : 's'} como «Cargado»? Hacelo solo después de importarlos en Tienda Nube.`)) return;
    for (const p of sel2) { p.estado = 'cargado'; p.exportado_en = new Date().toISOString(); await guardarProducto(p, operador()); }
    elegidos.clear(); toast('Listo: quedaron marcados como cargados'); ctx.recargar();
  };
  $('#sel-listos').onclick = () => { elegidos.clear(); todos.filter((p) => p.estado === 'listo' && !bloqueado(p)).forEach((p) => elegidos.add(p.id)); pintarItems(); };
  $('#sel-todos').onclick = () => { elegidos.clear(); todos.filter((p) => !bloqueado(p) && p.estado !== 'cargado').forEach((p) => elegidos.add(p.id)); pintarItems(); };
  $('#sel-nada').onclick = () => { elegidos.clear(); pintarItems(); };
  pintarItems();
}
