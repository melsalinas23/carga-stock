// Service worker:
//  1) deja la app lista para abrir sin conexión,
//  2) guarda librerías y tipografías externas la primera vez que se usan,
//  3) agrega los encabezados que permiten usar varios núcleos del procesador (quitar fondo mucho más rápido)
//     aunque el sitio esté en un hosting que no permite configurarlos.
const VERSION = 'v11';
const APP = 'app-' + VERSION;
const LIBS = 'libs-v1';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'app-config.js', 'config/base.json',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/remote.js', 'js/config.js', 'js/imagen.js', 'js/exportar.js', 'js/textos.js',
  'js/vista-lista.js', 'js/vista-producto.js', 'js/vista-exportar.js', 'js/vista-ajustes.js', 'js/acceso.js', 'js/fondo-worker.js', 'js/iconos.js', 'js/riel.js', 'js/tema.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'img/kai-k.png', 'img/kai-logo.png', 'img/fileteado.webp', 'fonts/Inter-normal-400-800.woff2', 'fonts/PlayfairDisplay-italic-700.woff2'];
const HOSTS_LIBS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'staticimgly.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

function aislar(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => Promise.all(ARCHIVOS.map((a) => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== LIBS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;              // datos y fotos de la nube: siempre en vivo
  if (HOSTS_LIBS.includes(url.hostname)) {                       // librerías, modelo y tipografías: primero caché
    e.respondWith(caches.open(LIBS).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin === location.origin) {                          // la app: primero red (recibe mejoras), si no hay red, caché
    e.respondWith(fetch(req)
      .then((res) => { if (res.ok) caches.open(APP).then((c) => c.put(req, res.clone())); return aislar(res); })
      .catch(() => caches.match(req).then((r) => aislar(r || undefined) || caches.match('index.html').then(aislar))));
  }
});
