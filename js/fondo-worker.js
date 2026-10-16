// Quita el fondo en segundo plano (Web Worker) para que la pantalla no se congele mientras procesa.
import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

self.onmessage = async ({ data }) => {
  const { id, blob } = data;
  try {
    const salida = await removeBackground(blob, {
      model: 'isnet_quint8',
      output: { format: 'image/png' },
      progress: (clave, actual, total) => self.postMessage({ id, progreso: [clave, actual, total] }),
    });
    self.postMessage({ id, ok: true, blob: salida });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};
self.postMessage({ listo: true });
