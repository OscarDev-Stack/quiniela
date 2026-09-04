import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BracketsService } from '../../core/services/brackets.service';
import { GruposService } from '../../core/services/grupos.service';
import { Grupo } from '../../core/models/grupo.model';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';
import { nombreOficial } from '../../core/models/equipos-liga-mx';
import { EquipoBracket } from '../../core/models/bracket.model';
import { NavComponent } from '../../shared/nav.component';

/**
 * Pantalla dedicada SOLO a crear una eliminatoria (bracket). La gestión de
 * las ya creadas vive en GestionarBracketsComponent. Si llega con ?grupo=ID,
 * la eliminatoria se crea para ese grupo (selector fijo).
 */
@Component({
  selector: 'app-crear-bracket',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent],
  template: `
    <app-nav [back]="true" [minimal]="true" title="Crear eliminatoria" [ocultarSaldo]="true" />
    <section class="panel">
          <div class="form">
            <label class="field">
              <span>Nombre</span>
              <input [(ngModel)]="nuevo.nombre" placeholder="Liguilla Apertura 2026" />
            </label>
            <label class="field">
              <span>¿Para quién?</span>
              <select [(ngModel)]="nuevo.grupoId" [disabled]="grupoBloqueado()">
                <option value="">🌎 Global (todos)</option>
                @for (g of misGrupos(); track g.id) {
                  <option [value]="g.id">{{ g.icono }} {{ g.nombre }}</option>
                }
              </select>
            </label>

            <label class="field">
              <span>Modo de juego</span>
              <select [(ngModel)]="nuevo.modo">
                <option value="pronostico">Pronóstico (cada quien llena el cuadro)</option>
                <option value="duenos">Dueños (a cada quien le toca un equipo)</option>
              </select>
            </label>

            <label class="field">
              <span>Equipos</span>
              <select [(ngModel)]="nuevo.equipos">
                <option [ngValue]="4">4 equipos</option>
                <option [ngValue]="8">8 equipos</option>
                <option [ngValue]="16">16 equipos</option>
              </select>
            </label>

            <label class="field">
              <span>Cómo se arma</span>
              <select [(ngModel)]="nuevo.armado">
                <option value="siembra">Por posición (1°vs8°)</option>
                <option value="manual">Cruces a mano</option>
              </select>
            </label>

            <label class="field">
              <span>Cruces en cada ronda</span>
              <select [(ngModel)]="nuevo.avance">
                <option value="reordena">Reordena: mejor vs peor (liguilla)</option>
                <option value="fijo">Cruces fijos del cuadro (Champions)</option>
              </select>
            </label>

            <label class="field">
              <span>Rondas</span>
              <select [(ngModel)]="nuevo.formatoRondas">
                <option value="ida-vuelta">Ida y vuelta</option>
                <option value="unico">Partido único</option>
              </select>
            </label>

            <label class="field">
              <span>Final</span>
              <select [(ngModel)]="nuevo.formatoFinal">
                <option value="ida-vuelta">Ida y vuelta</option>
                <option value="unico">Partido único</option>
              </select>
            </label>

            <label class="field">
              <span>Desempate en rondas</span>
              <select [(ngModel)]="nuevo.desempateRondas">
                <option value="mejor-sembrado">Mejor posicionado avanza</option>
                <option value="penales">Prórroga y penales</option>
              </select>
            </label>

            <label class="field">
              <span>Desempate en la final</span>
              <select [(ngModel)]="nuevo.desempateFinal">
                <option value="penales">Prórroga y penales</option>
                <option value="mejor-sembrado">Mejor posicionado avanza</option>
              </select>
            </label>

            <label class="field field--ancho">
              <span>{{ nuevo.modo === 'duenos' ? 'Cierre / inicio del torneo' : 'Cierre de pronósticos' }}</span>
              <input type="datetime-local" [(ngModel)]="nuevo.cierre" />
              <small class="pista">
                @if (nuevo.modo === 'duenos') {
                  A esa hora arranca el torneo. Ponla antes del primer partido.
                } @else {
                  A esa hora se congela el cuadro. Ponla antes del primer partido.
                }
              </small>
            </label>

            <label class="switch">
              <span class="switch-texto">
                Eliminatoria pública
                <small class="pista">
                  Aparece en el inicio y cualquiera puede unirse sin invitación.
                  Si la dejas privada, solo entra quien tenga el enlace.
                </small>
              </span>
              <input type="checkbox" class="switch-input" [(ngModel)]="nuevo.publico" />
              <span class="switch-pista" aria-hidden="true"></span>
            </label>

            <label class="field">
              <span>Costo de entrada (puntos)</span>
              <select [(ngModel)]="nuevo.costoEntrada">
                <option [ngValue]="0">Gratis</option>
                <option [ngValue]="50">50 pts</option>
                <option [ngValue]="100">100 pts</option>
                <option [ngValue]="200">200 pts</option>
                <option [ngValue]="500">500 pts</option>
              </select>
            </label>

            <label class="field">
              <span>% al bote acumulado</span>
              <select [(ngModel)]="nuevo.porcentajeBote">
                <option [ngValue]="0">Nada</option>
                <option [ngValue]="5">5%</option>
                <option [ngValue]="10">10%</option>
                <option [ngValue]="15">15%</option>
                <option [ngValue]="20">20%</option>
              </select>
              <small class="pista">Parte de la bolsa que se guarda para un torneo especial.</small>
            </label>

            @if (nuevo.modo !== 'duenos') {
            <label class="field">
              <span>Reparto de la bolsa</span>
              <select [(ngModel)]="nuevo.reparto">
                <option value="100">Todo al campeón</option>
                <option value="80,20">80% / 20% (1° y 2°)</option>
                <option value="70,20,10">70% / 20% / 10%</option>
              </select>
            </label>

            <label class="field">
              <span>Escala de puntos</span>
              <select [(ngModel)]="nuevo.escala">
                <option value="normal">Normal (10 · 20 · 40, campeón +30)</option>
                <option value="final">Más peso a la final (10 · 25 · 60, campeón +50)</option>
                <option value="pareja">Pareja (15 · 20 · 30, campeón +20)</option>
              </select>
              <small class="pista">Los puntos suben por ronda; el campeón da el bono mayor.</small>
            </label>
            }



            <label class="field field--ancho">
              <span>Equipos (uno por línea, del 1° al último por posición)</span>
              <textarea
                rows="8"
                [(ngModel)]="nuevo.listaEquipos"
                placeholder="América&#10;Tigres&#10;Rayados&#10;Chivas&#10;…"
              ></textarea>
            </label>

            <div class="acciones-crear">
              <button class="btn btn--primary" [disabled]="creando()" (click)="crear()">
                {{ creando() ? 'Creando…' : 'Crear eliminatoria' }}
              </button>
            </div>
          </div>
    </section>
  `,
  styles: [
    `
      .wrap { padding: 18px 16px 40px; }
      h1 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;
      }
      .cab {
        display: flex; align-items: center; gap: 10px; width: 100%;
        cursor: pointer; text-align: left; background: transparent; border: none;
        padding: 0; color: inherit;
      }
      .cab i { color: var(--text-muted); font-size: 17px; flex-shrink: 0; }
      .cab-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .cab-nom { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
      .cab-sub { font-size: 12px; font-weight: 400; color: var(--text-muted); }
      .badge {
        font-size: 11px; font-weight: 600; padding: 2px 9px;
        border-radius: 999px; background: var(--surface-1); color: var(--text-secondary);
      }
      .form { margin-top: 14px; display: grid; grid-template-columns: 1fr; gap: 14px 12px; }
      .field { display: block; }
      .field--ancho { grid-column: 1 / -1; }
      .acciones-crear { grid-column: 1 / -1; }
      @media (max-width: 620px) {
        .form { grid-template-columns: 1fr; gap: 14px; }
      }
      .acciones-crear .btn--primary { width: 100%; }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 5px; }
      .field input, .field select, .field textarea {
        width: 100%; min-height: 42px; padding: 9px 11px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .field textarea { min-height: auto; font-family: inherit; resize: vertical; }
      .btn {
        padding: 10px 16px; border-radius: var(--radius); cursor: pointer;
        font-size: 14px; font-weight: 600;
        border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary);
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; }
      .btn.sm { padding: 7px 12px; font-size: 13px; }
      .btn:disabled { opacity: 0.5; }
      .aviso { font-size: 13px; color: var(--text-secondary); margin: 8px 0 0; }
      .aviso--error { color: var(--danger-text); }
      .invitar { display: flex; align-items: center; gap: 10px; margin: 10px 0 14px; }

      /* Resumen de configuración */
      .resumen-cfg { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 14px; }
      .resumen-cfg .dato {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; padding: 5px 10px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .resumen-cfg .dato i { font-size: 14px; }
      .resumen-cfg .dato--gana { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }

      /* Participantes / dueños */
      .part-cab {
        display: flex; align-items: center; gap: 8px; width: 100%;
        background: transparent; border: none; cursor: pointer; padding: 8px 0;
        color: var(--text-primary); font-size: 14px; text-align: left;
      }
      .part-cab .sub { font-size: 12px; font-weight: 400; color: var(--text-muted); margin: 0 0 0 auto; }
      .part {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 8px 10px; border-radius: var(--radius); background: var(--surface-1); margin-bottom: 5px;
      }
      .part-alias { font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .part-datos { flex-shrink: 0; }
      .part-estado { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--text-muted); }
      .part-estado.ok { background: var(--success-bg); color: var(--success-text); }
      .part-estado.pend { background: var(--warning-bg); color: var(--warning-text); }
      .codigo { font-size: 13px; color: var(--text-secondary); margin: 0; }
      .sub { font-size: 14px; font-weight: 600; margin: 18px 0 10px; }
      .captura { border-top: 1px solid var(--border); padding: 12px 0; }
      .captura-cab { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .pista { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
      .partido {
        border: 1px solid var(--border); border-radius: var(--radius);
        padding: 10px; margin-bottom: 8px; background: var(--surface-1);
      }
      .partido-cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .tipo { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
      /* Rejilla fija: nombre | casilla | guion | casilla | nombre.
         Las casillas quedan siempre centradas, sin importar el largo
         de los nombres, que se recortan con puntos suspensivos. */
      .marcador {
        display: grid;
        grid-template-columns: 1fr 48px 12px 48px 1fr;
        align-items: center; gap: 8px;
      }
      .partido input {
        width: 48px; text-align: center; padding: 8px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary); font-size: 15px;
      }
      .sep { color: var(--text-muted); text-align: center; }
      .eq-nom {
        font-size: 13px; color: var(--text-secondary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .eq-nom--der { text-align: left; }
      .partido-btn { width: 100%; margin-top: 10px; }
      .check-ok { color: var(--success-text); font-size: 12px; font-weight: 600; }
      .calif { width: 100%; margin: 6px 0 12px; }
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
        background: var(--text-muted); transition: transform 0.18s ease, background 0.18s ease;
      }
      .switch-input:checked + .switch-pista { background: var(--accent-fill); border-color: transparent; }
      .switch-input:checked + .switch-pista::after { transform: translateX(20px); background: #fff; }
      @media (prefers-reduced-motion: reduce) { .switch-pista, .switch-pista::after { transition: none; } }
    `,
  ],
})
export class CrearBracketComponent {
  private readonly service = inject(BracketsService);
  private readonly gruposSrv = inject(GruposService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly stats = inject(StatsService);

  readonly misGrupos = toSignal(this.gruposSrv.misGrupos(), { initialValue: [] as Grupo[] });
  readonly grupoBloqueado = signal(false);
  readonly creando = signal(false);

  nuevo = {
    nombre: '',
    modo: 'pronostico' as 'pronostico' | 'duenos',
    equipos: 8,
    armado: 'siembra' as 'siembra' | 'manual',
    avance: 'reordena' as 'reordena' | 'fijo',
    formatoRondas: 'ida-vuelta' as 'ida-vuelta' | 'unico',
    formatoFinal: 'unico' as 'ida-vuelta' | 'unico',
    desempateRondas: 'mejor-sembrado' as 'mejor-sembrado' | 'penales',
    desempateFinal: 'penales' as 'mejor-sembrado' | 'penales',
    reparto: '80,20',
    escala: 'normal' as 'normal' | 'final' | 'pareja',
    publico: false,
    costoEntrada: 100,
    porcentajeBote: 0,
    cierre: '',
    listaEquipos: '',
    grupoId: '' as string, // '' = Global
  };


  private readonly grupoUrl = inject(ActivatedRoute).snapshot.queryParamMap.get('grupo');

  constructor() {
    if (this.grupoUrl) {
      this.nuevo.grupoId = this.grupoUrl;
      this.grupoBloqueado.set(true);
    }
  }

  async crear(): Promise<void> {
    const equipos: EquipoBracket[] = this.nuevo.listaEquipos
      .split('\n')
      .map((n) => nombreOficial(n))
      .filter(Boolean)
      .map((nombre, i) => ({ nombre, siembra: i + 1 }));

    if (this.nuevo.armado === 'siembra' && equipos.length !== this.nuevo.equipos) {
      this.toast.error(`Con el orden por posición necesitas exactamente ${this.nuevo.equipos} equipos.`);
      return;
    }

    this.creando.set(true);
    try {
      await this.service.crear({
        nombre: this.nuevo.nombre.trim(),
        modo: this.nuevo.modo,
        config: {
          equipos: this.nuevo.equipos,
          armado: this.nuevo.armado,
          avance: this.nuevo.avance,
          formatoRondas: this.nuevo.formatoRondas,
          formatoFinal: this.nuevo.formatoFinal,
          desempateRondas: this.nuevo.desempateRondas,
          desempateFinal: this.nuevo.desempateFinal,
          reparto:
            this.nuevo.modo === 'duenos' ? [100] : this.nuevo.reparto.split(',').map(Number),
        },
        puntaje: this.puntajeDeEscala(),
        equipos,
        costoEntrada: Number(this.nuevo.costoEntrada),
        porcentajeBote: Number(this.nuevo.porcentajeBote),
        cierraAt: this.nuevo.cierre ? new Date(this.nuevo.cierre) : null,
        publico: this.nuevo.publico,
        grupoId: this.nuevo.grupoId || null,
      });
      this.stats.evento('bracket_creado', {
        modo: this.nuevo.modo,
        equipos: Number(this.nuevo.equipos),
        es_grupo: this.nuevo.grupoId ? 'si' : 'no',
      });
      this.toast.exito('Eliminatoria creada.');
      if (this.grupoUrl) {
        this.router.navigate(['/grupos', this.grupoUrl]);
      } else {
        this.router.navigate(['/admin/brackets']);
      }
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo crear.');
    } finally {
      this.creando.set(false);
    }
  }

  /** Traduce la escala elegida a los valores de puntos. */
  private puntajeDeEscala() {
    const escalas = {
      normal: { avanzaPorRonda: [10, 20, 40, 60], campeon: 30, finalista: 15 },
      final: { avanzaPorRonda: [10, 25, 60, 120], campeon: 50, finalista: 20 },
      pareja: { avanzaPorRonda: [15, 20, 30, 45], campeon: 20, finalista: 12 },
    };
    const e = escalas[this.nuevo.escala];
    return {
      ...e,
      marcadorExacto: 0,
      marcadorResultado: 0,
    };
  }
}