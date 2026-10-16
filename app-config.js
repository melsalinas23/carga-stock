// Conexión a la base compartida (Supabase). Se completa una sola vez (ver LEEME.md).
export default {
  supabaseUrl: '',
  supabaseKey: '',        // clave pública "anon" (nunca la secreta)
  negocio: 'diagonal',
  requiereLogin: true,    // true: nadie usa la app sin iniciar sesión con un usuario autorizado
};
