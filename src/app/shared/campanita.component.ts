import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { PerfilService, Movimiento } from '../core/services/perfil.service';

/**
 * Campanita de notificaciones en el encabezado. Muestra los movimientos
 * de puntos (del ledger) más recientes, con un punto rojo cuando hay
 * novedades desde la última vez que se abrió.
 *
 * El "leído" se guarda en el dispositivo (localStorage): si hay
 * movimientos más nuevos que la última apertura, se marca el punto.
 * Así no toca el ledger ni genera escrituras extra.
 */
@Component({
  selector: 'app-campanita',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="campanita">
      <button class="btn-campana" (click)="alternar()" aria-label="Notificaciones">
        <i class="ti ti-bell"></i>
        @if (hayNuevas()) {
          <span class="punto" aria-hidden="true"></span>
        }
      </button>

      @if (abierto()) {
        <div class="fondo" (click)="cerrar()"></div>

        <div class="panel">
          <div class="panel-cab">
            <span class="panel-tit">Notificaciones</span>
          </div>

          @if (lista().length === 0) {
            <div class="vacio">
              <i class="ti ti-bell-off"></i>
              <p>Aún no hay movimientos.</p>
            </div>
          } @else {
            <div class="items">
              @for (m of lista(); track m.id) {
                <div class="item" [class.item--nuevo]="esNueva(m)">
                  <span class="item-icono" [class]="claseIcono(m.tipo)">
                    <i class="ti" [class]="icono(m.tipo)"></i>
                  </span>
                  <div class="item-txt">
                    <span class="item-tit">{{ etiqueta(m.tipo) }}</span>
                    @if (m.detalle) { <span class="item-det">{{ m.detalle }}</span> }
                    @if (fecha(m); as f) { <span class="item-fecha">{{ f }}</span> }
                  </div>
                  <span class="item-monto" [class.pos]="m.monto > 0" [class.neg]="m.monto < 0">
                    {{ m.monto > 0 ? '+' : '' }}{{ m.monto | number }}
                  </span>
                </div>
              }
            </div>

            <button class="ver-todos" (click)="verTodos()">
              Ver todos mis movimientos
              <i class="ti ti-arrow-right"></i>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .campanita { position: relative; }
      .btn-campana {
        position: relative; background: transparent; border: none; cursor: pointer;
        color: var(--text-secondary); font-size: 20px; padding: 4px; line-height: 1;
      }
      .punto {
        position: absolute; top: 2px; right: 2px;
        width: 9px; height: 9px; border-radius: 50%;
        background: var(--danger-text); border: 1.5px solid var(--surface-0, #fff);
      }

      .fondo { position: fixed; inset: 0; z-index: 190; }
      .panel {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 200;
        width: min(340px, 90vw); max-height: 70vh; overflow-y: auto;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
        animation: aparecer 0.18s ease;
      }
      /* En móvil, centramos el panel en la pantalla para que no se corte
         ni quede pegado a la orilla, sin importar dónde esté la campanita. */
      @media (max-width: 640px) {
        .panel {
          position: fixed;
          top: 64px;
          left: 50%;
          right: auto;
          transform: translateX(-50%);
          width: calc(100vw - 24px);
          max-width: 380px;
          animation: none;
        }
      }
      @keyframes aparecer {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .panel-cab {
        padding: 13px 15px; border-bottom: 1px solid var(--border);
        position: sticky; top: 0; background: var(--surface-2);
      }
      .panel-tit { font-size: 14px; font-weight: 700; }

      .vacio { text-align: center; padding: 34px 20px; color: var(--text-muted); }
      .vacio i { font-size: 30px; opacity: 0.5; }
      .vacio p { margin: 8px 0 0; font-size: 13px; }

      .items { display: flex; flex-direction: column; }
      .item {
        display: flex; align-items: center; gap: 11px;
        padding: 11px 14px; border-bottom: 1px solid var(--border);
      }
      .item:last-child { border-bottom: none; }
      .item--nuevo { background: var(--accent-bg); }
      .item-icono {
        flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 16px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .item-icono.ok { background: var(--success-bg); color: var(--success-text); }
      .item-icono.gasto { background: var(--danger-bg); color: var(--danger-text); }
      .item-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .item-tit { font-size: 13px; font-weight: 600; }
      .item-det { font-size: 12px; color: var(--text-secondary); }
      .item-fecha { font-size: 11px; color: var(--text-muted); }
      .item-monto { flex-shrink: 0; font-size: 13px; font-weight: 700; }
      .item-monto.pos { color: var(--success-text); }
      .item-monto.neg { color: var(--danger-text); }

      .ver-todos {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
        padding: 12px; cursor: pointer; font-size: 13px; font-weight: 600;
        border: none; border-top: 1px solid var(--border);
        background: transparent; color: var(--accent-fill);
        position: sticky; bottom: 0;
      }
      .ver-todos:hover { background: var(--accent-bg); }
    `,
  ],
})
export class CampanitaComponent {
  private readonly perfil = inject(PerfilService);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly abierto = signal(false);

  /** Marca de tiempo (ms) de la última apertura, guardada por dispositivo. */
  private readonly ultimaVista = signal<number>(this.leerUltimaVista());

  private readonly movimientos = toSignal(
    user(this.auth).pipe(
      map((u) => u?.uid ?? null),
      switchMap((uid) => (uid ? this.perfil.movimientos(uid) : of([] as Movimiento[]))),
    ),
    { initialValue: [] as Movimiento[] },
  );

  /** Mostramos los más recientes; el ledger ya viene ordenado desc. */
  readonly lista = computed(() => this.movimientos().slice(0, 5));

  /** ¿Hay algún movimiento más nuevo que la última vez que abrí? */
  readonly hayNuevas = computed(() => {
    const ultima = this.ultimaVista();
    return this.movimientos().some((m) => this.ms(m) > ultima);
  });

  esNueva(m: Movimiento): boolean {
    return this.ms(m) > this.ultimaVista();
  }

  alternar(): void {
    const abrir = !this.abierto();
    this.abierto.set(abrir);
    if (abrir) {
      // Al abrir, marcamos todo como visto (guardamos el instante actual).
      const ahora = Date.now();
      // Nota: guardamos DESPUÉS de que hayNuevas ya se calculó para esta apertura,
      // así los "nuevos" se resaltan esta vez y dejan de estarlo la próxima.
      setTimeout(() => {
        this.ultimaVista.set(ahora);
        this.guardarUltimaVista(ahora);
      }, 50);
    }
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  /** Cierra el panel y lleva a la pantalla completa de movimientos. */
  verTodos(): void {
    this.abierto.set(false);
    this.router.navigate(['/movimientos']);
  }

  // --- Persistencia local de la última vista ---
  private leerUltimaVista(): number {
    try {
      const v = localStorage.getItem('campanita:ultimaVista');
      return v ? Number(v) : 0;
    } catch {
      return 0;
    }
  }
  private guardarUltimaVista(ms: number): void {
    try {
      localStorage.setItem('campanita:ultimaVista', String(ms));
    } catch {
      // Si localStorage no está disponible, no pasa nada grave.
    }
  }

  private ms(m: Movimiento): number {
    return (m.createdAt?.seconds ?? 0) * 1000;
  }

  // --- Presentación (mismas etiquetas que la vista de movimientos) ---
  etiqueta(tipo: string): string {
    const map: Record<string, string> = {
      apuesta: 'Pronóstico',
      premio: 'Pronóstico acertado',
      'torneo-entrada': 'Entrada a torneo',
      'torneo-premio': 'Premio de torneo',
      'torneo-revivir': 'Revivir',
      reinicio: 'Reinicio de saldo',
      sobrante: 'Sobrante',
      devolucion: 'Devolución',
      devoluciones: 'Devoluciones',
    };
    return map[tipo] ?? tipo.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  icono(tipo: string): string {
    const map: Record<string, string> = {
      apuesta: 'ti-ticket',
      premio: 'ti-trophy',
      'torneo-entrada': 'ti-login',
      'torneo-premio': 'ti-award',
      'torneo-revivir': 'ti-heart',
      reinicio: 'ti-refresh',
      sobrante: 'ti-coins',
      devolucion: 'ti-arrow-back-up',
      devoluciones: 'ti-arrow-back-up',
    };
    return map[tipo] ?? 'ti-coins';
  }

  claseIcono(tipo: string): string {
    if (tipo === 'premio' || tipo === 'torneo-premio' || tipo === 'sobrante') return 'ok';
    if (tipo === 'apuesta' || tipo === 'torneo-entrada' || tipo === 'torneo-revivir') return 'gasto';
    return '';
  }

  fecha(m: Movimiento): string | null {
    if (!m.createdAt?.seconds) return null;
    const d = new Date(m.createdAt.seconds * 1000);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}