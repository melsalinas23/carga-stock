// Tema claro (por defecto, pensado para la luz del local), oscuro o automático según el celular.
export const temaGuardado = () => { try { return localStorage.getItem('tema') || 'claro'; } catch { return 'claro'; } };
export function aplicarTema(valor = temaGuardado()) {
  try { localStorage.setItem('tema', valor); } catch { /* sin almacenamiento */ }
  const efectivo = valor === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro') : valor;
  document.documentElement.dataset.tema = efectivo;
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', efectivo === 'oscuro' ? 'dark' : 'light');
}
