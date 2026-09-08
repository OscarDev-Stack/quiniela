/**
 * Guarda anti-bucle COMPARTIDA para toda recarga automática de la app.
 *
 * Autoriza como mucho MAX_RECARGAS dentro de VENTANA_MS, sin importar quién
 * pida recargar (detección de versión en el componente App, o el manejador de
 * fallo de chunks del router que corre ANTES de que exista el componente).
 *
 * Se comparte para que ambas rutas usen EXACTAMENTE el mismo contador global.
 * Si tuvieran contadores distintos, un fallo de chunk podría recargar 3 veces
 * y la detección de versión otras 3, dejando al usuario en un ciclo. Con una
 * sola clave en sessionStorage eso no puede pasar.
 *
 * La ventana está alineada con el auto-reparador inline de index.html.
 */
const VENTANA_MS = 2 * 60 * 1000; // 2 min.
const MAX_RECARGAS = 3;
const CLAVE = 'recargasAutoTs';

/** Marca que la próxima carga debe mostrar el overlay "Actualizando". */
export const CLAVE_OVERLAY_ACTUALIZANDO = 'mostrarOverlayActualizando';

/**
 * ¿Podemos recargar automáticamente sin arriesgar un bucle? Registra el intento
 * si autoriza. Si el storage no es confiable (modo privado), devuelve false:
 * preferimos NO recargar antes que arriesgar un ciclo.
 */
export function puedeRecargarSinCiclar(): boolean {
  const ahora = Date.now();
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    const marcas: number[] = crudo ? (JSON.parse(crudo) as number[]) : [];
    const recientes = marcas.filter((t) => ahora - t < VENTANA_MS);
    if (recientes.length >= MAX_RECARGAS) return false;

    recientes.push(ahora);
    sessionStorage.setItem(CLAVE, JSON.stringify(recientes));
    // Confirmamos que de verdad quedó escrito (modo privado a veces acepta
    // setItem pero no persiste).
    return sessionStorage.getItem(CLAVE) !== null;
  } catch {
    return false;
  }
}
