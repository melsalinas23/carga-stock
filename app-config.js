// Acceso y conexión de la app (ver LEEME.md).
export default {
  supabaseUrl: 'https://bgjisgcnaubiegwvzooe.supabase.co',
  supabaseKey: 'sb_publishable_4v8-xn0Nb7anCN5oorArNg_B4xaJQXR',  // clave pública (nunca la secreta ni service_role)
  negocio: 'diagonal',
  requiereLogin: true,    // true: nadie usa la app sin pasar por el acceso
  // Versión inicial (baja seguridad): clave compartida por todo el equipo. La prepara preparar-acceso.mjs.
  // Si más arriba se completa Supabase, pasa a mandar el login por persona y esto se ignora.
  acceso: 'config/acceso.json',
  // Tienda de Tienda Nube a la que se suben las fotos por SKU (hace falta el login con Supabase). Vacío = panel oculto.
  tiendanube: { tienda: '8437403' },  // 8437403 = tienda de prueba · 7212308 = Diagonal Herrajes
};
