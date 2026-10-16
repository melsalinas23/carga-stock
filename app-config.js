// Acceso y conexión de la app (ver LEEME.md).
export default {
  supabaseUrl: '',
  supabaseKey: '',        // clave pública "anon" (nunca la secreta)
  negocio: 'diagonal',
  requiereLogin: true,    // true: nadie usa la app sin pasar por el acceso
  // Versión inicial (baja seguridad): clave compartida por todo el equipo. La prepara preparar-acceso.mjs.
  // Si más arriba se completa Supabase, pasa a mandar el login por persona y esto se ignora.
  acceso: 'config/acceso.json',
};
