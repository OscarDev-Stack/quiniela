import { Injectable, signal, computed } from '@angular/core';
import { Grupo } from '../core/models/grupo.model';

/**
 * El contexto activo desde el que el usuario ve la app: Global o uno de sus
 * grupos. Es un estado compartido que otras vistas (inicio, torneos, ranking)
 * leen para filtrar su contenido.
 *
 * grupoId null = Global. Se recuerda el último contexto usado en localStorage.
 *
 * Regla de arranque: si el usuario pertenece a algún grupo, NUNCA aterriza en
 * Global por defecto. Solo está en Global si lo eligió a propósito, o si no
 * tiene ningún grupo.
 */
export interface Contexto {
  grupoId: string | null;
  nombre: string; // "Global" o el nombre del grupo
  icono: string; // "🌎" o el emoji del grupo
}

const GLOBAL: Contexto = { grupoId: null, nombre: 'Global', icono: '🌎' };
const CLAVE = 'quiniela.contexto';
/** Marca de que el usuario eligió Global a propósito (no es el default). */
const CLAVE_GLOBAL_ELEGIDO = 'quiniela.globalElegido';

@Injectable({ providedIn: 'root' })
export class ContextoService {
  private readonly _actual = signal<Contexto>(this.leerGuardado());
  /** Evita re-decidir el contexto inicial más de una vez por sesión. */
  private inicializado = false;

  /** El contexto activo (solo lectura para las vistas). */
  readonly actual = this._actual.asReadonly();

  /** true si estamos en Global. */
  readonly esGlobal = computed(() => this._actual().grupoId === null);

  /** El grupoId activo, o null si Global. */
  readonly grupoId = computed(() => this._actual().grupoId);

  /** Cambia el contexto y lo recuerda. */
  cambiar(ctx: Contexto): void {
    this._actual.set(ctx);
    this.guardar(ctx);
    // Si el usuario elige Global explícitamente, se respeta en el arranque.
    this.marcarGlobalElegido(ctx.grupoId === null);
  }

  /** Vuelve a Global (elección explícita del usuario). */
  aGlobal(): void {
    this.cambiar(GLOBAL);
  }

  /**
   * Decide el contexto inicial cuando el inicio ya conoce los grupos del
   * usuario. Se ejecuta una sola vez por sesión.
   *
   * - Si el contexto guardado es un grupo válido, se queda ahí.
   * - Si es un grupo que ya no existe, cae a la regla de abajo.
   * - Si está en Global: se queda en Global SOLO si el usuario lo eligió a
   *   propósito o no tiene grupos; si no, entra a su primer grupo (favorito
   *   si tiene).
   */
  resolverInicial(grupos: Grupo[]): void {
    if (this.inicializado) {
      // Aun ya inicializado, si el grupo actual dejó de existir, corrige.
      this.validarContra(grupos.map((g) => g.id));
      return;
    }
    this.inicializado = true;

    const actual = this._actual();
    const ids = grupos.map((g) => g.id);

    // Si estoy en un grupo que sigue existiendo, me quedo.
    if (actual.grupoId !== null && ids.includes(actual.grupoId)) return;

    // Si estoy en un grupo que ya no existe, o en Global:
    const globalElegido = this.leerGlobalElegido();
    if (actual.grupoId === null && globalElegido) return; // Global a propósito
    if (grupos.length === 0) {
      this.forzarGlobalSinMarcar();
      return;
    }

    // Entrar al primer grupo (prioriza el primero de la lista, que el inicio
    // suele ordenar con favoritos primero).
    const g = grupos[0];
    this._actual.set({ grupoId: g.id, nombre: g.nombre, icono: g.icono });
    this.guardar(this._actual());
  }

  /**
   * Si el contexto apunta a un grupo del que el usuario ya no forma parte,
   * se vuelve a Global.
   */
  validarContra(idsGrupos: string[]): void {
    const g = this._actual().grupoId;
    if (g !== null && !idsGrupos.includes(g)) {
      this.forzarGlobalSinMarcar();
    }
  }

  /** Global "de rebote" (no cuenta como elección explícita). */
  private forzarGlobalSinMarcar(): void {
    this._actual.set(GLOBAL);
    this.guardar(GLOBAL);
    this.marcarGlobalElegido(false);
  }

  private leerGuardado(): Contexto {
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return GLOBAL;
      const ctx = JSON.parse(crudo) as Contexto;
      if (!ctx || typeof ctx.grupoId === 'undefined') return GLOBAL;
      return ctx;
    } catch {
      return GLOBAL;
    }
  }

  private guardar(ctx: Contexto): void {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(ctx));
    } catch {
      // Sin localStorage (modo privado): no recuerda, no pasa nada.
    }
  }

  private marcarGlobalElegido(valor: boolean): void {
    try {
      localStorage.setItem(CLAVE_GLOBAL_ELEGIDO, valor ? '1' : '0');
    } catch {
      // Ignorar.
    }
  }

  private leerGlobalElegido(): boolean {
    try {
      return localStorage.getItem(CLAVE_GLOBAL_ELEGIDO) === '1';
    } catch {
      return false;
    }
  }
}