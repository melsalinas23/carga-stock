// Procesa una foto sin pantalla, con las mismas opciones del editor de fotos. Lo usa la carga masiva.
import { leerOriginal, quitarFondo, componer, codificar, codificarComo, aBlob } from './imagen.js';
import { cfg } from './config.js';

export const MODOS_FOTO = [
  { id: 'quitar_fondo', titulo: 'Quitar el fondo', ayuda: 'El producto se recorta y queda centrado sobre fondo blanco, igual que las fotos ya subidas. Para fotos sacadas con un celular. Tarda unos segundos por foto.' },
  { id: 'ajustar', titulo: 'Solo ajustar', ayuda: 'La foto completa queda en un cuadrado del mismo tamaño que las demás, con luz y nitidez mejoradas, sin tocar el fondo. Para fotos con fondo prolijo.' },
  { id: 'tal_cual', titulo: 'Subir tal cual', ayuda: 'No se modifica la foto (solo se achica si pesa más de 4 MB; las HEIC del iPhone se convierten). Para fotos ya editadas por un profesional.' },
];
const TAL_CUAL_MAX = 4 * 1024 * 1024;

// Devuelve { blob, orig, tipo, aviso }: la foto lista para subir, la original achicada (para volver a editarla) y el modo que se usó.
export async function procesarFoto(archivo, modo) {
  const fc = cfg.foto || {};
  if (modo === 'tal_cual' && /^image\/(jpeg|png|webp)$/.test(archivo.type) && archivo.size <= TAL_CUAL_MAX) {
    return { blob: archivo, orig: null, tipo: 'original', aviso: '' };
  }
  const original = await leerOriginal(archivo);
  let modoFinal = modo === 'tal_cual' ? 'original' : modo;
  let recorte = null, aviso = '';
  if (modoFinal === 'quitar_fondo') {
    try { recorte = await quitarFondo(original); }
    catch (e) { console.error(e); modoFinal = 'ajustar'; aviso = 'no se pudo quitar el fondo, quedó solo ajustada'; }
  }
  const lienzo = componer(modoFinal, { original, recorte }, { tam: fc.tam || 1200, margen: fc.margen ?? 0.08, sombra: fc.sombra !== false, mejorar: fc.mejorar !== false });
  return { blob: await codificar(lienzo, fc.calidad || 0.85), orig: await aBlob(original, 'image/jpeg', 0.85), tipo: modoFinal, aviso };
}

// Taller de imágenes: quitar fondo (opcional), centrar en un cuadrado, sombra a elección y formato de salida a elección.
// opciones: quitar (true/false) · fondo 'blanco' | 'transparente' · sombra 0/1/2 · tam (px) · margen · mejorar · formato 'jpg' | 'webp' | 'png'
// Devuelve { blob, ext, modo, aviso }. Con fondo transparente la salida es siempre PNG.
export async function procesarTaller(archivo, { quitar = true, fondo = 'blanco', sombra = 1, tam = 1200, margen = 0.08, mejorar = true, formato = 'jpg' } = {}) {
  const original = await leerOriginal(archivo, Math.min(2400, Math.max(1600, tam)));
  let modo = quitar ? 'quitar_fondo' : 'ajustar', recorte = null, aviso = '';
  if (modo === 'quitar_fondo') {
    try { recorte = await quitarFondo(original); }
    catch (e) { console.error(e); modo = 'ajustar'; aviso = 'no se pudo quitar el fondo: quedó solo ajustada'; }
  }
  const transparente = modo === 'quitar_fondo' && fondo === 'transparente';
  const lienzo = componer(modo, { original, recorte }, { tam, margen, sombra, mejorar, fondo: transparente ? 'transparente' : 'blanco' });
  const blob = await codificarComo(lienzo, transparente ? 'png' : formato, 0.92);
  return { blob, ext: blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg', modo, aviso };
}
