// Conexión con la base compartida (Supabase). Si no está configurada, la app trabaja solo en el dispositivo.

const CDN_SUPABASE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
let client = null;
let negocio = 'diagonal';

export const configurado = () => !!client;
export const idNegocio = () => negocio;

export async function iniciar({ url, key, negocio: neg }) {
  if (!url || !key) { client = null; return false; }
  if (neg) negocio = neg;
  const { createClient } = await import(CDN_SUPABASE);
  client = createClient(url.trim(), key.trim(), { auth: { persistSession: true, autoRefreshToken: true } });
  return true;
}

// Solo para pruebas automáticas: permite enchufar un cliente simulado.
export function iniciarConCliente(c, neg) { client = c; if (neg) negocio = neg; }

export async function sesion() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export async function entrar(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.session;
}

export async function salir() { if (client) await client.auth.signOut(); }

// Aviso cuando la sesión se cierra (por ejemplo, si venció y no se pudo renovar)
export function escucharSesion(fn) { client?.auth.onAuthStateChange((evento) => fn(evento)); }

// ¿El usuario con sesión está en la lista de personas autorizadas? (función es_equipo de supabase.sql)
export async function esEquipo() {
  const { data, error } = await client.rpc('es_equipo');
  if (error) throw error;
  return data === true;
}

export async function traerCambios(desde) {
  const todos = [];
  let cursor = desde || null;
  for (;;) {
    let q = client.from('productos').select('*').eq('negocio', negocio).order('updated_at', { ascending: true }).limit(500);
    if (cursor) q = q.gt('updated_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    todos.push(...data);
    if (data.length < 500) break;
    cursor = data[data.length - 1].updated_at;
  }
  return todos;
}

export async function subirProducto(row) {
  const { data, error } = await client.from('productos').upsert(row, { onConflict: 'id' }).select('updated_at').single();
  if (error) throw error;
  return data;
}

export async function subirFoto(path, blob) {
  const { error } = await client.storage.from('fotos').upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp', cacheControl: '31536000' });
  if (error) throw error;
}

export async function borrarFotos(paths) {
  if (!paths.length) return;
  const { error } = await client.storage.from('fotos').remove(paths);
  if (error) throw error;
}

export const urlFoto = (path) => client.storage.from('fotos').getPublicUrl(path).data.publicUrl;

// Puente con la API de Tienda Nube (función `tiendanube` de Supabase): el permiso de la tienda vive solo en el servidor.
export async function tiendaNube(accion, datos = {}) {
  const { data, error } = await client.functions.invoke('tiendanube', { body: { accion, ...datos } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* sin detalle del servidor */ }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || 'Tienda Nube no respondió bien');
  return data;
}

export async function traerConfig() {
  const { data, error } = await client.from('config').select('*').eq('negocio', negocio).maybeSingle();
  if (error) throw error;
  return data;
}

export async function subirConfig(obj) {
  const { data, error } = await client.from('config').upsert({ negocio, data: obj }, { onConflict: 'negocio' }).select('updated_at').single();
  if (error) throw error;
  return data;
}
