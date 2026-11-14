// Usuarios y accesos (solo administración): crear usuarios, dar una clave nueva y quitar el acceso. Todo pasa por la función
// `usuarios` de Supabase, que valida en el servidor que quien llama sea administrador. Las claves nuevas las genera el
// servidor y se muestran una sola vez: la app no las guarda.
import * as remote from './remote.js';
import { $, $$, esc, toast, abrirModal, cerrarModal } from './util.js';

const MIN_CLAVE = 10;
const PERFILES = { admin: 'Administración', equipo: 'Equipo', imagenes: 'Solo imágenes' };
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso: se prueba el método viejo */ }
  try {
    const t = document.createElement('textarea');
    t.value = texto; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

// Ventana con el usuario y la clave para copiar. No se cierra tocando afuera, para no perder la clave sin querer.
function mostrarClave({ email, clave, titulo }) {
  const enlace = location.origin + location.pathname;
  const mensaje = `Entrá a ${enlace}\nUsuario: ${email}\nClave: ${clave}\nPodés cambiar la clave desde la app cuando quieras.`;
  abrirModal(`
    <h3 style="margin-top:0">${esc(titulo)}</h3>
    <p class="ayuda">Esta clave se muestra <b>una sola vez</b>: la app no la guarda. Copiala ahora y pasásela a la persona por un medio privado.</p>
    <div class="clave-caja"><span class="ayuda">Usuario</span><b>${esc(email)}</b><span class="ayuda">Clave</span><code id="u-clave">${esc(clave)}</code></div>
    <div class="fila-botones">
      <button class="btn primario" id="u-copiar" type="button">Copiar el mensaje completo</button>
      <button class="btn" id="u-copiar-clave" type="button">Copiar solo la clave</button>
      <button class="btn" id="u-listo" type="button">Listo</button>
    </div>`, { cerrable: false });
  $('#u-copiar').onclick = async () => toast((await copiar(mensaje)) ? 'Mensaje copiado' : 'No se pudo copiar: seleccionala a mano');
  $('#u-copiar-clave').onclick = async () => toast((await copiar(clave)) ? 'Clave copiada' : 'No se pudo copiar: seleccionala a mano');
  $('#u-listo').onclick = cerrarModal;
}

function confirmar({ titulo, texto, boton, peligro = false }) {
  return new Promise((ok) => {
    abrirModal(`
      <h3 style="margin-top:0">${titulo}</h3>
      <p class="ayuda">${texto}</p>
      <div class="fila-botones"><button class="btn ${peligro ? 'peligro' : 'primario'}" id="c-si" type="button">${boton}</button><button class="btn" id="c-no" type="button">Cancelar</button></div>`);
    $('#c-si').onclick = () => { cerrarModal(); ok(true); };
    $('#c-no').onclick = () => { cerrarModal(); ok(false); };
  });
}

// Cada persona cambia su propia clave (Ajustes, y el botón de arriba en el Taller de imágenes).
export function abrirCambiarClave() {
  abrirModal(`
    <h3 style="margin-top:0">Cambiar mi clave</h3>
    <p class="ayuda">Elegí una clave de al menos ${MIN_CLAVE} caracteres y guardala en un lugar seguro.</p>
    <label class="campo"><span>Clave actual</span><input id="k-act" type="password" autocomplete="current-password"></label>
    <label class="campo"><span>Clave nueva</span><input id="k-nue" type="password" autocomplete="new-password"></label>
    <label class="campo"><span>Repetí la clave nueva</span><input id="k-rep" type="password" autocomplete="new-password"></label>
    <p class="ayuda" id="k-err" role="alert" hidden style="color:var(--err)"></p>
    <div class="fila-botones"><button class="btn primario" id="k-ok" type="button">Guardar la clave nueva</button><button class="btn" id="k-no" type="button">Cancelar</button></div>`);
  const error = (t) => { const e = $('#k-err'); e.textContent = t; e.hidden = !t; };
  $('#k-no').onclick = cerrarModal;
  $('#k-ok').onclick = async () => {
    const act = $('#k-act').value, nue = $('#k-nue').value, rep = $('#k-rep').value;
    if (!act) return error('Escribí tu clave actual.');
    if (nue.length < MIN_CLAVE) return error(`La clave nueva tiene que tener al menos ${MIN_CLAVE} caracteres.`);
    if (nue.length > 72) return error('La clave nueva puede tener hasta 72 caracteres.');
    if (nue !== rep) return error('Las dos claves nuevas no coinciden.');
    if (nue === act) return error('La clave nueva tiene que ser distinta de la actual.');
    error(''); const b = $('#k-ok'); b.disabled = true;
    try { await remote.cambiarMiClave(act, nue); cerrarModal(); toast('Clave cambiada'); }
    catch (e) { error(String(e.message || e)); b.disabled = false; }
  };
}

export async function vistaUsuarios(raiz, ctx) {
  if (!(await remote.esAdmin())) {
    raiz.innerHTML = '<div class="vacio"><p><b>Solo la administración puede manejar usuarios.</b></p><a class="btn" href="#/ajustes">Volver a Ajustes</a></div>';
    return;
  }
  let datos;
  try { datos = await remote.usuarios('listar'); }
  catch (e) {
    const sinFuncion = /not found|404|Failed to send|fetch/i.test(String(e.message));
    raiz.innerHTML = `<div class="vacio"><p><b>No se pudo leer la lista de usuarios.</b></p><p>${esc(String(e.message || e))}</p>${sinFuncion ? '<p class="ayuda">Si es la primera vez, falta activar la función «usuarios» en Supabase (pasos en el LEEME, sección «Usuarios y accesos»).</p>' : ''}<a class="btn" href="#/ajustes">Volver a Ajustes</a></div>`;
    return;
  }

  const pintar = () => {
    const filas = datos.usuarios.map((u) => {
      const yo = u.email === datos.yo;
      const gestiona = u.perfil !== 'admin' && !yo;
      const estado = u.conUsuario ? (u.ultimoAcceso ? `último ingreso ${fechaHora(u.ultimoAcceso)}` : 'todavía no ingresó') : 'sin usuario creado: solo figura en la lista';
      return `<li class="usuario" data-email="${esc(u.email)}">
        <div class="usuario-dato"><b>${esc(u.email)}</b>${yo ? ' <span class="ayuda">(vos)</span>' : ''}<div class="ayuda">${esc(PERFILES[u.perfil] || u.perfil)} · ${esc(estado)}</div></div>
        ${gestiona ? `<div class="usuario-botones">${u.conUsuario ? '<button class="btn chico" data-accion="clave" type="button">Clave nueva</button>' : ''}<button class="btn chico peligro" data-accion="quitar" type="button">Quitar</button></div>` : ''}
      </li>`;
    }).join('');
    $('#u-lista').innerHTML = filas || '<li class="ayuda">Todavía no hay usuarios.</li>';
    $$('#u-lista button[data-accion]').forEach((b) => { b.onclick = () => accionSobre(b.dataset.accion, b.closest('li').dataset.email, b); });
  };

  const recargarLista = async () => { datos = await remote.usuarios('listar'); pintar(); };

  async function accionSobre(accion, email, boton) {
    if (accion === 'clave') {
      if (!(await confirmar({ titulo: `Clave nueva para ${esc(email)}`, texto: 'Se genera una clave nueva y la anterior deja de funcionar. Vas a ver la clave una sola vez.', boton: 'Generar clave nueva' }))) return;
      boton.disabled = true;
      try { const r = await remote.usuarios('cambiar-clave', { email }); mostrarClave({ email, clave: r.clave, titulo: 'Clave nueva' }); await recargarLista(); }
      catch (e) { toast(String(e.message || e), 'error'); boton.disabled = false; }
    } else if (accion === 'quitar') {
      const u = datos.usuarios.find((x) => x.email === email);
      const extra = u?.perfil === 'equipo' ? ' Los productos que cargó no se borran.' : '';
      if (!(await confirmar({ titulo: `Quitar a ${esc(email)}`, texto: `Pierde el acceso ahora mismo y se borra su usuario.${extra} Si más adelante lo necesita, se vuelve a crear.`, boton: 'Quitar usuario', peligro: true }))) return;
      boton.disabled = true;
      try { await remote.usuarios('quitar', { email }); toast('Usuario quitado'); await recargarLista(); }
      catch (e) { toast(String(e.message || e), 'error'); boton.disabled = false; }
    }
  }

  raiz.innerHTML = `
    <section class="panel">
      <h3>Crear un usuario</h3>
      <p class="ayuda">La persona entra con su mail y la clave que se genera acá. No se envía ningún mail: la clave se la pasás vos.</p>
      <label class="campo"><span>Mail</span><input id="u-mail" type="email" inputmode="email" autocomplete="off" placeholder="persona@ejemplo.com"></label>
      <div class="campo"><span id="u-perfil-et">Qué puede hacer</span>
        <div style="display:grid;gap:6px" role="radiogroup" aria-labelledby="u-perfil-et">
          <label class="item" style="display:flex;gap:8px;align-items:center;padding:10px 12px"><input type="radio" name="u-perfil" value="imagenes" checked><span><b>Solo imágenes</b> · usa el Taller de imágenes (quitar fondo, sombra y ZIP). No ve productos, fotos ni tiendas del negocio.</span></label>
          <label class="item" style="display:flex;gap:8px;align-items:center;padding:10px 12px"><input type="radio" name="u-perfil" value="equipo"><span><b>Equipo</b> · usa toda la app: productos, fotos, precios y exportación.</span></label>
        </div>
      </div>
      <details class="ayuda"><summary>Prefiero elegir yo la clave</summary>
        <label class="campo"><span>Clave (de ${MIN_CLAVE} a 72 caracteres; si la dejás vacía, se genera una segura)</span><input id="u-clave-propia" type="text" autocomplete="off" spellcheck="false"></label>
      </details>
      <p class="ayuda" id="u-err" role="alert" hidden style="color:var(--err)"></p>
      <div class="fila-botones"><button class="btn primario" id="u-crear" type="button">Crear usuario</button></div>
    </section>

    <section class="panel">
      <h3>Usuarios y accesos</h3>
      <ul id="u-lista" class="usuarios"></ul>
    </section>`;
  pintar();

  const error = (t) => { const e = $('#u-err'); e.textContent = t; e.hidden = !t; };
  $('#u-crear').onclick = async () => {
    const email = $('#u-mail').value.trim().toLowerCase();
    const perfil = ($('input[name="u-perfil"]:checked') || {}).value;
    const clave = $('#u-clave-propia').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('Escribí un mail válido.');
    if (clave && (clave.length < MIN_CLAVE || clave.length > 72)) return error(`La clave tiene que tener entre ${MIN_CLAVE} y 72 caracteres.`);
    error(''); const b = $('#u-crear'); b.disabled = true;
    try {
      const r = await remote.usuarios('crear', { email, perfil, clave: clave || undefined });
      $('#u-mail').value = ''; $('#u-clave-propia').value = '';
      await recargarLista();
      if (r.clave) mostrarClave({ email: r.email, clave: r.clave, titulo: 'Usuario creado' });
      else toast(`Usuario creado con la clave que elegiste (${r.email})`);
    } catch (e) { error(String(e.message || e)); }
    b.disabled = false;
  };
}
