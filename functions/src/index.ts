/* ============================================================
   Punto de entrada de las Cloud Functions.
   El monolito se partió por dominios: cada archivo exporta sus
   funciones onCall/onSchedule/onRequest y aquí solo se re-exportan
   (con el mismo nombre, para que Firebase no re-cree funciones).
   Importar ./comun garantiza initializeApp() antes que nada.
   Lo único que vive aquí es validarTurnstile (el portón de acceso).
   ============================================================ */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { opcionesCall, turnstileSecret } from './comun';

/* ============================================================
   NOTIFICACIONES → ./notificaciones
   Canal push/Telegram: prefs, tokens, vínculo, webhook, avisos.
   ============================================================ */
export {
    guardarPrefsNotif,
    guardarPush,
    guardarTelegram,
    vincularTelegram,
    telegramWebhook,
    avisarRegistro,
    solicitarReinicio,
} from './notificaciones';

/* ============================================================
   API externa + schedulers de resultados → ./api
   football-data.org y TheSportsDB: buscar/traer, refrescar tabla,
   importar equipos, revisar resultados/jornadas, resumen del día.
   ============================================================ */
export {
    buscarFixtures,
    buscarFixturesSportsDb,
    formaEquiposApi,
    revisarResultados,
    revisarResultadosSportsDb,
    actualizarMarcadoresEnVivo,
    traerJornadaApi,
    traerResultadosApi,
    refrescarTablaApi,
    importarEquiposApi,
    revisarJornadas,
    avisarOportunidades,
} from './api';

/* ============================================================
   GRUPOS (competencias privadas) -> ./grupos
   Las funciones onCall de grupos se re-exportan desde ./grupos
   (mismo nombre, para que Firebase no re-cree funciones).
   esAdminDeGrupo se importa donde se necesita (torneos/partidos/brackets).
   ============================================================ */
export {
    crearGrupo,
    unirseAGrupo,
    agregarMiembroGrupo,
    salirDeGrupo,
    hacerAdminGrupo,
    quitarAdminGrupo,
    marcarGrupoFavorito,
    buscarUsuariosPorAlias,
} from './grupos';

/* ============================================================
   USUARIOS y RANKING → ./usuarios
   Funciones onCall de administración de cuentas y ranking,
   re-exportadas con el mismo nombre desde ./usuarios.
   ============================================================ */
export {
    recalcularRanking,
    backfillTotales,
    reiniciarPuntos,
    eliminarUsuarios,
    sincronizarHistoricos,
    cambiarAlias,
} from './usuarios';

/* ============================================================
   PARTIDOS → ./partidos
   Pronósticos sueltos, bolsa, liquidación, cancelación y bote.
   Se re-exportan con el mismo nombre desde ./partidos.
   ============================================================ */
export {
    crearPronostico,
    liquidarPartido,
    cerrarPartidos,
    cancelarPartido,
    recalcularBolsas,
    crearPartidoGrupo,
    liquidarPartidoGrupo,
} from './partidos';

/* ============================================================
   TORNEOS → ./torneos
   Supervivencia y quiniela por puntos. Se re-exportan con el mismo
   nombre desde ./torneos.
   ============================================================ */
export {
    crearTorneo,
    unirseTorneo,
    revivir,
    guardarPick,
    guardarQuiniela,
    previsualizarQuiniela,
    resolverJornadaCompeticion,
    finalizarTorneo,
    resolverPendientes,
    consultarTorneo,
    cerrarInscripciones,
    recordarJornada,
} from './torneos';

/* ============================================================
   BRACKETS → ./brackets
   Eliminatorias (cuadro, dueños, pronóstico, calificación). Se
   re-exportan con el mismo nombre desde ./brackets.
   ============================================================ */
export {
    crearBracket,
    asignarLlaveBracket,
    asignarDuenoBracket,
    aceptarDuenoBracket,
    rechazarDuenoBracket,
    capturarPartidoBracket,
    guardarPronosticoBracket,
    unirseBracket,
    calificarBracket,
    avisarDuenosPendientes,
    cerrarBrackets,
    consultarBracket,
} from './brackets';

/**
 * Valida un token de Cloudflare Turnstile (el "portón" de acceso al sitio).
 * El cliente resuelve el widget, obtiene un token y lo manda aquí; esta
 * función lo verifica con Cloudflare usando la Secret Key. Solo si es válido
 * se permite el acceso a la app.
 *
 * Es onCall (no requiere que el usuario esté autenticado, porque el portón
 * está ANTES del login).
 */
export const validarTurnstile = onCall(
    { ...opcionesCall, secrets: [turnstileSecret] },
    async (req) => {
        const token = String(req.data?.token ?? '');
        if (!token) {
            throw new HttpsError('invalid-argument', 'Falta el token de verificación.');
        }

        const secret = turnstileSecret.value();
        if (!secret) {
            throw new HttpsError('failed-precondition', 'Turnstile no está configurado en el servidor.');
        }

        // Cloudflare valida el token con esta llamada (siteverify).
        const body = new URLSearchParams();
        body.append('secret', secret);
        body.append('response', token);

        try {
            const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });
            const data = (await resp.json()) as { success?: boolean; 'error-codes'?: string[] };

            if (data.success === true) {
                return { ok: true };
            }
            return { ok: false, errores: data['error-codes'] ?? [] };
        } catch {
            throw new HttpsError('internal', 'No se pudo verificar con Cloudflare. Intenta de nuevo.');
        }
    },
);
