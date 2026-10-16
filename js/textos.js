// Sugerencias de descripción y SEO armadas con reglas (sin IA): rápidas, gratis y editables.
import { cfg, principalDe } from './config.js';

const corte = (s, max) => {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:\-–]+$/, '');
};

export function sugerirTextos(p) {
  const nombre = (p.nombre || '').trim();
  const marca = (p.marca || '').trim();
  const frase = cfg.frases_por_categoria?.[principalDe(p.categoria)] || '';
  const cierre = cfg.frase_cierre || '';
  const atributos = (p.props || []).filter((x) => x?.n?.trim() && x?.v?.trim()).map((x) => `- **${x.n.trim()}:** ${x.v.trim()}`);

  const descripcion = [
    `**${nombre}**${marca ? ' de ' + marca : ''}.`,
    frase,
    atributos.join('\n'),
    cierre,
  ].filter(Boolean).join('\n\n');

  const suf = cfg.seo_sufijo || '';
  const seo_titulo = (nombre + suf).length <= 70 ? nombre + suf : corte(nombre, 70);

  const base = [nombre + (marca ? ` ${marca}` : '') + '.', frase, cierre].filter(Boolean).join(' ');
  const seo_desc = corte(base, 320);

  return { descripcion, seo_titulo, seo_desc };
}
