import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { NavComponent } from '../../shared/nav.component';
import { UserService } from '../../core/services/user.service';
import { CompeticionesService } from '../../core/services/competiciones.service';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';

/**
 * Panel del gestor de liga. Muestra solo las competiciones que gestiona
 * y le deja capturar y publicar resultados de sus jornadas — nada más.
 * La creación de ligas, equipos y la asignación de gestores se quedan
 * en el panel de admin, fuera de su alcance.
 */
@Component({
  selector: 'app-liga-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Mi liga" />

      <span class="rol"><i class="ti ti-ball-football"></i> Administrador de liga</span>
      <p class="desc">
        Captura los resultados de tus jornadas y publícalos. Al publicar, se
        aplican a todos los torneos que estén jugando esa jornada.
      </p>

      @if (ligas().length === 0) {
        <div class="vacio">
          <i class="ti ti-shield"></i>
          <p>No administras ninguna liga por ahora.</p>
        </div>
      }

      @for (c of ligas(); track c.id) {
        <section class="panel">
          <button class="liga-cab" (click)="alternarLiga(c.id)">
            <i class="ti" [class.ti-chevron-down]="!ligaAbierta(c.id)" [class.ti-chevron-up]="ligaAbierta(c.id)"></i>
            <span class="liga-nom">{{ c.nombre }}</span>
          </button>

          @if (ligaAbierta(c.id)) {
            @if (jornadas(c.id).length === 0) {
              <p class="sin-jornadas">Esta liga aún no tiene jornadas.</p>
            }

            @for (j of jornadas(c.id); track j.id) {
              <div class="jornada">
                <button class="jornada-cab" (click)="alternarJornada(j.id)">
                  <i class="ti" [class.ti-chevron-down]="!jornadaAbierta(j.id)" [class.ti-chevron-up]="jornadaAbierta(j.id)"></i>
                  <span class="jornada-tit">Jornada {{ j.numero }}</span>
                  @if (j.estado === 'resuelta') {
                    <span class="marca marca--ok">Publicada</span>
                  } @else if (faltantes(j) > 0) {
                    <span class="marca marca--warn">Faltan {{ faltantes(j) }}</span>
                  } @else {
                    <span class="marca marca--lista">Lista</span>
                  }
                </button>

                @if (jornadaAbierta(j.id)) {
                  @for (p of j.partidos; track $index) {
                    <div class="partido">
                      <span class="equipos">{{ p.local }} vs {{ p.visitante }}</span>
                      @if (j.estado === 'resuelta') {
                        <span class="res">{{ etiqueta(p) }}</span>
                      } @else {
                        <div class="captura">
                          <input
                            type="number" min="0" max="20" class="goles"
                            [ngModel]="p.golesLocal"
                            (ngModelChange)="ponerGoles(p, 'local', $event)"
                            aria-label="Goles del local"
                          />
                          <span class="guion">–</span>
                          <input
                            type="number" min="0" max="20" class="goles"
                            [ngModel]="p.golesVisitante"
                            (ngModelChange)="ponerGoles(p, 'visitante', $event)"
                            aria-label="Goles del visitante"
                          />
                        </div>
                      }
                    </div>
                  }

                  @if (j.estado !== 'resuelta') {
                    <div class="acciones">
                      <button class="btn" (click)="guardar(c.id, j)">Guardar</button>
                      <button
                        class="btn btn--primary"
                        [disabled]="faltantes(j) > 0 || publicando()"
                        (click)="publicar(c.id, j)"
                      >
                        {{ publicando() ? 'Publicando…' : 'Publicar jornada' }}
                      </button>
                    </div>
                  }
                }
              </div>
            }
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .rol {
        display: inline-flex; align-items: center; gap: 7px;
        padding: 6px 12px; border-radius: 999px;
        background: var(--accent-bg); color: var(--accent-text);
        font-size: 13px; font-weight: 700;
      }
      .desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 10px 0 18px; }
      .vacio { text-align: center; padding: 40px 20px; color: var(--text-muted); }
      .vacio i { font-size: 38px; opacity: 0.5; }
      .vacio p { margin: 10px 0 0; font-size: 14px; }
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 6px; margin-bottom: 12px;
      }
      .liga-cab {
        display: flex; align-items: center; gap: 10px; width: 100%;
        background: transparent; border: none; padding: 10px; cursor: pointer;
        color: inherit; font-size: 15px; font-weight: 700;
      }
      .liga-cab i { color: var(--text-muted); }
      .sin-jornadas { font-size: 13px; color: var(--text-muted); padding: 0 10px 10px; }
      .jornada { border-top: 1px solid var(--border); }
      .jornada-cab {
        display: flex; align-items: center; gap: 10px; width: 100%;
        background: transparent; border: none; padding: 11px 10px; cursor: pointer;
        color: inherit; font-size: 14px; font-weight: 600;
      }
      .jornada-cab i { color: var(--text-muted); }
      .jornada-tit { flex: 1; text-align: left; }
      .marca { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
      .marca--ok { background: var(--success-bg); color: var(--success-text); }
      .marca--warn { background: var(--warning-bg); color: var(--warning-text); }
      .marca--lista { background: var(--accent-bg); color: var(--accent-text); }
      .partido {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 8px 12px;
      }
      .equipos { font-size: 13px; color: var(--text-secondary); }
      .captura { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .goles {
        width: 46px; text-align: center; padding: 7px; font-size: 15px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .guion { color: var(--text-muted); }
      .res { font-size: 13px; font-weight: 600; color: var(--text-primary); }
      .acciones { display: flex; gap: 8px; padding: 10px 12px; }
      .btn {
        flex: 1; padding: 10px; cursor: pointer; font-size: 14px; font-weight: 600;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; color: var(--text-primary);
      }
      .btn--primary { border: none; background: var(--accent-fill); color: #fff; }
      .btn--primary:disabled { opacity: 0.5; cursor: default; }
    `,
  ],
})
export class LigaPanelComponent {
  private readonly users = inject(UserService);
  private readonly service = inject(CompeticionesService);
  private readonly confirmar = inject(ConfirmarService);
  private readonly toast = inject(ToastService);

  readonly ligas = toSignal(this.users.misLigas$, { initialValue: [] as Array<{ id: string; nombre: string }> });

  readonly publicando = signal(false);

  private readonly ligaAbiertaId = signal<string | null>(null);
  private readonly jornadaAbiertaId = signal<string | null>(null);

  // Jornadas de todas mis ligas, cargadas por liga abierta.
  private readonly jornadasSignal = toSignal(
    toObservable(this.ligaAbiertaId).pipe(
      switchMap((id) => (id ? this.service.jornadas(id) : of([] as Jornada[]))),
    ),
    { initialValue: [] as Jornada[] },
  );

  jornadas(competicionId: string): Jornada[] {
    // Solo cargamos las de la liga abierta; para las demás, vacío.
    return this.ligaAbiertaId() === competicionId ? this.jornadasSignal() : [];
  }

  ligaAbierta(id: string): boolean {
    return this.ligaAbiertaId() === id;
  }
  alternarLiga(id: string): void {
    this.ligaAbiertaId.set(this.ligaAbiertaId() === id ? null : id);
    this.jornadaAbiertaId.set(null);
  }

  jornadaAbierta(id: string): boolean {
    return this.jornadaAbiertaId() === id;
  }
  alternarJornada(id: string): void {
    this.jornadaAbiertaId.set(this.jornadaAbiertaId() === id ? null : id);
  }

  faltantes(j: Jornada): number {
    return j.partidos.filter((p) => !p.resultado).length;
  }

  etiqueta(p: PartidoJornada): string {
    if (p.resultado === 'pospuesto') return 'Aplazado';
    if (typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number') {
      return `${p.golesLocal} – ${p.golesVisitante}`;
    }
    return '—';
  }

  ponerGoles(p: PartidoJornada, lado: 'local' | 'visitante', valor: unknown): void {
    const n = Number(valor);
    const goles = Number.isFinite(n) && n >= 0 ? n : null;
    if (lado === 'local') p.golesLocal = goles;
    else p.golesVisitante = goles;

    // Deriva el resultado cuando ambos marcadores están puestos.
    if (typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number') {
      p.resultado =
        p.golesLocal > p.golesVisitante
          ? 'local'
          : p.golesLocal < p.golesVisitante
            ? 'visitante'
            : 'empate';
    } else {
      p.resultado = null;
    }
  }

  async guardar(competicionId: string, j: Jornada): Promise<void> {
    try {
      await this.service.guardarResultados(competicionId, j.id, this.limpiar(j.partidos));
      this.toast.exito('Resultados guardados.');
    } catch {
      this.toast.error('No se pudieron guardar los resultados.');
    }
  }

  /**
   * Firestore rechaza campos undefined. Normaliza cada partido para que
   * los marcadores y el resultado sean número o null, nunca undefined.
   */
  private limpiar(partidos: PartidoJornada[]): PartidoJornada[] {
    return partidos.map((p) => ({
      local: p.local,
      visitante: p.visitante,
      golesLocal: typeof p.golesLocal === 'number' ? p.golesLocal : null,
      golesVisitante: typeof p.golesVisitante === 'number' ? p.golesVisitante : null,
      resultado: p.resultado ?? null,
    }));
  }

  async publicar(competicionId: string, j: Jornada): Promise<void> {
    if (this.faltantes(j) > 0) {
      this.toast.error('Faltan resultados por capturar.');
      return;
    }
    const ok = await this.confirmar.pedir({
      titulo: `Publicar la jornada ${j.numero}`,
      mensaje: 'Se aplicará a todos los torneos que estén en esta jornada. No se puede deshacer.',
      aceptar: 'Publicar',
      peligro: true,
    });
    if (!ok) return;

    this.publicando.set(true);
    try {
      await this.service.guardarResultados(competicionId, j.id, this.limpiar(j.partidos));
      await this.service.resolver(competicionId, j.id);
      this.toast.exito(`Jornada ${j.numero} publicada y aplicada a los torneos.`);
    } catch {
      this.toast.error('No se pudo publicar.');
    } finally {
      this.publicando.set(false);
    }
  }
}