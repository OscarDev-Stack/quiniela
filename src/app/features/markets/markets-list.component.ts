import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Market, MarketType } from '../../core/models/market.model';

@Component({
  selector: 'app-markets-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="screen">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <span class="brand-name">Quiniela</span>
        </div>
        <div class="balance-pill">{{ balance() | number }} pts</div>
      </header>

      <nav class="filters">
        <span class="chip chip--active">Todos</span>
        <span class="chip">Hoy</span>
        <span class="chip">Liga MX</span>
        <span class="chip">Liguilla</span>
      </nav>

      <section class="list">
        @for (m of markets(); track m.id) {
          <article class="card" [class.card--live]="m.status === 'en-juego'">
            <div class="card-top">
              <span class="competition">{{ m.competition }}</span>
              @switch (m.status) {
                @case ('abierto') { <span class="badge badge--open">Abierto</span> }
                @case ('cierra-pronto') { <span class="badge badge--soon">Cierra pronto</span> }
                @case ('en-juego') { <span class="badge badge--live">En juego</span> }
              }
            </div>

            <div class="teams">
              <span class="team">{{ m.homeTeam }}</span>
              <span class="vs">vs</span>
              <span class="team">{{ m.awayTeam }}</span>
            </div>

            @if (m.status !== 'en-juego') {
              <div class="meta">
                <span class="closes">{{ m.closesLabel }}</span>
                <span class="type-tag">{{ typeLabel(m.type) }}</span>
              </div>
              <div class="card-footer">
                <span class="hidden-prize">Premio se revela al iniciar</span>
                <button class="btn btn--primary" (click)="onPredict(m)">Pronosticar</button>
              </div>
            } @else {
              <div class="prize-caption">
                Premio por acierto · bolsa {{ m.poolTotal | number }} pts
              </div>
              <div class="prize-grid">
                @for (p of m.prizes; track p.label) {
                  <div class="prize-cell">
                    <div class="prize-label">{{ p.label }}</div>
                    <div class="prize-value">{{ p.value | number }}</div>
                  </div>
                }
              </div>
            }
          </article>
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .screen { max-width: 460px; margin: 0 auto; padding: 16px; }

      .topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 4px 16px; }
      .brand { display: flex; align-items: center; gap: 10px; }
      .brand-mark {
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--accent-bg); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center; font-weight: 600;
      }
      .brand-name { font-size: 18px; font-weight: 600; }
      .balance-pill {
        background: var(--accent-bg); color: var(--accent-text);
        padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 14px;
      }

      .filters { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 16px; }
      .chip {
        font-size: 13px; padding: 6px 14px; border-radius: 999px;
        border: 1px solid var(--border); color: var(--text-secondary);
        white-space: nowrap; cursor: pointer;
      }
      .chip--active { background: var(--text-primary); color: var(--surface-2); border-color: var(--text-primary); }

      .list { display: flex; flex-direction: column; gap: 12px; }
      .card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
      .card--live { background: var(--surface-1); }

      .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .competition { font-size: 12px; color: var(--text-muted); }

      .badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
      .badge--open { color: var(--success-text); background: var(--success-bg); }
      .badge--soon { color: var(--warning-text); background: var(--warning-bg); }
      .badge--live { color: var(--text-secondary); background: var(--surface-2); }

      .teams { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .team { font-size: 16px; font-weight: 600; }
      .vs { font-size: 13px; color: var(--text-muted); }

      .meta { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .closes { font-size: 13px; color: var(--text-secondary); }
      .type-tag {
        background: var(--surface-1); padding: 2px 8px; border-radius: var(--radius);
        font-size: 12px; color: var(--text-secondary);
      }

      .card-footer { display: flex; align-items: center; justify-content: space-between; }
      .hidden-prize { font-size: 13px; color: var(--text-muted); }

      .btn {
        font-size: 14px; padding: 8px 16px; border-radius: var(--radius);
        border: 1px solid var(--border-strong); background: var(--surface-2);
        color: var(--text-primary); cursor: pointer; transition: background 0.15s;
      }
      .btn:hover { background: var(--surface-1); }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; }
      .btn--primary:hover { filter: brightness(0.96); }

      .prize-caption { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
      .prize-grid { display: flex; gap: 8px; }
      .prize-cell {
        flex: 1; text-align: center; background: var(--surface-2);
        border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 4px;
      }
      .prize-label { font-size: 12px; color: var(--text-muted); }
      .prize-value { font-size: 15px; font-weight: 600; }
    `,
  ],
})
export class MarketsListComponent {
  /* Saldo de prueba. Luego vendrá de Firestore (el marcador del usuario). */
  readonly balance = signal(2400);

  /* Datos de prueba. En el siguiente paso los leeremos de la colección `markets`. */
  readonly markets = signal<Market[]>([
    {
      id: 'm1',
      competition: 'Amistoso internacional',
      homeTeam: 'México',
      awayTeam: 'Argentina',
      type: '1x2',
      status: 'abierto',
      closesLabel: 'Cierra en 2h 15m',
    },
    {
      id: 'm2',
      competition: 'Liguilla · ida',
      homeTeam: 'Rayados',
      awayTeam: 'América',
      type: 'quien-pasa',
      status: 'cierra-pronto',
      closesLabel: 'Cierra en 25m',
    },
    {
      id: 'm3',
      competition: 'LaLiga',
      homeTeam: 'Barcelona',
      awayTeam: 'Madrid',
      type: '1x2',
      status: 'en-juego',
      closesLabel: 'En juego',
      poolTotal: 48000,
      prizes: [
        { label: 'Local', value: 320 },
        { label: 'Empate', value: 890 },
        { label: 'Visitante', value: 410 },
      ],
    },
  ]);

  private readonly typeLabels: Record<MarketType, string> = {
    '1x2': '1-X-2',
    '1-2': '1-2',
    'quien-pasa': '¿Quién pasa?',
  };

  typeLabel(t: MarketType): string {
    return this.typeLabels[t];
  }

  onPredict(m: Market): void {
    // Próximo paso: navegar a la pantalla de confirmación del pronóstico.
    console.log('Pronosticar mercado', m.id);
  }
}