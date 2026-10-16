// Ajustes: quién carga, fotos, categorías y medidas, base compartida, copias de seguridad.
import * as store from './store.js';
import * as remote from './remote.js';
import { cfg, guardarAjustes, reemplazarConfig, operador, setOperador, categoriasPrincipales, listaProveedores, guardarProveedores } from './config.js';
import { construirBackup, leerBackup } from './exportar.js';
import { esc, $, $$, toast, descargar, parseNum, abrirModal, cerrarModal, sinTildes } from './util.js';
import { icono } from './iconos.js';
import { aplicarTema, temaGuardado } from './tema.js';

const lineas = (t) => String(t).split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

export async function vistaAjustes(raiz, ctx) {
  const pend = await store.contarPendientes();
  const conectado = remote.configurado();
  const ses = conectado ? await remote.sesion() : null;
  const f = cfg.foto || {};
  const mains = categoriasPrincipales();

  raiz.innerHTML = `
  <div class="ajustes-cols">
  <section class="panel">
    <h3>Este equipo</h3>
    <label class="campo"><span>¿Quién está cargando? Queda registrado en cada producto.</span><input id="a-operador" value="${esc(operador())}" placeholder="Tu nombre" autocomplete="off"></label>
    <div class="campo"><span id="tema-et">Tema de la pantalla</span>
      <div class="segmentado tema-opciones" id="a-tema" role="radiogroup" aria-labelledby="tema-et">
        <label><input type="radio" name="tema" value="claro"><span>${icono('sol', 18)}Claro</span></label>
        <label><input type="radio" name="tema" value="oscuro"><span>${icono('luna', 18)}Oscuro</span></label>
        <label><input type="radio" name="tema" value="auto"><span>Como el celular</span></label>
      </div>
      <small>El tema claro se lee mejor con la luz fuerte del local.</small>
    </div>
  </section>

  <section class="panel">
    <h3>Fotos</h3>
    <label class="campo"><span>Modo por defecto</span>
      <select id="a-modo"><option value="quitar_fondo">Quitar fondo</option><option value="ajustar">Solo ajustar</option><option value="original">Original</option></select><small>Quitar fondo deja el producto solo sobre blanco. Solo ajustar mantiene la foto completa en un cuadrado.</small></label>
    <div class="rejilla">
      <label class="campo"><span>Tamaño (px)</span><select id="a-tam"><option>1000</option><option>1200</option><option>1600</option></select></label>
      <label class="campo"><span>Calidad WebP</span><input id="a-cal" type="range" min="0.7" max="0.95" step="0.05" value="${f.calidad || 0.85}"></label>
    </div>
    <label class="interruptor"><span>Sombra suave por defecto</span><input type="checkbox" id="a-sombra" ${f.sombra !== false ? 'checked' : ''}><span class="pista" aria-hidden="true"></span></label>
    <label class="interruptor"><span>Mejorar luz y nitidez por defecto</span><input type="checkbox" id="a-mejorar" ${f.mejorar !== false ? 'checked' : ''}><span class="pista" aria-hidden="true"></span></label>
    <button class="btn" id="a-guardar-foto">Guardar ajustes de fotos</button>
  </section>

  <section class="panel">
    <h3>Negocio: ${esc(cfg.negocio_nombre || '')}</h3>
    <label class="campo"><span>Categorías (una por línea, «Principal &gt; Sub»)</span><textarea id="a-cats" rows="8">${esc(cfg.categorias.join('\n'))}</textarea></label>
    <label class="campo"><span>Marcas (una por línea)</span><textarea id="a-marcas" rows="3">${esc((cfg.marcas || []).join('\n'))}</textarea></label>
    <div class="rejilla">
      <label class="campo"><span>Dígitos del SKU</span><input id="a-skud" inputmode="numeric" value="${cfg.sku_digitos || 0}"><small>Rellena con ceros a la izquierda (0 = no rellenar).</small></label>
      <label class="campo"><span>Sufijo del título SEO</span><input id="a-seosuf" value="${esc(cfg.seo_sufijo || '')}"></label>
    </div>
    <label class="campo"><span>Frase de cierre de las descripciones</span><textarea id="a-cierre" rows="2">${esc(cfg.frase_cierre || '')}</textarea></label>
    <details class="grupo"><summary><span>Medidas del paquete por categoría</span>${icono('chevron', 20)}</summary><div class="cont">
      <small class="ayuda">Se usan para completar solas las medidas al elegir categoría (peso kg · alto · ancho · profundidad en cm).</small>
      <div class="tabla-medidas">${mains.map((m, i) => { const v = (cfg.medidas_por_categoria || {})[m] || cfg.medidas_generales || {}; return `<div class="fila-med" data-cat="${esc(m)}"><b>${esc(m)}</b>${['peso', 'alto', 'ancho', 'prof'].map((k) => `<input data-k="${k}" inputmode="decimal" value="${v[k] ?? ''}" aria-label="${{ peso: 'Peso en kilos', alto: 'Alto en centímetros', ancho: 'Ancho en centímetros', prof: 'Profundidad en centímetros' }[k]}" placeholder="${{ peso: 'kg', alto: 'alto', ancho: 'ancho', prof: 'prof.' }[k]}">`).join('')}</div>`; }).join('')}</div>
    </div></details>
    <button class="btn primario" id="a-guardar-neg">Guardar datos del negocio</button>
  </section>

  <section class="panel">
    <h3>Proveedores <span class="ayuda" id="p-cuenta"></span></h3>
    <p class="ayuda">Quedan guardados en la cuenta: lo que cargues acá lo ven todos los que cargan productos. Tocá uno para ver o editar sus datos de contacto.</p>
    <input id="p-buscar" type="search" placeholder="Buscar proveedor" autocomplete="off">
    <div id="p-lista" class="items"></div>
    <div class="fila-botones">
      <button class="btn primario" id="p-nuevo">${icono('mas', 20)}Agregar proveedor</button>
      <label class="btn">Importar<input type="file" id="p-imp" accept=".json,.csv" hidden></label>
      <button class="btn" id="p-exp">Descargar lista</button>
    </div>
  </section>

  <section class="panel">
    <h3>Base compartida (varios teléfonos y computadoras)</h3>
    <div id="nube"></div>
  </section>

  <section class="panel">
    <h3>Copia de seguridad</h3>
    <p class="ayuda">Descarga todos los productos y fotos de este equipo en un ZIP. Útil antes de cambiar de teléfono o si trabajás sin la base compartida.</p>
    <div class="fila-botones">
      <button class="btn" id="a-backup">Descargar copia</button>
      <label class="btn">Restaurar copia<input type="file" id="a-restaurar" accept=".zip" hidden></label>
    </div>
    <div id="a-prog" class="progreso" hidden><div class="barra"><i id="a-barra"></i></div><span id="a-txt"></span></div>
  </section>

  <section class="panel">
    <h3>Configuración del negocio (para usar la app con otro comercio)</h3>
    <div class="fila-botones">
      <button class="btn" id="a-cfg-exp">Descargar configuración</button>
      <label class="btn">Cargar configuración<input type="file" id="a-cfg-imp" accept=".json" hidden></label>
    </div>
  </section>
  </div>
  <div class="firma"><img src="img/kai-logo.png" alt="Marketing KAI"><span>Una herramienta de Marketing KAI</span></div>
  <p class="version">Carga de productos · v1 · ${pend} pendiente${pend === 1 ? '' : 's'} de sincronizar</p>`;

  $$('#a-tema input').forEach((r) => { r.checked = r.value === temaGuardado(); r.onchange = () => { aplicarTema(r.value); toast('Tema cambiado'); }; });
  $('#a-modo').value = f.modo || 'quitar_fondo';
  $('#a-tam').value = String(f.tam || 1200);
  $('#a-operador').onchange = (e) => { setOperador(e.target.value); toast('Guardado'); };

  $('#a-guardar-foto').onclick = async () => {
    await guardarAjustes({ foto: { modo: $('#a-modo').value, tam: +$('#a-tam').value, calidad: +$('#a-cal').value, sombra: $('#a-sombra').checked, mejorar: $('#a-mejorar').checked } });
    toast('Ajustes de fotos guardados');
  };

  $('#a-guardar-neg').onclick = async () => {
    const med = { ...(cfg.medidas_por_categoria || {}) };
    $$('.fila-med').forEach((fila) => {
      const o = {};
      $$('input', fila).forEach((i) => { o[i.dataset.k] = parseNum(i.value, { miles: false }); });
      if (Object.values(o).every((v) => v != null)) med[fila.dataset.cat] = o;
    });
    const cats = $('#a-cats').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    await guardarAjustes({
      categorias: cats.length ? cats : cfg.categorias,
      marcas: lineas($('#a-marcas').value),
      sku_digitos: parseInt($('#a-skud').value, 10) || 0, seo_sufijo: $('#a-seosuf').value, frase_cierre: $('#a-cierre').value.trim(),
      medidas_por_categoria: med,
    });
    toast('Datos del negocio guardados'); ctx.recargar();
  };

  // ----- proveedores (se guardan en la cuenta) -----
  let provs = listaProveedores().map((p) => ({ ...p }));
  const claveP = (n) => sinTildes(n).toLowerCase().trim();
  const guardarProvs = async () => {
    provs.sort((a, b) => claveP(a.nombre).localeCompare(claveP(b.nombre), 'es'));
    await guardarProveedores(provs);
  };
  function pintarProvs() {
    const q = claveP($('#p-buscar').value);
    const lista = provs.filter((p) => !q || claveP(`${p.nombre} ${p.tel || ''} ${p.whatsapp || ''} ${p.mail || ''}`).includes(q));
    $('#p-cuenta').textContent = `(${provs.length})`;
    $('#p-lista').innerHTML = lista.length ? lista.slice(0, 200).map((p) => {
      const datos = [p.tel && `Tel. ${p.tel}`, p.whatsapp && `WhatsApp ${p.whatsapp}`, p.mail].filter(Boolean).join(' · ');
      return `<button type="button" class="item prov" data-n="${esc(p.nombre)}"><div><b>${esc(p.nombre)}</b>${datos ? `<div class="ayuda">${esc(datos)}</div>` : '<div class="ayuda">Sin datos de contacto</div>'}</div></button>`;
    }).join('') + (lista.length > 200 ? '<div class="ayuda">Mostrando 200. Usá la búsqueda.</div>' : '') : '<div class="vacio">Ningún proveedor coincide.</div>';
    $$('#p-lista .prov').forEach((b) => (b.onclick = () => editarProv(provs.find((p) => p.nombre === b.dataset.n))));
  }
  function editarProv(p) {
    const nuevo = !p; p = p || { nombre: '', tel: '', whatsapp: '', mail: '', direccion: '', nota: '' };
    const campo = (k, t, ph = '') => `<label class="campo"><span>${t}</span><input data-k="${k}" value="${esc(p[k] || '')}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
    const caja = abrirModal(`<h3>${nuevo ? 'Nuevo <em>proveedor</em>' : 'Proveedor'}</h3>
      ${campo('nombre', 'Nombre')}${campo('tel', 'Teléfono')}${campo('whatsapp', 'WhatsApp (y con quién hablar)')}${campo('mail', 'Mail')}${campo('direccion', 'Dirección')}
      <label class="campo"><span>Notas (vacaciones, condiciones de pago...)</span><textarea data-k="nota" rows="2">${esc(p.nota || '')}</textarea></label>
      <div class="fila-botones">${nuevo ? '' : '<button class="btn peligro" id="pv-borrar">Eliminar</button>'}<button class="btn" id="pv-cancelar">Cancelar</button><button class="btn primario" id="pv-ok">Guardar</button></div>`);
    $('#pv-cancelar', caja).onclick = cerrarModal;
    $('#pv-ok', caja).onclick = async () => {
      const dato = {}; $$('[data-k]', caja).forEach((i) => { dato[i.dataset.k] = i.value.trim(); });
      if (!dato.nombre) { toast('Falta el nombre', 'error'); return; }
      if (nuevo && provs.some((x) => claveP(x.nombre) === claveP(dato.nombre))) { toast('Ya existe un proveedor con ese nombre', 'error'); return; }
      if (nuevo) provs.push(dato); else Object.assign(p, dato);
      await guardarProvs(); cerrarModal(); pintarProvs(); toast('Proveedor guardado');
    };
    const bor = $('#pv-borrar', caja);
    if (bor) bor.onclick = async () => { if (!confirm(`¿Eliminar a ${p.nombre} de la lista?`)) return; provs = provs.filter((x) => x !== p); await guardarProvs(); cerrarModal(); pintarProvs(); };
  }
  function leerCSVProv(texto) {
    const filas = texto.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(l.includes(';') ? ';' : ',').map((x) => x.trim().replace(/^"|"$/g, '')));
    const enc = filas.shift().map((h) => claveP(h));
    const col = (k) => enc.findIndex((h) => h.startsWith(k));
    const idx = { nombre: col('nombre') >= 0 ? col('nombre') : col('proveedor'), tel: col('tel'), whatsapp: col('whats'), mail: col('mail') >= 0 ? col('mail') : col('correo'), direccion: col('direc'), nota: col('nota') };
    return filas.map((f) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? f[i] || '' : '']))).filter((p) => p.nombre);
  }
  $('#p-buscar').oninput = pintarProvs;
  $('#p-nuevo').onclick = () => editarProv(null);
  $('#p-exp').onclick = () => descargar(new Blob([JSON.stringify({ tipo: 'proveedores', version: 1, proveedores: provs }, null, 1)], { type: 'application/json' }), 'proveedores.json');
  $('#p-imp').onchange = async (e) => {
    const arch = e.target.files[0]; e.target.value = ''; if (!arch) return;
    try {
      const txt = await arch.text();
      const entrantes = arch.name.toLowerCase().endsWith('.csv') ? leerCSVProv(txt) : (() => { const j = JSON.parse(txt); return Array.isArray(j) ? j : j.proveedores; })();
      if (!entrantes?.length) throw new Error('No encontré proveedores en el archivo');
      let nuevos = 0, actualizados = 0;
      for (const en of entrantes.map((x) => (typeof x === 'string' ? { nombre: x } : x))) {
        if (!en.nombre) continue;
        const ex = provs.find((p) => claveP(p.nombre) === claveP(en.nombre));
        if (ex) { for (const k of ['tel', 'whatsapp', 'mail', 'direccion', 'nota']) if (en[k]) ex[k] = en[k]; actualizados++; }
        else { provs.push({ nombre: en.nombre, tel: en.tel || '', whatsapp: en.whatsapp || '', mail: en.mail || '', direccion: en.direccion || '', nota: en.nota || '' }); nuevos++; }
      }
      await guardarProvs(); pintarProvs(); toast(`Proveedores: ${nuevos} nuevos, ${actualizados} actualizados`);
    } catch (err) { toast('No se pudo importar: ' + err.message, 'error'); }
  };
  pintarProvs();

  // ----- base compartida -----
  const nube = $('#nube');
  if (!conectado) {
    nube.innerHTML = `
      <p class="ayuda">Sin base compartida, los productos se guardan solo en este equipo. Para que varias personas carguen desde distintos teléfonos o computadoras, conectá la base (se hace una vez; ver LEEME).</p>
      <label class="campo"><span>URL del proyecto</span><input id="n-url" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>
      <label class="campo"><span>Clave pública (anon key)</span><input id="n-key" placeholder="eyJ..." autocomplete="off"></label>
      <button class="btn primario" id="n-conectar">Conectar</button>`;
    $('#n-conectar').onclick = () => {
      const url = $('#n-url').value.trim(), key = $('#n-key').value.trim();
      if (!/^https:\/\/.+\..+/.test(url) || key.length < 20) { toast('Revisá la URL y la clave', 'error'); return; }
      localStorage.setItem('sb_url', url); localStorage.setItem('sb_key', key); location.reload();
    };
  } else {
    const e = store.getEstadoSync();
    nube.innerHTML = `
      <p>Estado: <b>${ses ? esc(e.texto) : 'sin iniciar sesión'}</b>${ses ? ` · ${esc(ses.user.email)}` : ''}</p>
      <div class="fila-botones">
        ${ses ? `<button class="btn primario" id="n-sync">Sincronizar ahora</button><button class="btn" id="n-salir">Cerrar sesión</button>` : `<a class="btn primario" href="#/login">Iniciar sesión</a>`}
        ${localStorage.getItem('sb_url') ? '<button class="btn peligro" id="n-desc">Desconectar</button>' : ''}
      </div>`;
    const bs = $('#n-sync'); if (bs) bs.onclick = async () => { bs.disabled = true; const r = await store.sincronizar(); toast(r.ok ? `Sincronizado (${r.subidos} subidos, ${r.bajados} bajados)` : 'No se pudo sincronizar: ' + (r.motivo || (r.errores || []).join('; ')), r.ok ? '' : 'error'); ctx.recargar(); };
    const sal = $('#n-salir'); if (sal) sal.onclick = async () => { await remote.salir(); location.hash = '#/login'; location.reload(); };
    const des = $('#n-desc'); if (des) des.onclick = () => { if (confirm('¿Desconectar la base compartida de este equipo? Los productos locales no se borran.')) { localStorage.removeItem('sb_url'); localStorage.removeItem('sb_key'); location.reload(); } };
  }

  // ----- copias -----
  const prog = (n, t, txt) => { $('#a-prog').hidden = false; $('#a-barra').style.width = Math.round((n / t) * 100) + '%'; $('#a-txt').textContent = `${txt} ${n}/${t}`; };
  $('#a-backup').onclick = async () => {
    try { const z = await construirBackup((n, t) => prog(n, t, 'Armando la copia…')); descargar(z, `copia-productos-${new Date().toISOString().slice(0, 10)}.zip`); toast('Copia descargada'); }
    catch (e) { toast('No se pudo armar la copia: ' + e.message, 'error'); }
    $('#a-prog').hidden = true;
  };
  $('#a-restaurar').onchange = async (e) => {
    const arch = e.target.files[0]; e.target.value = ''; if (!arch) return;
    if (!confirm('Se van a agregar (o actualizar) los productos de la copia. ¿Seguir?')) return;
    try {
      const prods = await leerBackup(arch);
      for (const p of prods) await store.guardarProducto(p, operador());
      toast(`Se restauraron ${prods.length} productos`);
    } catch (err) { toast('Copia inválida: ' + err.message, 'error'); }
  };

  $('#a-cfg-exp').onclick = () => descargar(new Blob([JSON.stringify(cfg, null, 1)], { type: 'application/json' }), `configuracion-${cfg.id || 'negocio'}.json`);
  $('#a-cfg-imp').onchange = async (e) => {
    const arch = e.target.files[0]; e.target.value = ''; if (!arch) return;
    try {
      const obj = JSON.parse(await arch.text());
      if (!Array.isArray(obj.categorias)) throw new Error('El archivo no tiene categorías');
      if (!confirm('Esto reemplaza la configuración actual del negocio. ¿Seguir?')) return;
      await reemplazarConfig(obj); toast('Configuración cargada'); ctx.recargar();
    } catch (err) { toast('No se pudo leer: ' + err.message, 'error'); }
  };
}

export async function vistaLogin(raiz, ctx, opciones) {
  const op = opciones && typeof opciones === 'object' ? opciones : {};
  raiz.innerHTML = `
  <section class="login-pantalla">
    <h2>${op.obligatorio ? 'Acceso <em>privado</em>' : 'Iniciar <em>sesión</em>'}</h2>
    <p class="ayuda">${op.obligatorio ? 'Esta aplicación es de uso interno. Ingresá con el mail y la clave que te dieron.' : 'Usá el mail y la clave que te dieron para cargar productos junto al resto del equipo.'}</p>
    <label class="campo"><span>Mail</span><input id="l-mail" type="email" autocomplete="username"></label>
    <label class="campo"><span>Clave</span><input id="l-pass" type="password" autocomplete="current-password"></label>
    <div class="fila-botones"><button class="btn primario grande" id="l-ok">Entrar</button>${op.obligatorio ? '' : '<a class="btn" href="#/">Seguir sin iniciar sesión</a>'}</div>
    ${op.obligatorio ? '' : '<small class="ayuda">Sin iniciar sesión podés cargar productos igual: quedan en este equipo y se suben cuando entres.</small>'}
  </section>`;
  const entrar = async () => {
    const boton = $('#l-ok'); boton.classList.add('cargando');
    try {
      await remote.entrar($('#l-mail').value, $('#l-pass').value);
      if (op.alEntrar) { await op.alEntrar(); return; }
      toast('Sesión iniciada'); await ctx.alIniciarSesion?.(); ctx.ir('#/');
    } catch (e) { boton.classList.remove('cargando'); toast('No se pudo entrar: ' + (/invalid login/i.test(e.message || '') ? 'mail o clave incorrectos.' : (e.message || e)), 'error'); }
  };
  $('#l-ok').onclick = entrar;
  $('#l-pass').onkeydown = (e) => { if (e.key === 'Enter') entrar(); };
  setTimeout(() => $('#l-mail').focus({ preventScroll: true }), 80);
}
