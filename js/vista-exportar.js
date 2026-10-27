// Pantalla de exportación en tres pasos: elegir, descargar CSV + fotos, importar y marcar como cargados.
import appConfig from '../app-config.js';
import * as remote from './remote.js';
import { listaVisible, guardarProducto, obtener, bytesFoto } from './store.js';
import { normSku, operador } from './config.js';
import { revisar, skusRepetidos, construirCSV, csvABytes, construirInterno, construirZipFotos, slugDe, nombreFoto, textoAHtml } from './exportar.js';
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
  iniciarTN(todos);
}

// ---------- Enviar a Tienda Nube (datos + fotos, por SKU) ----------
const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => mal(r.error || new Error('No se pudo leer la foto'));
  r.readAsDataURL(blob);
});
const tnElegidos = new Set();
const numero = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const rutaCat = (c) => String(c || '').split('>').map((x) => x.trim()).filter(Boolean);

// Lo que se manda al servidor: los datos del producto tal como están cargados en la app
const cargaTN = (p) => ({
  sku: normSku(p.sku), nombre: (p.nombre || '').trim(), descripcionHtml: textoAHtml(p.descripcion),
  categorias: [p.categoria, p.categoria_extra].map(rutaCat).filter((r) => r.length),
  marca: (p.marca || '').trim(), tags: (p.tags || '').trim(), seoTitulo: (p.seo_titulo || '').trim(), seoDesc: (p.seo_desc || '').trim(),
  precio: numero(p.precio), precioPromo: numero(p.precio_promo), costo: numero(p.costo),
  peso: numero(p.peso), alto: numero(p.alto), ancho: numero(p.ancho), prof: numero(p.prof), stock: numero(p.stock),
  barcode: (p.barcode || '').trim(), mpn: (p.mpn || '').trim(), envioGratis: !!p.envio_gratis, fisico: p.fisico !== false, props: p.props || [],
});

const TITULO_PLAN = { crear: 'Se crea, oculto', actualizar: 'Se actualiza', 'sin-cambios': 'Datos sin cambios', 'no-se-puede': 'No se puede crear', 'solo-fotos': 'Solo fotos', 'no-existe': 'No está en la tienda' };

async function iniciarTN(todos) {
  const tienda = String(appConfig.tiendanube?.tienda || '');
  const panel = $('#panel-tn');
  if (!tienda || !remote.configurado() || !(await remote.sesion())) return; // hace falta el login con Supabase
  panel.hidden = false;

  const subidas = (p) => (p.tn?.tienda === tienda ? p.tn.subidas || [] : []);
  const pendientes = (p) => (p.fotos || []).filter((f) => !subidas(p).includes(f.id));
  const lista = todos.filter((p) => p.sku);
  for (const p of lista) if (p.estado !== 'cargado' && (pendientes(p).length || p.estado === 'listo')) tnElegidos.add(p.id);
  for (const id of [...tnElegidos]) if (!lista.find((p) => p.id === id)) tnElegidos.delete(id);

  const op = { datos: true, fotos: true, desc: false, forzar: false };
  let plan = [], informe = [], fase = 'lista';
  const li = ([txt, mal]) => `<li class="${mal ? 'rojo' : ''}">${esc(txt)}</li>`;

  function pintar() {
    if (fase === 'plan') return pintarPlan();
    const hay = lista.filter((p) => tnElegidos.has(p.id)).length;
    const casilla = (k, txt) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-op="${k}" ${op[k] ? 'checked' : ''}> ${txt}</label>`;
    panel.innerHTML = `
      <div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">＋</span>Enviar a Tienda Nube</h3>
        <p class="ayuda">Crea o actualiza cada producto por su SKU y le sube las fotos. Los productos nuevos se crean ocultos y quedan visibles solo si están en estado «Listo» y tienen fotos. Antes de enviar ves qué va a cambiar. Tienda <span class="num">${esc(tienda)}</span>.</p>
        <div class="items" id="tn-items">${lista.length ? lista.map((p) => {
          const n = pendientes(p).length;
          return `<label class="item"><input type="checkbox" data-id="${p.id}" ${tnElegidos.has(p.id) ? 'checked' : ''}>
            <div style="min-width:0"><span class="sku num">${esc(normSku(p.sku))}</span> <span class="estado ${n ? 'e-borrador' : 'e-cargado'}">${n ? `${n} foto${n === 1 ? '' : 's'} para subir` : 'Fotos subidas'}</span>
            <div>${esc(p.nombre || 'Sin nombre')}</div></div></label>`;
        }).join('') : '<p class="ayuda" style="margin:0">Todavía no hay productos con SKU.</p>'}</div>
        <div class="ayuda" style="display:grid;gap:6px;margin:10px 0">
          ${casilla('datos', 'Datos del producto (crea o actualiza)')}
          ${casilla('fotos', 'Fotos')}
          ${casilla('desc', 'Reemplazar la descripción de los que ya existen')}
          ${casilla('forzar', 'Agregar fotos aunque el producto ya tenga fotos')}
        </div>
        <div class="fila-botones col"><button class="btn primario" id="b-tn" ${hay && (op.datos || op.fotos) ? '' : 'disabled'}>${icono('imagen', 20)}Revisar y enviar (${hay})</button></div>
        <div id="tn-prog" class="progreso" hidden><div class="barra"><i id="tn-barra"></i></div><span id="tn-txt"></span></div>
        <ul class="ayuda" id="tn-res" style="padding-left:18px;margin:8px 0 0">${informe.map(li).join('')}</ul>
      </div>`;
    $$('#tn-items input').forEach((c) => (c.onchange = () => { c.checked ? tnElegidos.add(c.dataset.id) : tnElegidos.delete(c.dataset.id); pintar(); }));
    $$('[data-op]', panel).forEach((c) => (c.onchange = () => { op[c.dataset.op] = c.checked; pintar(); }));
    $('#b-tn') && ($('#b-tn').onclick = revisarPlan);
  }

  function pintarPlan() {
    const accionables = plan.filter((e) => !e.error && !['no-se-puede', 'no-existe'].includes(e.accion) && (e.accion !== 'sin-cambios' || e.fotos > 0)).length;
    panel.innerHTML = `
      <div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">＋</span>Esto es lo que va a pasar</h3>
        <p class="ayuda">Revisalo antes de enviar. Todavía no se cambió nada en la tienda ${esc(tienda)}.</p>
        <ul class="ayuda" style="padding-left:18px;margin:0 0 10px;display:grid;gap:10px">${plan.map((e) => `
          <li class="${e.error || e.accion === 'no-se-puede' || e.accion === 'no-existe' ? 'rojo' : ''}"><b class="num">${esc(e.etiqueta)}</b> · ${esc(e.nombre || 'Sin nombre')}<br>
            <b>${e.error ? 'Error' : TITULO_PLAN[e.accion] || e.accion}</b>${e.error ? `: ${esc(e.error)}` : ''}${e.faltan?.length ? `: falta ${esc(e.faltan.join(', '))}` : ''}
            ${(e.cambios || []).map((c) => `<br>· ${esc(c.campo)}${c.antes ? `: ${esc(c.antes)} → ${esc(c.despues)}` : `: ${esc(c.despues)}`}`).join('')}
            ${e.fotos ? `<br>· ${e.fotos} foto${e.fotos === 1 ? '' : 's'} para subir` : ''}
          </li>`).join('')}</ul>
        <div class="fila-botones col">
          <button class="btn primario" id="b-tn-ok" ${accionables ? '' : 'disabled'}>${icono('check', 20)}Enviar a Tienda Nube</button>
          <button class="btn fantasma" id="b-tn-no">Volver</button>
        </div>
        <div id="tn-prog" class="progreso" hidden><div class="barra"><i id="tn-barra"></i></div><span id="tn-txt"></span></div>
      </div>`;
    $('#b-tn-no').onclick = () => { fase = 'lista'; pintar(); };
    $('#b-tn-ok').onclick = enviar;
  }

  const progreso = (n, total, txt) => { $('#tn-prog').hidden = false; $('#tn-barra').style.width = Math.round((n / Math.max(total, 1)) * 100) + '%'; $('#tn-txt').textContent = txt; };

  // Paso 1: se pregunta al servidor qué haría con cada producto, sin cambiar nada en la tienda
  async function revisarPlan() {
    const ids = lista.filter((p) => tnElegidos.has(p.id)).map((p) => p.id);
    $('#b-tn').disabled = true;
    plan = []; informe = [];
    for (let n = 0; n < ids.length; n++) {
      const p = await obtener(ids[n]);
      if (!p) continue;
      progreso(n, ids.length, `Revisando: ${n + 1} de ${ids.length}`);
      const e = { id: p.id, etiqueta: normSku(p.sku), nombre: p.nombre || '', fotos: op.fotos ? pendientes(p).length : 0, accion: '', cambios: [], faltan: [], tnId: null };
      try {
        if (op.datos) {
          const r = await remote.tiendaNube('sincronizar-producto', { tienda, simular: true, conDescripcion: op.desc, producto: cargaTN(p) });
          Object.assign(e, { accion: r.accion, cambios: r.cambios || [], faltan: r.faltan || [], tnId: r.id || null });
        } else {
          const r = await remote.tiendaNube('buscar', { tienda, sku: e.etiqueta });
          Object.assign(e, { accion: r.existe ? 'solo-fotos' : 'no-existe', tnId: r.id || null });
        }
        if (e.accion === 'no-se-puede' || e.accion === 'no-existe') e.fotos = 0;
      } catch (err) { e.error = err.message; }
      plan.push(e);
    }
    fase = 'plan'; pintar();
  }

  // Paso 2: datos, fotos y publicación, producto por producto
  async function enviar() {
    $('#b-tn-ok').disabled = true; $('#b-tn-no').disabled = true;
    informe = [];
    const trabajo = plan.filter((e) => !e.error && !['no-se-puede', 'no-existe'].includes(e.accion));
    for (const e of plan) {
      if (e.error) informe.push([`${e.etiqueta}: ${e.error}`, true]);
      else if (e.accion === 'no-se-puede') informe.push([`${e.etiqueta}: no se creó, falta ${e.faltan.join(', ')}`, true]);
      else if (e.accion === 'no-existe') informe.push([`${e.etiqueta}: no está en la tienda, revisá el SKU`, true]);
    }
    let ok = 0;
    for (let n = 0; n < trabajo.length; n++) {
      const e = trabajo[n];
      progreso(n, trabajo.length, `Enviando: ${n + 1} de ${trabajo.length} · ${e.etiqueta}`);
      const resumen = [];
      try {
        let p = await obtener(e.id);
        if (op.datos && (e.accion === 'crear' || e.accion === 'actualizar')) {
          const r = await remote.tiendaNube('sincronizar-producto', { tienda, simular: false, conDescripcion: op.desc, producto: cargaTN(p) });
          resumen.push(r.accion === 'crear' ? 'creado (oculto)' : 'datos actualizados');
        } else if (e.accion === 'sin-cambios') resumen.push('datos sin cambios');

        const enTienda = await remote.tiendaNube('buscar', { tienda, sku: e.etiqueta });
        if (!enTienda.existe) throw new Error('no aparece en la tienda');
        let fotosEnTienda = enTienda.fotos.length;
        if (op.fotos) {
          const yaSubimos = subidas(p).length;
          if (!pendientes(p).length) resumen.push('fotos ya estaban subidas');
          else if (fotosEnTienda && !op.forzar && !yaSubimos) resumen.push(`tiene ${fotosEnTienda} foto${fotosEnTienda === 1 ? '' : 's'} en la tienda y no se tocó`);
          else {
            let posicion = fotosEnTienda, cuantas = 0;
            for (;;) {
              // se vuelve a leer el producto antes de cada foto: tras guardarlo, en iPhone los Blob de la copia vieja pueden quedar sin archivo
              p = await obtener(e.id);
              const indice = (p.fotos || []).findIndex((f) => !subidas(p).includes(f.id));
              if (indice < 0) break;
              const f = p.fotos[indice];
              const base64 = await aBase64(await bytesFoto(f));
              await remote.tiendaNube('subir-foto', { tienda, producto: enTienda.id, nombre: nombreFoto(p, indice, f.ext || 'jpg'), base64, posicion: ++posicion });
              p.tn = { tienda, subidas: [...subidas(p), f.id], fecha: new Date().toISOString() };
              await guardarProducto(p, operador());
              cuantas++; fotosEnTienda++;
            }
            resumen.push(`${cuantas} foto${cuantas === 1 ? '' : 's'} subida${cuantas === 1 ? '' : 's'}`);
          }
        }
        p = await obtener(e.id);
        if (p.estado === 'listo' && p.mostrar !== false && fotosEnTienda > 0 && !enTienda.publicado) {
          await remote.tiendaNube('visibilidad', { tienda, producto: enTienda.id, publicado: true });
          resumen.push('publicado');
        }
        informe.push([`${e.etiqueta}: ${resumen.join(' · ') || 'sin novedades'}`, false]); ok++;
      } catch (err) { informe.push([`${e.etiqueta}: ${err.message}${resumen.length ? ` (antes: ${resumen.join(' · ')})` : ''}`, true]); }
    }
    const nuevos = await listaVisible();
    lista.splice(0, lista.length, ...nuevos.filter((q) => q.sku).sort((a, b) => normSku(a.sku).localeCompare(normSku(b.sku), 'es', { numeric: true })));
    toast(`Listo: ${ok} de ${trabajo.length} producto${trabajo.length === 1 ? '' : 's'} enviados a Tienda Nube`, ok === trabajo.length && informe.every((x) => !x[1]) ? '' : 'error');
    fase = 'lista'; pintar();
  }

  pintar();
}
