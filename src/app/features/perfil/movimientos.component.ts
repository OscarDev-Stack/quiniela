import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Auth, user } from '@angular/fire/auth';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { PerfilService, Movimiento } from '../../core/services/perfil.service';

/**
 * Historial de movimientos de puntos de la propia cuenta: entradas a
 * torneos, pagos por revivir, premios cobrados. Es el ledger visible,
 * en línea con la transparencia del resto de la app. Solo el mío: las
 * reglas de Firestore no dejan leer el ledger ajeno.
 */
@Component({
  selector: 'app-movimientos',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Mis movimientos" />

      @if (cargando()) {
        <app-cargando texto="Cargando movimientos" />
      }

      @if (movimientos(); as movs) {
        @if (movs.length === 0) {
          <div class="vacio">
            <i class="ti ti-receipt"></i>
            <p>Aún no tienes movimientos.</p>
            <p class="pista">Aquí verás tus entradas a torneos, revividas y premios.</p>
          </div>
        } @else {
          <p class="intro">
            Tu historial completo de puntos, lo más reciente primero. Cada línea
            queda registrada para que puedas hacer tus cuentas.
          </p>

          <div class="lista">
            @for (m of movs; track m.id) {
              <div class="mov">
                <div class="mov-izq">
                  <span class="mov-icono" [class]="claseIcono(m.tipo)">
                    <i class="ti" [class]="icono(m.tipo)"></i>
                  </span>
                  <div>
                    <span class="mov-tipo">{{ etiqueta(m.tipo) }}</span>
                    @if (m.detalle) { <span class="mov-detalle">{{ m.detalle }}</span> }
                    @if (fecha(m); as f) { <span class="mov-fecha">{{ f }}</span> }
                  </div>
                </div>
                <span class="mov-monto" [class.pos]="m.monto > 0" [class.neg]="m.monto < 0">
                  {{ m.monto > 0 ? '+' : '' }}{{ m.monto | number }}
                </span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .intro { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin: 0 0 16px; }
      .lista { display: flex; flex-direction: column; gap: 8px; }
      .mov {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1);
      }
      .mov-izq { display: flex; align-items: center; gap: 11px; min-width: 0; }
      .mov-icono {
        flex-shrink: 0; width: 34px; height: 34px; border-radius: 9px;
        display: flex; align-items: center; justify-content: center; font-size: 17px;
        background: var(--surface-2); color: var(--text-secondary);
      }
      .icono--neg { background: var(--warning-bg); color: var(--warning-text); }
      .icono--pos { background: var(--success-bg); color: var(--success-text); }
      .icono--revivir { background: var(--accent-bg); color: var(--accent-text); }
      .mov-tipo { display: block; font-size: 14px; font-weight: 600; color: var(--text-primary); }
      .mov-detalle { display: block; font-size: 12px; color: var(--text-secondary); }
      .mov-fecha { display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px; }
      .mov-monto {
        flex-shrink: 0; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums;
        color: var(--text-secondary);
      }
      .mov-monto.pos { color: var(--success-text); }
      .mov-monto.neg { color: var(--warning-text); }
      .vacio { text-align: center; padding: 48px 20px; color: var(--text-muted); }
      .vacio i { font-size: 40px; opacity: 0.5; }
      .vacio p { margin: 10px 0 0; font-size: 14px; }
      .vacio .pista { font-size: 12px; color: var(--text-muted); }
      .cargando { font-size: 14px; color: var(--text-muted); }
    `,
  ],
})
export class MovimientosComponent {
  private readonly auth = inject(Auth);
  private readonly perfil = inject(PerfilService);

  private readonly uid = toSignal(user(this.auth).pipe(map((u) => u?.uid ?? null)), {
    initialValue: null,
  });

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  readonly movimientos = toSignal(
    user(this.auth).pipe(
      map((u) => u?.uid ?? null),
      switchMap((uid) => (uid ? this.perfil.movimientos(uid) : of([] as Movimiento[]))),
      tap(() => apagarCargando(this.cargando, this.inicioCarga)),
    ),
    { initialValue: undefined },
  );

  /** Nombre legible de cada tipo de movimiento. */
  etiqueta(tipo: string): string {
    const m: Record<string, string> = {
      'apuesta': 'Pronóstico',
      'torneo-entrada': 'Entrada a torneo',
      'torneo-revivir': 'Reviviste en un torneo',
      'premio': 'Pronóstico acertado',
      'torneo-premio': 'Premio de torneo',
      'bracket-entrada': 'Entrada a eliminatoria',
      'bracket-premio': 'Premio de eliminatoria',
      'sobrante': 'Sobrante de bolsa',
      'devolucion': 'Devolución',
      'torneo-devolucion': 'Devolución',
      'devolucion-cancelacion': 'Devolución por cancelación',
      'reinicio': 'Reinicio de saldo',
    };
    if (m[tipo]) return m[tipo];
    // Tipo no listado (p. ej. uno agregado a mano): se limpia y capitaliza
    // para que no se vea crudo en minúsculas con guiones.
    const limpio = tipo.replace(/[-_]/g, ' ').trim();
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
  }

  icono(tipo: string): string {
    if (tipo === 'torneo-revivir') return 'ti-heart';
    if (tipo.includes('premio')) return 'ti-trophy';
    if (tipo.includes('devolucion')) return 'ti-arrow-back-up';
    if (tipo === 'reinicio') return 'ti-refresh';
    if (tipo === 'sobrante') return 'ti-coins';
    return 'ti-ticket';
  }

  claseIcono(tipo: string): string {
    if (tipo === 'torneo-revivir') return 'mov-icono icono--revivir';
    if (tipo.includes('premio')) return 'mov-icono icono--pos';
    if (tipo.includes('devolucion')) return 'mov-icono icono--pos';
    if (tipo === 'reinicio') return 'mov-icono';
    return 'mov-icono icono--neg';
  }

  fecha(m: Movimiento): string {
    const seg = m.createdAt?.seconds;
    if (!seg) return '';
    const d = new Date(seg * 1000);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}