// Íconos dibujados a mano (SVG, trazo 1,75, puntas redondas): un solo juego para toda la app.
const P = {
  lista: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17.5" r=".9"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  exportar: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  ajustes: '<path d="M4 8h9M18 8h2M4 16h2M11 16h9"/><circle cx="15.5" cy="8" r="2.3"/><circle cx="8.5" cy="16" r="2.3"/>',
  camara: '<path d="M4.5 8.5h2.7l1.6-2.5h6.4l1.6 2.5h2.7a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.3" r="3.4"/>',
  imagen: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17.5 5-4.8 3.6 3.4 2.6-2.4 5.3 4.8"/>',
  papelera: '<path d="M5 7h14M9.5 7V4.5h5V7"/><path d="m7 7 .9 12.5h8.2L17 7"/><path d="M10.2 11v5M13.8 11v5"/>',
  estrella: '<path d="m12 4.2 2.45 5 5.55.8-4 3.9.95 5.5L12 16.8l-4.95 2.6.95-5.5-4-3.9 5.55-.8Z"/>',
  lapiz: '<path d="m4.5 19.5.9-4L16.2 4.7a1.6 1.6 0 0 1 2.3 0l.8.8a1.6 1.6 0 0 1 0 2.3L8.5 18.6Z"/><path d="m14.5 6.5 3 3"/>',
  check: '<path d="m5 12.5 4.6 4.6L19 7.5"/>',
  chevron: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  derecha: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  buscar: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.6 4.6"/>',
  nube: '<path d="M7.5 18.5a4.3 4.3 0 0 1-.7-8.5 5.6 5.6 0 0 1 10.7 1.2 3.7 3.7 0 0 1-.6 7.3Z"/>',
  nube_off: '<path d="M7.5 18.5a4.3 4.3 0 0 1-.7-8.5 5.6 5.6 0 0 1 2-3.1M17.5 11.2a3.7 3.7 0 0 1-.6 7.3H9.5"/><path d="m4 4 16 16"/>',
  cerrar: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  duplicar: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  varita: '<path d="m5 19 9.5-9.5"/><path d="m13 5.5.9 2.1 2.1.9-2.1.9L13 11.5l-.9-2.1-2.1-.9 2.1-.9Z"/><path d="m18.5 12 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z"/>',
  alerta: '<path d="M12 4.5 3.5 19.5h17Z"/><path d="M12 10.5v4M12 17v.1"/>',
  usuario: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  caja: '<path d="M4 8.5 12 4.5l8 4v8L12 20.5l-8-4Z"/><path d="m4 8.5 8 4 8-4M12 12.5v8"/>',
  flecha_k: '<path d="M5 19 19 5M9 5h10v10"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
  luna: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  descargar: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  subir: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  copia: '<path d="M6 4.5h9l3 3v12H6Z"/><path d="M9 12.5h6M9 16h6"/>',
};

export const icono = (nombre, tam = 20, clase = '') =>
  `<svg class="ic ${clase}" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[nombre] || ''}</svg>`;
