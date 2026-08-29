import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmarService } from '../../shared/confirmar.service';
import { InstalarBotonComponent } from './instalar-boton.component';
import { NotificacionesBotonComponent } from './notificaciones-boton.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { ToastService } from '../../shared/toast.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { of, switchMap, tap } from 'rxjs';
import { Auth, user } from '@angular/fire/auth';
import { NavComponent } from '../../shared/nav.component';
import { UserService } from '../../core/services/user.service';
import { NovedadesService } from '../../shared/novedades.service';
import { RankingService, RankingDoc } from '../../core/services/ranking.service';
import { PerfilService } from '../../core/services/perfil.service';
import { Trofeo } from '../../core/models/trofeo.model';
import { APP_VERSION } from '../../core/version';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent, InstalarBotonComponent, NotificacionesBotonComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Perfil" />

      @if (cargando()) {
        <app-cargando texto="Cargando perfil" />
      }

      <header class="cabecera">
        <div class="avatar">{{ inicial() }}</div>

        @if (editandoAlias()) {
          <form class="edit-alias" (ngSubmit)="guardarAlias()">
            <input
              type="text"
              name="alias"
              [(ngModel)]="aliasBorrador"
              maxlength="20"
              placeholder="Tu nombre"
              autocomplete="off"
              [disabled]="guardandoAlias()"
            />
            <div class="edit-alias-acciones">
              <button type="submit" class="btn-alias btn-alias--ok" [disabled]="guardandoAlias()">
                {{ guardandoAlias() ? 'Guardando…' : 'Guardar' }}
              </button>
              <button type="button" class="btn-alias" [disabled]="guardandoAlias()" (click)="cancelarAlias()">
                Cancelar
              </button>
            </div>
          </form>
        } @else {
          <h1>
            {{ alias() }}
            @if (esMio() && me()?.validada) {
              <i class="ti ti-rosette-discount-check-filled check"></i>
            }
            @if (esMio()) {
              <button class="editar-alias" (click)="editarAlias()" aria-label="Editar nombre" title="Editar nombre">
                <i class="ti ti-pencil"></i>
              </button>
            }
          </h1>
        }

        @if (posicion(); as p) {
          <p class="posicion">Lugar #{{ p }} del ranking</p>
        }
      </header>

      <section class="tarjetas">
        <div class="tarjeta">
          <span class="etq">Acierto</span>
          <span class="val acento">
            {{ porcentaje() }}%
            <small>{{ aciertos() }}/{{ resueltos() }}</small>
          </span>
        </div>
        <div class="tarjeta">
          <span class="etq">Racha</span>
          <span class="val">
            {{ racha() }}
            @if (racha() >= 3) { <span class="fuego">🔥</span> }
            <small>mejor {{ mejorRacha() }}</small>
          </span>
        </div>
        <div class="tarjeta">
          <span class="etq">Puntos históricos</span>
          <span class="val" [class.neg]="historicos() < 0">{{ historicos() | number }}</span>
        </div>
        <div class="tarjeta">
          <span class="etq">Torneos ganados</span>
          <span class="val dorado">{{ trofeos().length || torneosGanados() }}</span>
        </div>
      </section>

      @if (esMio()) {
        <section class="panel">
          <h2>Mi actividad</h2>
          <div class="linea">
            <span>Saldo disponible</span>
            <strong [class.neg]="(me()?.puntos ?? 0) < 0">{{ me()?.puntos ?? 0 | number }} pts</strong>
          </div>
          <div class="linea">
            <span>Total apostado</span>
            <strong>{{ resumen()?.totalApostado ?? 0 | number }} pts</strong>
          </div>
          <div class="linea">
            <span>Mejor premio</span>
            <strong class="verde">{{ resumen()?.mejorPremio ?? 0 | number }} pts</strong>
          </div>

          <button class="ver-movs" (click)="verMovimientos()">
            <span><i class="ti ti-receipt"></i> Ver todos mis movimientos</span>
            <i class="ti ti-chevron-right"></i>
          </button>
        </section>
      }

      @if (trofeos().length > 0) {
      <section class="panel">
        <h2>Trofeos</h2>
        @for (t of trofeos(); track t.id) {
          <div class="trofeo">
            <span class="copa"><i class="ti ti-trophy"></i></span>
            <div class="trofeo-datos">
              <div class="trofeo-nombre">{{ t.torneo }}</div>
              <div class="trofeo-sub">
                {{ t.competicion }}
                @if (t.compartido) { · compartido }
              </div>
            </div>
            @if (t.premio > 0) {
              <span class="trofeo-premio">+{{ t.premio | number }}</span>
            }
          </div>
        }
      </section>
      }

      @if (esMio() && validada()) {
        <section class="panel">
          <div class="panel-head">
            <h3><i class="ti ti-refresh-dot"></i> Reinicio de saldo</h3>
          </div>

          @if (saldo() < 0) {
            <p class="ayuda-tg">
              ¿Traes el saldo en rojo? Pide que lo regresen a cero.
              El administrador lo revisa y decide; tus aciertos, racha y
              puntos históricos no se tocan.
            </p>
          } @else {
            <p class="ayuda-tg">
              Tu saldo está en positivo, así que reiniciarlo significa
              <strong>perder los {{ saldo() | number }} pts que llevas</strong>.
              Pídelo solo si de verdad quieres empezar de cero.
            </p>
          }

          @if (yaSolicitado()) {
            <div class="pendiente">
              <i class="ti ti-clock"></i>
              <div>
                <strong>Ya la enviaste</strong>
                <p>
                  El administrador la revisará. Si tu saldo se mueve, podrás
                  pedirlo de nuevo.
                </p>
              </div>
            </div>
          } @else {
            <button class="btn btn--principal" [disabled]="pidiendo()" (click)="pedirReinicio()">
              {{ pidiendo() ? 'Enviando…' : 'Solicitar reinicio de saldo' }}
            </button>
          }

          @if (mensajeReinicio()) {
            <p class="aviso-tg" [class.aviso-tg--error]="errorReinicio()">
              {{ mensajeReinicio() }}
            </p>
          }
        </section>
      }

      @if (esMio() && validada()) {
        <section class="panel">
          <div class="panel-head">
            <h3><i class="ti ti-bell"></i> Notificaciones</h3>
          </div>
          <app-notificaciones-boton [pushActivo]="me()?.pushActivo === true" />
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3><i class="ti ti-brand-telegram"></i> Avisos por Telegram</h3>
            @if (conectado()) {
              <span class="marca-ok"><i class="ti ti-circle-check"></i> Conectado</span>
            }
          </div>

          @if (conectado()) {
            <label class="switch">
              <span class="switch-texto">Quiero recibir avisos de mis torneos</span>
              <input
                type="checkbox"
                class="switch-input"
                [ngModel]="activo"
                (ngModelChange)="alternarAvisos($event)"
              />
              <span class="switch-pista" aria-hidden="true"></span>
            </label>

            <p class="ayuda-tg">
              También puedes escribir <strong>/stop</strong> en el chat del bot para
              dejar de recibirlos.
            </p>
          } @else {
            <p class="ayuda-tg">
              <strong>No pierdas un torneo por olvido.</strong>
              Te aviso en cuanto abra la jornada, mientras todavía hay tiempo de elegir,
              y te mando los resultados apenas salen.
            </p>
            <p class="ayuda-tg ayuda-tg--chica">
              Se conecta con un toque. No tienes que copiar ningún número.
            </p>

            <button class="btn btn--principal" [disabled]="guardandoTg()" (click)="conectar()">
              <i class="ti ti-brand-telegram"></i>
              {{ guardandoTg() ? 'Preparando…' : 'Conectar Telegram' }}
            </button>
          }

          @if (mensajeTg()) {
            <p class="aviso-tg" [class.aviso-tg--error]="errorTg()">{{ mensajeTg() }}</p>
          }
        </section>
      }

      @if (esMio()) {
        <app-instalar-boton />

        <button class="salir" (click)="salir()">
          <i class="ti ti-logout"></i> Cerrar sesión
        </button>
      }

      <button class="version" (click)="verNovedades()">
        v{{ version }} · Ver novedades
      </button>
    </div>
  `,
  styles: [
    `
      .cabecera { text-align: center; margin-bottom: 20px; }
      .avatar {
        width: 68px; height: 68px; border-radius: 50%; margin: 0 auto 10px;
        background: var(--accent-bg); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; font-weight: 700;
      }
      h1 {
        font-size: 20px; font-weight: 600; margin: 0;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .check { color: var(--accent-fill); font-size: 18px; }
      .posicion { font-size: 13px; color: var(--text-muted); margin: 4px 0 0; }

      /* Botón lápiz junto al nombre */
      .editar-alias {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-1);
        color: var(--text-secondary); font-size: 14px;
      }
      .editar-alias:hover { color: var(--accent-text); border-color: var(--accent-fill); }

      /* Formulario de edición del alias */
      .edit-alias { display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .edit-alias input {
        width: min(260px, 80vw); text-align: center;
        padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary); font-size: 18px; font-weight: 600;
      }
      .edit-alias input:focus { outline: none; border-color: var(--accent-fill); }
      .edit-alias-acciones { display: flex; gap: 8px; }
      .btn-alias {
        padding: 8px 16px; border-radius: var(--radius); cursor: pointer; font-size: 13px; font-weight: 600;
        border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
      }
      .btn-alias:disabled { opacity: 0.6; cursor: default; }
      .btn-alias--ok { background: var(--accent-fill); color: #fff; border-color: transparent; }

      .tarjetas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
      .tarjeta { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 12px 14px; }
      .etq { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
      .val { font-size: 20px; font-weight: 700; display: flex; align-items: baseline; gap: 5px; }
      .val small { font-size: 12px; font-weight: 400; color: var(--text-muted); }
      .acento { color: var(--accent-text); }
      .dorado { color: var(--warning-text); }
      .neg { color: var(--danger-text); }
      .fuego { font-size: 15px; }

      .panel { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 15px; margin-bottom: 14px; }
      h2 { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
      .linea { display: flex; justify-content: space-between; align-items: center;
        font-size: 14px; padding: 7px 0; color: var(--text-secondary); }
      .linea strong { color: var(--text-primary); }
      .ver-movs {
        display: flex; align-items: center; justify-content: space-between; width: 100%;
        margin-top: 12px; padding: 11px 12px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
        font-size: 13px; font-weight: 600;
      }
      .ver-movs i:last-child { color: var(--text-muted); }
      .verde { color: var(--success-text); }

      .trofeo { display: flex; align-items: center; gap: 12px; padding: 10px 0;
        border-bottom: 1px solid var(--border); }
      .trofeo:last-child { border-bottom: none; }
      .copa { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
        background: var(--warning-bg); color: var(--warning-text);
        display: flex; align-items: center; justify-content: center; font-size: 17px; }
      .trofeo-datos { flex: 1; min-width: 0; }
      .trofeo-nombre { font-size: 14px; font-weight: 600; }
      .trofeo-sub { font-size: 12px; color: var(--text-muted); }
      .trofeo-premio { font-size: 14px; font-weight: 600; color: var(--success-text); }
      .ayuda-tg { font-size: 13px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.5; }
      .ayuda-tg strong { color: var(--text-primary); }
      .ayuda-tg--chica { font-size: 12px; color: var(--text-muted); margin-bottom: 14px; }
      .switch {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        margin-bottom: 16px; font-size: 14px; cursor: pointer;
      }
      .switch-texto { flex: 1; }

      /* El interruptor real está oculto; se dibuja la pista y el botón. */
      .switch-input { position: absolute; opacity: 0; width: 0; height: 0; }
      .switch-pista {
        position: relative; flex-shrink: 0;
        width: 48px; height: 28px; border-radius: 999px;
        background: var(--surface-1); border: 1px solid var(--border);
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .switch-pista::after {
        content: ''; position: absolute; top: 3px; left: 3px;
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
      .switch-input:focus-visible + .switch-pista {
        outline: 2px solid var(--accent-text); outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        .switch-pista, .switch-pista::after { transition: none; }
      }
      .btn--principal {
        width: 100%; padding: 12px; cursor: pointer; font-size: 15px; font-weight: 600;
        border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff;
      }
      .pendiente {
        display: flex; gap: 10px; align-items: flex-start;
        background: var(--warning-bg); border-radius: var(--radius); padding: 12px 14px;
      }
      .pendiente i { font-size: 18px; color: var(--warning-text); flex-shrink: 0; margin-top: 1px; }
      .pendiente strong { display: block; font-size: 14px; color: var(--warning-text); margin-bottom: 3px; }
      .pendiente p { font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.45; }

      .marca-ok {
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; color: var(--success-text);
      }
      .btn--principal { display: flex; align-items: center; justify-content: center; gap: 8px; }
      .aviso-tg { font-size: 13px; color: var(--success-text); margin: 12px 0 0; }
      .aviso-tg--error { color: var(--danger-text); }

      .salir {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; cursor: pointer; margin-top: 4px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; color: var(--danger-text);
        font-size: 15px; padding: 13px;
      }
      .version {
        display: block; width: 100%; cursor: pointer;
        text-align: center; font-size: 11px; color: var(--text-muted);
        opacity: 0.7; margin: 18px 0 4px; letter-spacing: 0.4px;
        background: transparent; border: none; padding: 8px;
      }
      .version:hover { opacity: 1; color: var(--accent-text); }
    `,
  ],
})
export class PerfilComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(Auth);
  private readonly users = inject(UserService);
  private readonly novedadesSrv = inject(NovedadesService);
  private readonly ranking = inject(RankingService);
  private readonly perfil = inject(PerfilService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  verMovimientos(): void {
    this.router.navigate(['/movimientos']);
  }

  private readonly confirmar = inject(ConfirmarService);
  private readonly toast = inject(ToastService);

  /** uid del perfil que se muestra: el de la ruta, o el mío. */
  private readonly uidRuta = this.route.snapshot.paramMap.get('uid');
  private readonly miUid = toSignal(user(this.auth), { initialValue: null });

  readonly uid = computed(() => this.uidRuta ?? this.miUid()?.uid ?? '');
  readonly esMio = computed(() => !this.uidRuta || this.uidRuta === this.miUid()?.uid);

  /** Datos privados: solo cuando es mi propio perfil. */
  readonly me = toSignal(this.users.me$, { initialValue: null });

  /** Datos públicos: sirven para cualquier perfil. */
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  private readonly fila = toSignal(
    toObservable(this.uid).pipe(
      switchMap((uid) => (uid ? this.ranking.fila(uid) : of(null))),
      tap(() => apagarCargando(this.cargando, this.inicioCarga)),
    ),
    { initialValue: null as RankingDoc | null },
  );

  readonly trofeos = toSignal(
    toObservable(this.uid).pipe(switchMap((uid) => (uid ? this.perfil.trofeos(uid) : of([])))),
    { initialValue: [] as Trofeo[] },
  );

  readonly resumen = toSignal(
    toObservable(this.uid).pipe(
      switchMap((uid) => (uid && this.esMio() ? this.perfil.resumen(uid) : of(null))),
    ),
    { initialValue: null },
  );

  readonly alias = computed(
    () => this.fila()?.alias ?? this.me()?.alias ?? this.me()?.email?.split('@')[0] ?? 'jugador',
  );
  readonly inicial = computed(() => (this.alias()[0] ?? '?').toUpperCase());

  /* --- Edición del alias --- */
  readonly editandoAlias = signal(false);
  readonly guardandoAlias = signal(false);
  aliasBorrador = '';

  editarAlias(): void {
    this.aliasBorrador = this.alias();
    this.editandoAlias.set(true);
  }

  cancelarAlias(): void {
    this.editandoAlias.set(false);
  }

  async guardarAlias(): Promise<void> {
    const nuevo = this.aliasBorrador.trim();
    if (nuevo.length < 3) {
      this.toast.error('El alias debe tener al menos 3 caracteres.');
      return;
    }
    if (nuevo === this.alias()) {
      this.editandoAlias.set(false);
      return;
    }

    this.guardandoAlias.set(true);
    try {
      await this.perfil.cambiarAlias(nuevo);
      this.toast.exito('Nombre actualizado.');
      this.editandoAlias.set(false);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo cambiar el nombre.');
    } finally {
      this.guardandoAlias.set(false);
    }
  }

  readonly porcentaje = computed(() => this.fila()?.porcentaje ?? 0);
  readonly aciertos = computed(() => this.fila()?.aciertos ?? this.me()?.aciertos ?? 0);
  readonly resueltos = computed(() => this.fila()?.resueltos ?? this.me()?.resueltos ?? 0);
  readonly racha = computed(() => this.fila()?.racha ?? this.me()?.racha ?? 0);
  readonly mejorRacha = computed(() => this.fila()?.mejorRacha ?? this.me()?.mejorRacha ?? 0);
  readonly historicos = computed(
    () => this.fila()?.puntos ?? this.me()?.puntosHistoricos ?? this.me()?.puntos ?? 0,
  );
  readonly torneosGanados = computed(
    () => this.fila()?.torneosGanados ?? this.me()?.torneosGanados ?? 0,
  );

  readonly posicion = signal<number | null>(null);
  readonly isAdmin = toSignal(this.users.isAdmin$, { initialValue: false });


  readonly version = APP_VERSION;

  /* --- Solicitud de reinicio --- */
  readonly pidiendo = signal(false);
  readonly mensajeReinicio = signal('');
  readonly errorReinicio = signal(false);

  /** Hasta que un administrador valide la cuenta no hay nada que configurar. */
  readonly validada = computed(() => this.me()?.validada === true);

  readonly saldo = computed(() => this.me()?.puntos ?? 0);

  /**
   * Saldo con el que acabamos de enviar la solicitud. Se guarda aquí
   * para que el botón reaccione al toque, sin esperar a que Firestore
   * propague el cambio. Si el saldo se mueve, deja de coincidir y el
   * botón vuelve solo.
   */
  private readonly saldoEnviado = signal<number | null>(null);

  /** Ya se pidió con este mismo saldo: no tiene caso repetirla. */
  readonly yaSolicitado = computed(() => {
    const actual = this.saldo();
    return this.saldoEnviado() === actual || this.me()?.solicitudReinicio?.saldo === actual;
  });

  async pedirReinicio(): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Solicitar reinicio',
      mensaje:
        this.saldo() > 0
          ? `Perderías los ${this.saldo()} pts que llevas. Le avisaremos al ` +
          'administrador para que revise tu caso.'
          : 'Le avisaremos al administrador para que revise tu caso. ' +
          'Si lo aprueba, tu saldo volverá a cero.',
      aceptar: 'Enviar solicitud',
      peligro: this.saldo() > 0,
    });
    if (!ok) return;

    this.pidiendo.set(true);
    this.errorReinicio.set(false);

    try {
      await this.perfil.solicitarReinicio();
      this.saldoEnviado.set(this.saldo());
      this.mensajeReinicio.set('Listo, ya le avisamos al administrador.');
    } catch (e: unknown) {
      this.errorReinicio.set(true);
      this.mensajeReinicio.set((e as Error)?.message ?? 'No se pudo enviar.');
    } finally {
      this.pidiendo.set(false);
    }
  }

  /** Abre el historial de novedades. */
  verNovedades(): void {
    this.novedadesSrv.abrirHistorial();
  }

  /* --- Avisos por Telegram --- */
  activo = false;
  readonly guardandoTg = signal(false);
  readonly mensajeTg = signal('');
  readonly errorTg = signal(false);

  /** ¿Ya quedó ligada la cuenta de Telegram? */
  readonly conectado = computed(() => !!this.me()?.telegramChatId);

  /** Abre Telegram con el enlace personal de conexión. */
  async conectar(): Promise<void> {
    this.guardandoTg.set(true);
    this.mensajeTg.set('');
    this.errorTg.set(false);

    try {
      const enlace = await this.perfil.vincularTelegram();
      // Se abre en otra pestaña: en móvil salta directo a la app.
      window.open(enlace, '_blank');
      this.mensajeTg.set('Pulsa Iniciar en Telegram y listo. Esta pantalla se actualiza sola.');
    } catch (e: unknown) {
      this.errorTg.set(true);
      this.mensajeTg.set((e as Error)?.message ?? 'No se pudo generar el enlace.');
    } finally {
      this.guardandoTg.set(false);
    }
  }

  /** Enciende o apaga los avisos sin desconectar la cuenta. */
  async alternarAvisos(valor: boolean): Promise<void> {
    this.activo = valor;

    try {
      const chatId = this.me()?.telegramChatId ?? '';
      await this.perfil.guardarTelegram(chatId, valor);
      this.toast.exito(valor ? 'Avisos activados.' : 'Avisos en pausa.');
    } catch (e: unknown) {
      this.activo = !valor;
      this.toast.error((e as Error)?.message ?? 'No se pudo guardar.');
    }
  }

  async salir(): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Cerrar sesión',
      mensaje: 'Tendrás que volver a entrar con tu correo y contraseña.',
      aceptar: 'Cerrar sesión',
      peligro: true,
    });
    if (!ok) return;

    await this.authService.logout();
    this.router.navigate(['/login']);
  }

  constructor() {
    // Posición en el ranking, si aplica.
    const f = this.fila();
    if (f?.calificado) {
      this.ranking
        .miPosicionPorPorcentaje(f.porcentaje)
        .then((n) => this.posicion.set(n || null))
        .catch(() => this.posicion.set(null));
    }

    // Precarga la configuración de Telegram que ya estuviera guardada.
    effect(() => {
      const yo = this.me();
      if (!yo) return;
      untracked(() => {
        this.activo = yo.notificaciones === true;
      });
    });
  }
}