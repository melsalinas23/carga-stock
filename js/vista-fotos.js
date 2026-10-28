// Fotos rápidas: se escribe el SKU, la app muestra el producto de la tienda, se sacan o eligen las fotos y se suben directo a Tienda Nube.
// La cola de fotos vive solo en este equipo y se borra apenas Tienda Nube confirma la subida.
import * as remote from './remote.js';
import { getMeta, setMeta } from './store.js';
import { normSku } from './config.js';
import { editorFoto } from './vista-producto.js';
import { extDe } from './imagen.js';
import { icono } from './iconos.js';
import { $, $$, esc, toast, uid, aBase64 } from './util.js';
import { tiendas, tiendaActual, fijarTienda, tiendasConectadas, selectorTiendaHtml } from './tn.js';

const COLA = 'fotos_rapidas_cola';      // [{ id, sku, tienda, nombre, productoId, enTienda, reemplazar, fotos: [{ id, ext, blob }], estado, error }]
const HISTORIAL = 'fotos_rapidas_hoy';  // [{ sku, nombre, n, tienda, ts }]
const hora = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export async function vistaFotos(raiz, ctx) {
  if (!tiendas().length || !remote.configurado() || !(await remote.sesion())) {
    raiz.innerHTML = `<div class="vacio"><p><b>Esta función necesita iniciar sesión.</b></p><p>Entrá con tu mail para subir fotos directo a Tienda Nube.</p><a class="btn primario" href="#/login">Iniciar sesión</a></div>`;
    return;
  }
  let conectadas = [];
  try { conectadas = await tiendasConectadas(); } catch (e) { toast('No se pudo consultar la conexión con Tienda Nube: ' + (e.message || e), 'error'); }

  let actual = tiendaActual();
  let cola = (await getMeta(COLA)) || [];
  let historial = ((await getMeta(HISTORIAL)) || []).filter((h) => Date.now() - h.ts < 24 * 3600 * 1000);
  for (const it of cola) if (it.estado === 'subiendo') { it.estado = 'error'; it.error = 'Se interrumpió la subida. Reintentá.'; }
  let item = cola.find((x) => x.estado === 'en-curso') || null;
  let aviso = null;
  let ocupado = false;
  const urls = [];

  const guardarCola = () => setMeta(COLA, cola);
  const miniatura = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
  ctx.alSalir?.(() => urls.forEach((u) => URL.revokeObjectURL(u)));

  function pintar() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const pendientes = cola.filter((x) => x.estado === 'error');
    raiz.innerHTML = `
      <div class="exp-cols">
        <section class="panel paso">
          <div>
            ${selectorTiendaHtml(actual, conectadas)}
            ${item ? bloqueProducto() : bloqueSku()}
            ${aviso ? `<p class="${aviso.mal ? 'rojo' : 'ayuda'}" style="margin:10px 0 0"><b>${esc(aviso.txt)}</b></p>` : ''}
          </div>
        </section>
        <div class="col-der">
          ${pendientes.length ? `<section class="panel paso"><div><h3 class="paso-t">Pendientes de subir</h3>
            <p class="ayuda">Estas fotos no llegaron a la tienda. Quedan guardadas en este equipo hasta que se suban.</p>
            <ul class="ayuda" style="padding-left:0;list-style:none;display:grid;gap:10px">${pendientes.map((x) => `
              <li><b class="num">${esc(x.sku)}</b> · ${esc(x.nombre || '')} · ${x.fotos.length} foto${x.fotos.length === 1 ? '' : 's'}<br><span class="rojo">${esc(x.error || '')}</span>
              <div class="fila-botones" style="margin:6px 0 0"><button class="btn chico" data-reintentar="${x.id}">Reintentar</button><button class="btn chico fantasma" data-descartar="${x.id}">Descartar</button></div></li>`).join('')}</ul></div></section>` : ''}
          <section class="panel paso"><div><h3 class="paso-t">Subidas de hoy</h3>
            ${historial.length ? `<ul class="ayuda" style="padding-left:18px;margin:0">${historial.map((h) => `<li><b class="num">${esc(h.sku)}</b> · ${esc(h.nombre || '')} · ${h.n} foto${h.n === 1 ? '' : 's'} · ${hora(h.ts)}</li>`).join('')}</ul>` : '<p class="ayuda" style="margin:0">Todavía no subiste fotos hoy.</p>'}
          </div></section>
        </div>
      </div>`;
    enlazar();
  }

  function bloqueSku() {
    return `<h3 class="paso-t"><span class="nro" aria-hidden="true">1</span>¿De qué producto es la foto?</h3>
      <form id="f-sku" autocomplete="off">
        <label class="campo" style="margin:0 0 10px"><span>SKU</span><input id="i-sku" type="text" inputmode="text" autocapitalize="characters" enterkeyhint="search" placeholder="Escribí el SKU del producto" ${ocupado ? 'disabled' : ''}></label>
        <div class="fila-botones col"><button class="btn primario" type="submit" id="b-buscar" ${ocupado ? 'disabled' : ''}>${icono('buscar', 20)}Buscar producto</button></div>
      </form>
      <p class="ayuda" style="margin:10px 0 0">La app busca el producto en la tienda y te muestra su nombre para que confirmes que es el correcto.</p>`;
  }

  function bloqueProducto() {
    const n = item.fotos.length;
    return `<h3 class="paso-t"><span class="nro" aria-hidden="true">2</span>Sacá o elegí las fotos</h3>
      <div class="item" style="display:block;margin:0 0 10px"><span class="sku num">${esc(item.sku)}</span> <span class="estado ${item.publicado ? 'e-cargado' : 'e-borrador'}">${item.publicado ? 'Visible' : 'Oculto'}</span>
        <div><b>${esc(item.nombre)}</b></div>
        <div class="ayuda">${item.enTienda ? `Ya tiene ${item.enTienda} foto${item.enTienda === 1 ? '' : 's'} en la tienda.` : 'Todavía no tiene fotos en la tienda.'}</div>
        <button type="button" class="btn chico fantasma" id="b-otro" style="margin-top:8px" ${ocupado ? 'disabled' : ''}>No es este producto</button></div>
      <div class="fotos" id="fotos-rapidas">${item.fotos.map((f, i) => `
        <div class="foto" data-i="${i}"><img src="${miniatura(f.blob)}" alt="Foto ${i + 1}">
          ${i === 0 && !item.enTienda ? '<span class="etq">Principal</span>' : ''}
          <div class="acc"><button type="button" data-quitar="${i}" aria-label="Quitar la foto ${i + 1}">${icono('papelera', 20)}</button></div></div>`).join('')}</div>
      <div class="btns-foto">
        <label class="btn primario">${icono('camara', 22)}<span>Sacar foto</span><input id="in-cam" type="file" accept="image/*" capture="environment" ${ocupado ? 'disabled' : ''}></label>
        <label class="btn">${icono('imagen', 22)}<span>Galería</span><input id="in-gal" type="file" accept="image/*" multiple ${ocupado ? 'disabled' : ''}></label>
      </div>
      ${item.enTienda ? `<label class="ayuda" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="c-reemp" ${item.reemplazar ? 'checked' : ''}> Reemplazar las ${item.enTienda} foto${item.enTienda === 1 ? '' : 's'} que ya tiene</label>` : ''}
      <div class="fila-botones col" style="margin-top:12px"><button class="btn primario grande" id="b-subir" ${n && !ocupado ? '' : 'disabled'}>${icono('check', 20)}${ocupado ? 'Subiendo…' : `Subir ${n} foto${n === 1 ? '' : 's'} a Tienda Nube`}</button></div>`;
  }

  function enlazar() {
    const sel = $('#tn-tienda');
    if (sel) sel.onchange = () => { fijarTienda(sel.value); actual = tiendas().find((t) => t.id === sel.value) || actual; aviso = null; pintar(); };
    const f = $('#f-sku');
    if (f) { f.onsubmit = (e) => { e.preventDefault(); buscarSku($('#i-sku').value); }; if (!ocupado) setTimeout(() => $('#i-sku')?.focus({ preventScroll: true }), 50); }
    $('#b-otro') && ($('#b-otro').onclick = descartarActual);
    $('#in-cam') && ($('#in-cam').onchange = (e) => { const a = [...e.target.files]; e.target.value = ''; agregar(a); });
    $('#in-gal') && ($('#in-gal').onchange = (e) => { const a = [...e.target.files]; e.target.value = ''; agregar(a); });
    $$('[data-quitar]').forEach((b) => (b.onclick = async () => { item.fotos.splice(+b.dataset.quitar, 1); await guardarCola(); pintar(); }));
    $('#c-reemp') && ($('#c-reemp').onchange = async (e) => { item.reemplazar = e.target.checked; await guardarCola(); });
    $('#b-subir') && ($('#b-subir').onclick = () => subir(item));
    $$('[data-reintentar]').forEach((b) => (b.onclick = () => subir(cola.find((x) => x.id === b.dataset.reintentar))));
    $$('[data-descartar]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Descartar estas fotos? No se van a subir y se borran de este equipo.')) return;
      cola = cola.filter((x) => x.id !== b.dataset.descartar); await guardarCola(); pintar();
    }));
  }

  async function buscarSku(valor) {
    const sku = normSku(String(valor || '').trim());
    if (!sku || ocupado) return;
    ocupado = true; aviso = { txt: 'Buscando el producto…' }; pintar();
    try {
      const r = await remote.tiendaNube('buscar', { tienda: actual.id, sku });
      if (!r.existe) aviso = { mal: true, txt: `No hay ningún producto con el SKU ${sku} en «${actual.nombre}». Revisá el número.` };
      else {
        item = { id: uid(), sku, tienda: actual.id, nombre: r.nombre, productoId: r.id, enTienda: r.fotos.length, publicado: r.publicado, reemplazar: false, fotos: [], estado: 'en-curso', error: '' };
        cola.push(item); await guardarCola(); aviso = null;
      }
    } catch (e) { aviso = { mal: true, txt: e.message }; }
    ocupado = false; pintar();
  }

  async function agregar(archivos) {
    for (const archivo of archivos) {
      const r = await editorFoto(archivo);
      if (!r) continue;
      item.fotos.push({ id: uid(), ext: extDe(r.blob), blob: r.blob });
      await guardarCola(); pintar();
    }
  }

  async function descartarActual() {
    if (item.fotos.length && !confirm('Hay fotos sin subir. ¿Descartarlas y cambiar de producto?')) return;
    cola = cola.filter((x) => x.id !== item.id); item = null; aviso = null; await guardarCola(); pintar();
  }

  async function subir(it) {
    if (!it || ocupado) return;
    if (it.reemplazar && it.enTienda && !confirm(`Se van a borrar las ${it.enTienda} foto${it.enTienda === 1 ? '' : 's'} que ya tiene «${it.nombre}» en la tienda y se reemplazan por las nuevas. ¿Seguir?`)) return;
    ocupado = true; aviso = { txt: 'Subiendo las fotos…' }; if (item === it) pintar();
    try {
      // los bytes se leen antes de tocar el almacenamiento: en iPhone los Blob de IndexedDB pueden quedar inválidos tras guardar
      const cargas = [];
      for (const f of it.fotos) cargas.push({ id: f.id, ext: f.ext, base64: await aBase64(f.blob) });
      it.estado = 'subiendo'; it.error = '';
      const enT = await remote.tiendaNube('buscar', { tienda: it.tienda, sku: it.sku });
      if (!enT.existe) throw new Error(`El SKU ${it.sku} ya no está en la tienda.`);
      let posicion = it.reemplazar ? 0 : enT.fotos.length;
      if (it.reemplazar && enT.fotos.length) { await remote.tiendaNube('borrar-fotos', { tienda: it.tienda, producto: enT.id }); it.reemplazar = false; }
      for (const c of cargas) {
        const base = posicion;
        await remote.tiendaNube('subir-foto', { tienda: it.tienda, producto: enT.id, nombre: `${it.sku}${base ? `_${base + 1}` : ''}.${c.ext}`, base64: c.base64, posicion: ++posicion });
        it.fotos = it.fotos.filter((f) => f.id !== c.id);
      }
      cola = cola.filter((x) => x.id !== it.id); await guardarCola();
      historial.unshift({ sku: it.sku, nombre: enT.nombre, n: cargas.length, tienda: it.tienda, ts: Date.now() });
      await setMeta(HISTORIAL, historial.slice(0, 100));
      if (item === it) item = null;
      aviso = { txt: `Listo: ${cargas.length} foto${cargas.length === 1 ? '' : 's'} en «${enT.nombre}».` };
      toast(aviso.txt);
    } catch (e) {
      it.estado = 'error'; it.error = e.message || String(e);
      await guardarCola();
      if (item === it) { item = null; }
      aviso = { mal: true, txt: `No se pudo subir ${it.sku}: ${it.error} Las fotos quedaron guardadas en «Pendientes».` };
    }
    ocupado = false; pintar();
  }

  pintar();
}
