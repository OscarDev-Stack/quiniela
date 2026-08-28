import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { BracketsService } from '../../core/services/brackets.service';
import { FormsModule } from '@angular/forms';
import { CuadroBracketComponent } from './cuadro-bracket.component';
import { ReglasBracketComponent } from './reglas-bracket.component';
import { EscudoComponent } from '../../shared/escudo.component';
import { ToastService } from '../../shared/toast.service';
import { ConfirmarService } from '../../shared/confirmar.service';
import { PronosticoBracketComponent } from './pronostico-bracket.component';
import { TablaBracketComponent } from './tabla-bracket.component';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { Bracket } from '../../core/models/bracket.model';

/**
 * Vista del jugador para una eliminatoria: el cuadro real arriba, y
 * debajo, según el momento, el formulario para pronosticar o el
 * pronóstico ya congelado.
 */
@Component({
  selector: 'app-bracket-detalle',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CuadroBracketComponent,
    ReglasBracketComponent,
    EscudoComponent,
    PronosticoBracketComponent,
    TablaBracketComponent,
    NavComponent,
    CargandoComponent,
  ],
  template: `
    <div class="screen">
      <app-nav [title]="bracket()?.nombre ?? 'Eliminatoria'" [back]="true" />

      <div class="wrap">
      @if (bracket(); as b) {
        <div class="franja">
          <span class="pill">{{ etiqueta(b.estado) }}</span>
          <span class="pill">{{ b.config.equipos }} equipos</span>
          @if (b.costoEntrada > 0) {
            <span class="pill">Entrada: {{ b.costoEntrada | number }} pts</span>
          }
          @if (b.bolsa > 0) {
            <span class="pill pill--premio">Bolsa: {{ b.bolsa | number }} pts</span>
          }
          @if (b.estado !== 'finalizado' && fechaCierre(b); as fc) {
            <span class="pill"><i class="ti ti-clock"></i> {{ b.modo === 'duenos' ? 'Inicia' : 'Cierra' }}: {{ fc }}</span>
          }
        </div>

        <section class="panel">
          <h2>Cuadro</h2>
          <app-cuadro-bracket [bracket]="b" />
        </section>

        @if (b.estado === 'en-curso' || b.estado === 'finalizado') {
          <section class="panel">
            <h2>{{ b.estado === 'finalizado' ? 'Resultados' : 'Pronósticos de todos' }}</h2>
            <app-tabla-bracket [pronosticos]="pronosticos()" [miUid]="miUid()" />
          </section>
        }

        <!-- ── MODO DUEÑOS ── -->
        @if (b.modo === 'duenos') {
          @if (miDueno(); as d) {
            @if (d.estado === 'invitado') {
              <section class="panel panel--aviso">
                <h2>Te tocó un equipo</h2>
                <div class="tu-equipo">
                  <app-escudo [equipo]="d.equipo" [size]="88" />
                  <span class="tu-equipo-nom">{{ d.equipo }}</span>
                </div>
                <p class="aviso-txt">
                  Se te asignó este equipo en <strong>{{ b.nombre }}</strong>.
                  @if (b.costoEntrada > 0) {
                    Aceptar cuesta <strong>{{ b.costoEntrada | number }} pts</strong> de entrada.
                  }
                  Ganas si tu equipo llega a ser campeón.
                </p>
                <div class="reglas-mini"><app-reglas-bracket [b]="b" /></div>
                <button class="btn-unir" [disabled]="aceptando()" (click)="aceptarDueno()">
                  {{ aceptando() ? 'Un momento…' : (b.costoEntrada > 0 ? 'Aceptar y pagar ' + (b.costoEntrada | number) + ' pts' : 'Aceptar y participar') }}
                </button>
                <button class="btn-rechazar" [disabled]="aceptando()" (click)="rechazarDueno()">
                  No, gracias
                </button>
              </section>
            } @else {
              <section class="panel">
                <h2>Tu equipo</h2>
                <div class="tu-equipo">
                  <app-escudo [equipo]="d.equipo" [size]="88" />
                  <span class="tu-equipo-nom">{{ d.equipo }}</span>
                </div>
                <p class="aviso-txt">Ganas si {{ d.equipo }} es campeón. Sigue el cuadro de arriba.</p>
              </section>
            }
          }

          <!-- Quién le tocó a quién (visible para todos) -->
          @if ((b.duenos ?? []).length > 0) {
            <section class="panel">
              <h2>Quién tiene cada equipo</h2>
              <div class="duenos-lista">
                @for (dd of b.duenos ?? []; track dd.equipo) {
                  <div class="dueno-fila" [class.dueno-fila--mio]="dd.uid === miUid()">
                    <span class="dueno-eq">
                      <app-escudo [equipo]="dd.equipo" [size]="24" />
                      <span class="dueno-eq-nom">{{ dd.equipo }}</span>
                    </span>
                    <span class="dueno-quien">
                      {{ dd.nombre }}
                      @if (dd.invitado) { <span class="etq-inv">invitado</span> }
                      @else if (dd.estado === 'invitado') { <i class="ti ti-clock" title="Esperando que acepte"></i> }
                    </span>
                  </div>
                }
              </div>
            </section>
          }
        } @else {
        <!-- ── MODO PRONÓSTICO (el de siempre) ── -->
        @if (b.estado !== 'inscripcion' || acepto()) {
          <section class="panel">
            <h2>Tu pronóstico</h2>
            <app-pronostico-bracket [bracket]="b" />
          </section>

          <!-- Ya dentro: las reglas quedan al final, colapsadas. -->
          <section class="panel">
            <button class="colapso" (click)="verReglas.set(!verReglas())">
              <span><i class="ti ti-book"></i> Cómo se juega</span>
              <i class="ti" [class.ti-chevron-down]="!verReglas()" [class.ti-chevron-up]="verReglas()"></i>
            </button>
            @if (verReglas()) {
              <div class="colapso-cuerpo">
                <app-reglas-bracket [b]="b" />
              </div>
            }
          </section>
        }
        }

        <!-- Modal automático la primera vez: reglas + aceptar + unirse. -->
        @if (b.modo !== 'duenos' && b.estado === 'inscripcion' && !acepto() && !resolviendo()) {
          <div class="modal-fondo">
            <div class="modal">
              <div class="modal-cab">
                <h2 class="modal-tit">{{ b.nombre }}</h2>
                <button class="modal-x" (click)="salir()" aria-label="Cerrar">
                  <i class="ti ti-x"></i>
                </button>
              </div>
              <div class="modal-cuerpo">
                <app-reglas-bracket [b]="b" />
              </div>
              <label class="switch">
                <span class="switch-texto">
                  Entiendo cómo se juega y quiero participar@if (b.costoEntrada > 0) { (cuesta {{ b.costoEntrada }} pts) }.
                </span>
                <input type="checkbox" class="switch-input" [(ngModel)]="aceptoRaw" />
                <span class="switch-pista" aria-hidden="true"></span>
              </label>
              <button class="btn-unir" [disabled]="!marcado()" (click)="confirmar()">
                {{ marcado() ? 'Unirme y pronosticar' : 'Marca la casilla para continuar' }}
              </button>
              <button class="btn-salir" (click)="salir()">No jugar por ahora</button>
            </div>
          </div>
        }
      } @else if (cargando()) {
        <app-cargando texto="Cargando eliminatoria" />
      } @else {
        <p class="cargando">No se encontró la eliminatoria.</p>
      }
      </div>
    </div>
  `,
  styles: [
    `
      .wrap { padding: 0 0 90px; }
      .franja { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
      .pill {
        font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .pill--premio { background: var(--accent-bg); color: var(--accent-text); }
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px; margin-bottom: 14px;
      }
      .panel h2 { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
      .cargando { font-size: 14px; color: var(--text-muted); }
      .switch {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
        cursor: pointer;
      }
      .switch-texto { flex: 1; font-size: 13px; color: var(--text-secondary); line-height: 1.4; }
      .switch-input { position: absolute; opacity: 0; width: 0; height: 0; }
      .switch-pista {
        position: relative; flex-shrink: 0; margin-top: 1px;
        width: 46px; height: 26px; border-radius: 999px;
        background: var(--surface-1); border: 1px solid var(--border);
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .switch-pista::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--text-muted);
        transition: transform 0.18s ease, background 0.18s ease;
      }
      .switch-input:checked + .switch-pista {
        background: var(--accent-fill); border-color: transparent;
      }
      .switch-input:checked + .switch-pista::after {
        transform: translateX(20px); background: #fff;
      }
      @media (prefers-reduced-motion: reduce) {
        .switch-pista, .switch-pista::after { transition: none; }
      }

      /* Modal de bienvenida */
      .modal-fondo {
        position: fixed; inset: 0; z-index: 100;
        background: rgba(0, 0, 0, 0.6);
        display: flex; align-items: flex-end; justify-content: center;
        padding: 0;
      }
      .modal {
        width: 100%; max-width: 520px; max-height: 85vh; overflow-y: auto;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 18px 18px 0 0;
        padding: 20px 20px calc(24px + env(safe-area-inset-bottom));
        /* Ritmo vertical parejo entre bloques del modal. */
        display: flex; flex-direction: column; gap: 16px;
        animation: subir 0.25s ease;
      }
      @keyframes subir { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @media (min-width: 560px) {
        .modal-fondo { align-items: center; padding: 20px; }
        .modal { border-radius: 18px; }
      }
      .modal-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; }
      .modal-tit { font-size: 18px; font-weight: 700; margin: 0; flex: 1; }
      .modal-x {
        flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-1); border: none; cursor: pointer;
        color: var(--text-secondary); font-size: 18px;
      }
      .btn-salir {
        width: 100%; margin: -8px 0 0; padding: 10px; cursor: pointer;
        font-size: 14px; font-weight: 500; border: none; border-radius: var(--radius);
        background: transparent; color: var(--text-secondary);
      }
      .modal-cuerpo { margin: 0; }
      .btn-unir {
        width: 100%; margin: 0; padding: 13px; cursor: pointer;
        font-size: 15px; font-weight: 600; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff;
      }
      .btn-unir:disabled { opacity: 0.6; cursor: default; background: var(--surface-1); color: var(--text-muted); }
      .btn-rechazar {
        width: 100%; margin: 8px 0 0; padding: 11px; cursor: pointer;
        font-size: 14px; font-weight: 600; border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; color: var(--text-secondary);
      }
      .btn-rechazar:disabled { opacity: 0.5; cursor: default; }

      /* Vista modo dueños */
      .panel--aviso { border-color: var(--tipo-elim-fill); }
      .tu-equipo {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 14px 0;
      }
      .tu-equipo-nom { font-size: 24px; font-weight: 800; color: var(--text-primary); }
      .aviso-txt { font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin: 0 0 14px; text-align: center; }
      .reglas-mini { margin: 0 0 16px; }

      .duenos-lista { display: flex; flex-direction: column; gap: 6px; }
      .dueno-fila {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-0);
      }
      .dueno-fila--mio { border-color: var(--tipo-elim-fill); background: var(--tipo-elim-bg); }
      .dueno-eq { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .dueno-eq-nom { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dueno-quien { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
      .etq-inv {
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
        padding: 2px 6px; border-radius: 999px; background: var(--surface-2); color: var(--text-muted);
      }

      /* Colapso de reglas al final */
      .colapso {
        display: flex; align-items: center; justify-content: space-between; width: 100%;
        background: transparent; border: none; padding: 0; cursor: pointer;
        color: inherit; font-size: 15px; font-weight: 600;
      }
      .colapso i { color: var(--text-muted); }
      .colapso-cuerpo { margin-top: 14px; }
    `,
  ],
})
export class BracketDetalleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(BracketsService);
  private readonly toast = inject(ToastService);
  private readonly confirmarDialogo = inject(ConfirmarService);
  private readonly location = inject(Location);
  private readonly auth = inject(Auth);

  private readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');

  /** Estado del check dentro del modal. */
  readonly marcado = signal(false);
  get aceptoRaw(): boolean {
    return this.marcado();
  }
  set aceptoRaw(v: boolean) {
    this.marcado.set(v);
  }
  /** Se confirma al pulsar "Unirme": cierra el modal y muestra el cuadro. */
  private readonly confirmado = signal(false);
  confirmar(): void {
    if (this.marcado()) this.confirmado.set(true);
  }

  /** Cierra el modal sin unirse y regresa a la pantalla anterior. */
  salir(): void {
    this.location.back();
  }
  readonly verReglas = signal(false);
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  readonly bracket = toSignal(this.service.bracket(this.id()), { initialValue: null });
  readonly miUid = toSignal(user(this.auth).pipe(map((u) => u?.uid ?? null)), {
    initialValue: null,
  });

  // La colección completa solo se puede leer cuando el bracket terminó
  // (así lo exige la regla, para no espiar cuadros ajenos). Antes de eso
  // solo leemos el propio pronóstico.
  readonly pronosticos = toSignal(
    toObservable(computed(() => {
      const e = this.bracket()?.estado;
      return e === 'en-curso' || e === 'finalizado';
    })).pipe(
      switchMap((cerrado) => (cerrado ? this.service.pronosticos(this.id()) : of([]))),
    ),
    { initialValue: [] },
  );

  private readonly miPron = toSignal(
    toObservable(this.miUid).pipe(
      switchMap((uid) =>
        uid
          ? this.service.miPronostico(this.id(), uid).pipe(tap(() => this.pronCargado.set(true)))
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** Se pone en true cuando ya sabemos si hay pronóstico (evita parpadeo). */
  private readonly pronCargado = signal(false);

  /**
   * ¿Ya tenemos todo para mostrar sin saltos? Necesitamos el bracket, y
   * además el pronóstico propio SALVO en modo dueños o cuando ya terminó
   * (ahí el pronóstico individual no se espera).
   */
  private readonly listoParaMostrar = computed(() => {
    const b = this.bracket();
    if (!b) return false;
    if (b.modo === 'duenos' || b.estado === 'finalizado') return true;
    return this.pronCargado();
  });

  /** Apaga el overlay de carga solo cuando ya está todo listo (sin saltos). */
  private readonly apagar = effect(() => {
    if (this.listoParaMostrar()) {
      apagarCargando(this.cargando, this.inicioCarga);
    }
  });

  /** ¿Ya tengo un pronóstico guardado? Entonces no pido aceptar de nuevo. */
  private readonly yaPronostico = computed(() => !!this.miPron());
  readonly acepto = computed(() => this.confirmado() || this.yaPronostico());

  /** Aún resolviendo si el usuario ya está dentro: no mostramos nada todavía. */
  readonly resolviendo = computed(() => !this.pronCargado());

  /** Modo dueños: mi asignación de equipo, si tengo una. */
  readonly miDueno = computed(() => {
    const uid = this.miUid();
    if (!uid) return null;
    return (this.bracket()?.duenos ?? []).find((d) => d.uid === uid) ?? null;
  });

  readonly aceptando = signal(false);

  async aceptarDueno(): Promise<void> {
    this.aceptando.set(true);
    try {
      await this.service.aceptarDueno(this.id());
      this.toast.exito('¡Listo! Ya estás dentro con tu equipo.');
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo aceptar.');
    } finally {
      this.aceptando.set(false);
    }
  }

  async rechazarDueno(): Promise<void> {
    const eq = this.miDueno()?.equipo ?? 'tu equipo';
    const ok = await this.confirmarDialogo.pedir({
      titulo: 'Rechazar el equipo',
      mensaje: `¿Seguro que no quieres participar con ${eq}? El equipo quedará libre para otro jugador.`,
      aceptar: 'Sí, rechazar',
      cancelar: 'Mejor no',
      peligro: true,
    });
    if (!ok) return;

    this.aceptando.set(true);
    try {
      await this.service.rechazarDueno(this.id());
      this.toast.exito('Rechazaste la invitación.');
      this.location.back();
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo rechazar.');
    } finally {
      this.aceptando.set(false);
    }
  }

  /** Fecha de cierre/inicio del bracket, formateada. Null si no tiene. */
  fechaCierre(b: { cierraAt?: { seconds: number } | Date | null }): string | null {
    const v = b.cierraAt;
    if (!v) return null;
    const d = v instanceof Date ? v : new Date((v.seconds ?? 0) * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  etiqueta(estado: string): string {
    const m: Record<string, string> = {
      armando: 'Armando',
      inscripcion: 'Abierto para pronosticar',
      'en-curso': 'En juego',
      finalizado: 'Finalizado',
    };
    return m[estado] ?? estado;
  }
}