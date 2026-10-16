// Formulario de producto: riel de avance, fotos (con quitar fondo), datos de Tienda Nube, guardado.
import { obtener, productoNuevo, guardarProducto, eliminarProducto, srcFoto, listaVisible } from './store.js';
import { cfg, medidasPara, normSku, operador, nombresProveedores, buscarProveedor, listaProveedores, guardarProveedores } from './config.js';
import { leerOriginal, quitarFondo, componer, codificar, aBlob, extDe } from './imagen.js';
import { revisar } from './exportar.js';
import { avance, rielHTML, textoFaltan } from './riel.js';
import { sugerirTextos } from './textos.js';
import { icono } from './iconos.js';
import { esc, $, $$, uid, parseNum, toast, abrirModal, cerrarModal } from './util.js';

let plantillaNuevo = null; // para "Duplicar como nuevo"

const n2s = (n) => (n == null ? '' : String(n).replace('.', ','));

function opcionesCategoria(actual, vacio = 'Elegí una categoría') {
  const grupos = new Map();
  for (const c of cfg.categorias) {
    const main = c.split(' > ')[0];
    if (!grupos.has(main)) grupos.set(main, []);
    grupos.get(main).push(c);
  }
  let html = `<option value="">${vacio}</option>`;
  if (actual && !cfg.categorias.includes(actual)) html += `<option value="${esc(actual)}" selected>${esc(actual)} (no está en la lista)</option>`;
  for (const [main, items] of grupos) {
    html += `<optgroup label="${esc(main)}">` + items.map((c) => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${c.includes(' > ') ? esc(c.split(' > ').slice(1).join(' > ')) : 'Solo «' + esc(main) + '»'}</option>`).join('') + '</optgroup>';
  }
  return html;
}

const inp = (name, label, val, o = {}) => `
  <label class="campo ${o.cls || ''}"><span>${label}${o.req ? ' <i>*</i>' : ''}</span>
    <input name="${name}" type="text" value="${esc(val ?? '')}" ${o.im ? `inputmode="${o.im}"` : ''} ${o.list ? `list="${o.list}"` : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} autocomplete="off" ${o.extra || ''}>
    ${o.ayuda ? `<small>${o.ayuda}</small>` : ''}</label>`;

const area = (name, label, val, filas = 4, ayuda = '') => `
  <label class="campo"><span>${label}</span><textarea name="${name}" rows="${filas}">${esc(val ?? '')}</textarea>${ayuda ? `<small>${ayuda}</small>` : ''}</label>`;

const interruptor = (name, label, val, ayuda = '') => `
  <label class="interruptor"><span>${label}${ayuda ? `<small>${ayuda}</small>` : ''}</span><input type="checkbox" name="${name}" ${val ? 'checked' : ''}><span class="pista" aria-hidden="true"></span></label>`;

const grupo = (id, titulo, contenido, { abierto = false, res = '' } = {}) => `
  <details class="grupo" id="g-${id}" ${abierto ? 'open' : ''}>
    <summary><span>${titulo}</span><span class="res" id="res-${id}">${res}</span>${icono('chevron', 20)}</summary>
    <div class="cont">${contenido}</div>
  </details>`;

export function duplicarComo(p) {
  const copia = JSON.parse(JSON.stringify({ ...p, fotos: [] }));
  for (const k of ['id', 'sku', 'barcode', 'slug', 'remote_ts', 'eliminado', '_dirty', '_fotos_borradas']) delete copia[k];
  copia.estado = 'borrador';
  plantillaNuevo = copia;
}

export async function vistaProducto(raiz, ctx, id) {
  let p = id && id !== 'nuevo' ? await obtener(id) : null;
  const esNuevo = !p;
  if (id && id !== 'nuevo' && !p) { raiz.innerHTML = '<div class="vacio"><p><b>No encontré ese producto.</b></p><p>Puede que lo hayan eliminado desde otro equipo.</p><a class="btn" href="#/">Volver a la lista</a></div>'; return; }
  if (esNuevo) {
    p = productoNuevo(cfg, operador());
    if (plantillaNuevo) { Object.assign(p, plantillaNuevo); plantillaNuevo = null; }
  }
  p.props = [...(p.props || []), { n: '', v: '' }, { n: '', v: '' }, { n: '', v: '' }].slice(0, 3);
  p.fotos = p.fotos || [];
  let sucio = false;
  const marcarSucio = () => { sucio = true; };
  ctx.antesDeSalir = () => !sucio || confirm('Hay cambios sin guardar. ¿Salir igual?');

  const pr = (i) => p.props[i];
  const ESTADO_TXT = { borrador: 'Borrador', listo: 'Listo', cargado: 'Cargado' };

  raiz.innerHTML = `
  <form id="f" class="producto" autocomplete="off" onsubmit="return false">
    <datalist id="dl-marcas">${(cfg.marcas || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dl-prov">${nombresProveedores().map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dl-props">${(cfg.propiedades_sugeridas || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>

    <div class="riel-mini" id="riel-mini" aria-hidden="true"></div>
    <div class="cab-form">
      <div id="riel-caja"></div>
      <p class="riel-texto" id="riel-txt" aria-live="polite"></p>
    </div>

    <div class="cols">
      <div class="col-fotos">
        ${grupo('fotos', 'Fotos', `
          <div id="fotos" class="fotos"></div>
          <div class="btns-foto">
            <label class="btn primario">${icono('camara', 22)}<span>Sacar foto</span><input id="in-camara" type="file" accept="image/*" capture="environment"></label>
            <label class="btn">${icono('imagen', 22)}<span>Galería</span><input id="in-galeria" type="file" accept="image/*" multiple></label>
          </div>
          <p class="ayuda nota-foto">Se guarda como <code id="ej-nombre">SKU.webp</code>. El fondo se quita en este equipo: la foto no se envía a ningún servidor.</p>`, { abierto: true, res: '<span id="n-fotos"></span>' })}
      </div>

      <div class="col-datos">
        ${grupo('ident', 'Identificación', `
          <div class="rejilla">
            ${inp('sku', 'SKU', p.sku, { req: true, ph: 'Código interno', ayuda: '<span id="sku-aviso"></span>' })}
            ${inp('nombre', 'Nombre del producto', p.nombre, { req: true })}
            ${inp('marca', 'Marca', p.marca, { list: 'dl-marcas' })}
            ${inp('mpn', 'Código de fabricante', p.mpn)}
            ${inp('proveedor', 'Proveedor', p.proveedor, { list: 'dl-prov', ayuda: '<span id="prov-info"></span>' })}
            ${inp('barcode', 'Código de barras', p.barcode, { im: 'numeric' })}
          </div>`, { abierto: true })}

        ${grupo('cat', 'Categoría', `
          <label class="campo"><span>Categoría principal <i>*</i></span><select name="categoria">${opcionesCategoria(p.categoria)}</select></label>
          <label class="campo"><span>Categoría adicional (opcional)</span><select name="categoria_extra">${opcionesCategoria(p.categoria_extra, 'Ninguna')}</select><small>El producto aparece en las dos categorías de la tienda. Por ejemplo, una percha en Perchas y en Baño.</small></label>
          ${inp('tags', 'Tags (separados por coma)', p.tags)}`, { abierto: true })}

        ${grupo('precio', 'Precios', `
          <div class="rejilla">
            ${inp('precio', 'Precio de venta público ($)', n2s(p.precio), { req: true, im: 'decimal' })}
            ${inp('precio_promo', 'Precio promocional ($)', n2s(p.precio_promo), { im: 'decimal' })}
            ${inp('precio_mayorista', 'Precio mayorista ($)', n2s(p.precio_mayorista), { im: 'decimal', ayuda: 'Interno: no se sube a la tienda.' })}
            ${inp('costo', 'Costo ($)', n2s(p.costo), { im: 'decimal', ayuda: 'Se sube como costo del producto en Tienda Nube.' })}
          </div>`, { abierto: true })}

        ${grupo('medidas', 'Medidas del paquete', `
          <p class="ayuda" id="ayuda-medidas" style="margin:12px 0 0">Se completan solas según la categoría. Corregilas si este producto es distinto.</p>
          <div class="rejilla cuatro">
            ${inp('peso', 'Peso (kg)', n2s(p.peso), { im: 'decimal' })}
            ${inp('alto', 'Alto (cm)', n2s(p.alto), { im: 'decimal' })}
            ${inp('ancho', 'Ancho (cm)', n2s(p.ancho), { im: 'decimal' })}
            ${inp('prof', 'Profundidad (cm)', n2s(p.prof), { im: 'decimal' })}
          </div>
          ${interruptor('envio_gratis', 'Envío sin cargo', p.envio_gratis)}`, { abierto: true })}

        ${grupo('texto', 'Descripción y SEO', `
          <div class="fila-botones" style="margin:12px 0 0"><button type="button" class="btn chico" id="sugerir">${icono('varita', 18)}Sugerir descripción y SEO</button></div>
          ${area('descripcion', 'Descripción', p.descripcion, 7, 'Una línea en blanco separa párrafos. Las líneas que empiezan con «- » forman una lista. **texto** va en negrita.')}
          ${inp('seo_titulo', 'Título para SEO', p.seo_titulo, { ayuda: '<span id="c-seot" class="num">0</span> de 70 caracteres' })}
          ${area('seo_desc', 'Descripción para SEO', p.seo_desc, 3, '<span id="c-seod" class="num">0</span> de 320 caracteres')}`)}

        ${grupo('props', 'Filtros y variantes', `
          <p class="ayuda" style="margin:12px 0 0">Cada par crea un filtro en la tienda (por ejemplo, Material: Acero inoxidable). Hasta 3.</p>
          ${[0, 1, 2].map((i) => `<div class="rejilla">${inp('prop_n_' + i, 'Propiedad ' + (i + 1), pr(i).n, { list: 'dl-props' })}${inp('prop_v_' + i, 'Valor ' + (i + 1), pr(i).v)}</div>`).join('')}`)}

        ${grupo('inv', 'Inventario y visibilidad', `
          ${inp('stock', 'Stock', p.stock, { im: 'numeric', ayuda: 'Vacío significa stock infinito.' })}
          ${interruptor('mostrar', 'Mostrar en la tienda', p.mostrar, 'Si lo apagás, queda oculto aunque se importe.')}
          ${interruptor('fisico', 'Producto físico', p.fisico !== false, 'Necesita envío.')}`)}

        ${grupo('notas', 'Notas internas', `
          ${area('notas', 'Notas (no se suben a la tienda)', p.notas, 3)}
          <div class="meta-info">${p.creado_por ? 'Cargado por ' + esc(p.creado_por) : ''}</div>`)}

        ${grupo('estado', 'Estado del producto', `
          <div class="estado-form">
            <div class="segmentado" id="estado" role="radiogroup" aria-label="Estado del producto">
              ${['borrador', 'listo', 'cargado'].map((e) => `<label><input type="radio" name="estado" value="${e}" ${p.estado === e ? 'checked' : ''}><span>${e === 'cargado' ? icono('check', 16) : ''}${ESTADO_TXT[e]}</span></label>`).join('')}
            </div>
            <p class="ayuda" style="margin:0 0 4px">Dejalo en «Listo» cuando tenga lo necesario para exportarlo. «Cargado» es para lo que ya importaste en Tienda Nube.</p>
          </div>`, { abierto: true })}

        ${esNuevo ? '' : `<div class="fila-botones"><button type="button" class="btn" id="duplicar">${icono('duplicar', 20)}Duplicar como nuevo</button><button type="button" class="btn peligro" id="borrar">${icono('papelera', 20)}Eliminar</button></div>`}
      </div>
    </div>

    <div class="espacio-barra"></div>
    <div class="barra-guardar">
      <button type="button" class="btn grande" id="g-nuevo">Guardar y cargar otro</button>
      <button type="button" class="btn cta grande" id="g-ok">Guardar</button>
    </div>
  </form>`;

  const form = $('#f');
  const val = (n) => form.elements[n]?.value ?? '';
  const num = (n, miles = true) => parseNum(val(n), { miles });

  // ----- leer el formulario hacia p -----
  function leer() {
    for (const k of ['sku', 'nombre', 'marca', 'mpn', 'proveedor', 'barcode', 'categoria', 'categoria_extra', 'tags', 'descripcion', 'seo_titulo', 'seo_desc', 'notas', 'stock']) p[k] = val(k).trim();
    p.precio = num('precio'); p.precio_promo = num('precio_promo'); p.precio_mayorista = num('precio_mayorista'); p.costo = num('costo');
    for (const k of ['peso', 'alto', 'ancho', 'prof']) p[k] = num(k, false);
    p.props = [0, 1, 2].map((i) => ({ n: val('prop_n_' + i).trim(), v: val('prop_v_' + i).trim() }));
    for (const k of ['envio_gratis', 'mostrar', 'fisico']) p[k] = form.elements[k].checked;
    p.estado = form.elements.estado.value;
    return p;
  }

  // ----- el riel, avisos y contadores -----
  let repetidos = new Set();
  let completoAntes = null;
  const irA = (k) => {
    const mapa = { foto: '#in-camara', sku: '[name=sku]', nombre: '[name=nombre]', categoria: '[name=categoria]', precio: '[name=precio]', medidas: '[name=peso]' };
    if (k === 'foto') { const g = $('#g-fotos'); g.open = true; g.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const el = $(mapa[k], form); if (!el) return;
    el.closest('details')?.setAttribute('open', '');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.focus({ preventScroll: true }), 250);
  };
  async function refrescarFaltas() {
    if (!$('#riel-caja')) return;
    leer();
    const otros = (await listaVisible()).filter((x) => x.id !== p.id && normSku(x.sku) === normSku(p.sku) && p.sku);
    repetidos = new Set(otros.length ? [normSku(p.sku)] : []);
    const a = avance(p);
    $('#riel-caja').innerHTML = rielHTML(p, { interactivo: true });
    $$('#riel-caja .seg').forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
    const rielEl = $('#riel-caja .riel'); if (rielEl && completoAntes === false && a.completo) { rielEl.classList.remove('completo'); void rielEl.offsetWidth; rielEl.classList.add('completo'); }
    completoAntes = a.completo;
    $('#riel-mini').innerHTML = rielHTML(p) + `<span class="cuenta">${a.hechos} de ${a.pasos.length}</span>`;
    $('#riel-txt').innerHTML = a.completo
      ? `<em>Completo.</em> ${p.estado === 'borrador' ? 'Ya podés marcarlo como Listo.' : ''}`
      : `<b>${a.faltan.length === 1 ? 'Falta' : 'Faltan'} ${a.faltan.length}:</b> ` + a.faltan.map((x) => `<button type="button" class="falta-link" data-ir="${x.k}">${esc(x.t)}</button>`).join('');
    $$('#riel-txt .falta-link').forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
    const pv = buscarProveedor(p.proveedor);
    $('#prov-info').textContent = pv ? [pv.tel && `Tel. ${pv.tel}`, pv.whatsapp && `WhatsApp ${pv.whatsapp}`, pv.mail].filter(Boolean).join(' · ') + (pv.nota ? ` · ${pv.nota}` : '') : '';
    const av = $('#sku-aviso');
    if (otros.length) av.innerHTML = `<span class="aviso-sku">Ya existe otro con este SKU: <a href="#/producto/${otros[0].id}">${esc(otros[0].nombre || 'abrirlo')}</a></span>`; else av.textContent = '';
    $('#c-seot').textContent = p.seo_titulo.length; $('#c-seod').textContent = p.seo_desc.length;
    $('#c-seot').style.color = p.seo_titulo.length > 70 ? 'var(--err)' : ''; $('#c-seod').style.color = p.seo_desc.length > 320 ? 'var(--err)' : '';
    $('#ej-nombre').textContent = (normSku(p.sku) || 'SKU') + '.webp';
    $('#n-fotos').textContent = p.fotos.length ? `${p.fotos.length} foto${p.fotos.length === 1 ? '' : 's'}` : '';
  }

  function autocompletarMedidas(forzar = false) {
    if (!val('categoria')) return;
    const m = medidasPara(val('categoria'));
    if (!m) return;
    const campos = { peso: m.peso, alto: m.alto, ancho: m.ancho, prof: m.prof };
    let puesto = false;
    for (const [k, v] of Object.entries(campos)) {
      const el = form.elements[k];
      if (forzar || !el.value.trim() || el.dataset.auto === '1') { el.value = n2s(v); el.dataset.auto = '1'; puesto = true; }
    }
    if (puesto) $('#ayuda-medidas').textContent = 'Medidas sugeridas por la categoría (con fondo violeta suave). Corregilas si este producto es distinto.';
  }

  form.addEventListener('input', (e) => {
    marcarSucio();
    if (['peso', 'alto', 'ancho', 'prof'].includes(e.target.name)) delete e.target.dataset.auto;
    refrescarFaltas();
  });
  form.elements.categoria.addEventListener('change', () => { autocompletarMedidas(); refrescarFaltas(); });
  $('#sugerir').onclick = () => {
    leer();
    if (!p.nombre) { toast('Primero cargá el nombre del producto.'); return; }
    if ((p.descripcion || p.seo_titulo || p.seo_desc) && !confirm('Ya hay textos escritos. ¿Querés reemplazarlos por la sugerencia?')) return;
    const s = sugerirTextos(p);
    form.elements.descripcion.value = s.descripcion; form.elements.seo_titulo.value = s.seo_titulo; form.elements.seo_desc.value = s.seo_desc;
    marcarSucio(); refrescarFaltas(); toast('Textos sugeridos. Revisalos y ajustalos si hace falta.');
  };

  // ----- fotos -----
  function pintarFotos() {
    const cont = $('#fotos');
    if (!cont) return; // la pantalla ya se cerró mientras se procesaba la foto
    cont.innerHTML = p.fotos.length ? p.fotos.map((f, i) => `
      <div class="foto" data-i="${i}">
        <img src="${srcFoto(f)}" alt="Foto ${i + 1} del producto" crossorigin="anonymous">
        ${i === 0 ? '<span class="etq">Principal</span>' : ''}
        <div class="acc">
          ${i > 0 ? `<button type="button" data-a="principal" aria-label="Hacer principal la foto ${i + 1}">${icono('estrella', 20)}</button>` : ''}
          ${f.orig ? `<button type="button" data-a="editar" aria-label="Volver a procesar la foto ${i + 1}">${icono('lapiz', 20)}</button>` : ''}
          <button type="button" data-a="borrar" aria-label="Quitar la foto ${i + 1}">${icono('papelera', 20)}</button>
        </div>
      </div>`).join('') : `<label class="anadir-foto" for="in-camara">${icono('camara', 36)}<b>Empezá por la foto</b><span>Tocá acá: se le quita el fondo y queda lista para la tienda.</span></label>`;
    $$('.foto .acc button', cont).forEach((b) => (b.onclick = () => accionFoto(+b.closest('.foto').dataset.i, b.dataset.a)));
    refrescarFaltas();
  }

  async function accionFoto(i, a) {
    const f = p.fotos[i];
    if (a === 'principal') { p.fotos.splice(i, 1); p.fotos.unshift(f); }
    if (a === 'borrar') {
      if (!confirm('¿Quitar esta foto?')) return;
      p.fotos.splice(i, 1);
      if (f.path) p._fotos_borradas = [...(p._fotos_borradas || []), f.path];
    }
    if (a === 'editar') {
      const r = await editorFoto(f.orig, { modo: f.tipo });
      if (r) {
        const viejo = f.path;
        Object.assign(f, { blob: r.blob, orig: r.orig, tipo: r.tipo, ext: extDe(r.blob), path: undefined, url: '', id: uid() });
        if (viejo) p._fotos_borradas = [...(p._fotos_borradas || []), viejo];
      }
    }
    marcarSucio(); pintarFotos();
  }

  async function agregarArchivos(archivos) {
    for (const archivo of archivos) {
      const r = await editorFoto(archivo);
      if (!r) continue;
      p.fotos.push({ id: uid(), ext: extDe(r.blob), tipo: r.tipo, blob: r.blob, orig: r.orig });
      marcarSucio(); pintarFotos();
    }
  }
  $('#in-camara').onchange = async (e) => { const a = [...e.target.files]; e.target.value = ''; await agregarArchivos(a); };
  $('#in-galeria').onchange = async (e) => { const a = [...e.target.files]; e.target.value = ''; await agregarArchivos(a); };

  // ----- guardar -----
  async function guardar(otro) {
    leer();
    if (!p.sku) { toast('Falta el SKU: es la clave del producto y el nombre de la foto.', 'error'); irA('sku'); return; }
    if (p.estado === 'listo' || p.estado === 'cargado') {
      const crit = revisar(p, repetidos).filter((x) => x.critico);
      if (crit.length) { toast('Para dejarlo en «' + ESTADO_TXT[p.estado] + '» falta: ' + crit.map((x) => x.texto).join(', ') + '.', 'error'); return; }
    } else if (repetidos.size && !confirm('Ya existe otro producto con ese SKU. ¿Guardar igual?')) return;
    if (p.seo_titulo.length > 70 || p.seo_desc.length > 320) toast('El SEO supera el largo permitido: se va a recortar al exportar.');
    if (p.proveedor && !buscarProveedor(p.proveedor) && confirm(`«${p.proveedor}» no está en la lista de proveedores. ¿Querés agregarlo para que quede guardado en la cuenta?`)) {
      await guardarProveedores([...listaProveedores(), { nombre: p.proveedor }]);
    }
    const btn = $(otro ? '#g-nuevo' : '#g-ok'); btn.classList.add('cargando');
    await guardarProducto(p, operador());
    sucio = false;
    toast('Producto guardado');
    ctx.ir(otro ? '#/nuevo' : '#/');
  }
  $('#g-ok').onclick = () => guardar(false);
  $('#g-nuevo').onclick = () => guardar(true);
  const dup = $('#duplicar'); if (dup) dup.onclick = () => { duplicarComo(leer()); sucio = false; location.hash = '#/nuevo'; };
  const bor = $('#borrar');
  if (bor) bor.onclick = async () => {
    if (!confirm(`¿Eliminar «${p.nombre || p.sku}»? No se puede deshacer.`)) return;
    await eliminarProducto(p, operador()); sucio = false; toast('Producto eliminado'); location.hash = '#/';
  };

  const cab = $('.cab-form');
  const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--alto-cab-form', cab.offsetHeight + 'px'));
  ro.observe(cab); ctx.alSalir(() => ro.disconnect());
  const mini = $('#riel-mini');
  const io = new IntersectionObserver(([e]) => mini.classList.toggle('on', !e.isIntersecting && e.boundingClientRect.bottom < 80), { rootMargin: '-56px 0px 0px 0px' });
  io.observe(cab); ctx.alSalir(() => io.disconnect());
  autocompletarMedidas();
  pintarFotos();
  if (esNuevo) setTimeout(() => form.elements.sku.focus({ preventScroll: true }), 100);
}

// ===== Editor de foto (hoja inferior): original contra resultado, con tres modos =====
function editorFoto(fuente, inicial = {}) {
  return new Promise((resolver) => {
    const fc = cfg.foto || {};
    let modo = inicial.modo && ['quitar_fondo', 'ajustar', 'original'].includes(inicial.modo) ? inicial.modo : (fc.modo || 'quitar_fondo');
    const estado = { original: null, recorte: null, fallo: false, ultimo: null };
    const caja = abrirModal(`
      <div class="modal-cab"><h3>Foto del <em>producto</em></h3><button type="button" class="btn-icono" id="e-cerrar" aria-label="Descartar la foto">${icono('cerrar', 22)}</button></div>
      <div class="comparar">
        <figure><figcaption>Original</figcaption><div id="e-orig" class="lienzo-foto"></div></figure>
        <figure><figcaption>Resultado</figcaption><div id="e-res" class="lienzo-foto"><span class="cargando-txt">Preparando…</span></div></figure>
      </div>
      <div id="e-prog" class="progreso" hidden><div class="barra"><i id="e-barra"></i></div><span id="e-txt"></span></div>
      <div class="segmentado" id="e-modo" role="radiogroup" aria-label="Qué hacer con la foto">
        <label><input type="radio" name="modo" value="quitar_fondo"><span>Quitar fondo</span></label>
        <label><input type="radio" name="modo" value="ajustar"><span>Solo ajustar</span></label>
        <label><input type="radio" name="modo" value="original"><span>Original</span></label>
      </div>
      <div class="opciones-foto">
        <label class="interruptor"><span>Sombra suave</span><input type="checkbox" id="e-sombra" ${fc.sombra !== false ? 'checked' : ''}><span class="pista" aria-hidden="true"></span></label>
        <label class="interruptor"><span>Mejorar luz y nitidez</span><input type="checkbox" id="e-mejorar" ${fc.mejorar !== false ? 'checked' : ''}><span class="pista" aria-hidden="true"></span></label>
      </div>
      <div class="fila-botones">
        <button type="button" class="btn grande" id="e-descartar">Descartar</button>
        <button type="button" class="btn primario grande" id="e-usar" disabled>Usar esta foto</button>
      </div>`, { cerrable: false });

    const $e = (s) => $(s, caja);
    const marcar = () => { for (const r of $$('input[name=modo]', caja)) r.checked = r.value === modo; };
    marcar();
    let turno = 0;

    async function renderizar() {
      const miTurno = ++turno;
      $e('#e-usar').disabled = true;
      try {
        if (modo === 'quitar_fondo' && !estado.recorte && !estado.fallo) {
          $e('#e-prog').hidden = false; $e('#e-txt').textContent = 'Quitando el fondo. La primera vez baja el modelo (unos 50 MB).'; $e('#e-barra').style.width = '5%';
          estado.promesa ??= quitarFondo(estado.original, (k, c, t) => {
            if (String(k).startsWith('fetch') && t) { $e('#e-barra').style.width = Math.max(5, Math.round((c / t) * 70)) + '%'; }
            else if (String(k).startsWith('compute')) { $e('#e-barra').style.width = '90%'; $e('#e-txt').textContent = 'Recortando el producto…'; }
          }).then((r) => { estado.recorte = r; }).catch((err) => {
            estado.fallo = true; console.error(err);
            toast('No pude quitar el fondo (' + (err.message || err) + '). Probá con «Solo ajustar» u «Original».', 'error');
            if (modo === 'quitar_fondo') { modo = 'ajustar'; marcar(); }
          });
          await estado.promesa;
          $e('#e-prog').hidden = true;
        } else if (modo !== 'quitar_fondo') { $e('#e-prog').hidden = true; }
        if (miTurno !== turno) return;
        const lienzo = componer(modo, estado, { tam: fc.tam || 1200, margen: fc.margen ?? 0.08, sombra: $e('#e-sombra').checked, mejorar: $e('#e-mejorar').checked });
        estado.ultimo = lienzo;
        lienzo.style.cssText = 'width:100%;height:100%;object-fit:contain';
        $e('#e-res').innerHTML = ''; $e('#e-res').appendChild(lienzo);
        $e('#e-usar').disabled = false;
      } catch (err) {
        console.error(err); toast('No se pudo procesar la foto: ' + (err.message || err), 'error');
      }
    }

    const descartar = () => { turno++; document.removeEventListener('keydown', alTeclado); cerrarModal(); resolver(null); };
    const alTeclado = (e) => { if (e.key === 'Escape') descartar(); };
    document.addEventListener('keydown', alTeclado);
    $$('input[name=modo]', caja).forEach((r) => (r.onchange = () => { modo = r.value; renderizar(); }));
    $e('#e-sombra').onchange = renderizar; $e('#e-mejorar').onchange = renderizar;
    $e('#e-descartar').onclick = descartar; $e('#e-cerrar').onclick = descartar;
    $e('#e-usar').onclick = async () => {
      $e('#e-usar').disabled = true; $e('#e-usar').classList.add('cargando');
      const blob = await codificar(estado.ultimo, fc.calidad || 0.85);
      const orig = await aBlob(estado.original, 'image/jpeg', 0.85);
      document.removeEventListener('keydown', alTeclado);
      cerrarModal(); resolver({ blob, orig, tipo: modo });
    };

    leerOriginal(fuente).then((c) => {
      estado.original = c;
      const mini = document.createElement('canvas'); mini.width = c.width; mini.height = c.height; mini.getContext('2d').drawImage(c, 0, 0);
      mini.style.cssText = 'width:100%;height:100%;object-fit:contain';
      $e('#e-orig').appendChild(mini);
      renderizar();
    }).catch((err) => { toast('No pude abrir la imagen: ' + (err.message || err), 'error'); descartar(); });
  });
}
