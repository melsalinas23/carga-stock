// Utilidades generales: DOM, números, textos, descargas y codificación para el CSV de Tienda Nube.
import { icono } from './iconos.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
// Contenido de un Blob en base64 (sin el prefijo data:), listo para mandar a la API
export const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => mal(r.error || new Error('No se pudo leer la foto'));
  r.readAsDataURL(blob);
});
export const sinTildes =(s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function slugify(s, max = 80) {
  let t = sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (t.length > max) {
    t = t.slice(0, max);
    if (t.includes('-')) t = t.replace(/-[^-]*$/, '');
    t = t.replace(/-+$/, '');
  }
  return t;
}

// Acepta "128.871,14", "128,871.14", "1500", "0,4". miles=false → el punto siempre es decimal (pesos y medidas).
export function parseNum(v, { miles = true } = {}) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c >= 0) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (p >= 0 && miles && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Formato de Tienda Nube: coma de miles y punto decimal → 128,871.14
export const fmtPrecioCSV = (n) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtPesoCSV = (n) => (n == null ? '' : n.toFixed(2));
export const fmtMedidaCSV = (n) => (n == null ? '' : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
// Formato para mostrar en pantalla (Argentina)
export const fmtARS = (n) => (n == null ? '—' : '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// El CSV de Tienda Nube se genera en Latin-1 (igual que los archivos que ya se importaron).
const REEMPLAZOS = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '•': '-', '€': 'EUR', '™': '', ' ': ' ', '​': '' };
// Reemplaza símbolos que Latin-1 no tiene (comillas curvas, guiones largos...). Va ANTES de armar el CSV.
export function limpiarTexto(str) {
  let s = '';
  for (const ch of String(str ?? '').normalize('NFC')) s += REEMPLAZOS[ch] ?? ch;
  return s;
}
export function aLatin1(str) {
  const out = [];
  for (const ch of limpiarTexto(str)) {
    const code = ch.codePointAt(0);
    out.push(code < 256 ? code : 63);
  }
  return new Uint8Array(out);
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function toast(msg, tipo = '') {
  const cont = $('#toasts');
  const d = document.createElement('div');
  d.className = 'toast ' + tipo;
  d.innerHTML = icono(tipo === 'error' ? 'alerta' : 'check', 20) + '<span></span>';
  d.querySelector('span').textContent = msg;
  cont.appendChild(d);
  setTimeout(() => d.classList.add('fuera'), tipo === 'error' ? 6000 : 2800);
  setTimeout(() => d.remove(), tipo === 'error' ? 6500 : 3300);
}

export function abrirModal(html, { cerrable = true } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-fondo"></div><div class="modal-caja" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.classList.add('con-modal');
  if (cerrable) $('.modal-fondo', m).onclick = cerrarModal;
  const caja = $('.modal-caja', m);
  caja.setAttribute('tabindex', '-1'); caja.focus({ preventScroll: true });
  return caja;
}
export function cerrarModal() {
  const m = $('#modal');
  m.hidden = true; m.innerHTML = '';
  document.body.classList.remove('con-modal');
}

const scriptsCargados = new Map();
export function cargarScript(url) {
  if (!scriptsCargados.has(url)) {
    scriptsCargados.set(url, new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = url; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => { scriptsCargados.delete(url); mal(new Error('No se pudo cargar ' + url)); };
      document.head.appendChild(s);
    }));
  }
  return scriptsCargados.get(url);
}

export const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
