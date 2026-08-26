import { Injectable, signal, computed } from '@angular/core';

/**
 * El contexto activo desde el que el usuario ve la app: Global o uno de sus
 * grupos. Es un estado compartido que otras vistas (inicio, torneos, ranking)
 * leen para filtrar su contenido.
 *
 * grupoId null = Global. Se recuerda el último contexto usado en localStorage
 * para restaurarlo al volver a abrir la app.
 */
export interface Contexto {
  grupoId: string | null;
  nombre: string; // "Global" o el nombre del grupo
  icono: string; // "🌎" o el emoji del grupo
}

const GLOBAL: Contexto = { grupoId: null, nombre: 'Global', icono: '🌎' };
const CLAVE = 'quiniela.contexto';

@Injectable({ providedIn: 'root' })
export class ContextoService {
  private readonly _actual = signal<Contexto>(this.leerGuardado());

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
  }

  /** Vuelve a Global. */
  aGlobal(): void {
    this.cambiar(GLOBAL);
  }

  /**
   * Si el contexto guardado apunta a un grupo del que el usuario ya no forma
   * parte, se vuelve a Global. Lo llama el inicio cuando conoce los grupos.
   */
  validarContra(idsGrupos: string[]): void {
    const g = this._actual().grupoId;
    if (g !== null && !idsGrupos.includes(g)) {
      this.aGlobal();
    }
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
      // Si no hay localStorage (modo privado), no pasa nada: solo no recuerda.
    }
  }
}