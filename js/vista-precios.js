// Actualizar precios: se sube la lista de precios (xls, xlsx o csv), la app la compara con el catálogo de la tienda,
// muestra qué va a cambiar (y marca los cambios raros «para revisar») y, con tu confirmación, cambia los precios de a 50.
// Antes de tocar nada guarda y descarga los precios actuales: se puede deshacer.
import * as remote from './remote.js';
import { getMeta, setMeta } from './store.js';
import { icono } from './iconos.js';
import { $, $$, esc, toast, descargar, cargarScript } from './util.js';
import { tiendas, tiendaActual, fijarTienda, tiendasConectadas, selectorTiendaHtml } from './tn.js';

const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const ULTIMA = 'precios_ultima';   // { fecha, tienda, nombre, items: [{ producto, variante, sku, nombre, anterior, nuevo }], aplicados: [variante], deshecho }
const FILAS_POR_PAGINA = 100;
const TAMANO_LOTE = 50;

const clave = (sku) => String(sku || '').trim().replace(/^0+/, '');
const dinero = (n) => (n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctTxt = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')} %`);
const sello = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const aNumero = (v) => {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');   // formato argentino: 1.234,56
  return Number(s);
};
const csv = (filas) => new Blob(['﻿' + filas.map((f) => f.map((c) => { const t = String(c ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });

// ---------- lista de precios ----------
// CSV/TXT: se detecta el separador (; , o tabulación) y la codificación (UTF-8 o Windows-1252); todo queda como texto, así no se pierden los ceros de los códigos.
function csvAFilas(bytes) {
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { texto = new TextDecoder('windows-1252').decode(bytes); }
  texto = texto.replace(/^\uFEFF/, '');
  const muestra = texto.slice(0, 3000);
  const sep = ['\t', ';', ','].map((c) => [c, muestra.split(c).length - 1]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = [];
  let fila = [], celda = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) { if (c === '"') { if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false; } else celda += c; }
    else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else celda += c;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

async function abrirLista(archivo) {
  let filas;
  if (/\.(csv|txt)$/i.test(archivo.name)) filas = csvAFilas(await archivo.arrayBuffer());
  else {
    await cargarScript(SHEETJS);
    const libro = window.XLSX.read(await archivo.arrayBuffer(), { type: 'array', dense: true });
    filas = window.XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }
  const esCodigo = (c) => /^(c[oó]d(igo)?\.?|sku)$/i.test(String(c).trim());
  const esPrecio = (c) => /lista|precio/i.test(String(c));
  const h = filas.findIndex((f) => f.some(esCodigo) && f.some(esPrecio));
  if (h < 0) throw new Error('No encontré las columnas «Código» y «P. Lista» o «Precio» en la primera hoja del archivo.');
  const cabecera = filas[h];
  return { filas, h, colCodigo: cabecera.findIndex(esCodigo), precios: cabecera.map((c, i) => ({ i, nombre: String(c).trim() })).filter((c) => esPrecio(c.nombre)) };
}

function extraerPrecios({ filas, h, colCodigo }, colPrecio) {
  const mapa = new Map();
  let repetidos = 0;
  for (const f of filas.slice(h + 1)) {
    const cod = String(f[colCodigo] ?? '').trim();
    if (!/^\d{4,12}$/.test(cod)) continue;          // las filas de proveedor y de títulos no tienen código
    const precio = aNumero(f[colPrecio]);
    if (!(precio > 0)) continue;
    const k = clave(cod);
    if (mapa.has(k)) repetidos++;
    mapa.set(k, precio);
  }
  return { mapa, repetidos };
}

export async function vistaPrecios(raiz, ctx) {
  if (!tiendas().length || !remote.configurado() || !(await remote.sesion())) {
    raiz.innerHTML = `<div class="vacio"><p><b>Esta función necesita iniciar sesión.</b></p><p>Entrá con tu mail para actualizar precios en Tienda Nube.</p><a class="btn primario" href="#/login">Iniciar sesión</a></div>`;
    return;
  }
  let conectadas = [];
  try { conectadas = await tiendasConectadas(); } catch (e) { toast('No se pudo consultar la conexión con Tienda Nube: ' + (e.message || e), 'error'); }

  let actual = tiendaActual();
  let fase = 'inicio';                       // inicio · buscando · plan · aplicando · fin
  let datosLista = null, nombreLista = '', colPrecio = 0, lista = new Map(), repetidosLista = 0;
  let catalogo = [], plan = [];
  const opc = { redondeo: 'entero', umbral: 30, ocultos: true };   // por defecto, pesos enteros
  const incluidos = new Set();                // variantes «para revisar» que se tildaron a mano
  let pestana = 'cambia', pagina = 0;
  let aviso = null, avance = { n: 0, total: 0, txt: '' }, detener = false, bloqueo = null;
  let respaldo = (await getMeta(ULTIMA)) || null;
  let resultado = null;

  const pintarAvance = () => {
    const b = $('#p-barra'), t = $('#p-txt');
    if (b) b.style.width = Math.round((avance.n / Math.max(avance.total, 1)) * 100) + '%';
    if (t) t.textContent = avance.txt;
  };

  function pintar() {
    if (fase === 'buscando' || fase === 'aplicando') return pintarProgreso();
    if (fase === 'plan') return pintarPlan();
    if (fase === 'fin') return pintarFin();
    return pintarInicio();
  }

  // ---------- 1. elegir la lista ----------
  function pintarInicio() {
    const ultima = respaldo && !respaldo.deshecho ? respaldo : null;
    raiz.innerHTML = `
      <section class="panel paso"><div>
        ${selectorTiendaHtml(actual, conectadas)}
        <h3 class="paso-t"><span class="nro" aria-hidden="true">1</span>Elegí la lista de precios</h3>
        <p class="ayuda">Archivo de Excel (.xls o .xlsx) o CSV con una columna de código (el SKU) y otra con el precio, por ejemplo <b>P.LISTA 1</b>. Los SKU se comparan sin los ceros de adelante.</p>
        <div id="p-soltar" class="zona-soltar" tabindex="0">${icono('exportar', 36)}<b>Soltá acá la lista de precios</b><span>o elegila con el botón</span></div>
        <div class="btns-foto" style="grid-template-columns:1fr"><label class="btn primario">${icono('descargar', 20)}<span>Elegir el archivo</span><input id="p-archivo" type="file" accept=".xls,.xlsx,.csv,.txt"></label></div>
        ${aviso ? `<p class="${aviso.mal ? 'rojo' : 'ayuda'}" style="margin:10px 0 0"><b>${esc(aviso.txt)}</b></p>` : ''}
        ${datosLista ? `
          <p class="ayuda" style="margin:12px 0 0"><b>${esc(nombreLista)}</b>: ${lista.size.toLocaleString('es-AR')} productos con precio${repetidosLista ? ` (${repetidosLista} código${repetidosLista === 1 ? '' : 's'} repetido${repetidosLista === 1 ? '' : 's'}: se usa el último)` : ''}.</p>
          ${datosLista.precios.length > 1 ? `<label class="campo" style="margin:8px 0 0"><span>Columna de precio</span><select id="p-col">${datosLista.precios.map((c) => `<option value="${c.i}" ${c.i === colPrecio ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>` : `<p class="ayuda" style="margin:4px 0 0">Columna de precio: <b>${esc(datosLista.precios[0].nombre)}</b></p>`}
          <div class="fila-botones col" style="margin-top:12px"><button class="btn primario grande" id="p-comparar">${icono('buscar', 20)}Comparar con la tienda</button></div>` : ''}
      </div></section>
      <section class="panel paso"><div>
        <h3 class="paso-t">Última actualización</h3>
        ${ultima ? `<p class="ayuda">${new Date(ultima.fecha).toLocaleString('es-AR')} · «${esc(ultima.nombre)}» · ${ultima.aplicados.length} precio${ultima.aplicados.length === 1 ? '' : 's'} cambiado${ultima.aplicados.length === 1 ? '' : 's'}.</p>
          <div class="fila-botones col"><button class="btn" id="p-deshacer-ultima">Deshacer esa actualización</button><button class="btn fantasma" id="p-bajar-respaldo">Descargar los precios anteriores</button></div>`
          : '<p class="ayuda" style="margin:0">No hay una actualización reciente para deshacer.</p>'}
      </div></section>`;
    enlazarInicio();
  }

  function enlazarInicio() {
    const sel = $('#tn-tienda');
    if (sel) sel.onchange = () => { fijarTienda(sel.value); actual = tiendas().find((t) => t.id === sel.value) || actual; pintar(); };
    const cargar = async (archivo) => {
      aviso = { txt: 'Leyendo la lista… puede tardar unos segundos si es grande.' }; datosLista = null; pintarInicioSoloAviso();
      try {
        datosLista = await abrirLista(archivo);
        nombreLista = archivo.name; colPrecio = datosLista.precios[0].i;
        ({ mapa: lista, repetidos: repetidosLista } = extraerPrecios(datosLista, colPrecio));
        aviso = lista.size ? null : { mal: true, txt: 'La lista no tiene ningún código con precio. Revisá la columna elegida.' };
      } catch (e) { datosLista = null; aviso = { mal: true, txt: e.message || String(e) }; }
      pintar();
    };
    const entrada = $('#p-archivo');
    if (entrada) entrada.onchange = () => { const f = entrada.files[0]; entrada.value = ''; if (f) cargar(f); };
    const zona = $('#p-soltar');
    if (zona) {
      zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('sobre'); };
      zona.ondragleave = () => zona.classList.remove('sobre');
      zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove('sobre'); const f = e.dataTransfer.files[0]; if (f) cargar(f); };
    }
    const col = $('#p-col');
    if (col) col.onchange = () => { colPrecio = +col.value; ({ mapa: lista, repetidos: repetidosLista } = extraerPrecios(datosLista, colPrecio)); pintar(); };
    $('#p-comparar') && ($('#p-comparar').onclick = comparar);
    $('#p-deshacer-ultima') && ($('#p-deshacer-ultima').onclick = () => deshacer(respaldo));
    $('#p-bajar-respaldo') && ($('#p-bajar-respaldo').onclick = () => descargarRespaldo(respaldo));
  }
  const pintarInicioSoloAviso = () => { const p = $('#p-soltar')?.parentElement; if (p) { let el = $('#p-aviso'); if (!el) { el = document.createElement('p'); el.id = 'p-aviso'; el.className = 'ayuda'; p.appendChild(el); } el.innerHTML = `<b>${esc(aviso.txt)}</b>`; } };

  // ---------- 2. traer el catálogo de la tienda ----------
  async function comparar() {
    fase = 'buscando'; avance = { n: 0, total: 1, txt: 'Leyendo el catálogo de la tienda…' }; pintar();
    try {
      catalogo = [];
      for (let p = 1; ; p++) {
        const r = await remote.tiendaNube('catalogo', { tienda: actual.id, pagina: p });
        for (const prod of r.productos) for (const v of prod.variantes) catalogo.push({ producto: prod.id, variante: v.id, sku: v.sku, nombre: prod.nombre, visible: prod.visible, precio: v.precio, promo: v.promo });
        avance = { n: p, total: p + (r.hayMas ? 1 : 0), txt: `Leyendo el catálogo de la tienda… ${catalogo.length.toLocaleString('es-AR')} productos` }; pintarAvance();
        if (!r.hayMas) break;
      }
    } catch (e) { fase = 'inicio'; aviso = { mal: true, txt: 'No se pudo leer el catálogo: ' + (e.message || e) }; pintar(); return; }
    calcular(); pestana = 'cambia'; pagina = 0; fase = 'plan'; pintar();
  }

  // ---------- 3. el plan: qué cambia ----------
  function calcular() {
    // pesos enteros; si un precio muy bajo diera 0 (Tienda Nube no lo acepta) se conservan los centavos
    const redondear = (x) => (opc.redondeo === 'entero' && Math.round(x) > 0 ? Math.round(x) : Math.round(x * 100) / 100);
    plan = catalogo.map((v) => {
      const base = clave(v.sku) && lista.get(clave(v.sku));
      if (!base) return { ...v, grupo: 'sin-lista' };
      const nuevo = redondear(base);
      const dif = v.precio == null ? null : nuevo - v.precio;
      const pct = v.precio ? (dif / v.precio) * 100 : null;
      let grupo = 'cambia';
      if (v.precio != null && Math.abs(dif) < 0.005) grupo = 'igual';
      else if (!opc.ocultos && !v.visible) grupo = 'excluido';
      else if (pct == null || Math.abs(pct) > opc.umbral) grupo = 'revisar';
      return { ...v, nuevo, pct, grupo };
    });
  }
  const filasDe = (g) => plan.filter((f) => f.grupo === g).sort((a, b) => Math.abs(b.pct ?? 1e9) - Math.abs(a.pct ?? 1e9));
  const aCambiar = () => plan.filter((f) => f.grupo === 'cambia' || (f.grupo === 'revisar' && incluidos.has(f.variante)));

  function pintarPlan() {
    const n = (g) => plan.filter((f) => f.grupo === g).length;
    const cambiar = aCambiar();
    const visibles = cambiar.filter((f) => f.visible).length;
    const lista_ = filasDe(pestana);
    const paginas = Math.max(1, Math.ceil(lista_.length / FILAS_POR_PAGINA));
    pagina = Math.min(pagina, paginas - 1);
    const filas = lista_.slice(pagina * FILAS_POR_PAGINA, (pagina + 1) * FILAS_POR_PAGINA);
    const pcts = plan.filter((f) => f.grupo === 'cambia' && f.pct != null).map((f) => f.pct).sort((a, b) => a - b);
    const mediana = pcts.length ? pcts[Math.floor(pcts.length / 2)] : null;
    const pest = [['cambia', 'Se cambian', n('cambia')], ['revisar', 'Para revisar', n('revisar')], ['igual', 'Sin cambios', n('igual')], ['sin-lista', 'No están en la lista', n('sin-lista')]];
    if (n('excluido')) pest.splice(2, 0, ['excluido', 'Ocultos (excluidos)', n('excluido')]);
    const conCasilla = pestana === 'revisar';
    raiz.innerHTML = `
      <section class="panel paso"><div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">2</span>Esto es lo que va a pasar</h3>
        <p class="ayuda">Tienda <b>${esc(actual.nombre)}</b>${actual.real ? ' <b class="rojo">(tienda real)</b>' : ' (prueba)'} · lista <b>${esc(nombreLista)}</b>. Todavía no se cambió nada.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0">
          <div class="item" style="display:block"><div class="ayuda">Se cambian</div><b style="font-size:1.4em">${cambiar.length.toLocaleString('es-AR')}</b><div class="ayuda">${visibles} visibles · ${cambiar.length - visibles} ocultos${mediana != null ? ` · mediana ${pctTxt(mediana)}` : ''}</div></div>
          <div class="item" style="display:block"><div class="ayuda">Para revisar</div><b style="font-size:1.4em">${n('revisar')}</b><div class="ayuda">cambian más de ${opc.umbral} %: no se aplican si no los tildás</div></div>
          <div class="item" style="display:block"><div class="ayuda">Sin cambios</div><b style="font-size:1.4em">${n('igual').toLocaleString('es-AR')}</b><div class="ayuda">${n('sin-lista')} no están en la lista</div></div>
        </div>
        <div class="ayuda" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:0 0 10px">
          <label>Precios: <select id="p-redondeo"><option value="exacto" ${opc.redondeo === 'exacto' ? 'selected' : ''}>exactos de la lista (con centavos)</option><option value="entero" ${opc.redondeo === 'entero' ? 'selected' : ''}>redondeados a pesos enteros</option></select></label>
          <label>«Para revisar» si cambia más de <input id="p-umbral" type="number" min="1" max="1000" value="${opc.umbral}" style="width:70px;min-height:36px"> %</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="p-ocultos" ${opc.ocultos ? 'checked' : ''}> Incluir los productos ocultos</label>
        </div>
        <div class="segmentado" role="tablist" style="flex-wrap:wrap;margin-bottom:8px">${pest.map(([id, t, c]) => `<label><input type="radio" name="p-pest" value="${id}" ${pestana === id ? 'checked' : ''}><span>${t} (${c.toLocaleString('es-AR')})</span></label>`).join('')}</div>
        ${conCasilla ? `<p class="ayuda" style="margin:4px 0 8px">Tildá solo los que estés seguro de cambiar. <button class="btn chico fantasma" id="p-todos-rev" type="button">Tildar todos</button> <button class="btn chico fantasma" id="p-ninguno-rev" type="button">Ninguno</button></p>` : ''}
        <div style="overflow-x:auto"><table class="tabla-masiva"><thead><tr>${conCasilla ? '<th></th>' : ''}<th>SKU</th><th>Producto</th><th>Actual</th><th>${pestana === 'sin-lista' ? '' : 'Nuevo'}</th><th>${pestana === 'sin-lista' ? '' : 'Cambio'}</th></tr></thead><tbody>
          ${filas.map((f) => `<tr class="${f.grupo === 'revisar' && Math.abs(f.pct ?? 1e9) > 100 ? 'rojo' : ''}">${conCasilla ? `<td><input type="checkbox" data-rev="${f.variante}" ${incluidos.has(f.variante) ? 'checked' : ''} aria-label="Cambiar ${esc(f.sku)}"></td>` : ''}<td class="num"><b>${esc(f.sku)}</b></td><td>${esc(f.nombre)} <span class="estado ${f.visible ? 'e-cargado' : 'e-borrador'}">${f.visible ? 'Visible' : 'Oculto'}</span></td><td class="num">${dinero(f.precio)}</td><td class="num">${f.nuevo != null ? dinero(f.nuevo) : ''}</td><td class="num">${f.nuevo != null ? pctTxt(f.pct) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="ayuda">No hay productos en este grupo.</td></tr>'}
        </tbody></table></div>
        ${paginas > 1 ? `<p class="ayuda" style="margin:8px 0">Página ${pagina + 1} de ${paginas} · ${lista_.length.toLocaleString('es-AR')} productos <button class="btn chico fantasma" id="p-ant" ${pagina ? '' : 'disabled'}>Anterior</button> <button class="btn chico fantasma" id="p-sig" ${pagina < paginas - 1 ? '' : 'disabled'}>Siguiente</button></p>` : ''}
        <div class="fila-botones col" style="margin-top:12px">
          <button class="btn primario grande" id="p-aplicar" ${cambiar.length ? '' : 'disabled'}>${icono('check', 20)}Cambiar ${cambiar.length.toLocaleString('es-AR')} precio${cambiar.length === 1 ? '' : 's'}</button>
          <button class="btn" id="p-csv">${icono('descargar', 20)}Descargar el plan (CSV)</button>
          <button class="btn fantasma" id="p-volver">Volver</button>
        </div>
      </div></section>`;
    enlazarPlan(lista_);
  }

  function enlazarPlan(lista_) {
    $('#p-redondeo').onchange = (e) => { opc.redondeo = e.target.value; calcular(); pintar(); };
    $('#p-umbral').onchange = (e) => { opc.umbral = Math.max(1, Math.min(1000, +e.target.value || 30)); calcular(); pintar(); };
    $('#p-ocultos').onchange = (e) => { opc.ocultos = e.target.checked; calcular(); pintar(); };
    $$('input[name=p-pest]').forEach((r) => (r.onchange = () => { pestana = r.value; pagina = 0; pintar(); }));
    $$('[data-rev]').forEach((c) => (c.onchange = () => { c.checked ? incluidos.add(+c.dataset.rev) : incluidos.delete(+c.dataset.rev); pintar(); }));
    $('#p-todos-rev') && ($('#p-todos-rev').onclick = () => { lista_.forEach((f) => incluidos.add(f.variante)); pintar(); });
    $('#p-ninguno-rev') && ($('#p-ninguno-rev').onclick = () => { lista_.forEach((f) => incluidos.delete(f.variante)); pintar(); });
    $('#p-ant') && ($('#p-ant').onclick = () => { pagina--; pintar(); });
    $('#p-sig') && ($('#p-sig').onclick = () => { pagina++; pintar(); });
    $('#p-csv').onclick = () => descargar(csv([['SKU', 'Producto', 'Visible', 'Precio actual', 'Precio nuevo', 'Cambio %', 'Grupo'], ...plan.filter((f) => f.grupo !== 'sin-lista').map((f) => [f.sku, f.nombre, f.visible ? 'SI' : 'NO', f.precio ?? '', f.nuevo ?? '', f.pct == null ? '' : f.pct.toFixed(1), f.grupo])]), `plan-precios-${sello()}.csv`);
    $('#p-volver').onclick = () => { fase = 'inicio'; pintar(); };
    $('#p-aplicar').onclick = aplicar;
  }

  // ---------- 4. aplicar ----------
  function pintarProgreso() {
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t">${fase === 'buscando' ? 'Leyendo el catálogo…' : 'Cambiando los precios…'}</h3>
      <div class="progreso"><div class="barra"><i id="p-barra"></i></div><span id="p-txt"></span></div>
      ${fase === 'aplicando' ? `<p class="ayuda">No cierres esta pestaña. Podés detener: termina el lote que está haciendo y no sigue.</p><div class="fila-botones col"><button class="btn fantasma" id="p-detener">Detener después de este lote</button></div>` : ''}
    </div></section>`;
    $('#p-detener') && ($('#p-detener').onclick = () => { detener = true; $('#p-detener').disabled = true; $('#p-detener').textContent = 'Deteniendo…'; });
    pintarAvance();
  }

  const filasRespaldo = (r) => [['SKU', 'Producto', 'Precio anterior', 'Precio nuevo', 'id_producto', 'id_variante', 'Aplicado'], ...r.items.map((i) => [i.sku, i.nombre, i.anterior ?? '', i.nuevo, i.producto, i.variante, r.aplicados.includes(i.variante) ? 'SI' : 'NO'])];
  const descargarRespaldo = (r) => descargar(csv(filasRespaldo(r)), `precios-anteriores-${sello()}.csv`);

  async function enviarLotes(items, precioDe, etiqueta, alAplicar) {
    const fallidas = [];
    const errores = [];
    for (let i = 0; i < items.length; i += TAMANO_LOTE) {
      if (detener) { errores.push(`Se detuvo: faltan ${items.length - i} precios.`); fallidas.push(...items.slice(i)); break; }
      const lote = items.slice(i, i + TAMANO_LOTE);
      avance = { n: i, total: items.length, txt: `${etiqueta}: ${i.toLocaleString('es-AR')} de ${items.length.toLocaleString('es-AR')}` }; pintarAvance();
      try {
        const r = await remote.tiendaNube('actualizar-precios', { tienda: actual.id, cambios: lote.map((f) => ({ producto: f.producto, variante: f.variante, precio: precioDe(f) })) });
        for (const id of r.aplicadas) alAplicar(id);
        for (const id of r.fallidas) fallidas.push(lote.find((f) => f.variante === id));
      } catch (e) { fallidas.push(...lote); errores.push(e.message || String(e)); }
    }
    avance = { n: items.length, total: items.length, txt: 'Listo' }; pintarAvance();
    return { fallidas, errores };
  }

  async function aplicar() {
    const cambiar = aCambiar();
    if (!cambiar.length) return;
    const visibles = cambiar.filter((f) => f.visible).length;
    if (!confirm(`Vas a cambiar el precio de ${cambiar.length.toLocaleString('es-AR')} producto${cambiar.length === 1 ? '' : 's'} en «${actual.nombre}»${actual.real ? ' (TIENDA REAL)' : ''}: ${visibles} visible${visibles === 1 ? '' : 's'} y ${cambiar.length - visibles} oculto${cambiar.length - visibles === 1 ? '' : 's'}.\n\nAntes se guarda y se descarga una copia de los precios actuales para poder deshacer. ¿Seguir?`)) return;
    respaldo = { fecha: Date.now(), tienda: actual.id, nombre: actual.nombre, items: cambiar.map((f) => ({ producto: f.producto, variante: f.variante, sku: f.sku, nombre: f.nombre, anterior: f.precio, nuevo: f.nuevo })), aplicados: [], deshecho: false };
    await setMeta(ULTIMA, respaldo);
    descargarRespaldo(respaldo);
    fase = 'aplicando'; detener = false; pintar();
    try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { bloqueo = null; }
    ctx.antesDeSalir = () => confirm('Se están cambiando los precios. Si salís ahora se corta (lo ya cambiado queda). ¿Salir igual?');
    const porVariante = new Map(cambiar.map((f) => [f.variante, f]));
    let r = await enviarLotes(cambiar, (f) => f.nuevo, 'Cambiando precios', (id) => respaldo.aplicados.push(id));
    if (r.fallidas.length && !detener) {   // un segundo intento para los que no se aplicaron
      const segundo = await enviarLotes(r.fallidas, (f) => f.nuevo, 'Reintentando los que fallaron', (id) => respaldo.aplicados.push(id));
      r = { fallidas: segundo.fallidas, errores: [...r.errores, ...segundo.errores] };
    }
    await setMeta(ULTIMA, respaldo);
    ctx.antesDeSalir = null;
    try { await bloqueo?.release(); } catch { /* ya liberado */ }
    resultado = { tipo: 'aplicar', pedidos: cambiar.length, aplicadas: respaldo.aplicados.length, fallidas: r.fallidas.filter(Boolean).map((f) => porVariante.get(f.variante) || f), errores: [...new Set(r.errores)] };
    fase = 'fin'; pintar();
    toast(`Precios cambiados: ${respaldo.aplicados.length.toLocaleString('es-AR')} de ${cambiar.length.toLocaleString('es-AR')}`, resultado.fallidas.length ? 'error' : '');
  }

  async function deshacer(r) {
    const items = r.items.filter((i) => r.aplicados.includes(i.variante) && i.anterior != null);
    if (!items.length) { toast('No hay precios para deshacer.', 'error'); return; }
    if (r.tienda !== actual.id) { toast(`Esa actualización fue en «${r.nombre}». Elegí esa tienda arriba para deshacerla.`, 'error'); return; }
    if (!confirm(`Se van a volver ${items.length.toLocaleString('es-AR')} precios a como estaban antes de la actualización del ${new Date(r.fecha).toLocaleString('es-AR')} en «${r.nombre}». ¿Seguir?`)) return;
    fase = 'aplicando'; detener = false; pintar();
    const hechos = [];
    const res = await enviarLotes(items.map((i) => ({ producto: i.producto, variante: i.variante, anterior: i.anterior })), (f) => f.anterior, 'Deshaciendo', (id) => hechos.push(id));
    r.aplicados = r.aplicados.filter((id) => !hechos.includes(id));
    r.deshecho = r.aplicados.length === 0;
    await setMeta(ULTIMA, r); respaldo = r;
    resultado = { tipo: 'deshacer', pedidos: items.length, aplicadas: hechos.length, fallidas: res.fallidas.filter(Boolean), errores: [...new Set(res.errores)] };
    fase = 'fin'; pintar();
  }

  function pintarFin() {
    const ok = resultado.fallidas.length === 0;
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t"><span class="nro" aria-hidden="true">✓</span>${resultado.tipo === 'aplicar' ? 'Precios actualizados' : 'Actualización deshecha'}</h3>
      <p class="${ok ? 'ayuda' : 'rojo'}"><b>${resultado.aplicadas.toLocaleString('es-AR')} de ${resultado.pedidos.toLocaleString('es-AR')}</b> precios ${resultado.tipo === 'aplicar' ? 'cambiados' : 'vueltos a como estaban'}.${ok ? '' : ` No se pudieron cambiar ${resultado.fallidas.length}.`}</p>
      ${resultado.errores.length ? `<ul class="ayuda rojo" style="padding-left:18px">${resultado.errores.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${resultado.fallidas.length ? `<details class="ayuda"><summary><b>Ver los que fallaron</b></summary><ul style="padding-left:18px">${resultado.fallidas.slice(0, 60).map((f) => `<li class="num">${esc(f.sku || '')} · ${esc(f.nombre || '')}</li>`).join('')}${resultado.fallidas.length > 60 ? `<li>y ${resultado.fallidas.length - 60} más</li>` : ''}</ul></details>` : ''}
      <div class="fila-botones col" style="margin-top:12px">
        ${resultado.tipo === 'aplicar' && respaldo ? `<button class="btn" id="p-bajar">${icono('descargar', 20)}Descargar los precios anteriores</button><button class="btn" id="p-deshacer">Deshacer esta actualización</button>` : ''}
        <button class="btn primario" id="p-otra">Listo</button>
      </div>
    </div></section>`;
    $('#p-bajar') && ($('#p-bajar').onclick = () => descargarRespaldo(respaldo));
    $('#p-deshacer') && ($('#p-deshacer').onclick = () => deshacer(respaldo));
    $('#p-otra').onclick = () => { fase = 'inicio'; datosLista = null; catalogo = []; plan = []; incluidos.clear(); aviso = null; pintar(); };
  }

  ctx.alSalir?.(() => { try { bloqueo?.release(); } catch { /* ya liberado */ } });
  pintar();
}
