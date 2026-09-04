import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TorneosService } from '../../core/services/torneos.service';
import { ModoTorneo } from '../../core/models/torneo.model';
import { Grupo } from '../../core/models/grupo.model';
import { Competicion } from '../../core/models/competicion.model';
import { CompeticionesService } from '../../core/services/competiciones.service';
import { GruposService } from '../../core/services/grupos.service';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';
import { NavComponent } from '../../shared/nav.component';

/**
 * Pantalla dedicada SOLO a crear un torneo (quiniela o supervivencia).
 * La gestión de torneos ya creados vive en GestionarTorneosComponent.
 * Si llega con ?grupo=ID, el torneo se crea para ese grupo (selector fijo).
 */
@Component({
  selector: 'app-crear-torneo',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent],
  template: `
    <app-nav [back]="true" [minimal]="true" title="Crear torneo" [ocultarSaldo]="true" />
    <section class="panel">
      <div class="grid">
        <label class="field">
          <span>Nombre</span>
          <input type="text" [(ngModel)]="form.nombre" placeholder="AutomatePower" />
          <small class="pista">Como le van a decir entre ustedes.</small>
        </label>
        <label class="field">
          <span>¿Para quién?</span>
          <select [(ngModel)]="form.grupoId" [disabled]="grupoBloqueado()">
            <option value="">🌎 Global (todos)</option>
            @for (g of misGrupos(); track g.id) {
              <option [value]="g.id">{{ g.icono }} {{ g.nombre }}</option>
            }
          </select>
          @if (grupoBloqueado()) {
            <small class="pista">Este torneo será para el grupo desde el que entraste.</small>
          } @else {
            <small class="pista">Global lo ven todos; un grupo, solo sus miembros.</small>
          }
        </label>
        <label class="field">
          <span>Modo de juego</span>
          <select [(ngModel)]="form.modo">
            <option value="supervivencia">Supervivencia</option>
            <option value="quiniela">Quiniela por puntos</option>
          </select>
        </label>
        @if (form.modo === 'quiniela') {
          <label class="field">
            <span>Jornadas que dura</span>
            <input type="number" min="1" max="20" [(ngModel)]="form.jornadas" />
            <small class="pista">
              Empezando en la jornada {{ form.jornadaInicial || 1 }}, terminará en la
              <strong>jornada {{ jornadaFinal() }}</strong>.
              Ajusta la duración para que llegue hasta donde quieras que acabe la liga.
            </small>
          </label>
        } @else {
          <label class="field">
            <span>Vidas por jugador</span>
            <select [(ngModel)]="form.vidas">
              <option [ngValue]="0">Sin vidas (un tropiezo y fuera)</option>
              <option [ngValue]="1">1 vida</option>
              <option [ngValue]="2">2 vidas</option>
              <option [ngValue]="3">3 vidas</option>
            </select>
          </label>

          @if (form.vidas > 0) {
            <label class="field">
              <span>¿Qué salva una vida?</span>
              <select [(ngModel)]="form.vidaCubre">
                <option value="empate">Solo empates</option>
                <option value="tropiezo">Empates y derrotas</option>
              </select>
              <small class="pista">
                @if (form.vidaCubre === 'empate') {
                  El empate gasta una vida; la derrota siempre elimina.
                } @else {
                  Cualquier tropiezo, empate o derrota, gasta una vida.
                }
              </small>
            </label>
          }

          <label class="switch">
            <span class="switch-texto">
              Permitir revivir
              <small class="pista">
                Quien caiga puede volver una vez, solo en la jornada siguiente,
                a muerte súbita. Cuesta (jornada ÷ 2) × la entrada.
              </small>
            </span>
            <input type="checkbox" class="switch-input" [(ngModel)]="form.permiteRevivir" />
            <span class="switch-pista" aria-hidden="true"></span>
          </label>
        }
        <label class="field">
          <span>Competición</span>
          <select [(ngModel)]="form.competicionId">
            <option value="">Elige una…</option>
            @for (c of competiciones(); track c.id) {
              <option [value]="c.id">{{ c.nombre }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Jornada de inicio</span>
          <input type="number" min="1" [(ngModel)]="form.jornadaInicial" />
          @if (form.modo === 'quiniela') {
            <small class="pista">
              El torneo tomará {{ form.jornadas || 1 }} jornada(s) desde aquí y terminará en la
              <strong>jornada {{ jornadaFinal() }}</strong>.
            </small>
          }
        </label>
        <label class="field">
          <span>Cierre de inscripciones</span>
          <input type="datetime-local" [(ngModel)]="form.cierreInscripcion" />
          <small class="pista">
            A esa hora el torneo arranca solo. Si no hay al menos dos jugadores,
            se cancela y se devuelven los puntos.
          </small>
        </label>
        <label class="field">
          <span>Costo de entrada (puntos)</span>
          <select [(ngModel)]="form.costoEntrada">
            <option [ngValue]="0">Gratis</option>
            <option [ngValue]="100">100 pts</option>
            <option [ngValue]="200">200 pts</option>
            <option [ngValue]="500">500 pts</option>
            <option [ngValue]="1000">1000 pts</option>
          </select>
        </label>
        <label class="field">
          <span>% al bote acumulado</span>
          <select [(ngModel)]="form.porcentajeBote">
            <option [ngValue]="0">Nada</option>
            <option [ngValue]="5">5%</option>
            <option [ngValue]="10">10%</option>
            <option [ngValue]="15">15%</option>
            <option [ngValue]="20">20%</option>
          </select>
          <small class="pista">Parte de la bolsa que se guarda para un torneo especial.</small>
        </label>
        <div class="field regla-fija">
          <span>Reglas</span>
          @if (form.modo === 'quiniela') {
            <p>
              Pronosticas el marcador de todos los partidos.
              Marcador exacto: 5 puntos. Solo acertar quién gana: 3 puntos.
              Gana quien más acumule.
            </p>
          } @else {
            <p>{{ resumenSupervivencia() }}</p>
          }
        </div>
      </div>
      <button class="btn btn--primary" [disabled]="guardando()" (click)="crear()">
        {{ guardando() ? 'Creando…' : 'Crear torneo' }}
      </button>
    </section>

  `,
  styles: [
    `
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat { background: var(--surface-1); border-radius: var(--radius); padding: 12px 14px; }
      .stat-label { font-size: 12px; color: var(--text-secondary); }
      .stat-val { font-size: 22px; font-weight: 600; }
      .accent { color: var(--accent-text); }
      @media (max-width: 620px) {
        .stats { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .stat-val { font-size: 19px; }
      }

      .msg { display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px; border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text); }

      .panel { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
      h2 { font-size: 16px; font-weight: 600; margin: 0; }
      .sub { font-size: 12px; color: var(--text-muted); }
      .pista { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
      .switch {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
        cursor: pointer; margin-top: 4px;
      }
      .switch-texto { flex: 1; font-size: 14px; }
      .switch-input { position: absolute; opacity: 0; width: 0; height: 0; }
      .switch-pista {
        position: relative; flex-shrink: 0; margin-top: 2px;
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
      .regla-fija p { font-size: 12px; color: var(--text-muted); margin: 0;
        background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .bolsa { font-size: 13px; color: var(--success-text); margin-top: 4px; }
      .cab { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
      .cab--boton {
        width: 100%; cursor: pointer; text-align: left;
        background: transparent; border: none; padding: 0; color: inherit;
        align-items: center;
      }
      .cab--boton:hover h2 { color: var(--accent-text); }
      .cab-datos { flex: 1; min-width: 0; }
      .chevron { font-size: 18px; color: var(--text-muted); flex-shrink: 0; }
      .tag { font-size: 11px; font-weight: 700; text-transform: uppercase;
        padding: 3px 9px; border-radius: 999px; background: var(--surface-1); color: var(--text-secondary); }

      .grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .field { display: block; margin-bottom: 12px; }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      textarea { width: 100%; font-family: inherit; font-size: 16px; padding: 11px 12px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary); }

      .invitacion {
        background: var(--surface-1); border-radius: var(--radius);
        padding: 12px; margin-bottom: 14px;
      }
      .codigo {
        display: block; text-align: center; margin-bottom: 10px;
        font-family: var(--font-mono, monospace); font-size: 18px; font-weight: 700;
        letter-spacing: 3px; color: var(--text-primary);
      }
      .invitacion-acciones { display: flex; gap: 8px; }
      .invitacion-acciones .btn { flex: 1; justify-content: center; }

      .participantes { border-top: 1px solid var(--border); padding-top: 12px; margin-bottom: 14px; }
      .part-cab { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
      .part-cab--boton {
        width: 100%; cursor: pointer; text-align: left; align-items: center;
        background: transparent; border: none; padding: 0; color: inherit;
      }
      .part-cab--boton:hover strong { color: var(--accent-text); }
      .part-cab--boton .sub { margin-left: auto; }
      .buscador {
        display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
        border: 1px solid var(--border); border-radius: var(--radius);
        padding: 0 12px; color: var(--text-muted);
      }
      .buscador input { border: none; background: transparent; padding: 10px 0; min-height: 40px; }
      .buscador input:focus { outline: none; }
      .part {
        display: grid; align-items: center; gap: 8px;
        grid-template-columns: 1fr auto;
        padding: 10px 0; border-bottom: 1px solid var(--border);
      }
      .part-datos {
        grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      }
      @media (min-width: 520px) {
        .part { grid-template-columns: 1fr auto auto; }
        .part-datos { grid-column: auto; }
      }
      .part:last-child { border-bottom: none; }
      .part--fuera { opacity: 0.6; }
      .part-alias { flex: 1; font-size: 14px; font-weight: 600; min-width: 110px;
        display: flex; align-items: center; gap: 5px; }
      .gestor-ico { color: var(--accent-fill); font-size: 14px; }
      .part-vidas { color: var(--danger-text); font-size: 12px; }
      .sin-vidas { color: var(--warning-text); font-size: 11px; }
      .part-estado { font-size: 11px; color: var(--text-muted); }
      .part-estado.ok { color: var(--success-text); font-weight: 600; }
      .part-usados { font-size: 11px; color: var(--text-muted); }

      .jornada-nueva { border-top: 1px solid var(--border); padding-top: 14px; margin-bottom: 14px; }
      .jornada { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
      .jornada-cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .partido { display: flex; align-items: center; gap: 10px; padding: 6px 0; flex-wrap: wrap; }
      .equipos { flex: 1; font-size: 14px; min-width: 160px; }
      .partido select { width: auto; min-width: 170px; }
      .res { font-size: 13px; color: var(--text-secondary); }
      .acciones { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

      .btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 9px 16px; cursor: pointer; border: 1px solid var(--border-strong);
        border-radius: var(--radius); background: transparent; font-size: 14px;
        color: var(--text-primary);
      }
      .btn.sm { padding: 7px 13px; font-size: 13px; }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600; }
      .btn:disabled { opacity: 0.6; cursor: default; }

      @media (max-width: 620px) {
        .grid { grid-template-columns: 1fr; }
        .partido select { width: 100%; }
      }
    `,
  ],
})
export class CrearTorneoComponent {
  private readonly service = inject(TorneosService);
  private readonly gruposSrv = inject(GruposService);
  private readonly competicionesSrv = inject(CompeticionesService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly stats = inject(StatsService);

  /** Grupos donde soy admin (puedo crearles torneos). */
  readonly misGrupos = toSignal(this.gruposSrv.misGrupos(), { initialValue: [] as Grupo[] });
  /** Si venimos desde un grupo, el selector queda fijo en ese grupo. */
  readonly grupoBloqueado = signal(false);
  readonly guardando = signal(false);

  readonly competiciones = toSignal(this.competicionesSrv.competiciones(), {
    initialValue: [] as Competicion[],
  });

  form = {
    nombre: '',
    modo: 'supervivencia' as ModoTorneo,
    jornadas: 5,
    vidas: 1,
    vidaCubre: 'empate' as 'empate' | 'tropiezo',
    permiteRevivir: false,
    competicionId: '',
    jornadaInicial: 1,
    costoEntrada: 0,
    porcentajeBote: 0,
    cierreInscripcion: '',
    grupoId: '' as string,
  };

  private readonly grupoUrl = inject(ActivatedRoute).snapshot.queryParamMap.get('grupo');

  constructor() {
    if (this.grupoUrl) {
      this.form.grupoId = this.grupoUrl;
      this.grupoBloqueado.set(true);
    }
  }

  /**
   * Jornada en la que TERMINARÁ el torneo según inicio + duración. Es un
   * cálculo exacto (inicio + duración − 1) que no depende de conocer cuántas
   * jornadas tiene la liga, así que sirve para cualquier competición.
   */
  jornadaFinal(): number {
    const inicio = Math.max(1, Math.floor(Number(this.form.jornadaInicial) || 1));
    const dura = Math.max(1, Math.floor(Number(this.form.jornadas) || 1));
    return inicio + dura - 1;
  }

  /** Resumen de las reglas de supervivencia según lo elegido. */
  resumenSupervivencia(): string {
    const v = Number(this.form.vidas);
    if (v === 0) {
      return 'Sin vidas: un solo tropiezo, empate o derrota, y quedas fuera.';
    }
    const cuantas = v === 1 ? 'Una vida' : `${v} vidas`;
    if (this.form.vidaCubre === 'tropiezo') {
      return `${cuantas} por jugador. Cada empate o derrota gasta una; al agotarlas, el siguiente tropiezo elimina.`;
    }
    return `${cuantas} por jugador. El empate gasta una vida; la derrota siempre elimina.`;
  }

  async crear(): Promise<void> {
    if (!this.form.nombre.trim()) {
      this.toast.exito('Ponle nombre al torneo.');
      return;
    }
    const comp = this.competiciones().find((c) => c.id === this.form.competicionId);
    if (!comp) {
      this.toast.error('Elige una competición. Si no hay, créala en la pestaña Ligas.');
      return;
    }
    if (!this.form.cierreInscripcion) {
      this.toast.exito('Indica hasta cuándo se puede entrar al torneo.');
      return;
    }
    const cierre = new Date(this.form.cierreInscripcion);
    if (cierre.getTime() <= Date.now()) {
      this.toast.error('Esa hora ya pasó. Elige una futura.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.service.crearTorneo({
        nombre: this.form.nombre.trim(),
        competicionId: comp.id,
        competicionNombre: comp.nombre,
        jornadaInicial: Number(this.form.jornadaInicial) || 1,
        costoEntrada: Number(this.form.costoEntrada),
        porcentajeBote: Number(this.form.porcentajeBote),
        cierreInscripcion: cierre,
        modo: this.form.modo,
        jornadas: this.form.modo === 'quiniela' ? Number(this.form.jornadas) || 1 : 0,
        vidas: this.form.modo === 'supervivencia' ? Number(this.form.vidas) : 0,
        vidaCubre: this.form.vidaCubre,
        permiteRevivir: this.form.modo === 'supervivencia' && this.form.permiteRevivir,
        grupoId: this.form.grupoId || null,
      });
      this.stats.evento('torneo_creado', {
        modo: this.form.modo,
        es_grupo: this.form.grupoId ? 'si' : 'no',
      });
      this.toast.exito('Torneo creado. Comparte el enlace de invitación.');
      // Volver: al grupo si vino de un grupo, o a la gestión de torneos.
      if (this.grupoUrl) {
        this.router.navigate(['/grupos', this.grupoUrl]);
      } else {
        this.router.navigate(['/admin/torneos']);
      }
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo crear.');
    } finally {
      this.guardando.set(false);
    }
  }
}