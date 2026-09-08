import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { EscanerQrComponent } from '../../shared/escaner-qr.component';
import { InvitacionPendiente } from '../../shared/invitacion.util';
import { apagarCargando } from '../../shared/cargando.util';
import { TorneosService } from '../../core/services/torneos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { ContextoService } from '../../shared/contexto.service';
import { ToastService } from '../../shared/toast.service';
import { Torneo } from '../../core/models/torneo.model';
import { Bracket } from '../../core/models/bracket.model';

@Component({
  selector: 'app-torneos-list',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent, EscanerQrComponent],
  template: `
    <div class="screen">
      <app-nav title="Torneos" />

      <div class="acciones">
        <button class="btn" (click)="abrirUnirse()">
          <i class="ti ti-ticket"></i> Unirme con código
        </button>
      </div>

      <nav class="filters">
        @for (f of filtros; track f) {
          <button class="chip" [class.chip--on]="filtro() === f" (click)="filtro.set(f)">
            {{ f }} <span class="chip-num">{{ conteo(f) }}</span>
          </button>
        }
      </nav>

      @if (cargando()) {
        <app-cargando texto="Cargando torneos" />
      } @else if (visibles().length === 0 && bracketsVisibles().length === 0) {
        <div class="vacio">
          <i class="ti ti-tournament"></i>
          @if (filtro() === 'Abiertos') {
            <p>No hay torneos ni eliminatorias abiertos o en juego ahora mismo.</p>
            <p class="pista">Los torneos y eliminatorias son por invitación: únete con el código que te compartan.</p>
          } @else if (filtro() === 'Cerrados') {
            <p>Todavía no hay torneos ni eliminatorias finalizados.</p>
          } @else {
            <p>No hay torneos ni eliminatorias todavía.</p>
            <p class="pista">Los torneos y eliminatorias son por invitación: únete con el código que te compartan.</p>
          }
        </div>
      }

      @for (t of visibles(); track t.id) {
        <article class="card" [class.card--quin]="t.modo === 'quiniela'" [class.card--surv]="t.modo !== 'quiniela'" [class.card--abierto]="t.estado === 'inscripcion'" [class.card--terminado]="finalizado(t.estado)" (click)="abrir(t)">
          <div class="top">
            <span class="competicion">{{ t.competicionNombre }}</span>
            @switch (t.estado) {
              @case ('inscripcion') { <span class="tag tag--ok">Inscripciones</span> }
              @case ('en-curso') { <span class="tag tag--warn">Jornada {{ t.jornadaActual }}</span> }
              @case ('finalizado') { <span class="tag">Finalizado</span> }
            }
          </div>
          <h2>{{ t.nombre }}</h2>
          <div class="meta">
            @if (t.modo === 'quiniela') {
              <span><i class="ti ti-target-arrow"></i> Por puntos</span>
              @if (t.jornadas) {
                <span><i class="ti ti-list-numbers"></i> {{ t.jornadas }} jornadas</span>
              }
            } @else {
              <span><i class="ti ti-heart"></i> {{ t.vidas === 1 ? '1 vida' : t.vidas + ' vidas' }}</span>
            }
            @if (t.estado === 'inscripcion') {
              <span><i class="ti ti-flag"></i> Inicia en J{{ t.jornadaInicial }}</span>
            }
            @if (t.costoEntrada > 0) {
              <span class="bolsa">
                <i class="ti ti-coins"></i> Bolsa {{ t.bolsa | number }} pts
              </span>
            }
            @if (esPublicoNoMioTorneo(t)) {
              <span class="unete"><i class="ti ti-door-enter"></i> Únete</span>
            }
            @if (t.ganadorAlias) {
              <span class="ganador"><i class="ti ti-trophy"></i> {{ t.ganadorAlias }}</span>
            }
            @if (t.premioPagado) {
              <span class="premio">{{ t.premioPagado | number }} pts</span>
            }
          </div>
        </article>
      }

      @if (bracketsVisibles().length > 0) {
        <h3 class="seccion">Eliminatorias</h3>
        @for (b of bracketsVisibles(); track b.id) {
          <article class="card card--bracket" [class.card--abierto]="b.estado === 'inscripcion'" [class.card--terminado]="finalizado(b.estado)" (click)="abrirBracket(b)">
            <div class="top">
              <span class="competicion">Eliminatoria</span>
              @switch (b.estado) {
                @case ('inscripcion') { <span class="tag tag--ok">Abierta</span> }
                @case ('en-curso') { <span class="tag tag--warn">En juego</span> }
                @case ('finalizado') { <span class="tag">Finalizada</span> }
              }
            </div>
            <h2>{{ b.nombre }}</h2>
            <div class="meta">
              <span><i class="ti ti-sitemap"></i> {{ tipoBracket(b) }}</span>
              <span><i class="ti ti-users"></i> {{ b.config.equipos }} equipos</span>
              @if (b.costoEntrada > 0) {
                <span class="bolsa"><i class="ti ti-coins"></i> Bolsa {{ b.bolsa | number }} pts</span>
              }
              @if (esPublicoNoMio(b)) {
                <span class="unete"><i class="ti ti-door-enter"></i> Únete</span>
              }
              @if (b.ganadorAlias) {
                <span class="ganador"><i class="ti ti-trophy"></i> {{ b.ganadorAlias }}</span>
              }
            </div>
          </article>
        }
      }

      <!-- Diálogo: unirse con código (escanear QR o escribir el código) -->
      @if (mostrarUnirse()) {
        <div class="overlay" (click)="cerrarUnirse()">
          <div class="dialogo" (click)="$event.stopPropagation()">
            <h3>Unirme con código</h3>
            <p class="dialogo-ayuda">
              Escanea el QR de la invitación o escribe el código del torneo o la
              eliminatoria.
            </p>

            <app-escaner-qr [autoNavegar]="false" (leido)="onEscaneado($event)" />

            @if (ocupado()) {
              <div class="uniendo"><i class="ti ti-loader-2"></i> Uniéndote…</div>
            }

            <div class="dialogo-acciones">
              <button class="btn" (click)="cerrarUnirse()">Cerrar</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .acciones { display: flex; gap: 8px; margin-bottom: 16px; }
      .btn {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 11px; font-size: 14px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .btn:disabled { opacity: 0.6; cursor: default; }

      .vacio { text-align: center; color: var(--text-muted); padding: 48px 0; }
      .vacio i { font-size: 36px; opacity: 0.5; }
      .vacio p { font-size: 14px; margin: 10px 0 0; }
      .vacio .pista { font-size: 12px; opacity: 0.8; }

      /* Diálogo de "unirme con código" */
      .overlay {
        position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.45);
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .dialogo {
        width: 100%; max-width: 400px; background: var(--surface-2);
        border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px;
        max-height: 90vh; overflow-y: auto;
      }
      .dialogo h3 { margin: 0 0 6px; font-size: 17px; }
      .dialogo-ayuda { margin: 0 0 14px; font-size: 13px; color: var(--text-secondary); line-height: 1.4; }
      .uniendo {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        font-size: 13px; color: var(--text-muted); margin: 14px 0 0;
      }
      .uniendo i { font-size: 18px; animation: gira 1s linear infinite; }
      @keyframes gira { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .uniendo i { animation: none; } }
      .dialogo-acciones {
        display: flex; gap: 8px;
        margin-top: 18px; padding-top: 14px;
        border-top: 1px solid var(--border);
      }

      /* Filtros por estado dentro del panel: botones rectangulares, el activo
         en azul de acento. Mismo estilo que la vista de Partidos. */
      .filters { display: flex; gap: 6px; margin-top: 2px; margin-bottom: 14px; }
      .chip {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 6px; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-secondary); white-space: nowrap;
      }
      .chip--on { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .chip-num {
        flex-shrink: 0; min-width: 22px; height: 22px; box-sizing: border-box; padding: 0 6px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; border-radius: 999px; background: rgba(128, 128, 128, 0.22);
      }
      .chip--on .chip-num { background: rgba(255, 255, 255, 0.25); }

      .card {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 15px; margin-bottom: 12px; cursor: pointer;
      }
      .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .competicion { font-size: 12px; color: var(--text-muted); }
      h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
      .meta { display: flex; gap: 14px; font-size: 13px; color: var(--text-secondary); }
      .meta i { font-size: 14px; vertical-align: -1px; }
      .ganador { color: var(--warning-text); font-weight: 600; }
      .bolsa { color: var(--success-text); font-weight: 600; }
      .premio { color: var(--success-text); }
      .unete { color: var(--accent-text); font-weight: 600; }

      .tag { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary); }
      .tag--ok { color: var(--success-text); background: var(--success-bg); }
      .tag--warn { color: var(--warning-text); background: var(--warning-bg); }
      .seccion {
        font-size: 13px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
        color: var(--text-muted); margin: 22px 0 12px;
      }
      /* Cada tarjeta expone su color propio en --c-realce; así el realce de
         "abierto" usa el color de SU tipo (quiniela verde, survivor rojo,
         eliminatoria azul) y nunca mezcla colores entre tipos. */
      .card--bracket { border-left: 4px solid var(--tipo-elim-fill); --c-realce: var(--tipo-elim-fill); }
      .card--surv { border-left: 4px solid var(--tipo-surv-fill); --c-realce: var(--tipo-surv-fill); }
      .card--quin { border-left: 4px solid var(--tipo-quin-fill); --c-realce: var(--tipo-quin-fill); }

      /* Abiertos a inscripción: los resaltamos para invitar a unirse. Un pulso
         sutil del anillo, en el color propio de la tarjeta, para que salten a
         la vista sin mezclar colores entre tipos. */
      .card--abierto {
        border-color: var(--c-realce);
        animation: pulso-abierto 2.2s ease-in-out infinite;
      }
      @keyframes pulso-abierto {
        0%, 100% { box-shadow: 0 0 0 0 transparent, 0 4px 14px rgba(0, 0, 0, 0.12); }
        50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-realce) 35%, transparent), 0 4px 14px rgba(0, 0, 0, 0.12); }
      }
      @media (prefers-reduced-motion: reduce) {
        .card--abierto {
          animation: none;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--c-realce) 30%, transparent), 0 4px 14px rgba(0, 0, 0, 0.12);
        }
      }
      .card--abierto .unete {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 9px; border-radius: 999px;
        background: color-mix(in srgb, var(--c-realce) 15%, transparent);
        color: var(--c-realce);
      }

      /* Terminados: atenuados pero conservan el color de SU tipo (apagado con
         gris) en lugar de un gris genérico, así se sigue reconociendo qué eran
         de un vistazo. */
      .card--terminado {
        opacity: 0.6;
        background: var(--surface-1);
        border-left-color: color-mix(in srgb, var(--c-realce) 45%, var(--text-muted));
      }
      .card--terminado:hover { opacity: 0.85; }
    `,
  ],
})
export class TorneosListComponent {
  private readonly service = inject(TorneosService);
  private readonly bracketsService = inject(BracketsService);
  private readonly router = inject(Router);
  private readonly contexto = inject(ContextoService);
  private readonly toast = inject(ToastService);

  /* Filtro por estado, mismas pastillas que la vista de Partidos. 'Abiertos'
     agrupa lo que está en juego y lo abierto a inscripción. Arranca en 'Todos'. */
  readonly filtros = ['Todos', 'Abiertos', 'Cerrados'];
  readonly filtro = signal('Todos');

  /* --- Unirme con código (escanear QR o escribir el código) --- */
  readonly mostrarUnirse = signal(false);
  readonly ocupado = signal(false);

  abrirUnirse(): void {
    this.mostrarUnirse.set(true);
  }
  cerrarUnirse(): void {
    this.mostrarUnirse.set(false);
  }

  /**
   * El escáner (QR o código escrito a mano) devolvió una invitación. Si trae un
   * tipo explícito (grupo o eliminatoria por el deep-link), respetamos su ruta.
   * Para un código suelto de torneo, lo resolvemos como antes: primero como
   * torneo (pantalla de reglas), y si no existe, como eliminatoria.
   */
  onEscaneado(inv: InvitacionPendiente): void {
    if (inv.tipo === 'grupo') {
      this.cerrarUnirse();
      this.router.navigate(['/unirse-grupo', inv.valor]);
      return;
    }
    if (inv.tipo === 'bracket') {
      this.cerrarUnirse();
      this.router.navigate(['/unirse-elim', inv.valor]);
      return;
    }
    this.unirse(inv.valor);
  }

  /**
   * Une por código. El mismo código puede ser de un torneo o de una
   * eliminatoria, así que probamos torneo primero (reusa la pantalla de
   * reglas /unirse/:codigo, que muestra el costo antes de aceptar) y, si no
   * existe como torneo, lo intentamos como eliminatoria.
   */
  async unirse(codigoEntrada: string): Promise<void> {
    const codigo = (codigoEntrada ?? '').trim().toUpperCase();
    if (!codigo) return;

    this.ocupado.set(true);
    try {
      // 1) ¿Es un torneo? consultarTorneo resuelve por código sin inscribir.
      await this.service.consultar(codigo);
      // Existe: mandamos a la pantalla de reglas para aceptar (respeta costo).
      this.ocupado.set(false);
      this.cerrarUnirse();
      this.router.navigate(['/unirse', codigo]);
      return;
    } catch {
      // No es torneo (o no existe). Probamos como eliminatoria.
    }

    try {
      const r = await this.bracketsService.unirse(codigo);
      this.cerrarUnirse();
      this.router.navigate(['/eliminatorias', r.id]);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'Ese código no existe.');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** True hasta que llegan los primeros torneos Y brackets (ambas secciones). */
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();
  private readonly listoTorneos = signal(false);
  private readonly listoTorneosPublicos = signal(false);
  private readonly listoBrackets = signal(false);
  private readonly listoBracketsPublicos = signal(false);

  private readonly torneos = toSignal(
    this.service.misTorneos$.pipe(tap(() => this.listoTorneos.set(true))),
    { initialValue: [] as Torneo[] },
  );
  /** Torneos públicos abiertos (para unirse aunque no participes aún). */
  private readonly torneosPublicos = toSignal(
    this.service.torneosPublicos().pipe(tap(() => this.listoTorneosPublicos.set(true))),
    { initialValue: [] as Torneo[] },
  );
  readonly brackets = toSignal(
    this.bracketsService.misBrackets().pipe(tap(() => this.listoBrackets.set(true))),
    { initialValue: [] as Bracket[] },
  );
  /** Eliminatorias públicas abiertas (para unirse aunque no participes aún). */
  private readonly bracketsPublicos = toSignal(
    this.bracketsService.bracketsPublicos().pipe(tap(() => this.listoBracketsPublicos.set(true))),
    { initialValue: [] as Bracket[] },
  );

  /** Apaga el loading cuando las fuentes de la vista ya emitieron. */
  private readonly apagar = effect(() => {
    if (
      this.listoTorneos() &&
      this.listoTorneosPublicos() &&
      this.listoBrackets() &&
      this.listoBracketsPublicos()
    ) {
      apagarCargando(this.cargando, this.inicioCarga);
    }
  });

  /**
   * Orden por estado: primero lo abierto a INSCRIPCIÓN (para captarlos antes
   * de que cierren), luego lo que está EN JUEGO por jornada, y al final lo
   * finalizado. Así de un vistazo se ve qué está activo sin que los terminados
   * estorben.
   */
  private rangoEstado(estado: string): number {
    if (estado === 'inscripcion' || estado === 'armando') return 0;
    if (estado === 'en-curso') return 1;
    return 2; // finalizado y cualquier otro
  }

  /**
   * ¿El estado (de torneo o eliminatoria) cae dentro de la etiqueta dada?
   * Mapea las etiquetas a los estados compartidos por ambos modelos:
   *  Abiertos → en juego + abierto a inscripción (en-curso, inscripcion, armando)
   *  Cerrados → finalizado · Todos → cualquiera.
   */
  private caeEnFiltro(estado: string, etiqueta: string): boolean {
    switch (etiqueta) {
      case 'Abiertos':
        return estado === 'en-curso' || estado === 'inscripcion' || estado === 'armando';
      case 'Cerrados':
        return estado === 'finalizado';
      default: // 'Todos'
        return true;
    }
  }

  private pasaFiltro(estado: string): boolean {
    return this.caeEnFiltro(estado, this.filtro());
  }

  /**
   * Torneos del contexto activo: los MÍOS más los PÚBLICOS abiertos donde aún
   * no estoy (sin duplicar), para descubrirlos y unirse desde aquí. Base sin
   * filtrar por chip, usada por la lista visible y por el conteo.
   */
  private readonly torneosContexto = computed(() => {
    const ctx = this.contexto.grupoId(); // null = Global
    const mios = this.torneos().filter((t) => (t.grupoId ?? null) === ctx);
    const idsMios = new Set(mios.map((t) => t.id));
    const publicosNuevos = this.torneosPublicos().filter(
      (t) => (t.grupoId ?? null) === ctx && !idsMios.has(t.id),
    );
    return [...mios, ...publicosNuevos];
  });

  /**
   * Eliminatorias del contexto activo: las MÍAS más las PÚBLICAS abiertas
   * donde aún no estoy (sin duplicar), para descubrirlas y unirse desde aquí.
   * Base sin filtrar por chip, usada por la lista visible y por el conteo.
   */
  private readonly bracketsContexto = computed(() => {
    const ctx = this.contexto.grupoId();
    const mios = this.brackets().filter((b) => (b.grupoId ?? null) === ctx);
    const idsMios = new Set(mios.map((b) => b.id));
    const publicasNuevas = this.bracketsPublicos().filter(
      (b) => (b.grupoId ?? null) === ctx && !idsMios.has(b.id),
    );
    return [...mios, ...publicasNuevas];
  });

  readonly visibles = computed(() =>
    [...this.torneosContexto()]
      .filter((t) => this.pasaFiltro(t.estado))
      .sort((a, b) => this.rangoEstado(a.estado) - this.rangoEstado(b.estado)),
  );

  readonly bracketsVisibles = computed(() =>
    [...this.bracketsContexto()]
      .filter((b) => this.pasaFiltro(b.estado))
      .sort((a, b) => this.rangoEstado(a.estado) - this.rangoEstado(b.estado)),
  );

  /**
   * Conteo combinado (torneos + eliminatorias) para el badge de cada chip.
   * Cuenta según la etiqueta del chip, no según el filtro activo.
   */
  conteo(etiqueta: string): number {
    const estados = [
      ...this.torneosContexto().map((t) => t.estado),
      ...this.bracketsContexto().map((b) => b.estado),
    ];
    return estados.filter((e) => this.caeEnFiltro(e, etiqueta)).length;
  }

  /** ¿Está finalizado? Para atenuarlo visualmente. */
  finalizado(estado: string): boolean {
    return estado === 'finalizado';
  }

  abrir(t: Torneo): void {
    // Si es un torneo público donde aún no estoy, lo mando a la pantalla de
    // reglas /unirse/:codigo (muestra el costo antes de aceptar). Si ya estoy,
    // abro el detalle normal.
    if (this.esPublicoNoMioTorneo(t)) {
      this.router.navigate(['/unirse', t.codigo]);
      return;
    }
    this.router.navigate(['/torneos', t.id]);
  }

  abrirBracket(b: Bracket): void {
    this.router.navigate(['/eliminatorias', b.id]);
  }

  /** ¿Es una eliminatoria pública abierta en la que aún no participo? */
  esPublicoNoMio(b: Bracket): boolean {
    return !this.brackets().some((m) => m.id === b.id);
  }

  /** ¿Es un torneo público abierto en el que aún no participo? */
  esPublicoNoMioTorneo(t: Torneo): boolean {
    return !this.torneos().some((m) => m.id === t.id);
  }

  /** Describe el tipo de eliminatoria: formato y cruces. */
  tipoBracket(b: Bracket): string {
    const rondas = b.config.formatoRondas === 'ida-vuelta' ? 'ida y vuelta' : 'partido único';
    return b.config.avance === 'reordena' ? `Liguilla · ${rondas}` : `Copa · ${rondas}`;
  }
}