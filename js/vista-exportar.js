// Pantalla de exportación en tres pasos: elegir, descargar CSV + fotos, importar y marcar como cargados.
import appConfig from '../app-config.js';
import * as remote from './remote.js';
import { listaVisible, guardarProducto, obtener, bytesFoto } from './store.js';
import { normSku, operador } from './config.js';
import { revisar, skusRepetidos, construirCSV, csvABytes, construirInterno, construirZipFotos, slugDe, nombreFoto } from './exportar.js';
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
        <section class="panel paso" id="panel-tn" hidden></section>
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
        const { blob, ok, total, fallas } = await construirZipFotos(grupo, (n, t) => { $('#barra').style.width = Math.round((n / t) * 100) + '%'; $('#txt').textContent = `Armando el ZIP: ${n} de ${t} fotos`; });
        descargar(blob, `fotos-productos-${sello()}-parte${+b.dataset.parte + 1}.zip`);
        if (fallas.length) toast(`ZIP con ${ok} de ${total} fotos. No se pudieron leer: ${fallas.slice(0, 4).join(', ')}${fallas.length > 4 ? ` y ${fallas.length - 4} más` : ''}. Volvé a sacar esas fotos.`, 'error');
        else toast('ZIP de fotos descargado');
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
  iniciarFotosTN(todos);
}

// ---------- Subir fotos directo a Tienda Nube (por SKU, a productos que ya existen en la tienda) ----------
const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => mal(r.error || new Error('No se pudo leer la foto'));
  r.readAsDataURL(blob);
});
const tnElegidos = new Set();

async function iniciarFotosTN(todos) {
  const tienda = String(appConfig.tiendanube?.tienda || '');
  const panel = $('#panel-tn');
  if (!tienda || !remote.configurado() || !(await remote.sesion())) return; // hace falta el login con Supabase
  panel.hidden = false;

  // fotos de un producto que todavía no se subieron a ESTA tienda
  const pendientes = (p) => (p.fotos || []).filter((f) => !(p.tn?.tienda === tienda && (p.tn.subidas || []).includes(f.id)));
  const lista = todos.filter((p) => p.sku && (p.fotos || []).length);
  for (const p of lista) if (pendientes(p).length) tnElegidos.add(p.id);
  for (const id of [...tnElegidos]) if (!lista.find((p) => p.id === id)) tnElegidos.delete(id);

  function pintar() {
    const hay = lista.filter((p) => tnElegidos.has(p.id)).length;
    panel.innerHTML = `
      <div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">＋</span>Subir fotos directo a Tienda Nube</h3>
        <p class="ayuda">Busca cada producto por su SKU en la tienda y le agrega las fotos. No cambia precios, nombres ni descripciones. Tienda <span class="num">${esc(tienda)}</span>.</p>
        <div class="items" id="tn-items">${lista.length ? lista.map((p) => {
          const n = pendientes(p).length;
          return `<label class="item"><input type="checkbox" data-id="${p.id}" ${tnElegidos.has(p.id) ? 'checked' : ''}>
            <div style="min-width:0"><span class="sku num">${esc(normSku(p.sku))}</span> <span class="estado ${n ? 'e-borrador' : 'e-cargado'}">${n ? `${n} para subir` : 'Subidas'}</span>
            <div>${esc(p.nombre || 'Sin nombre')}</div></div></label>`;
        }).join('') : '<p class="ayuda" style="margin:0">Todavía no hay productos con SKU y fotos.</p>'}</div>
        <label class="ayuda" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="tn-forzar"> Agregar aunque el producto ya tenga fotos en la tienda</label>
        <div class="fila-botones col"><button class="btn primario" id="b-tn" ${hay ? '' : 'disabled'}>${icono('imagen', 20)}Subir fotos de ${hay} producto${hay === 1 ? '' : 's'}</button></div>
        <div id="tn-prog" class="progreso" hidden><div class="barra"><i id="tn-barra"></i></div><span id="tn-txt"></span></div>
        <ul class="ayuda" id="tn-res" style="padding-left:18px;margin:0"></ul>
      </div>`;
    $$('#tn-items input').forEach((c) => (c.onchange = () => { c.checked ? tnElegidos.add(c.dataset.id) : tnElegidos.delete(c.dataset.id); pintar(); }));
    $('#b-tn') && ($('#b-tn').onclick = subir);
  }

  async function subir() {
    const forzar = $('#tn-forzar').checked;
    const ids = lista.filter((p) => tnElegidos.has(p.id)).map((p) => p.id);
    const total = lista.filter((p) => tnElegidos.has(p.id)).reduce((a, p) => a + pendientes(p).length, 0);
    $('#b-tn').disabled = true; $('#tn-prog').hidden = false;
    const res = $('#tn-res'); res.innerHTML = '';
    const linea = (txt, mal) => { const li = document.createElement('li'); li.textContent = txt; if (mal) li.className = 'rojo'; res.appendChild(li); };
    let hechas = 0, productosOk = 0;
    const avance = () => { $('#tn-barra').style.width = Math.round((hechas / Math.max(total, 1)) * 100) + '%'; $('#tn-txt').textContent = `Subiendo fotos: ${hechas} de ${total}`; };
    avance();

    for (const id of ids) {
      let p = await obtener(id);
      if (!p) continue;
      const etiqueta = normSku(p.sku);
      try {
        const pend = pendientes(p).length;
        if (!pend) { linea(`${etiqueta}: ya estaba subido`); productosOk++; continue; }
        const enTienda = await remote.tiendaNube('buscar', { tienda, sku: etiqueta });
        if (!enTienda.existe) { linea(`${etiqueta}: no está en la tienda, revisá el SKU. No se subió nada.`, true); hechas += pend; avance(); continue; }
        const yaSubimosAlgo = p.tn?.tienda === tienda && (p.tn.subidas || []).length;
        if (enTienda.fotos.length && !forzar && !yaSubimosAlgo) {
          linea(`${etiqueta}: ya tiene ${enTienda.fotos.length} foto${enTienda.fotos.length === 1 ? '' : 's'} en la tienda y no se tocó. Tildá «Agregar aunque ya tenga fotos» si querés sumarlas.`, true);
          hechas += pend; avance(); continue;
        }
        let posicion = enTienda.fotos.length, subidas = 0;
        for (;;) {
          // se vuelve a leer el producto antes de cada foto: tras guardarlo, en iPhone los Blob de la copia vieja pueden quedar sin archivo
          p = await obtener(id);
          const indice = (p.fotos || []).findIndex((f) => !(p.tn?.tienda === tienda && (p.tn.subidas || []).includes(f.id)));
          if (indice < 0) break;
          const f = p.fotos[indice];
          const base64 = await aBase64(await bytesFoto(f));
          await remote.tiendaNube('subir-foto', { tienda, producto: enTienda.id, nombre: nombreFoto(p, indice, f.ext || 'jpg'), base64, posicion: ++posicion });
          p.tn = { tienda, subidas: [...(p.tn?.tienda === tienda ? p.tn.subidas : []), f.id], fecha: new Date().toISOString() };
          await guardarProducto(p, operador());
          subidas++; hechas++; avance();
        }
        linea(`${etiqueta}: ${subidas} foto${subidas === 1 ? '' : 's'} subida${subidas === 1 ? '' : 's'} a «${enTienda.nombre}»`);
        productosOk++;
      } catch (e) { linea(`${etiqueta}: ${e.message}`, true); }
    }
    $('#tn-prog').hidden = true;
    toast(`Listo: ${productosOk} de ${ids.length} producto${ids.length === 1 ? '' : 's'} con fotos en Tienda Nube`, productosOk === ids.length ? '' : 'error');
    const nuevos = await listaVisible();
    lista.splice(0, lista.length, ...nuevos.filter((q) => q.sku && (q.fotos || []).length).sort((a, b) => normSku(a.sku).localeCompare(normSku(b.sku), 'es', { numeric: true })));
    const resultados = res.innerHTML;
    pintar(); $('#tn-res').innerHTML = resultados;
  }

  pintar();
}
