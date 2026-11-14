// Taller de imágenes: se suben fotos (sueltas, una carpeta o un ZIP), se les quita el fondo, se les agrega sombra y se
// descargan en uno o más ZIP. Todo pasa en este equipo: las fotos no se envían a ningún servidor.
import { procesarTaller } from './procesar.js';
import { reunir, archivosDeEntrada } from './vista-masiva.js';
import { icono } from './iconos.js';
import { $, $$, esc, toast, descargar, cargarScript } from './util.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const POR_ZIP = 150;                       // fotos por ZIP: así ningún archivo se vuelve enorme
const CLAVE_OPC = 'taller_opciones';
const POR_DEFECTO = { quitar: true, fondo: 'blanco', sombra: 1, tam: 1200, margen: 0.08, mejorar: true, formato: 'jpg' };
const sello = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const nombreBase = (n) => String(n).replace(/\.[^.]+$/, '');

const leerOpc = () => { try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE_OPC) || '{}') }; } catch { return { ...POR_DEFECTO }; } };
const guardarOpc = (o) => { try { localStorage.setItem(CLAVE_OPC, JSON.stringify(o)); } catch { /* sin almacenamiento */ } };

export async function vistaTaller(raiz, ctx) {
  let fase = 'inicio';                      // inicio · procesando · fin
  let fotos = [], ignorados = [];
  const opc = leerOpc();
  let prueba = null;                        // { orig, res, ms, aviso, cargando }
  let leyendo = false, cancelar = false, bloqueo = null;
  let avance = { n: 0, total: 0, txt: '' };
  let zips = [], errores = [], avisos = [];
  const urls = [];
  const url = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
  const soltarUrls = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  ctx.alSalir?.(() => { soltarUrls(); try { bloqueo?.release(); } catch { /* ya liberado */ } });

  const pintarAvance = () => {
    const b = $('#t-barra'), t = $('#t-txt');
    if (b) b.style.width = Math.round((avance.n / Math.max(avance.total, 1)) * 100) + '%';
    if (t) t.textContent = avance.txt;
  };
  const pintar = () => (fase === 'procesando' ? pintarProgreso() : fase === 'fin' ? pintarFin() : pintarInicio());

  // ---------- 1. elegir las fotos y las opciones ----------
  function pintarInicio() {
    const peso = fotos.reduce((a, f) => a + f.archivo.size, 0);
    const transp = opc.quitar && opc.fondo === 'transparente';
    const radio = (nombre, valor, actual, txt) => `<label class="item" style="display:flex;gap:8px;align-items:center;padding:10px 12px"><input type="radio" name="${nombre}" value="${valor}" ${String(valor) === String(actual) ? 'checked' : ''}> ${txt}</label>`;
    raiz.innerHTML = `
      <section class="panel paso"><div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">1</span>Subí las fotos</h3>
        <p class="ayuda">Podés soltar muchas fotos a la vez, una carpeta o un ZIP. No se envían a ningún servidor: todo se hace en esta computadora.</p>
        <div id="t-soltar" class="zona-soltar" tabindex="0">${icono('imagen', 36)}<b>Soltá acá las fotos, la carpeta o el ZIP</b><span>o elegilos con los botones</span></div>
        <div class="btns-foto" style="grid-template-columns:repeat(3,1fr)">
          <label class="btn">${icono('imagen', 20)}<span>Fotos</span><input id="t-fotos" type="file" accept="image/*,.heic,.heif" multiple></label>
          <label class="btn">${icono('caja', 20)}<span>Carpeta</span><input id="t-carpeta" type="file" webkitdirectory multiple></label>
          <label class="btn">${icono('caja', 20)}<span>ZIP</span><input id="t-zip" type="file" accept=".zip,application/zip"></label>
        </div>
        ${leyendo ? '<p class="ayuda" style="margin:10px 0 0"><b>Leyendo los archivos…</b></p>' : ''}
        ${fotos.length ? `<p class="ayuda" style="margin:10px 0 0"><b>${fotos.length.toLocaleString('es-AR')} foto${fotos.length === 1 ? '' : 's'}</b> listas (${mb(peso)}). <button class="btn chico fantasma" id="t-vaciar" type="button">Empezar de nuevo</button></p>` : ''}
        ${ignorados.length ? `<details class="ayuda" style="margin:6px 0 0"><summary class="rojo"><b>${ignorados.length} archivo${ignorados.length === 1 ? '' : 's'} ignorado${ignorados.length === 1 ? '' : 's'}</b></summary><ul style="padding-left:18px;margin:6px 0 0">${ignorados.slice(0, 40).map((i) => `<li>${esc(i.ignorado)} · ${esc(i.motivo)}</li>`).join('')}${ignorados.length > 40 ? `<li>y ${ignorados.length - 40} más</li>` : ''}</ul></details>` : ''}
      </div></section>

      <section class="panel paso"><div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">2</span>Elegí cómo quedan</h3>
        <div class="ayuda" style="display:grid;gap:14px">
          <div><b>Fondo</b><div style="display:grid;gap:6px;margin-top:6px">${radio('t-quitar', 'true', opc.quitar, 'Quitar el fondo y dejar solo el producto')}${radio('t-quitar', 'false', opc.quitar, 'Dejar la foto como está (solo centrarla en un cuadrado)')}</div></div>
          ${opc.quitar ? `<div><b>Color de fondo</b><div style="display:grid;gap:6px;margin-top:6px">${radio('t-fondo', 'blanco', opc.fondo, 'Blanco')}${radio('t-fondo', 'transparente', opc.fondo, 'Transparente (se descarga en PNG)')}</div></div>
          <div><b>Sombra</b><div style="display:grid;gap:6px;margin-top:6px">${radio('t-sombra', '0', opc.sombra, 'Sin sombra')}${radio('t-sombra', '1', opc.sombra, 'Suave')}${radio('t-sombra', '2', opc.sombra, 'Marcada')}</div></div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:14px">
            <label class="campo" style="margin:0"><span>Tamaño (cuadrado)</span><select id="t-tam">${[1000, 1080, 1200, 1600, 2000].map((n) => `<option value="${n}" ${opc.tam === n ? 'selected' : ''}>${n} × ${n} px</option>`).join('')}</select></label>
            ${opc.quitar ? `<label class="campo" style="margin:0"><span>Espacio alrededor</span><select id="t-margen">${[[0.04, 'Ajustado'], [0.08, 'Normal'], [0.14, 'Amplio']].map(([v, t]) => `<option value="${v}" ${opc.margen === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
            <label class="campo" style="margin:0"><span>Formato</span><select id="t-formato" ${transp ? 'disabled' : ''}>${[['jpg', 'JPG (el más común)'], ['webp', 'WebP (más liviano)'], ['png', 'PNG']].map(([v, t]) => `<option value="${v}" ${(transp ? 'png' : opc.formato) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          </div>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="t-mejorar" ${opc.mejorar ? 'checked' : ''}> Mejorar la luz y la nitidez</label>
        </div>
      </div></section>

      <section class="panel paso"><div>
        <h3 class="paso-t"><span class="nro" aria-hidden="true">3</span>Probá y procesá</h3>
        <div class="fila-botones col" style="margin-bottom:10px"><button class="btn" id="t-probar" ${fotos.length && !(prueba && prueba.cargando) ? '' : 'disabled'}>${icono('varita', 20)}Ver cómo queda la primera foto</button></div>
        ${prueba ? `<div class="comparar" style="margin:0 0 12px">
          <figure><figcaption>Original</figcaption><div class="lienzo-foto"><img src="${prueba.orig}" alt="Foto original" style="width:100%;height:100%;object-fit:contain"></div></figure>
          <figure><figcaption>Resultado</figcaption><div class="lienzo-foto damero">${prueba.cargando ? '<span class="cargando-txt">Procesando… la primera vez baja el modelo (unos 50 MB)</span>' : prueba.error ? `<span class="rojo">${esc(prueba.error)}</span>` : `<img src="${prueba.res}" alt="Resultado" style="width:100%;height:100%;object-fit:contain">`}</div></figure>
        </div>
        ${!prueba.cargando && !prueba.error ? `<p class="ayuda" style="margin:0 0 10px">Tardó ${(prueba.ms / 1000).toFixed(1).replace('.', ',')} s${prueba.aviso ? ` · ${esc(prueba.aviso)}` : ''}. Con ${fotos.length.toLocaleString('es-AR')} fotos serían unos ${tiempoTotal(prueba.ms)}.</p>` : ''}` : ''}
        <div class="fila-botones col"><button class="btn primario grande" id="t-procesar" ${fotos.length ? '' : 'disabled'}>${icono('check', 20)}Procesar ${fotos.length ? fotos.length.toLocaleString('es-AR') + ' foto' + (fotos.length === 1 ? '' : 's') : ''} y armar el ZIP</button></div>
      </div></section>`;
    enlazarInicio();
  }
  const tiempoTotal = (ms) => { const s = (ms * fotos.length) / 1000; return s < 90 ? `${Math.max(1, Math.round(s))} segundos` : `${Math.round(s / 60)} minutos`; };

  function enlazarInicio() {
    const cargar = async (candidatos) => {
      fotos = candidatos.filter((c) => c.archivo); ignorados = candidatos.filter((c) => c.ignorado);
      fotos.sort((a, b) => a.ruta.localeCompare(b.ruta, 'es', { numeric: true }));
      prueba = null; leyendo = false; pintar();
    };
    const leer = async (promesa) => { leyendo = true; pintar(); try { await cargar(await promesa()); } catch (e) { leyendo = false; toast('No se pudieron leer los archivos: ' + (e.message || e), 'error'); pintar(); } };
    for (const id of ['#t-fotos', '#t-carpeta', '#t-zip']) { const el = $(id); if (el) el.onchange = () => { const f = [...el.files]; leer(() => reunir(f)); }; }
    const zona = $('#t-soltar');
    if (zona) {
      zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('sobre'); };
      zona.ondragleave = () => zona.classList.remove('sobre');
      zona.ondrop = (e) => {
        e.preventDefault(); zona.classList.remove('sobre');
        const entradas = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);   // se leen acá: después del primer await ya no están
        const sueltos = [...e.dataTransfer.files];
        leer(async () => reunir(entradas.length ? (await Promise.all(entradas.map(archivosDeEntrada))).flat() : sueltos));
      };
    }
    $('#t-vaciar') && ($('#t-vaciar').onclick = () => { fotos = []; ignorados = []; prueba = null; soltarUrls(); pintar(); });
    const cambio = (fn) => { fn(); guardarOpc(opc); prueba = null; pintar(); };
    $$('input[name=t-quitar]').forEach((r) => (r.onchange = () => cambio(() => { opc.quitar = r.value === 'true'; })));
    $$('input[name=t-fondo]').forEach((r) => (r.onchange = () => cambio(() => { opc.fondo = r.value; })));
    $$('input[name=t-sombra]').forEach((r) => (r.onchange = () => cambio(() => { opc.sombra = +r.value; })));
    $('#t-tam') && ($('#t-tam').onchange = (e) => cambio(() => { opc.tam = +e.target.value; }));
    $('#t-margen') && ($('#t-margen').onchange = (e) => cambio(() => { opc.margen = +e.target.value; }));
    $('#t-formato') && ($('#t-formato').onchange = (e) => cambio(() => { opc.formato = e.target.value; }));
    $('#t-mejorar') && ($('#t-mejorar').onchange = (e) => cambio(() => { opc.mejorar = e.target.checked; }));
    $('#t-probar') && ($('#t-probar').onclick = probar);
    $('#t-procesar') && ($('#t-procesar').onclick = procesar);
  }

  async function probar() {
    soltarUrls();
    const primera = fotos[0].archivo;
    prueba = { orig: url(primera), cargando: true }; pintar();
    const t0 = performance.now();
    try { const r = await procesarTaller(primera, opc); prueba = { orig: prueba.orig, res: url(r.blob), ms: performance.now() - t0, aviso: r.aviso }; }
    catch (e) { prueba = { orig: prueba.orig, error: 'No se pudo procesar esta foto: ' + (e.message || e) }; }
    pintar();
  }

  // ---------- 2. procesar y armar los ZIP ----------
  function pintarProgreso() {
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t">Procesando las fotos…</h3>
      <div class="progreso"><div class="barra"><i id="t-barra"></i></div><span id="t-txt"></span></div>
      <p class="ayuda">No cierres esta pestaña ni la dejes en segundo plano mucho tiempo. Podés cancelar: se arma el ZIP con lo que ya está listo.</p>
      ${avisos.length ? `<ul class="ayuda rojo" style="padding-left:18px">${avisos.slice(-4).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <div class="fila-botones col"><button class="btn fantasma" id="t-cancelar">Cancelar y armar el ZIP con lo que hay</button></div>
    </div></section>`;
    $('#t-cancelar') && ($('#t-cancelar').onclick = () => { cancelar = true; $('#t-cancelar').disabled = true; $('#t-cancelar').textContent = 'Cancelando…'; });
    pintarAvance();
  }

  async function procesar() {
    await cargarScript(JSZIP);
    fase = 'procesando'; cancelar = false; zips = []; errores = []; avisos = [];
    const total = fotos.length;
    avance = { n: 0, total, txt: 'Preparando…' }; pintar();
    try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { bloqueo = null; }   // que la pantalla no se apague
    ctx.antesDeSalir = () => confirm('Se están procesando las fotos. Si salís ahora se pierde lo hecho. ¿Salir igual?');
    const usados = new Set();
    let zip = new window.JSZip(), enZip = 0, hechas = 0;
    const t0 = performance.now();
    const cerrarZip = async () => {
      if (!enZip) return;
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      zips.push({ blob, n: enZip });
      zip = new window.JSZip(); enZip = 0;
    };
    for (let i = 0; i < total; i++) {
      if (cancelar) break;
      const f = fotos[i];
      const trans = (performance.now() - t0) / 1000 / Math.max(i, 1);
      avance = { n: i, total, txt: `Foto ${i + 1} de ${total.toLocaleString('es-AR')} · ${f.archivo.name}${i ? ` · faltan unos ${Math.max(1, Math.round((trans * (total - i)) / 60))} min` : ''}` };
      pintarAvance();
      try {
        const r = await procesarTaller(f.archivo, opc);
        if (r.aviso) { avisos.push(`${f.archivo.name}: ${r.aviso}`); errores.push(`${f.archivo.name}: ${r.aviso}`); }
        let base = nombreBase(f.archivo.name), nombre = `${base}.${r.ext}`, n = 2;
        while (usados.has(nombre.toLowerCase())) nombre = `${base}_${n++}.${r.ext}`;
        usados.add(nombre.toLowerCase());
        zip.file(nombre, r.blob); enZip++; hechas++;
        if (enZip >= POR_ZIP) await cerrarZip();
      } catch (e) { errores.push(`${f.archivo.name}: ${e.message || e}`); avisos.push(`${f.archivo.name}: no se pudo procesar`); }
    }
    await cerrarZip();
    ctx.antesDeSalir = null;
    try { await bloqueo?.release(); } catch { /* ya liberado */ }
    avance = { n: total, total, txt: 'Listo', hechas };
    fase = 'fin'; pintar();
    toast(`Listo: ${hechas} de ${total} fotos`, hechas === total ? '' : 'error');
  }

  // ---------- 3. descargar ----------
  function pintarFin() {
    const hechas = zips.reduce((a, z) => a + z.n, 0);
    raiz.innerHTML = `<section class="panel paso"><div>
      <h3 class="paso-t"><span class="nro" aria-hidden="true">✓</span>Fotos listas</h3>
      <p class="ayuda"><b>${hechas.toLocaleString('es-AR')} foto${hechas === 1 ? '' : 's'}</b> procesada${hechas === 1 ? '' : 's'}${errores.length ? `, ${errores.length} con avisos` : ''}.${cancelar ? ' Se canceló antes de terminar.' : ''}</p>
      <div class="fila-botones col">${zips.map((z, i) => `<button class="btn primario" data-zip="${i}">${icono('descargar', 20)}Descargar ZIP${zips.length > 1 ? ` ${i + 1} de ${zips.length}` : ''} · ${z.n} foto${z.n === 1 ? '' : 's'} · ${mb(z.blob.size)}</button>`).join('') || '<p class="ayuda">No quedó ninguna foto para descargar.</p>'}
        ${zips.length > 1 ? `<button class="btn" id="t-todos">Descargar todos los ZIP</button>` : ''}
      </div>
      ${errores.length ? `<details class="ayuda" style="margin-top:12px"><summary class="rojo"><b>Ver los avisos (${errores.length})</b></summary><ul style="padding-left:18px">${errores.slice(0, 60).map((e) => `<li>${esc(e)}</li>`).join('')}${errores.length > 60 ? `<li>y ${errores.length - 60} más</li>` : ''}</ul></details>` : ''}
      <div class="fila-botones col" style="margin-top:12px"><button class="btn" id="t-otra">Procesar otra tanda</button></div>
    </div></section>`;
    const nombreZip = (i) => `fotos-sin-fondo-${sello()}${zips.length > 1 ? `-parte${i + 1}` : ''}.zip`;
    $$('[data-zip]').forEach((b) => (b.onclick = () => descargar(zips[+b.dataset.zip].blob, nombreZip(+b.dataset.zip))));
    $('#t-todos') && ($('#t-todos').onclick = () => zips.forEach((z, i) => setTimeout(() => descargar(z.blob, nombreZip(i)), i * 700)));
    $('#t-otra').onclick = () => { fotos = []; ignorados = []; zips = []; errores = []; avisos = []; prueba = null; soltarUrls(); fase = 'inicio'; pintar(); };
  }

  pintar();
}
