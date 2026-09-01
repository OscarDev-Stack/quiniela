import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { AdminService } from '../../core/services/admin.service';
import { nombreOficial } from '../../core/models/equipos-liga-mx';
import { EscudoComponent } from '../../shared/escudo.component';
import { SelectorEquipoComponent } from '../../shared/selector-equipo.component';
import { TipoPartido } from '../../core/models/partido.model';
import { ToastService } from '../../shared/toast.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { GruposService } from '../../core/services/grupos.service';
import { Grupo } from '../../core/models/grupo.model';
import { NavComponent } from '../../shared/nav.component';

/**
 * Pantalla dedicada SOLO a crear partidos (por API o manuales). La gestión y
 * liquidación de los ya creados vive en GestionarPartidosComponent.
 * Si llega con ?grupo=ID, los partidos se crean para ese grupo (selector fijo).
 */
@Component({
  selector: 'app-crear-partido',
  standalone: true,
  imports: [CommonModule, FormsModule, EscudoComponent, SelectorEquipoComponent, NavComponent],
  template: `
    <app-nav [back]="true" [minimal]="true" title="Crear partido" [ocultarSaldo]="true" />
    <section class="panel panel--contexto">
      <label class="ctx-field">
        <span><i class="ti ti-target"></i> ¿Para quién son los partidos que crees?</span>
        <select [(ngModel)]="grupoParaCrear" [disabled]="grupoBloqueado()">
          <option value="">🌎 Global (todos)</option>
          @for (g of misGrupos(); track g.id) {
            <option [value]="g.id">{{ g.icono }} {{ g.nombre }}</option>
          }
        </select>
        <small class="ctx-pista">
          Aplica a los partidos (manuales o de API) que crees abajo. Global lo ven todos; un grupo, solo sus miembros.
        </small>
      </label>
    </section>

    <section class="panel">
      <button class="panel-title panel-title--boton" (click)="verApi.set(!verApi())">
        <i class="ti" [class.ti-chevron-down]="!verApi()" [class.ti-chevron-up]="verApi()"></i>
        Buscar partido por API
      </button>

      @if (verApi()) {
      <div class="grid">
        <label class="field">
          <span>Fuente</span>
          <select [(ngModel)]="busqueda.fuente" (ngModelChange)="encontrados.set([])">
            <option value="sportsdb">TheSportsDB</option>
            <option value="football-data">football-data</option>
          </select>
        </label>

        @if (busqueda.fuente === 'sportsdb') {
          <label class="field">
            <span>Liga</span>
            <select [(ngModel)]="busqueda.ligaSportsDb">
              @for (l of ligasSportsDb; track l.code) {
                <option [value]="l.code">{{ l.label }}</option>
              }
            </select>
          </label>
        } @else {
          <label class="field">
            <span>Competición</span>
            <select [(ngModel)]="busqueda.competicion">
              <option value="CL">Champions League</option>
              <option value="PL">Premier League</option>
              <option value="PD">LaLiga</option>
              <option value="SA">Serie A</option>
              <option value="BL1">Bundesliga</option>
              <option value="FL1">Ligue 1</option>
              <option value="EC">Eurocopa</option>
              <option value="BSA">Brasileirão</option>
            </select>
          </label>
          <label class="field">
            <span>Desde</span>
            <input type="date" [(ngModel)]="busqueda.desde" />
          </label>
          <label class="field">
            <span>Hasta</span>
            <input type="date" [(ngModel)]="busqueda.hasta" />
          </label>
        }

        <label class="field">
          <span>Tipo de mercado</span>
          <select [(ngModel)]="busqueda.type">
            <option value="1x2">1-X-2</option>
            <option value="1-2">1-2 (sin empate)</option>
            <option value="quien-pasa">¿Quién pasa?</option>
          </select>
        </label>
      </div>
      <button class="btn" [disabled]="buscando()" (click)="buscar()">
        {{ buscando() ? 'Buscando…' : (busqueda.fuente === 'sportsdb' ? 'Buscar próximos partidos' : 'Buscar partidos') }}
      </button>

      @for (f of encontrados(); track f.clave) {
        <div class="row">
          <div class="row-main">
            <div class="row-title">{{ f.homeTeam }} vs {{ f.awayTeam }}</div>
            <div class="row-sub">{{ f.competition }} · {{ f.fecha | date: 'dd/MM, h:mm a' }}</div>
          </div>
          <button class="btn-primary sm" (click)="crearDesdeApi(f)">Crear</button>
        </div>
      }
      }
    </section>

    <section class="panel">
      <button class="panel-title panel-title--boton" (click)="verManual.set(!verManual())">
        <i class="ti" [class.ti-chevron-down]="!verManual()" [class.ti-chevron-up]="verManual()"></i>
        Crear partido manualmente
      </button>

      @if (verManual()) {
      <div class="grid">
        <label class="field">
          <span>Equipo local</span>
          <div class="equipo-input">
            <input type="text" [(ngModel)]="form.homeTeam" placeholder="Cruz Azul" />
            @if (form.homeTeam) { <app-escudo [equipo]="form.homeTeam" [size]="24" /> }
            <button type="button" class="btn-liga" (click)="selectorLocal.set(!selectorLocal())">Liga MX</button>
          </div>
          @if (selectorLocal()) {
            <app-selector-equipo (elegido)="form.homeTeam = $event; selectorLocal.set(false)" />
          }
        </label>
        <label class="field">
          <span>Equipo visitante</span>
          <div class="equipo-input">
            <input type="text" [(ngModel)]="form.awayTeam" placeholder="América" />
            @if (form.awayTeam) { <app-escudo [equipo]="form.awayTeam" [size]="24" /> }
            <button type="button" class="btn-liga" (click)="selectorVisita.set(!selectorVisita())">Liga MX</button>
          </div>
          @if (selectorVisita()) {
            <app-selector-equipo (elegido)="form.awayTeam = $event; selectorVisita.set(false)" />
          }
        </label>
        <label class="field">
          <span>Competición</span>
          <input type="text" [(ngModel)]="form.competition" placeholder="Amistoso" />
        </label>
        <label class="field">
          <span>Fecha y hora de cierre</span>
          <input type="datetime-local" [min]="minFecha" [(ngModel)]="form.closesAt" />
        </label>
        <label class="field">
          <span>Tipo de mercado</span>
          <select [(ngModel)]="form.type">
            <option value="1x2">1-X-2</option>
            <option value="1-2">1-2 (sin empate)</option>
            <option value="quien-pasa">¿Quién pasa? (ida y vuelta)</option>
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
        </label>
      </div>
      <p class="pista pista--suelta">El % es la parte de la bolsa que se guarda para un torneo especial.</p>
      <button class="btn-primary ancho-crear-btn" [disabled]="saving()" (click)="crear()">
        {{ saving() ? 'Guardando…' : 'Crear partido' }}
      </button>
      }
    </section>

  `,
  styles: [
    `
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat { background: var(--surface-1); border-radius: var(--radius); padding: 12px 14px; }
      .stat-label { font-size: 12px; color: var(--text-secondary); }
      .stat-val { font-size: 22px; font-weight: 600; }

      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px 18px; margin-bottom: 18px;
      }
      .panel-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
      .panel--contexto { border: 1px solid var(--accent-fill); }
      .ctx-field { display: block; }
      .ctx-field > span { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      .ctx-field select {
        width: 100%; padding: 10px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
        color: var(--text-primary); font-size: 14px;
      }
      .ctx-pista { display: block; font-size: 12px; color: var(--text-muted); margin-top: 6px; }
      .panel-title--boton {
        display: flex; align-items: center; gap: 8px; width: 100%;
        cursor: pointer; text-align: left; margin: 0;
        background: transparent; border: none; padding: 0; color: inherit;
      }
      .panel-title--boton i { font-size: 17px; color: var(--text-muted); }
      .panel-title--boton:hover { color: var(--accent-text); }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 14px 12px; margin-bottom: 16px; }
      .field { display: block; margin-bottom: 14px; }
      .equipo-input { display: flex; align-items: center; gap: 8px; }
      .equipo-input input { flex: 1; }
      .btn-liga {
        flex-shrink: 0; padding: 8px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; color: var(--text-secondary);
      }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      select {
        width: 100%; padding: 10px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-2); font-size: 14px;
      }

      .btn-primary {
        padding: 10px 18px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-weight: 600; font-size: 14px; cursor: pointer;
      }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }
      .ancho-crear-btn { width: 100%; margin-top: 4px; }
      .pista--suelta { font-size: 12px; color: var(--text-muted); margin: 0 0 14px; }
      .btn-primary.sm, .btn.sm { padding: 7px 12px; font-size: 13px; }
      .btn {
        padding: 7px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: var(--surface-2); font-size: 13px; cursor: pointer;
      }

      .empty { color: var(--text-muted); font-size: 14px; }
      .row {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        padding: 12px 0; border-bottom: 1px solid var(--border);
      }
      .row:last-child { border-bottom: none; }
      .row-main { flex: 1; min-width: 160px; }
      .row-title { font-size: 14px; font-weight: 600; }
      .row-sub { font-size: 12px; color: var(--text-muted); }
      .tabs { display: flex; gap: 6px; margin-top: 8px; margin-bottom: 18px; }
      .tab {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 6px; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
      }
      .tab--on { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .tab-num {
        flex-shrink: 0; width: 22px; height: 22px; box-sizing: border-box;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; border-radius: 999px;
        background: rgba(0, 0, 0, 0.12);
      }
      .tab--on .tab-num { background: rgba(255, 255, 255, 0.25); }
      .row-origen { margin-top: 6px; }
      .origen { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 74px; box-sizing: border-box; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
      .origen--api { color: var(--tipo-elim-fill); background: var(--tipo-elim-bg, rgba(55, 138, 221, 0.12)); }
      .origen--manual { color: var(--text-secondary); background: var(--surface-1); }
      .row-actions { display: flex; gap: 6px; align-items: center; }
      .result { font-size: 12px; color: var(--text-secondary); }

      .tag { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--surface-1); color: var(--text-secondary); }
      .tag--abierto { color: var(--success-text); background: var(--success-bg); }
      .tag--cierra-pronto { color: var(--warning-text); background: var(--warning-bg); }
      .tag--cancelado { color: var(--danger-text); background: var(--danger-bg); }

      .alerta {
        width: 100%; margin-top: 8px; font-size: 13px; padding: 9px 12px;
        border-radius: var(--radius); background: var(--warning-bg); color: var(--warning-text);
      }
      .propuesta {
        width: 100%; margin-top: 8px; display: flex; align-items: center; gap: 10px;
        flex-wrap: wrap; justify-content: space-between;
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius);
        background: var(--accent-bg); color: var(--accent-text);
      }
      .msg {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px;
        border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text);
      }
      .msg .cerrar { margin-left: auto; opacity: 0.7; }
      .stat-val.accent { color: var(--accent-text); }

      .bolsa { width: 100%; margin-top: 10px; background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .bolsa-top { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .bolsa-grid { display: flex; gap: 8px; flex-wrap: wrap; }
      .bolsa-cell { flex: 1; min-width: 90px; text-align: center; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 6px; }
      .bolsa-label { font-size: 12px; color: var(--text-muted); }
      .bolsa-val { font-size: 16px; font-weight: 600; }
      .bolsa-sub { font-size: 11px; color: var(--text-muted); }

      .result-box { display: flex; gap: 8px; width: 100%; margin-top: 8px; }

      /* En pantallas chicas, una columna por campo. */
      @media (max-width: 620px) {
        .grid { grid-template-columns: 1fr; }
        .stats { grid-template-columns: 1fr 1fr; }
        .bolsa-grid { flex-direction: column; }
        .result-box { flex-wrap: wrap; }
        .result-box select { flex: 1 1 100%; }
        .row { flex-wrap: wrap; }
        .row-actions { width: 100%; }
        .row-actions button { flex: 1; }
      }
      .result-box select { flex: 1; }
    `,
  ],
})
export class CrearPartidoComponent {
  private readonly admin = inject(AdminService);
  private readonly gruposSrv = inject(GruposService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly misGrupos = toSignal(this.gruposSrv.misGrupos(), { initialValue: [] as Grupo[] });
  readonly grupoParaCrear = signal<string>('');
  readonly grupoBloqueado = signal(false);

  readonly selectorLocal = signal(false);
  readonly selectorVisita = signal(false);
  readonly verApi = signal(false);
  readonly verManual = signal(false);
  readonly buscando = signal(false);
  readonly saving = signal(false);

  readonly minFecha = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  // Resultado unificado de ambas fuentes: football-data trae apiFixtureId +
  // homeTeamId numérico; TheSportsDB trae apiEventId. Cada partido lleva un
  // 'clave' único para el track del @for.
  readonly encontrados = signal<
    Array<{
      clave: string;
      apiFixtureId?: number;
      apiEventId?: string;
      apiLigaId?: number;
      fecha: string;
      homeTeam: string;
      awayTeam: string;
      homeTeamId: number | null;
      awayTeamId: number | null;
      competition: string;
    }>
  >([]);

  /** Ligas de TheSportsDB soportadas por el buscador (código → etiqueta). */
  readonly ligasSportsDb = [
    { code: 'LIGAMX', label: 'Liga MX' },
    { code: 'CL', label: 'Champions League' },
    { code: 'PL', label: 'Premier League' },
    { code: 'PD', label: 'LaLiga' },
    { code: 'SA', label: 'Serie A' },
    { code: 'BL1', label: 'Bundesliga' },
    { code: 'FL1', label: 'Ligue 1' },
  ];

  busqueda = {
    fuente: 'sportsdb' as 'sportsdb' | 'football-data',
    ligaSportsDb: 'LIGAMX',
    competicion: 'CL',
    desde: '',
    hasta: '',
    type: '1x2' as TipoPartido,
  };

  form = {
    homeTeam: '',
    awayTeam: '',
    competition: '',
    closesAt: '',
    type: '1x2' as TipoPartido,
    porcentajeBote: 0,
  };

  private readonly grupoUrl = inject(ActivatedRoute).snapshot.queryParamMap.get('grupo');

  constructor() {
    if (this.grupoUrl) {
      this.grupoParaCrear.set(this.grupoUrl);
      this.grupoBloqueado.set(true);
    }
  }

  async buscar(): Promise<void> {
    this.buscando.set(true);
    try {
      if (this.busqueda.fuente === 'sportsdb') {
        const r = await this.admin.buscarFixturesSportsDb(this.busqueda.ligaSportsDb);
        this.encontrados.set(
          r.map((p) => ({
            clave: 'ev-' + p.apiEventId,
            apiEventId: p.apiEventId,
            apiLigaId: p.apiLigaId,
            fecha: p.fecha,
            homeTeam: p.homeTeam,
            awayTeam: p.awayTeam,
            // TheSportsDB da ids de equipo como string; no los usamos para la
            // forma (eso es de football-data), así que van en null.
            homeTeamId: null,
            awayTeamId: null,
            competition: p.competition,
          })),
        );
        if (r.length === 0) this.toast.error('No hay próximos partidos para esa liga.');
      } else {
        if (!this.busqueda.desde) {
          this.toast.error('Elige al menos la fecha inicial.');
          return;
        }
        const r = await this.admin.buscarFixtures(
          this.busqueda.competicion,
          this.busqueda.desde,
          this.busqueda.hasta || this.busqueda.desde,
        );
        this.encontrados.set(
          r.map((p) => ({
            clave: 'fx-' + p.apiFixtureId,
            apiFixtureId: p.apiFixtureId,
            fecha: p.fecha,
            homeTeam: p.homeTeam,
            awayTeam: p.awayTeam,
            homeTeamId: p.homeTeamId,
            awayTeamId: p.awayTeamId,
            competition: p.competition,
          })),
        );
        if (r.length === 0) this.toast.error('No se encontraron partidos próximos en esas fechas.');
      }
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo buscar.');
    } finally {
      this.buscando.set(false);
    }
  }

  /** Crea el partido con los datos reales y su vínculo con la API. */
  async crearDesdeApi(f: {
    clave: string;
    apiFixtureId?: number;
    apiEventId?: string;
    apiLigaId?: number;
    fecha: string;
    homeTeam: string;
    awayTeam: string;
    homeTeamId?: number | null;
    awayTeamId?: number | null;
    competition: string;
  }): Promise<void> {
    const inicio = new Date(f.fecha);
    if (inicio.getTime() <= Date.now()) {
      this.toast.error('Ese partido ya empezó.');
      return;
    }
    const grupoSel = this.grupoParaCrear();
    if (grupoSel) {
      await this.admin.crearPartidoGrupo({
        grupoId: grupoSel,
        competition: f.competition,
        homeTeam: nombreOficial(f.homeTeam),
        awayTeam: nombreOficial(f.awayTeam),
        type: this.busqueda.type,
        closesAtMs: inicio.getTime(),
        ...(f.apiFixtureId ? { apiFixtureId: f.apiFixtureId } : {}),
        ...(f.apiEventId ? { apiEventId: f.apiEventId } : {}),
        ...(f.apiLigaId ? { apiLigaId: f.apiLigaId } : {}),
      });
    } else {
      // Forma reciente (solo football-data, que da ids numéricos de equipo).
      // Se captura una sola vez aquí y se guarda; si no hay, queda vacía.
      let formaLocal = '';
      let formaVisitante = '';
      if (f.homeTeamId || f.awayTeamId) {
        try {
          const forma = await this.admin.formaEquipos(f.homeTeamId ?? null, f.awayTeamId ?? null);
          formaLocal = forma.formaLocal;
          formaVisitante = forma.formaVisitante;
        } catch {
          // La forma es un extra informativo: si falla, el partido se crea igual.
        }
      }

      await this.admin.crearPartido({
        competition: f.competition,
        homeTeam: nombreOficial(f.homeTeam),
        awayTeam: nombreOficial(f.awayTeam),
        type: this.busqueda.type,
        status: 'abierto',
        closesAt: Timestamp.fromDate(inicio),
        ...(f.apiFixtureId ? { apiFixtureId: f.apiFixtureId } : {}),
        ...(f.apiEventId ? { apiEventId: f.apiEventId } : {}),
        ...(f.apiLigaId ? { apiLigaId: f.apiLigaId } : {}),
        ...(formaLocal ? { formaLocal } : {}),
        ...(formaVisitante ? { formaVisitante } : {}),
        grupoId: null,
      });
    }
    this.encontrados.set(this.encontrados().filter((x) => x.clave !== f.clave));
    this.toast.exito(`Partido creado: ${f.homeTeam} vs ${f.awayTeam}.`);
  }

  async crear(): Promise<void> {
    if (!this.form.homeTeam.trim() || !this.form.awayTeam.trim()) return;
    this.saving.set(true);
    try {
      if (!this.form.closesAt) {
        this.toast.error('Elige la fecha y hora de cierre.');
        return;
      }
      const cierre = new Date(this.form.closesAt);
      if (isNaN(cierre.getTime())) {
        this.toast.error('La fecha de cierre no es válida.');
        return;
      }
      if (cierre.getTime() <= Date.now()) {
        this.toast.error('La hora de cierre debe estar en el futuro.');
        return;
      }

      const grupoSel = this.grupoParaCrear();
      if (grupoSel) {
        await this.admin.crearPartidoGrupo({
          grupoId: grupoSel,
          competition: this.form.competition.trim() || 'Partido',
          homeTeam: nombreOficial(this.form.homeTeam),
          awayTeam: nombreOficial(this.form.awayTeam),
          type: this.form.type,
          closesAtMs: cierre.getTime(),
          porcentajeBote: Number(this.form.porcentajeBote),
        });
      } else {
        await this.admin.crearPartido({
          competition: this.form.competition.trim() || 'Partido',
          homeTeam: nombreOficial(this.form.homeTeam),
          awayTeam: nombreOficial(this.form.awayTeam),
          type: this.form.type,
          status: 'abierto',
          closesAt: Timestamp.fromDate(cierre),
          porcentajeBote: Number(this.form.porcentajeBote),
          grupoId: null,
        });
      }
      this.form = { homeTeam: '', awayTeam: '', competition: '', closesAt: '', type: '1x2', porcentajeBote: 0 };
      this.toast.exito('Partido creado.');
      // Si vino de un grupo, volver al grupo.
      if (this.grupoUrl) {
        this.router.navigate(['/grupos', this.grupoUrl]);
      }
    } finally {
      this.saving.set(false);
    }
  }
}