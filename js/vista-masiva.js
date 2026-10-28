// Carga masiva por nombre de archivo: se arrastran fotos, una carpeta o un ZIP cuyos archivos se llaman como el SKU
// (00000223.jpg, 00000223_2.jpg ...). La app arma los grupos, busca cada SKU en la tienda, muestra qué va a pasar y,
// con tu confirmación, procesa y sube. Si el SKU no existe puede crear un borrador del producto en la app.
import * as remote from './remote.js';
import { normSku, cfg, operador } from './config.js';
import { productoNuevo, guardarProducto, listaVisible } from './store.js';
import { extDe, esHeic, precargarHeic } from './imagen.js';
import { procesarFoto, MODOS_FOTO } from './procesar.js';
import { icono } from './iconos.js';
import { $, $$, esc, toast, uid, aBase64, cargarScript } from './util.js';
import { tiendas, tiendaActual, fijarTienda, tiendasConectadas, selectorTiendaHtml } from './tn.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const IMG = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
const IGNORAR = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i;
const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' };
const PREF_MODO = 'masiva_modo';
const PREF_MOSTRAR = 'fotos_mostrar';

const OPCIONES_FILA = {
  'sin-fotos': [['subir', 'Subir las fotos'], ['omitir', 'No subir']],
  'con-fotos': [['omitir', 'No tocar'], ['agregar', 'Agregar al final'], ['reemplazar', 'Reemplazar las que tiene']],
  'no-existe': [['omitir', 'No hacer nada'], ['crear', 'Crear producto (borrador en la app)']],
  error: [['omitir', 'Omitir']],
};

// "00000223_2.jpg" → { sku: '00000223', n: 2 } · "00000223.jpg" → n = 1 · también "00000223-2", "00000223 (2)" y "00000223(2)"
export function leerNombre(nombre) {
  const m = String(nombre).split('/').pop().match(/^(.+)\.(jpe?g|png|webp|gif|heic|heif)$/i);
  if (!m) return null;
  const stem = m[1].trim();
  const c = stem.match(/^(.+?)(?:[\s_-]+\(?(\d{1,2})\)?|\s*\((\d{1,2})\))$/);
  const sku = normSku((c ? c[1] : stem).trim());
  return sku ? { sku, n: c ? Number(c[2] || c[3]) || 1 : 1 } : null;
}

const tipoDe = (nombre) => TIPOS[nombre.split('.').pop().toLowerCase()] || 'image/jpeg';

async function expandirZip(zipFile) {
  await cargarScript(JSZIP);
  const zip = await window.JSZip.loadAsync(zipFile);
  const salida = [];
  for (const e of Object.values(zip.files)) {
    if (e.dir || IGNORAR.test(e.name)) continue;
    const base = e.name.split('/').pop();
    if (!IMG.test(base)) { salida.push({ ignorado: e.name, motivo: 'no es una foto compatible' }); continue; }
    salida.push({ archivo: new File([await e.async('blob')], base, { type: tipoDe(base) }), ruta: e.name });
  }
  return salida;
}

async function reunir(archivos) {
  const salida = [];
  for (const f of archivos) {
    const ruta = f.webkitRelativePath || f.name;
    if (IGNORAR.test(ruta)) continue;
    if (/\.zip$/i.test(f.name)) salida.push(...await expandirZip(f));
    else if (IMG.test(f.name)) salida.push({ archivo: f, ruta });
    else salida.push({ ignorado: ruta, motivo: 'no es una foto compatible' });
  }
  return salida;
}

async function archivosDeEntrada(entrada) {
  if (entrada.isFile) return [await new Promise((ok, mal) => entrada.file(ok, mal))];
  const lector = entrada.createReader(), todos = [];
  for (;;) {
    const lote = await new Promise((ok, mal) => lector.readEntries(ok, mal));
    if (!lote.length) break;
    for (const e of lote) todos.push(...await archivosDeEntrada(e));
  }
  return todos;
}

function agrupar(candidatos) {
  const mapa = new Map(), ignorados = [];
  for (const c of candidatos) {
    if (c.ignorado) { ignorados.push(c); continue; }
    const p = leerNombre(c.archivo.name);
    if (!p) { ignorados.push({ ignorado: c.ruta, motivo: 'no se reconoce el SKU en el nombre' }); continue; }
    const g = mapa.get(p.sku) || { sku: p.sku, fotos: [] };
    g.fotos.push({ n: p.n, archivo: c.archivo, ruta: c.ruta });
    mapa.set(p.sku, g);
  }
  for (const g of mapa.values()) g.fotos.sort((a, b) => a.n - b.n || a.ruta.localeCompare(b.ruta, 'es', { numeric: true }));
  return { grupos: [...mapa.values()].sort((a, b) => a.sku.localeCompare(b.sku, 'es', { numeric: true })), ignorados };
}

const leerPref = (k, por) => { try { return localStorage.getItem(k) ?? por; } catch { return por; } };
const guardarPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

export async function vistaMasiva(raiz, ctx) {
  if (!tiendas().length || !remote.configurado() || !(await remote.sesion())) {
    raiz.innerHTML = `<div class="vacio"><p><b>Esta función necesita iniciar sesión.</b></p><p>Entrá con tu mail para subir fotos directo a Tienda Nube.</p><a class="btn primario" href="#/login">Iniciar sesión</a></div>`;
    return;
  }
  let conectadas = [];
  try { conectadas = await tiendasConectadas(); } catch (e) { toast('No se pudo consultar la conexión con Tienda Nube: ' + (e.message || e), 'error'); }

  let actual = tiendaActual();
  let fase = 'inicio';                // inicio · buscando · revision · enviando · fin
  let grupos = [], ignorados = [];
  let modo = MODOS_FOTO.some((m) => m.id === leerPref(PREF_MODO, '')) ? leerPref(PREF_MODO, '') : 'quitar_fondo';
  let mostrar = leerPref(PREF_MOSTRAR, 'si') !== 'no';
  let avance = { n: 0, total: 0, txt: '' };
  let informe = [], borradores = [], detener = false, leyendo = false;
  let bloqueoPantalla = null;
  const totalFotos = () => grupos.reduce((a, g) => a + g.fotos.length, 0);

  const pintarAvance = () => {
    const barra = $('#m-barra'), txt = $('#m-txt');
    if (barra) barra.style.width = Math.round((avance.n / Math.max(avance.total, 1)) * 100) + '%';
    if (txt) txt.textContent = avance.txt;
  };

  function pintar() {
    if (fase === 'inicio') return pintarInicio();
    if (fase === 'buscando' || fase === 'enviando') return pintarProgreso();
    if (fase === 'revision') return pintarRevision();
    return pintarFin();
  }

  // ---------- 1. elegir las fotos ----------
  function pintarInicio() {
    const fotos = totalFotos();
    raiz.innerHTML = `
      <section class="panel paso"><div>
        ${selectorTiendaHtml(actual, conectadas)}
        <h3 class="paso-t"><span class="nro" aria-hidden="true">1</span>Elegí las fotos</h3>
        <p class="ayuda">Los archivos tienen que llamarse como el SKU: <code>00000223.jpg</code> es la principal y <code>00000223_2.jpg</code>, <code>00000223_3.jpg</code>… las siguientes. Sirve una carpeta, un ZIP o fotos sueltas. Las fotos del iPhone (HEIC) se convierten solas.</p>
        <div id="m-soltar" class="zona-soltar" tabindex="0">${icono('imagen', 36)}<b>Soltá acá las fotos, la carpeta o el ZIP</b><span>o elegilos con los botones</span></div>
        <div class="btns-foto" style="grid-template-columns:repeat(3,1fr)">
          <label class="btn">${icono('imagen', 20)}<span>Fotos</span><input id="m-fotos" type="file" accept="image/*" multiple></label>
          <label class="btn">${icono('caja', 20)}<span>Carpeta</span><input id="m-carpeta" type="file" webkitdirectory multiple></label>
          <label class="btn">${icono('caja', 20)}<span>ZIP</span><input id="m-zip" type="file" accept=".zip,application/zip"></label>
        </div>
        ${leyendo ? '<p class="ayuda" style="margin:10px 0 0"><b>Leyendo los archivos…</b></p>' : ''}
        ${fotos ? `<p class="ayuda" style="margin:10px 0 0"><b>${fotos} foto${fotos === 1 ? '' : 's'} de ${grupos.length} SKU</b> listas para revisar.</p>` : ''}
        ${ignorados.length ? `<details class="ayuda" style="margin:6px 0 0"><summary class="rojo"><b>${ignorados.length} archivo${ignorados.length === 1 ? '' : 's'} ignorado${ignorados.length === 1 ? '' : 's'}</b></summary><ul style="padding-left:18px;margin:6px 0 0">${ignorados.slice(0, 40).map((i) => `<li>${esc(i.ignorado)} · ${esc(i.motivo)}</li>`).join('')}${ignorados.length > 40 ? `<li>y ${ignorados.length - 40} más</li>` : ''}</ul></details>` : ''}

        <h3 class="paso-t" style="margin-top:18px"><span class="nro" aria-hidden="true">2</span>¿Qué hacemos con el fondo?</h3>
        <div style="display:grid;gap:8px">${MODOS_FOTO.map((m) => `
          <label class="item" style="display:flex;gap:10px;align-items:flex-start"><input type="radio" name="m-modo" value="${m.id}" ${m.id === modo ? 'checked' : ''}>
            <div><b>${m.titulo}</b><div class="ayuda">${m.ayuda}</div></div></label>`).join('')}</div>
        <label class="ayuda" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="m-mostrar" ${mostrar ? 'checked' : ''}> Mostrar en la tienda los productos que estén ocultos cuando se suban sus fotos</label>
        <div class="fila-botones col" style="margin-top:14px"><button class="btn primario grande" id="m-revisar" ${fotos && !leyendo ? '' : 'disabled'}>${icono('buscar', 20)}Revisar antes de subir</button></div>
      </div></section>`;
    enlazarInicio();
  }

  function enlazarInicio() {
    const sel = $('#tn-tienda');
    if (sel) sel.onchange = () => { fijarTienda(sel.value); actual = tiendas().find((t) => t.id === sel.value) || actual; pintar(); };
    const cargar = async (candidatos) => {
      leyendo = true; pintar();
      try {
        const r = agrupar(candidatos);
        grupos = r.grupos; ignorados = r.ignorados;
        if (candidatos.some((c) => c.archivo && esHeic(c.archivo))) precargarHeic().catch(() => { /* se vuelve a intentar al procesar */ });
      } catch (e) { toast('No se pudieron leer los archivos: ' + (e.message || e), 'error'); }
      leyendo = false; pintar();
    };
    const desdeInput = (id) => { const el = $(id); if (el) el.onchange = async () => { const f = [...el.files]; leyendo = true; pintar(); try { await cargar(await reunir(f)); } catch (e) { leyendo = false; toast('No se pudieron leer los archivos: ' + (e.message || e), 'error'); pintar(); } }; };
    desdeInput('#m-fotos'); desdeInput('#m-carpeta'); desdeInput('#m-zip');
    const zona = $('#m-soltar');
    if (zona) {
      zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('sobre'); };
      zona.ondragleave = () => zona.classList.remove('sobre');
      zona.ondrop = async (e) => {
        e.preventDefault(); zona.classList.remove('sobre');
        const entradas = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);  // se leen acá: después del primer await ya no están
        const sueltos = [...e.dataTransfer.files];
        leyendo = true; pintar();
        try {
          const archivos = entradas.length ? (await Promise.all(entradas.map(archivosDeEntrada))).flat() : sueltos;
          await cargar(await reunir(archivos));
        } catch (err) { leyendo = false; toast('No se pudieron leer los archivos: ' + (err.message || err), 'error'); pintar(); }
      };
    }
    $$('input[name=m-modo]').forEach((r) => (r.onchange = () => { modo = r.value; guardarPref(PREF_MODO, modo); }));
    $('#m-mostrar') && ($('#m-mostrar').onchange = (e) => { mostrar = e.target.checked; guardarPref(PREF_MOSTRAR, mostrar ? 'si' : 'no'); });
    $('#m-revisar') && ($('#m-revisar').onclick = buscarTodo);
  }

  // ---------- 2. buscar cada SKU en la tienda ----------
  async function buscarTodo() {
    fase = 'buscando'; avance = { n: 0, total: grupos.length, txt: 'Buscando los productos en la tienda…' }; pintar();
    let locales = [];
    try { locales = await listaVisible(); } catch { /* sin productos locales */ }
    const enApp = new Map(locales.map((p) => [normSku(p.sku), p]));
    const trabajar = async (g) => {
      try {
        const r = await remote.tiendaNube('buscar', { tienda: actual.id, sku: g.sku });
        if (r.existe) Object.assign(g, { estado: r.fotos.length ? 'con-fotos' : 'sin-fotos', productoId: r.id, nombre: r.nombre, publicado: r.publicado, enTienda: r.fotos.length });
        else Object.assign(g, { estado: 'no-existe', enApp: enApp.has(g.sku) });
      } catch (e) { Object.assign(g, { estado: 'error', error: e.message || String(e) }); }
      g.accion = g.estado === 'sin-fotos' ? 'subir' : 'omitir';
      avance.n++; avance.txt = `Buscando los productos en la tienda… ${avance.n} de ${avance.total}`; pintarAvance();
    };
    const cola = [...grupos];
    await Promise.all(Array.from({ length: 3 }, async () => { while (cola.length) await trabajar(cola.shift()); }));
    fase = 'revision'; pintar();
  }

  // ---------- 3. revisar y decidir ----------
  const haceFalta = (g) => ['subir', 'agregar', 'reemplazar', 'crear'].includes(g.accion);

  function pintarRevision() {
    const accionables = grupos.filter(haceFalta);
    const fotos = accionables.reduce((a, g) => a + g.fotos.length, 0);
    const reemplazos = accionables.filter((g) => g.accion === 'reemplazar').length;
    const creaciones = accionables.filter((g) => g.accion === 'crear').length;
    const seg = fotos * (modo === 'quitar_fondo' ? 5 : modo === 'ajustar' ? 1 : 0.3) + fotos * 0.8;
    const tiempo = seg < 90 ? `${Math.max(1, Math.round(seg))} segundos` : `${Math.round(seg / 60)} minutos`;
    const cuenta = (est) => grupos.filter((g) => g.estado === est).length;
    const selector = (g, i) => `<select data-fila="${i}" aria-label="Qué hacer con ${esc(g.sku)}">${(OPCIONES_FILA[g.estado] || OPCIONES_FILA.error).map(([v, t]) => `<option value="${v}" ${g.accion === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const estadoTxt = (g) => ({ 'sin-fotos': 'Existe, sin fotos', 'con-fotos': `Existe, tiene ${g.enTienda} foto${g.enTienda === 1 ? '' : 's'}`, 'no-existe': g.enApp ? 'No existe en la tienda (ya hay un borrador en la app)' : 'No existe en la tienda', error: 'Error: ' + (g.error || '') }[g.estado]);
    raiz.innerHTML = `
      <section class="panel paso"><div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">3</span>Esto es lo que va a pasar</h3>
        <p class="ayuda">Tienda <b>${esc(actual.nombre)}</b>${actual.real ? ' <b class="rojo">(tienda real)</b>' : ' (prueba)'} · fondo: <b>${esc(MODOS_FOTO.find((m) => m.id === modo).titulo)}</b>. Todavía no se cambió nada.</p>
        <div class="ayuda" style="display:grid;gap:6px;margin:8px 0 12px">
          ${cuenta('con-fotos') ? `<label>Para los ${cuenta('con-fotos')} que ya tienen fotos: <select id="m-masivo-con"><option value="">elegir…</option><option value="omitir">No tocar</option><option value="agregar">Agregar al final</option><option value="reemplazar">Reemplazar las que tienen</option></select></label>` : ''}
          ${cuenta('no-existe') ? `<label>Para los ${cuenta('no-existe')} que no existen en la tienda: <select id="m-masivo-no"><option value="">elegir…</option><option value="omitir">No hacer nada</option><option value="crear">Crear producto (borrador en la app)</option></select></label>` : ''}
        </div>
        <div style="overflow-x:auto"><table class="tabla-masiva"><thead><tr><th>SKU</th><th>Producto</th><th>Fotos</th><th>Estado</th><th>Qué hacer</th></tr></thead><tbody>
          ${grupos.map((g, i) => `<tr class="${g.estado === 'no-existe' || g.estado === 'error' ? 'rojo' : ''}"><td class="num"><b>${esc(g.sku)}</b></td><td>${esc(g.nombre || '—')}${g.estado !== 'no-existe' && g.estado !== 'error' ? ` <span class="estado ${g.publicado ? 'e-cargado' : 'e-borrador'}">${g.publicado ? 'Visible' : 'Oculto'}</span>` : ''}</td><td class="num">${g.fotos.length}</td><td>${esc(estadoTxt(g))}</td><td>${selector(g, i)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="ayuda" style="margin:12px 0 0"><b>${fotos} foto${fotos === 1 ? '' : 's'} en ${accionables.length} producto${accionables.length === 1 ? '' : 's'}</b>${creaciones ? ` · ${creaciones} borrador${creaciones === 1 ? '' : 'es'} nuevo${creaciones === 1 ? '' : 's'} en la app` : ''}${reemplazos ? ` · <span class="rojo">se borran las fotos actuales de ${reemplazos} producto${reemplazos === 1 ? '' : 's'}</span>` : ''}${fotos ? ` · tiempo aproximado: ${tiempo}` : ''}.</p>
        <div class="fila-botones col" style="margin-top:12px">
          <button class="btn primario grande" id="m-enviar" ${accionables.length ? '' : 'disabled'}>${icono('check', 20)}Procesar y subir</button>
          <button class="btn fantasma" id="m-volver">Volver</button>
        </div>
      </div></section>`;
    $$('select[data-fila]').forEach((s) => (s.onchange = () => { grupos[+s.dataset.fila].accion = s.value; pintarRevision(); }));
    const masivo = (id, estado) => { const s = $(id); if (s) s.onchange = () => { if (!s.value) return; grupos.filter((g) => g.estado === estado).forEach((g) => { g.accion = s.value; }); pintarRevision(); }; };
    masivo('#m-masivo-con', 'con-fotos'); masivo('#m-masivo-no', 'no-existe');
    $('#m-volver').onclick = () => { fase = 'inicio'; pintar(); };
    $('#m-enviar').onclick = enviar;
  }

  // ---------- 4. procesar y subir ----------
  function pintarProgreso() {
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t">${fase === 'buscando' ? 'Buscando…' : 'Procesando y subiendo…'}</h3>
      <div class="progreso"><div class="barra"><i id="m-barra"></i></div><span id="m-txt"></span></div>
      ${fase === 'enviando' ? `<p class="ayuda">No cierres esta pestaña mientras sube. Podés detener la carga: termina el producto que está haciendo y no sigue con los demás.</p>
        <ul id="m-informe" class="ayuda" style="padding-left:18px;margin:8px 0">${informe.map(li).join('')}</ul>
        <div class="fila-botones col"><button class="btn fantasma" id="m-detener">Detener después de este producto</button></div>` : ''}
    </div></section>`;
    $('#m-detener') && ($('#m-detener').onclick = () => { detener = true; $('#m-detener').disabled = true; $('#m-detener').textContent = 'Deteniendo…'; });
    pintarAvance();
  }
  const li = ([txt, mal]) => `<li class="${mal ? 'rojo' : ''}">${esc(txt)}</li>`;
  const sumar = (txt, mal = false) => { informe.push([txt, mal]); const ul = $('#m-informe'); if (ul) ul.insertAdjacentHTML('beforeend', li([txt, mal])); };

  async function crearBorrador(g, listas) {
    const locales = await listaVisible();
    const existente = locales.find((x) => normSku(x.sku) === g.sku);
    const fotos = listas.map((r) => ({ id: uid(), ext: extDe(r.blob), tipo: r.tipo, blob: r.blob, orig: r.orig || undefined }));
    let p = existente;
    if (p) p.fotos = [...(p.fotos || []), ...fotos];
    else { p = productoNuevo(cfg, operador()); p.sku = g.sku; p.fotos = fotos; }
    await guardarProducto(p, operador());
    borradores.push({ id: p.id, sku: g.sku, existente: !!existente });
    sumar(`${g.sku}: ${fotos.length} foto${fotos.length === 1 ? '' : 's'} guardada${fotos.length === 1 ? '' : 's'} en un borrador de la app (${existente ? 'ya existía' : 'nuevo'}). Falta completar los datos.`);
  }

  async function procesarGrupo(g, numero, total) {
    const listas = [], fallidas = [];
    for (let k = 0; k < g.fotos.length; k++) {
      avance.txt = `Producto ${numero} de ${total} · ${g.sku} · foto ${k + 1} de ${g.fotos.length}`; pintarAvance();
      try {
        const r = await procesarFoto(g.fotos[k].archivo, modo);
        listas.push({ ...r, ext: extDe(r.blob) });
        if (r.aviso) sumar(`${g.sku} (${g.fotos[k].archivo.name}): ${r.aviso}`, true);
      } catch (e) { fallidas.push(`${g.fotos[k].archivo.name}: ${e.message || e}`); }
    }
    if (fallidas.length) sumar(`${g.sku}: no se pudieron abrir ${fallidas.length} foto${fallidas.length === 1 ? '' : 's'} (${fallidas.join('; ')})`, true);
    if (!listas.length) throw new Error('ninguna foto se pudo procesar');

    if (g.accion === 'crear') { await crearBorrador(g, listas); return true; }

    let posicion = g.accion === 'reemplazar' ? 0 : g.enTienda || 0;
    if (g.accion === 'reemplazar' && g.enTienda) await remote.tiendaNube('borrar-fotos', { tienda: actual.id, producto: g.productoId });
    let subidas = 0;
    try {
      for (const r of listas) {
        const base = posicion;
        await remote.tiendaNube('subir-foto', { tienda: actual.id, producto: g.productoId, nombre: `${g.sku}${base ? `_${base + 1}` : ''}.${r.ext}`, base64: await aBase64(r.blob), posicion: ++posicion });
        subidas++;
      }
    } catch (e) {
      throw new Error(`${e.message || e} (se subieron ${subidas} de ${listas.length}${g.accion === 'reemplazar' ? '; las fotos anteriores ya se habían borrado' : ''})`);
    }
    let visible = '';
    if (mostrar && !g.publicado) {
      try { await remote.tiendaNube('visibilidad', { tienda: actual.id, producto: g.productoId, publicado: true }); visible = ' · ahora visible'; }
      catch (e) { sumar(`${g.sku}: las fotos se subieron pero no se pudo mostrar el producto (${e.message || e}).`, true); }
    }
    sumar(`${g.sku}: ${subidas} foto${subidas === 1 ? '' : 's'} subida${subidas === 1 ? '' : 's'} a «${g.nombre}»${g.accion === 'reemplazar' ? ' (reemplazo)' : ''}${visible}`);
    return true;
  }

  async function enviar() {
    const trabajo = grupos.filter(haceFalta);
    const reemplazos = trabajo.filter((g) => g.accion === 'reemplazar');
    if (reemplazos.length && !confirm(`Se van a BORRAR las fotos actuales de ${reemplazos.length} producto${reemplazos.length === 1 ? '' : 's'} en «${actual.nombre}» y se reemplazan por las nuevas. ¿Seguir?`)) return;
    if (actual.real && !confirm(`Vas a subir fotos a la tienda REAL «${actual.nombre}». ¿Seguir?`)) return;
    fase = 'enviando'; detener = false; informe = []; borradores = [];
    avance = { n: 0, total: trabajo.length, txt: 'Preparando…' }; pintar();
    try { bloqueoPantalla = await navigator.wakeLock?.request('screen'); } catch { bloqueoPantalla = null; }   // que la pantalla no se apague mientras sube
    ctx.antesDeSalir = () => confirm('Se está subiendo la carga masiva. Si salís ahora se corta. ¿Salir igual?');
    let hechos = 0;
    for (let i = 0; i < trabajo.length; i++) {
      if (detener) { sumar(`Se detuvo la carga: faltan ${trabajo.length - i} producto${trabajo.length - i === 1 ? '' : 's'}. Para seguir, volvé a cargar las mismas fotos y los que ya tienen fotos se pueden dejar en «No tocar».`, true); break; }
      avance.n = i; pintarAvance();
      try { if (await procesarGrupo(trabajo[i], i + 1, trabajo.length)) hechos++; }
      catch (e) { sumar(`${trabajo[i].sku}: ${e.message || e}`, true); }
    }
    ctx.antesDeSalir = null;
    try { await bloqueoPantalla?.release(); } catch { /* ya liberado */ }
    avance.n = trabajo.length; avance.hechos = hechos;
    fase = 'fin'; pintar();
    toast(`Carga masiva terminada: ${hechos} de ${trabajo.length} producto${trabajo.length === 1 ? '' : 's'}`, hechos === trabajo.length ? '' : 'error');
  }

  // ---------- 5. resultado ----------
  function pintarFin() {
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t"><span class="nro" aria-hidden="true">✓</span>Resultado</h3>
      <ul class="ayuda" style="padding-left:18px;margin:0 0 12px">${informe.map(li).join('') || '<li>No había nada para subir.</li>'}</ul>
      ${borradores.length ? `<div class="item" style="display:block;margin:0 0 12px"><b>Productos nuevos para completar</b>
        <p class="ayuda" style="margin:4px 0 8px">Las fotos ya están en cada borrador. Completá nombre, categoría, precio y demás datos, y después enviálos desde <b>Exportar → Enviar a Tienda Nube</b>: se crean ocultos con sus fotos.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${borradores.map((b) => `<a class="btn chico" href="#/producto/${esc(b.id)}">${esc(b.sku)} · completar datos</a>`).join('')}</div></div>` : ''}
      <div class="fila-botones col"><button class="btn primario" id="m-otra">Cargar otra tanda</button></div>
    </div></section>`;
    $('#m-otra').onclick = () => { grupos = []; ignorados = []; informe = []; borradores = []; fase = 'inicio'; pintar(); };
  }

  ctx.alSalir?.(() => { try { bloqueoPantalla?.release(); } catch { /* ya liberado */ } });
  pintar();
}
