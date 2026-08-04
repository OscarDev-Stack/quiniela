import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { TorneosService } from '../../core/services/torneos.service';
import { ModoTorneo } from '../../core/models/torneo.model';
import { UserService } from '../../core/services/user.service';
import { ReglasTorneoComponent } from './reglas-torneo.component';

@Component({
  selector: 'app-unirse',
  standalone: true,
  imports: [CommonModule, ReglasTorneoComponent],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="icono"><i class="ti ti-mail-opened"></i></div>
        @if (info(); as t) {
          <h1>{{ t.nombre }}</h1>
          <p class="codigo">
            {{ t.modo === 'quiniela' ? 'Quiniela por puntos' : 'Supervivencia' }}
            @if (t.competicionNombre) { · {{ t.competicionNombre }} }
          </p>
          <div class="datos">
            <span><i class="ti ti-users"></i> {{ t.inscritos }} inscrito(s)</span>
            @if (t.costoEntrada > 0) {
              <span class="costo"><i class="ti ti-coins"></i> {{ t.costoEntrada }} pts</span>
            } @else {
              <span><i class="ti ti-gift"></i> Gratis</span>
            }
          </div>
        } @else {
          <h1>Te invitaron a un torneo</h1>
          <p class="codigo">Código <strong>{{ codigo }}</strong></p>
        }

        @if (error()) {
          <div class="error">{{ error() }}</div>
        }

        @if (cargandoPerfil()) {
          <div class="cargando">
            <i class="ti ti-loader-2"></i>
            <span>Un momento…</span>
          </div>
        } @else if (!sesion()) {
          <div class="bloque">
            <h2>Así se juega</h2>
            <app-reglas-torneo [modo]="modo()" [costo]="costo()" [vidas]="vidas()" [vidaCubre]="vidaCubre()" [permiteRevivir]="permiteRevivir()" />
          </div>
          <p class="texto">Necesitas una cuenta para participar.</p>
          <button class="btn btn--primary" (click)="ir('registro')">Crear cuenta</button>
          <button class="btn" (click)="ir('login')">Ya tengo cuenta</button>
        } @else if (!validada()) {
          <div class="revision">
            <i class="ti ti-hourglass-high"></i>
            <strong>Tu cuenta está en revisión</strong>
            <p>
              Guardamos tu invitación. En cuanto el administrador valide tu cuenta,
              vuelve a abrir este enlace o entra desde la app para inscribirte.
            </p>
          </div>

          <div class="bloque">
            <h2>Mientras tanto, así se juega</h2>
            <app-reglas-torneo [modo]="modo()" [costo]="costo()" [vidas]="vidas()" [vidaCubre]="vidaCubre()" [permiteRevivir]="permiteRevivir()" />
          </div>

          <button class="btn" (click)="reintentar()">Ya me validaron, intentar</button>
          <button class="btn" (click)="salir()">Entendido</button>
        } @else {
          <div class="bloque">
            <h2>Antes de entrar, lee las reglas</h2>
            <app-reglas-torneo [modo]="modo()" [costo]="costo()" [vidas]="vidas()" [vidaCubre]="vidaCubre()" [permiteRevivir]="permiteRevivir()" />
          </div>

          <label class="acepto" [class.acepto--on]="acepto()">
            <input
              type="checkbox"
              class="acepto-input"
              [checked]="acepto()"
              (change)="acepto.set(!acepto())"
            />
            <span class="marca" aria-hidden="true"><i class="ti ti-check"></i></span>
            <span class="acepto-texto">Entiendo las reglas y quiero participar.</span>
          </label>

          <button
            class="btn btn--primary"
            [disabled]="!acepto() || cargando()"
            (click)="unirse()"
          >
            {{ cargando() ? 'Inscribiéndote…' : 'Aceptar y unirme' }}
          </button>
          <button class="btn" (click)="salir()">Ahora no</button>

          <p class="nota">
            Si el torneo tiene costo de entrada, se descontará de tu saldo al aceptar.
          </p>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .wrap {
        min-height: 100vh; display: flex; align-items: center; justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
      }
      .card {
        width: 100%; max-width: 420px; text-align: center;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 16px; padding: 26px 22px;
      }
      .icono {
        width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 14px;
        background: var(--accent-bg); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center; font-size: 26px;
      }
      h1 { font-size: 19px; font-weight: 600; margin: 0 0 4px; }
      h2 { font-size: 13px; font-weight: 600; margin: 0 0 6px; text-align: left;
        color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.4px; }
      .codigo { font-size: 13px; color: var(--text-secondary); margin: 0 0 18px; }
      .codigo strong { letter-spacing: 2px; }

      .datos {
        display: flex; justify-content: center; gap: 14px; flex-wrap: wrap;
        font-size: 12px; color: var(--text-secondary); margin-bottom: 18px;
      }
      .costo { color: var(--warning-text); font-weight: 600; }
      .bloque { text-align: left; margin-bottom: 18px; }
      .texto { font-size: 14px; color: var(--text-secondary); margin: 0 0 14px; }
      .nota { font-size: 12px; color: var(--text-muted); margin: 12px 0 0; }

      .acepto {
        display: flex; align-items: center; gap: 12px; cursor: pointer;
        text-align: left; margin-bottom: 16px; padding: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1);
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .acepto--on { border-color: var(--accent-fill); background: var(--accent-bg); }
      .acepto-input { position: absolute; opacity: 0; width: 0; height: 0; }
      .acepto-texto { flex: 1; font-size: 14px; line-height: 1.4; }

      .marca {
        flex-shrink: 0; width: 24px; height: 24px; border-radius: 7px;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid var(--border-strong); background: transparent;
        color: transparent; font-size: 15px;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .acepto--on .marca {
        background: var(--accent-fill); border-color: var(--accent-fill); color: #fff;
      }
      .acepto-input:focus-visible + .marca {
        outline: 2px solid var(--accent-text); outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        .acepto, .marca { transition: none; }
      }

      .cargando {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        padding: 28px 0; color: var(--text-muted); font-size: 13px;
      }
      .cargando i { font-size: 20px; animation: gira 1s linear infinite; }
      @keyframes gira {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .cargando i { animation: none; }
      }

      .revision {
        background: var(--warning-bg); color: var(--warning-text);
        border-radius: var(--radius); padding: 16px; margin-bottom: 18px; text-align: center;
      }
      .revision i { font-size: 26px; }
      .revision strong { display: block; font-size: 15px; margin: 6px 0 4px; }
      .revision p { font-size: 12px; margin: 0; opacity: 0.9; line-height: 1.5; }

      .error {
        background: var(--danger-bg); color: var(--danger-text);
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 16px;
      }
      .btn {
        width: 100%; padding: 12px; margin-bottom: 8px; cursor: pointer;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; font-size: 15px;
      }
      .btn--primary {
        background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600;
      }
      .btn:disabled { opacity: 0.5; cursor: default; }
    `,
  ],
})
export class UnirseComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly torneos = inject(TorneosService);
  private readonly users = inject(UserService);

  readonly codigo = (this.route.snapshot.paramMap.get('codigo') ?? '').toUpperCase();
  readonly sesion = toSignal(user(this.auth), { initialValue: null });
  /** undefined mientras carga; null si no hay documento. */
  private readonly me = toSignal(this.users.me$, { initialValue: undefined });

  /** Evita el parpadeo: no decidimos nada hasta tener el perfil. */
  readonly cargandoPerfil = computed(() => !!this.sesion() && this.me() === undefined);

  /** La inscripción requiere cuenta validada por un administrador. */
  readonly validada = computed(() => this.me()?.validada === true);
  readonly cargando = signal(false);
  readonly acepto = signal(false);
  readonly error = signal('');

  /** Datos del torneo, para mostrar las reglas correctas. */
  readonly info = signal<{
    nombre: string;
    modo: ModoTorneo;
    competicionNombre: string;
    costoEntrada: number;
    vidas: number;
    vidaCubre: 'empate' | 'tropiezo';
    permiteRevivir: boolean;
    inscritos: number;
  } | null>(null);

  readonly modo = computed<ModoTorneo>(() => this.info()?.modo ?? 'supervivencia');
  readonly costo = computed(() => this.info()?.costoEntrada ?? 0);
  readonly vidas = computed(() => this.info()?.vidas ?? 1);
  readonly vidaCubre = computed(() => this.info()?.vidaCubre ?? 'empate');
  readonly permiteRevivir = computed(() => this.info()?.permiteRevivir ?? false);

  constructor() {
    // La invitación sobrevive al cierre del navegador y a la espera de validación.
    if (this.codigo) localStorage.setItem('invitacion', this.codigo);

    // Consulta el torneo para saber qué reglas mostrar.
    this.torneos
      .consultar(this.codigo)
      .then((t) => this.info.set(t))
      .catch((e: Error) => this.error.set(e?.message ?? 'No encontramos ese torneo.'));
  }

  /** Guarda el código para retomar la invitación después de registrarse. */
  ir(destino: 'login' | 'registro'): void {
    localStorage.setItem('invitacion', this.codigo);
    this.router.navigate(['/' + destino]);
  }

  salir(): void {
    this.router.navigate(['/partidos']);
  }

  reintentar(): void {
    location.reload();
  }

  async unirse(): Promise<void> {
    if (!this.acepto()) return;

    this.error.set('');
    this.cargando.set(true);
    try {
      const r = await this.torneos.unirse(this.codigo);
      localStorage.removeItem('invitacion');
      if (r.costo > 0) {
        alert(`Quedaste inscrito. Se descontaron ${r.costo} puntos de tu saldo.`);
      }
      this.router.navigate(['/torneos', r.torneoId]);
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'No se pudo completar la inscripción.');
    } finally {
      this.cargando.set(false);
    }
  }
}