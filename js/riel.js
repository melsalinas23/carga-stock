// El riel de avance: seis segmentos que muestran qué falta para dejar un producto listo.
import { esc } from './util.js';

export const PASOS_AVANCE = [
  { k: 'foto', t: 'Foto' }, { k: 'sku', t: 'SKU' }, { k: 'nombre', t: 'Nombre' },
  { k: 'categoria', t: 'Categoría' }, { k: 'precio', t: 'Precio' }, { k: 'medidas', t: 'Medidas' },
];

export function avance(p) {
  const hecho = {
    foto: (p.fotos || []).length > 0,
    sku: !!String(p.sku || '').trim(),
    nombre: !!String(p.nombre || '').trim(),
    categoria: !!p.categoria,
    precio: p.precio > 0,
    medidas: p.peso > 0 && p.alto > 0 && p.ancho > 0 && p.prof > 0,
  };
  const pasos = PASOS_AVANCE.map((x) => ({ ...x, ok: hecho[x.k] }));
  const faltan = pasos.filter((x) => !x.ok);
  return { pasos, faltan, hechos: pasos.length - faltan.length, completo: faltan.length === 0 };
}

export const textoFaltan = (a) =>
  a.completo ? 'Completo' : `${a.faltan.length === 1 ? 'Falta' : 'Faltan'} ${a.faltan.length}: ${a.faltan.map((x) => x.t).join(', ')}`;

// Versión de lista (solo dibujo) o de formulario (cada segmento es un botón que lleva al campo).
export function rielHTML(p, { interactivo = false } = {}) {
  const a = avance(p);
  const etiqueta = `Avance ${a.hechos} de ${a.pasos.length}. ${textoFaltan(a)}`;
  const seg = (x) => interactivo
    ? `<li><button type="button" class="seg ${x.ok ? 'ok' : ''}" data-ir="${x.k}" aria-label="${esc(x.t)}: ${x.ok ? 'listo' : 'falta'}"><span>${esc(x.t)}</span></button></li>`
    : `<li class="seg ${x.ok ? 'ok' : ''}"></li>`;
  return `<ol class="riel ${interactivo ? 'riel-form' : ''} ${a.completo ? 'completo' : ''}" ${interactivo ? '' : `role="img" aria-label="${esc(etiqueta)}"`}>${a.pasos.map(seg).join('')}</ol>`;
}
