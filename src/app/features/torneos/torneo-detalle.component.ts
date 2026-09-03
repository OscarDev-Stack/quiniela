import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth, user } from '@angular/fire/auth';
import { map, switchMap, tap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { EscudoComponent } from '../../shared/escudo.component';
import { apagarCargando } from '../../shared/cargando.util';
import { ReglasTorneoComponent } from './reglas-torneo.component';
import { PartidosJornadaComponent } from './partidos-jornada.component';
import { TablaPosicionesComponent } from './tabla-posiciones.component';
import { CartonesJornadaComponent } from './cartones-jornada.component';
import { TablaLigaComponent } from './tabla-liga.component';
import { CelebracionVictoriaComponent } from '../../shared/celebracion-victoria.component';
import { TorneosService } from '../../core/services/torneos.service';
import {
  Torneo,
  Participante,
  Pick,
  Quiniela,
  fechaInscripcion,
} from '../../core/models/torneo.model';
import { Jornada, fechaJornada, equiposDeJornada } from '../../core/models/competicion.model';
import { CompeticionesService } from '../../core/services/competiciones.service';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';

@Component({
  selector: 'app-torneo-detalle',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent, ReglasTorneoComponent,
    PartidosJornadaComponent,
    TablaPosicionesComponent,
    CartonesJornadaComponent,
    TablaLigaComponent,
    CargandoComponent,
    EscudoComponent,
    CelebracionVictoriaComponent,
  ],
  template: `
    <div class="screen">
      <app-nav [back]="true" [title]="torneo()?.nombre ?? 'Torneo'" />

      @if (cargando()) {
        <app-cargando texto="Cargando torneo" />
      }

      @if (torneo(); as t) {
        <div class="flujo" [class.flujo--cerrada]="revelarPicks()">
        <div class="franja">
          <span class="pill" [class.pill--vivo]="t.estado === 'en-curso'">
            {{ etiquetaEstado(t.estado) }}
          </span>

          @if (t.estado !== 'finalizado') {
            <span class="pill">
              @if (t.estado === 'inscripcion') {
                Inicia J{{ t.jornadaInicial }}
              } @else {
                Jornada {{ t.jornadaActual }}
              }
            </span>
          }

          <span class="pill">
            <i class="ti ti-users"></i>
            @if (esQuiniela()) {
              {{ participantes().length }}
            } @else {
              {{ vivos().length }}/{{ participantes().length }}
            }
          </span>

          @if (yo()) {
            @if (esQuiniela()) {
              <span class="pill pill--premio">{{ yo()!.puntosTorneo ?? 0 }} pts</span>
            } @else if (yo()!.vidasRestantes > 0) {
              <span class="pill"><i class="ti ti-heart-filled corazon"></i></span>
            } @else {
              <span class="pill pill--gastada">Sin vida</span>
            }
          }

          @if (t.costoEntrada > 0) {
            <span class="pill pill--premio">
              <i class="ti ti-coins"></i>
              {{ (t.premioPagado ?? t.bolsa) | number }}
              @if (t.premioPagado) { <small>entregada</small> }
            </span>
          }
        </div>


        @if (t.estado === 'finalizado' && yo()) {
          @if (soyGanador()) {
            <app-celebracion-victoria
              class="p-final"
              titulo="¡Felicidades, ganaste!"
              [subtitulo]="esQuiniela()
                ? 'Terminaste primero con ' + (yo()!.puntosTorneo ?? 0) + ' puntos entre ' + participantes().length + ' jugador(es).'
                : 'Fuiste el último en pie de ' + participantes().length + ' participantes.'"
              [premio]="miPremio()"
            />
          } @else {
            <div class="final final--perdio p-final">
              <div class="trofeo"><i class="ti ti-confetti"></i></div>
              <h2>Torneo terminado</h2>
              @if (esQuiniela()) {
                <p>
                  Ganó <strong>{{ t.ganadorAlias }}</strong>.
                  Cerraste con {{ yo()!.puntosTorneo ?? 0 }} puntos.
                </p>
              } @else {
                <p>
                  Ganó <strong>{{ t.ganadorAlias }}</strong>.
                  Caíste en la jornada {{ yo()!.eliminadoEn }}.
                </p>
              }
            </div>
          }
        }

        @if (!yo() && !soyGestor()) {
          <div class="aviso aviso--fuera">
            <i class="ti ti-lock"></i> No participas en este torneo.
          </div>
        } @else if (!esQuiniela() && yo() && !yo()!.vivo) {
          <div class="aviso aviso--fuera">
            <i class="ti ti-skull"></i> Quedaste eliminado en la jornada {{ yo()!.eliminadoEn }}.
          </div>

          @if (puedeRevivir()) {
            <section class="panel panel--revivir">
              <div class="panel-head">
                <h3><i class="ti ti-heart-plus"></i> ¿Una última oportunidad?</h3>
              </div>
              <p class="ayuda">
                Puedes volver solo en esta jornada, con las mismas vidas que
                tenías al caer. Una sola vez por torneo.
              </p>
              <button class="btn btn--principal" [disabled]="reviviendo()" (click)="revivir()">
                {{ reviviendo() ? 'Reviviendo…' : 'Revivir por ' + (costoRevivir() | number) + ' pts' }}
              </button>
              @if (mensajeRevivir()) {
                <p class="aviso-tg" [class.aviso-tg--error]="errorRevivir()">{{ mensajeRevivir() }}</p>
              }
            </section>
          }
        }

        @if (pickEnEspera(); as p) {
          <div class="aviso">
            <i class="ti ti-clock-pause"></i>
            Tu elección de la jornada {{ p.jornada }} (<strong>{{ p.equipo }}</strong>)
            quedó en espera: ese partido se aplazó. Se definirá cuando se juegue.
          </div>
        }

        @if (t.estado === 'inscripcion') {
          <section class="panel panel--arranque">
            <div class="panel-head">
              <h3><i class="ti ti-hourglass-high"></i> Inscripciones abiertas</h3>
            </div>

            <p class="ayuda">
              El torneo arranca en la jornada <strong>{{ t.jornadaInicial }}</strong>
              de {{ t.competicionNombre }}.
              @if (esQuiniela()) {
                Hasta entonces no hay nada que pronosticar.
              } @else {
                Hasta entonces no hay que elegir equipo.
              }
            </p>

            @if (cierreInscripcion(); as ci) {
              <div class="arranque-dato plazo">
                <span class="etq">Se puede entrar hasta</span>
                <span class="val">{{ ci | date: "dd 'de' MMMM, h:mm a" }}</span>
                @if (restanteInscripcion(); as r) {
                  <span class="falta">Faltan {{ r }} · después arranca solo</span>
                } @else {
                  <span class="falta falta--vencida">Plazo vencido</span>
                }
              </div>
            }

            @if (jornadaActual(); as j) {
              <div class="arranque">
                <div class="arranque-dato">
                  <span class="etq">Primera jornada</span>
                  <span class="val">Jornada {{ j.numero }}</span>
                </div>
                @if (cierre(j); as c) {
                  <div class="arranque-dato">
                    <span class="etq">Cierra</span>
                    <span class="val">{{ c | date: "dd 'de' MMMM, h:mm a" }}</span>
                    @if (restante(j); as r) {
                      <span class="falta">Faltan {{ r }}</span>
                    } @else {
                      <span class="falta falta--vencida">Ya cerró</span>
                    }
                  </div>
                }
              </div>

              <p class="listado-partidos">
                @for (p of j.partidos; track $index) {
                  <span class="mini">
                    <app-escudo [equipo]="p.local" [size]="18" />
                    {{ p.local }} vs {{ p.visitante }}
                    <app-escudo [equipo]="p.visitante" [size]="18" />
                  </span>
                }
              </p>
            } @else {
              <p class="sin-catalogo">
                Esa jornada todavía no se publica en {{ t.competicionNombre }}.
              </p>
            }
          </section>
        }

        @if (t.estado === 'en-curso' && !jornadaActual()) {
          <div class="aviso">
            <i class="ti ti-calendar-question"></i>
            La jornada {{ t.jornadaActual }} de {{ t.competicionNombre }} todavía no se publica.
            @if (esQuiniela()) {
              En cuanto esté, podrás capturar tus marcadores.
            } @else {
              En cuanto esté, podrás elegir tu equipo.
            }
          </div>
        }

        @if (esQuiniela() && t.estado === 'en-curso' && jornadaActual(); as j) {
          <section class="panel">
            <div class="panel-head">
              <h3>Jornada {{ j.numero }}</h3>
              @if (cierre(j); as c) {
                <span class="cierra">
                  <i class="ti ti-clock"></i>
                  @if (restante(j); as r) { Cierra en {{ r }} } @else { Cerrada }
                </span>
              }
            </div>

            @if (miQuinielaEnviada()) {
              <div class="elegido">
                <i class="ti ti-check"></i> Ya enviaste tus pronósticos
              </div>
              <p class="ayuda">Puedes cambiarlos mientras la jornada siga abierta.</p>
            }

            @if (puedeElegir()) {
              <p class="ayuda">
                Marcador exacto: <strong>5 puntos</strong>.
                Solo acertar quién gana: <strong>3 puntos</strong>.
              </p>

              @for (p of j.partidos; track $index) {
                <div class="pronostico">
                  <span class="equipo-lado equipo-lado--izq">
                    <span class="equipo-nombre">{{ p.local }}</span>
                    <app-escudo [equipo]="p.local" [size]="22" />
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    class="goles"
                    [ngModel]="marcadores()[$index]?.local"
                    (ngModelChange)="ponerGol($index, 'local', $event)"
                    [attr.aria-label]="'Goles de ' + p.local"
                  />
                  <span class="guion">–</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    class="goles"
                    [ngModel]="marcadores()[$index]?.visitante"
                    (ngModelChange)="ponerGol($index, 'visitante', $event)"
                    [attr.aria-label]="'Goles de ' + p.visitante"
                  />
                  <span class="equipo-lado equipo-lado--der">
                    <app-escudo [equipo]="p.visitante" [size]="22" />
                    <span class="equipo-nombre">{{ p.visitante }}</span>
                  </span>
                </div>
              }

              <button class="btn btn--primary" [disabled]="guardando()" (click)="enviarQuiniela(j)">
                {{ guardando() ? 'Guardando…' : 'Guardar pronósticos' }}
              </button>
            }
          </section>
        }

        @if (!esQuiniela() && t.estado === 'en-curso' && jornadaActual(); as j) {
          <section class="panel p-jornada">
            <div class="panel-head">
              <h3>Jornada {{ j.numero }}</h3>
              @if (cierre(j); as c) {
                <span class="cierra">
                  <i class="ti ti-clock"></i>
                  @if (restante(j); as r) {
                    Cierra en {{ r }}
                  } @else {
                    Cerrada · {{ c | date: 'dd/MM, h:mm a' }}
                  }
                </span>
              }
            </div>

            @if (miPick(); as p) {
              <div class="elegido">
                <i class="ti ti-check"></i> Elegiste <strong>{{ p.equipo }}</strong>
              </div>
            }

            @if (puedeElegir()) {
              @if (!miPick()) {
                <p class="ayuda">
                  Elige un equipo que gane. El empate te cuesta la vida y la derrota te elimina.
                </p>
              } @else {
                <p class="ayuda">
                  Puedes cambiar tu elección mientras la jornada siga abierta.
                </p>
              }

              @if (disponibles().length === 0) {
                <div class="aviso">
                  <i class="ti ti-alert-circle"></i>
                  Ya usaste a todos los equipos que juegan en esta jornada.
                </div>
              } @else {
                <div class="equipos">
                  @for (e of disponibles(); track e) {
                    <button
                      class="equipo"
                      [class.equipo--activo]="e === miPick()?.equipo"
                      [disabled]="guardando()"
                      (click)="elegir(e)"
                    >
                      <app-escudo [equipo]="e" [size]="20" />
                      {{ e }}
                    </button>
                  }
                </div>
              }
            }
          </section>
        }

        @if (t.estado === 'en-curso' && jornadaActual(); as j) {
          <app-partidos-jornada
            class="p-partidos"
            [jornada]="j"
            [miEquipo]="miPick()?.equipo ?? null"
          />
        }

        @if (!esQuiniela() && yo() && yo()!.vivo) {
          <section class="panel p-equipos">
            <button class="panel-head panel-head--boton" (click)="verEquipos.set(!verEquipos())">
              <i class="ti chevron"
                [class.ti-chevron-down]="!verEquipos()"
                [class.ti-chevron-up]="verEquipos()"></i>
              <h3>Mis equipos</h3>
              <span class="restantes">{{ disponiblesTotales().length }} disponibles</span>
            </button>

            @if (verEquipos()) {

            @if (disponiblesTotales().length > 0) {
              <div class="chips">
                @for (e of disponiblesTotales(); track e) {
                  <span class="chip"><app-escudo [equipo]="e" [size]="18" />{{ e }}</span>
                }
              </div>
            } @else if (comprometidos().length === 0) {
              <p class="sin-catalogo">
                El administrador todavía no ha capturado los equipos de la competición.
              </p>
            }

            @if (comprometidos().length > 0) {
              <p class="usados-titulo">Ya no disponibles</p>
              <div class="chips">
                @for (e of comprometidos(); track e) {
                  <span class="chip chip--usado">
                    @if (jornadaLabel(e); as j) { <span class="chip-j">{{ j }}</span> }
                    <app-escudo [equipo]="e" [size]="18" />
                    {{ e }}
                  </span>
                }
              </div>
            }
            }
          </section>
        }

        @if (soyGestor()) {
          <section class="panel panel--gestion">
            <div class="panel-head">
              <h3><i class="ti ti-settings"></i> Administración del torneo</h3>
              <span class="etiqueta">Admin</span>
            </div>

            @if (t.estado === 'inscripcion') {
              <p class="ayuda">Las inscripciones siguen abiertas.</p>
              <button class="btn btn--primary" (click)="iniciar()">Iniciar torneo</button>
            }

            @if (t.estado === 'en-curso') {
              <p class="ayuda">
                Las jornadas y resultados los publica quien administra
                <strong>{{ t.competicionNombre }}</strong>. Aquí solo cierras el torneo
                si ya no habrá más jornadas.
              </p>
              <button class="btn" (click)="finalizar()">Cerrar torneo y repartir</button>
            }
          </section>
        }

        @if (esQuiniela() && revelarQuinielas() && jornadaActual(); as j) {
          <app-cartones-jornada
            [jornada]="j"
            [quinielas]="quinielasJornada()"
            [miUid]="miUid()"
          />
        }

        <!-- Historial: cartones y resultados de jornadas ya jugadas. -->
        @if (esQuiniela() && jornadasPasadas().length > 0) {
          <section class="panel">
            <button class="panel-toggle" (click)="verHistorial.set(!verHistorial())">
              <span><i class="ti ti-history"></i> Historial de jornadas</span>
              <i class="ti" [class.ti-chevron-down]="!verHistorial()" [class.ti-chevron-up]="verHistorial()"></i>
            </button>

            @if (verHistorial()) {
              <div class="hist-cuerpo">
                <p class="hist-nota">
                  Revisa cualquier jornada pasada para hacer tus propias cuentas.
                </p>

                <div class="hist-jornadas">
                  @for (n of jornadasPasadas(); track n) {
                    <button
                      class="hist-chip"
                      [class.hist-chip--activa]="jornadaHistorial() === n"
                      (click)="verJornadaHistorial(n)"
                    >
                      J{{ n }}
                    </button>
                  }
                </div>

                @if (jornadaHistorialData(); as jh) {
                  <app-cartones-jornada
                    [jornada]="jh"
                    [quinielas]="cartonesHistorial()"
                    [miUid]="miUid()"
                  />
                } @else if (jornadaHistorial()) {
                  <p class="hist-cargando">Cargando jornada {{ jornadaHistorial() }}…</p>
                }
              </div>
            }
          </section>
        }

        @if (esQuiniela()) {
          <app-tabla-posiciones
            class="p-jugadores"
            [participantes]="participantes()"
            [miUid]="miUid()"
          />
        } @else {
        <section class="panel p-jugadores">
          <div class="panel-head">
            <h3>Participantes</h3>
            <span class="resumen-vivos">
              <i class="ti ti-heart-filled"></i>
              {{ enPie().length }} de {{ participantes().length }} en pie
            </span>
          </div>

          <!-- EN PIE -->
          @if (enPie().length > 0) {
            <div class="grupo-titulo">En pie</div>
            @for (p of enPie(); track p.id) {
              <div class="jugador jugador--vivo" [class.jugador--yo]="p.id === miUid()">
                <div class="jug-cab">
                  <span class="avatar avatar--vivo">{{ inicial(p.alias) }}</span>
                  <span class="jug-info">
                    <span class="alias">
                      {{ p.alias }}@if (p.id === miUid()) { <span class="tu">· tú</span> }
                    </span>
                    <span class="corazones" [attr.aria-label]="p.vidasRestantes + ' vidas'">
                      @for (i of corazones(); track i) {
                        <i class="ti"
                          [class.ti-heart-filled]="i < p.vidasRestantes"
                          [class.ti-heart]="i >= p.vidasRestantes"
                          [class.corazon-on]="i < p.vidasRestantes"></i>
                      }
                      @if (p.vidasRestantes === 0) { <span class="sin-vida">al límite</span> }
                    </span>
                  </span>
                  <span class="chip-estado chip-estado--vivo">Vivo</span>
                </div>

                @if (revelarPicks() && eligio(p.id); as equipo) {
                  <div class="usados-fila">
                    <span class="chip chip--actual">
                      <app-escudo [equipo]="equipo" [size]="16" /> {{ equipo }}
                    </span>
                    @for (e of p.equiposUsados; track e) {
                      <span class="chip chip--usado"><app-escudo [equipo]="e" [size]="16" /> {{ e }}</span>
                    }
                  </div>
                } @else if (revelarPicks()) {
                  <div class="usados-fila">
                    <span class="chip chip--nada">No eligió</span>
                    @for (e of p.equiposUsados; track e) {
                      <span class="chip chip--usado"><app-escudo [equipo]="e" [size]="16" /> {{ e }}</span>
                    }
                  </div>
                } @else if (p.equiposUsados.length > 0) {
                  <div class="usados-fila">
                    @for (e of p.equiposUsados; track e) {
                      <span class="chip chip--usado"><app-escudo [equipo]="e" [size]="16" /> {{ e }}</span>
                    }
                  </div>
                } @else {
                  <p class="sin-usados">Aún no gasta ningún equipo.</p>
                }
              </div>
            }
          }

          <!-- ELIMINADOS -->
          @if (eliminados().length > 0) {
            <div class="grupo-titulo grupo-titulo--fuera">Eliminados</div>
            @for (p of eliminados(); track p.id) {
              <div class="jugador jugador--fuera" [class.jugador--yo]="p.id === miUid()">
                <div class="jug-cab">
                  <span class="avatar">{{ inicial(p.alias) }}</span>
                  <span class="jug-info">
                    <span class="alias">
                      {{ p.alias }}@if (p.id === miUid()) { <span class="tu">· tú</span> }
                    </span>
                  </span>
                  <span class="chip-estado">Eliminado · J{{ p.eliminadoEn }}</span>
                </div>

                @if (p.equiposUsados.length > 0) {
                  <div class="usados-fila">
                    @for (e of p.equiposUsados; track e) {
                      <span class="chip chip--usado"><app-escudo [equipo]="e" [size]="16" /> {{ e }}</span>
                    }
                  </div>
                }
              </div>
            }
          }
        </section>
        }

        @if (mostrarTablaLiga() && competicion(); as comp) {
          <details class="panel reglas-panel">
            <summary><i class="ti ti-table"></i> Tabla de la liga</summary>
            <div class="tabla-liga-cuerpo">
              <app-tabla-liga [competicion]="comp" />
            </div>
          </details>
        }

        <details class="panel reglas-panel">
          <summary><i class="ti ti-book"></i> Cómo se juega</summary>
          <app-reglas-torneo [costo]="t.costoEntrada" [modo]="t.modo ?? 'supervivencia'"
            [vidas]="t.vidas" [vidaCubre]="t.vidaCubre ?? 'empate'"
            [permiteRevivir]="t.permiteRevivir ?? false" />
        </details>
        </div>
      }
    </div>
  `,
  styles: [
    `
      /*
       * El orden de los paneles cambia según el momento del torneo.
       * Con la jornada abierta manda tu elección; ya cerrada, mandan
       * los resultados y lo que eligieron los demás.
       */
      .flujo { display: flex; flex-direction: column; }
      .flujo > * { order: 5; }
      .flujo > .franja { order: 0; }
      .flujo > .p-jornada { order: 1; }
      .flujo > .p-partidos { order: 2; }
      .flujo > .p-equipos { order: 3; }
      .flujo > .p-jugadores { order: 6; }
      .flujo > .reglas-panel { order: 9; }
      /* El resultado final (ganaste / terminó) siempre justo bajo la franja. */
      .flujo > .p-final { order: 0; }
      .flujo--cerrada > .p-final { order: 0; }

      .flujo--cerrada > .p-partidos { order: 1; }
      .flujo--cerrada > .p-jugadores { order: 2; }
      .flujo--cerrada > .p-jornada { order: 3; }
      .flujo--cerrada > .p-equipos { order: 4; }

      .franja {
        display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;
      }
      .pill {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary); white-space: nowrap;
      }
      .pill--vivo { background: var(--success-bg); color: var(--success-text); }
      .pill--premio { background: var(--accent-bg); color: var(--accent-text); }
      .pill--gastada { background: var(--warning-bg); color: var(--warning-text); }
      .pill small { font-weight: 500; opacity: 0.75; }
      .pill .corazon { font-size: 13px; }

      @media (min-width: 480px) {
      }
      .dato { background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .etq { display: block; font-size: 11px; color: var(--text-muted); }
      .val { font-size: 15px; font-weight: 600; line-height: 1.3; }
      .corazon { color: var(--danger-text); }
      .gastada { font-size: 12px; color: var(--text-muted); font-weight: 400; }
      .reglas-panel summary {
        cursor: pointer; font-size: 14px; font-weight: 600;
        display: flex; align-items: center; gap: 8px;
      }
      .reglas-panel[open] summary { margin-bottom: 8px; }
      .premio { color: var(--success-text); }
      .premio small { font-size: 11px; color: var(--text-muted); font-weight: 400; }

      .final {
        text-align: center; padding: 26px 20px; margin-bottom: 16px;
        border-radius: var(--radius-lg); border: 1px solid var(--border);
      }
      .final--gano {
        background: linear-gradient(160deg, var(--success-bg), var(--surface-2));
        border-color: var(--success-text);
      }
      .final--perdio { background: var(--surface-2); }
      .final h2 { font-size: 21px; font-weight: 700; margin: 0 0 6px; }
      .final--gano h2 { color: var(--success-text); }
      .final p { font-size: 13px; color: var(--text-secondary); margin: 0; }
      .trofeo { font-size: 44px; line-height: 1; margin-bottom: 10px; }
      .final--gano .trofeo { color: var(--warning-text); animation: brinca 1.4s ease-in-out infinite; }
      .premio-grande {
        font-size: 32px; font-weight: 700; color: var(--success-text); margin: 14px 0 2px;
      }
      .detalle { font-size: 12px; color: var(--text-muted); }

      @keyframes brinca {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .final--gano .trofeo { animation: none; }
      }

      .aviso { background: var(--warning-bg); color: var(--warning-text); font-size: 13px;
        padding: 11px 13px; border-radius: var(--radius); margin-bottom: 14px; }
      .panel--revivir { border-color: var(--accent-fill); }
      .aviso--fuera { background: var(--danger-bg); color: var(--danger-text); }

      .panel { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 15px; margin-bottom: 14px; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; }
      h3 { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
      .cierra { font-size: 12px; color: var(--text-secondary); }
      .ayuda { font-size: 13px; color: var(--text-secondary); margin: 0 0 12px; }

      .restantes { font-size: 12px; color: var(--text-muted); }
      .panel-head--boton {
        width: 100%; cursor: pointer; text-align: left; gap: 8px;
        background: transparent; border: none; padding: 0; color: inherit;
      }
      .panel-head--boton:hover h3 { color: var(--accent-text); }

      .panel-toggle {
        display: flex; align-items: center; justify-content: space-between; width: 100%;
        background: transparent; border: none; padding: 0; cursor: pointer;
        color: inherit; font-size: 15px; font-weight: 600;
      }
      .panel-toggle i { color: var(--text-muted); }
      .hist-cuerpo { margin-top: 14px; }
      .hist-nota { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; }
      .hist-jornadas { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      .hist-chip {
        min-width: 42px; padding: 7px 10px; cursor: pointer;
        border: 1px solid var(--border); border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
        font-size: 13px; font-weight: 600;
      }
      .hist-chip--activa {
        border-color: var(--accent-fill); background: var(--accent-bg); color: var(--accent-text);
      }
      .hist-cargando { font-size: 13px; color: var(--text-muted); }
      .panel-head--boton .restantes { margin-left: auto; }
      .chevron { font-size: 17px; color: var(--text-muted); flex-shrink: 0; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        font-size: 12px; padding: 5px 11px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
        display: inline-flex; align-items: center; gap: 6px;
      }
      .chip--usado { opacity: 0.5; text-decoration: line-through; }
      .chip-j {
        display: inline-block; text-decoration: none; opacity: 1;
        font-size: 10px; font-weight: 700; color: var(--accent-text);
        background: var(--accent-bg); border-radius: 4px; padding: 0 4px; margin-right: 3px;
      }
      .sin-catalogo { font-size: 12px; color: var(--text-muted); margin: 0; }

      /* --- Sección de participantes (supervivencia) rediseñada --- */
      .resumen-vivos {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; font-weight: 700; color: var(--success-text);
      }
      .grupo-titulo {
        font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
        color: var(--success-text); margin: 14px 0 8px;
      }
      .grupo-titulo--fuera { color: var(--text-muted); margin-top: 18px; }

      .jugador {
        border: 1px solid var(--border); border-radius: 12px;
        padding: 11px 12px; margin-bottom: 8px; background: var(--surface-2);
      }
      .jugador--vivo {
        border-color: color-mix(in srgb, var(--success-text) 30%, var(--border));
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--surface-2) 94%, var(--success-text)) 0%, var(--surface-2) 55%);
      }
      .jugador--fuera { opacity: 0.6; }
      .jugador--yo { box-shadow: inset 0 0 0 1.5px var(--accent-fill); }

      .jug-cab { display: flex; align-items: center; gap: 10px; }
      .avatar--vivo { background: color-mix(in srgb, var(--success-text) 18%, var(--surface-1)); color: var(--success-text); }
      .jug-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .jug-info .alias { font-size: 14px; font-weight: 700; }
      .tu { font-size: 11px; font-weight: 600; color: var(--accent-text); }
      .corazones { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--text-muted); }
      .corazones .corazon-on { color: var(--danger-text); }
      .corazones .sin-vida { margin-left: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--warning-text); }

      .chip-estado {
        flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-muted);
      }
      .chip-estado--vivo { color: var(--success-text); background: var(--success-bg); }

      .usados-fila { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 0 40px; }
      .sin-usados { font-size: 11px; color: var(--text-muted); margin: 8px 0 0 40px; }
      .sin-vida { font-size: 11px; color: var(--text-muted); }

      .chip--actual {
        background: var(--accent-bg); color: var(--accent-text);
        font-weight: 600; opacity: 1; text-decoration: none;
      }
      .chip--nada {
        background: var(--danger-bg); color: var(--danger-text);
        opacity: 1; text-decoration: none;
      }
      .usados-titulo {
        font-size: 11px; color: var(--text-muted); text-transform: uppercase;
        letter-spacing: 0.4px; margin: 14px 0 8px;
      }
      .pronostico {
        display: flex; align-items: center; gap: 8px; padding: 8px 0;
        border-bottom: 1px solid var(--border);
      }
      .pronostico:last-of-type { border-bottom: none; }
      .equipo-lado {
        flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
      }
      .equipo-lado--izq { justify-content: flex-end; }
      .equipo-lado--der { justify-content: flex-start; }
      .equipo-nombre { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .goles {
        width: 46px; min-height: 40px; text-align: center; font-size: 16px;
        padding: 6px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .guion { color: var(--text-muted); }

      .equipos { display: flex; flex-wrap: wrap; gap: 8px; }
      .equipo--activo {
        border-color: var(--accent-fill);
        background: var(--accent-bg);
        color: var(--accent-text);
        font-weight: 700;
      }
      .equipo {
        flex: 1 1 calc(50% - 4px); padding: 12px 10px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; font-size: 14px; font-weight: 600;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      }
      .equipo:hover:not(:disabled) { border-color: var(--accent-fill); background: var(--accent-bg); }
      .equipo:disabled { opacity: 0.5; }
      .usados { font-size: 11px; color: var(--text-muted); margin: 12px 0 0; }

      .elegido { display: flex; align-items: center; gap: 8px; font-size: 14px;
        background: var(--accent-bg); color: var(--accent-text);
        padding: 12px; border-radius: var(--radius); }

      .panel--arranque { border-color: var(--warning-text); }
      .arranque {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;
      }
      .arranque-dato { background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .plazo { margin-bottom: 12px; }
      .falta { display: block; font-size: 11px; color: var(--warning-text); margin-top: 2px; }
      .falta--vencida { color: var(--danger-text); }
      .listado-partidos { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
      .mini {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; padding: 4px 9px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-muted);
      }

      .panel--gestion { border-color: var(--accent-fill); }
      .etiqueta {
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
        padding: 3px 9px; border-radius: 999px;
        background: var(--accent-bg); color: var(--accent-text);
      }
      textarea {
        width: 100%; font-family: inherit; font-size: 16px; padding: 11px 12px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .captura { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 12px; }
      .btn {
        padding: 10px 16px; margin-top: 6px; cursor: pointer;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; font-size: 14px;
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600; }
      .btn:disabled { opacity: 0.6; cursor: default; }

      .fila { display: flex; align-items: center; gap: 10px; padding: 10px 0;
        border-bottom: 1px solid var(--border); }
      .fila:last-child { border-bottom: none; }
      .avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--surface-1);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600; color: var(--text-secondary); }
      .alias { flex: 1; font-size: 14px; font-weight: 600; }
      .vidas { color: var(--danger-text); font-size: 12px; }
      .estado { font-size: 11px; color: var(--text-muted); }
      .estado--vivo { color: var(--success-text); font-weight: 600; }
    `,
  ],
})
export class TorneoDetalleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(TorneosService);
  private readonly auth = inject(Auth);
  private readonly competiciones = inject(CompeticionesService);
  private readonly confirmar = inject(ConfirmarService);
  private readonly toast = inject(ToastService);
  private readonly stats = inject(StatsService);

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  // Marcamos el primer dato real de cada fuente que arma la vista.
  private readonly listoTorneo = signal(false);
  private readonly listoParticipantes = signal(false);
  // Los cartones de la jornada llegan encadenados (torneo → jornada → cartones);
  // marcamos cuando ya resolvimos su primer estado (con datos o vacío).
  private readonly cartonesListos = signal(false);

  readonly torneo = toSignal(
    this.service.torneo(this.id).pipe(tap(() => this.listoTorneo.set(true))),
    { initialValue: null },
  );
  readonly participantes = toSignal(
    this.service.participantes(this.id).pipe(tap(() => this.listoParticipantes.set(true))),
    { initialValue: [] as Participante[] },
  );
  /** Jornada en curso, tomada de la competición. */
  private readonly jornada = toSignal(
    toObservable(computed(() => this.torneo())).pipe(
      switchMap((t) =>
        t ? this.competiciones.jornadaPorNumero(t.competicionId, t.jornadaActual) : of(null),
      ),
    ),
    { initialValue: null as Jornada | null },
  );
  readonly yo = toSignal(this.service.miParticipacion(this.id), { initialValue: null });

  /**
   * Apaga el loading cuando el torneo y sus participantes ya llegaron. La
   * jornada depende del torneo (switchMap encadenado) y se resuelve enseguida;
   * no la exigimos para no dejar el spinner colgado si un torneo no tiene
   * jornada aún. Los cartones ajenos también se cargan encadenados; solo los
   * exigimos cuando esa sección va a mostrarse (quiniela con jornada revelada),
   * evitando el parpadeo de "Nadie envió pronósticos" antes de que lleguen.
   */
  private readonly apagar = effect(() => {
    const base = this.listoTorneo() && this.listoParticipantes();
    const esperaCartones = this.esQuiniela() && this.revelarQuinielas();
    if (base && (!esperaCartones || this.cartonesListos())) {
      apagarCargando(this.cargando, this.inicioCarga);
    }
  });

  readonly guardando = signal(false);
  /** Reloj interno para refrescar la cuenta regresiva. */
  private readonly ahora = signal(Date.now());

  /** Tiempo que falta para el cierre, en texto. */
  restante(j: Jornada): string {
    const f = fechaJornada(j);
    if (!f) return '';
    return this.enTexto(f.getTime() - this.ahora());
  }

  /** Convierte milisegundos restantes a algo legible. */
  private enTexto(ms: number): string {
    if (ms <= 0) return '';

    const min = Math.floor(ms / 60000);
    const dias = Math.floor(min / 1440);
    const horas = Math.floor((min % 1440) / 60);
    const mins = min % 60;

    if (dias > 0) return `${dias}d ${horas}h`;
    if (horas > 0) return `${horas}h ${mins}m`;
    return `${mins}m`;
  }

  readonly jornadaActual = computed<Jornada | null>(() => this.jornada());

  private readonly pickSignal = signal<Pick | null>(null);
  readonly miPick = computed(() => this.pickSignal());

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 30000);

    // Mi elección de la jornada en curso: cambia la jornada, cambia la escucha.
    let sub: Subscription | null = null;
    let subQ: Subscription | null = null;
    let jornadaEscuchada = -1;

    effect(() => {
      const numero = this.torneo()?.jornadaActual;
      if (numero === undefined || numero === jornadaEscuchada) return;

      untracked(() => {
        jornadaEscuchada = numero;
        sub?.unsubscribe();
        subQ?.unsubscribe();

        sub = this.service.miPick(this.id, numero).subscribe((p) => this.pickSignal.set(p));
        subQ = this.service.miQuiniela(this.id, numero).subscribe((q) => {
          this.quinielaSignal.set(q);
          // Precarga lo enviado para poder corregirlo.
          if (q?.marcadores?.length) this.marcadores.set([...q.marcadores]);
        });
      });
    });

    // Las elecciones ajenas solo se piden cuando la jornada ya cerró.
    let subPicks: Subscription | null = null;
    let jornadaPicks = -1;

    effect(() => {
      const abierta = this.revelarPicks();
      const numero = untracked(() => this.jornadaActual()?.numero ?? -1);

      if (!abierta || numero < 0) {
        subPicks?.unsubscribe();
        subPicks = null;
        jornadaPicks = -1;
        this.picksJornada.set([]);
        return;
      }
      if (numero === jornadaPicks) return;

      jornadaPicks = numero;
      subPicks?.unsubscribe();
      subPicks = this.service
        .picksJornada(this.id, numero)
        .subscribe((lista) => this.picksJornada.set(lista));
    });

    // Los cartones ajenos solo se piden cuando la jornada ya cerró.
    let subCartones: Subscription | null = null;
    let jornadaCartones = -1;

    effect(() => {
      const visible = this.revelarQuinielas();
      const numero = untracked(() => this.jornadaActual()?.numero ?? -1);

      if (!visible || numero < 0) {
        subCartones?.unsubscribe();
        subCartones = null;
        jornadaCartones = -1;
        this.quinielasSignal.set([]);
        // No hay cartones que esperar en este estado: liberamos el loading.
        this.cartonesListos.set(true);
        return;
      }
      if (numero === jornadaCartones) return;

      jornadaCartones = numero;
      subCartones?.unsubscribe();
      subCartones = this.service.quinielasJornada(this.id, numero).subscribe((lista) => {
        this.quinielasSignal.set(lista);
        this.cartonesListos.set(true);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      sub?.unsubscribe();
      subQ?.unsubscribe();
      subPicks?.unsubscribe();
      subCartones?.unsubscribe();
    });
  }

  readonly vivos = computed(() => this.participantes().filter((p) => p.vivo));

  readonly ordenados = computed(() =>
    [...this.participantes()].sort((a, b) => {
      if (a.vivo !== b.vivo) return a.vivo ? -1 : 1;
      return a.alias.localeCompare(b.alias, 'es');
    }),
  );

  /* --- Listas para la sección de participantes (supervivencia) --- */
  /** Los que siguen en pie, por alias. */
  readonly enPie = computed(() =>
    this.participantes()
      .filter((p) => p.vivo)
      .sort((a, b) => a.alias.localeCompare(b.alias, 'es')),
  );
  /** Los eliminados, primero los que cayeron más tarde (llegaron más lejos). */
  readonly eliminados = computed(() =>
    this.participantes()
      .filter((p) => !p.vivo)
      .sort((a, b) => (b.eliminadoEn ?? 0) - (a.eliminadoEn ?? 0) || a.alias.localeCompare(b.alias, 'es')),
  );
  /** Cuántas vidas configuró el torneo (para pintar los corazones). */
  readonly vidasTorneo = computed(() => Math.max(1, Number(this.torneo()?.vidas ?? 1)));
  /** Arreglo [0..vidas-1] para iterar los corazones en el template. */
  readonly corazones = computed(() => Array.from({ length: this.vidasTorneo() }, (_, i) => i));

  /**
   * Ganadores del torneo. Se calcula distinto según el modo, igual que el
   * backend al repartir:
   *  - QUINIELA: quienes tienen MÁS puntos del torneo; desempate por más
   *    marcadores exactos. (No es "todos": solo la cima de la tabla.)
   *  - SUPERVIVENCIA: los que siguen vivos, o quienes cayeron en la última
   *    jornada si ya no queda nadie.
   */
  private readonly ganadores = computed<Participante[]>(() => {
    const todos = this.participantes();
    if (todos.length === 0) return [];

    if (this.esQuiniela()) {
      const mejorPuntos = Math.max(...todos.map((p) => p.puntosTorneo ?? 0));
      const conMasPuntos = todos.filter((p) => (p.puntosTorneo ?? 0) === mejorPuntos);
      const mejorExactos = Math.max(...conMasPuntos.map((p) => p.exactos ?? 0));
      return conMasPuntos.filter((p) => (p.exactos ?? 0) === mejorExactos);
    }

    const vivos = this.vivos();
    if (vivos.length > 0) return vivos;

    const ultima = Math.max(0, ...todos.map((p) => p.eliminadoEn ?? 0));
    return todos.filter((p) => p.eliminadoEn === ultima);
  });

  readonly soyGanador = computed(() => {
    const yo = this.yo();
    return !!yo && this.ganadores().some((g) => g.id === yo.id);
  });

  /** Lo que me tocó de la bolsa. */
  readonly miPremio = computed(() => {
    const t = this.torneo();
    if (!t || !this.soyGanador()) return 0;
    return t.premioPagado ?? 0;
  });

  /** ¿Puedo gestionar este torneo? */
  readonly miUid = toSignal(user(this.auth).pipe(map((u) => u?.uid ?? null)), {
    initialValue: null,
  });

  readonly soyGestor = computed(() => {
    const uid = this.miUid();
    return !!uid && (this.torneo()?.gestores ?? []).includes(uid);
  });


  async iniciar(): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Iniciar el torneo',
      mensaje: 'Se cierran las inscripciones y ya nadie más podrá entrar.',
      aceptar: 'Iniciar',
    });
    if (!ok) return;
    await this.service.cambiarEstado(this.id, 'en-curso');
    this.toast.exito('Torneo iniciado.');
  }



  async finalizar(): Promise<void> {
    const vivos = this.vivos().length;
    const ok = await this.confirmar.pedir({
      titulo: 'Cerrar el torneo',
      mensaje: `${vivos} sobreviviente(s) se repartirán la bolsa en partes iguales.`,
      aceptar: 'Cerrar y repartir',
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await this.service.finalizar(this.id);
      this.toast.exito(
        `Torneo cerrado: ${r.ganadores} ganador(es)` +
        (r.premioPorCabeza > 0 ? ` · ${r.premioPorCabeza} pts cada uno.` : '.'),
      );
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo cerrar.');
    }
  }



  /** Elecciones mías que siguen sin definirse por un aplazamiento. */
  /** Todos mis picks, para saber en qué jornada usé cada equipo. */
  private readonly misPicksTodos = toSignal(this.service.misPicks(this.id), {
    initialValue: [] as Pick[],
  });

  /** Mapa equipo → jornada en que lo usé. */
  readonly jornadaDeEquipo = computed(() => {
    const mapa = new Map<string, number>();
    for (const p of this.misPicksTodos()) {
      if (p.equipo) mapa.set(p.equipo, p.jornada);
    }
    return mapa;
  });

  /** Etiqueta "J3" para un equipo, si sé en qué jornada se usó. */
  jornadaLabel(equipo: string): string {
    const j = this.jornadaDeEquipo().get(equipo);
    return j ? `J${j}` : '';
  }

  private readonly pendientes = toSignal(this.service.misPicksPendientes(this.id), {
    initialValue: [] as Pick[],
  });

  /**
   * Solo cuentan como "en espera" las elecciones de jornadas ya pasadas:
   * las de la jornada en curso están pendientes porque aún no se juega.
   */
  readonly pickEnEspera = computed(() => {
    const actual = this.torneo()?.jornadaActual ?? 0;
    return this.pendientes().find((p) => p.jornada < actual) ?? null;
  });

  /**
   * ¿Ya se pueden ver las elecciones de los demás?
   * Solo cuando el plazo de la jornada venció: antes sería copiarse.
   */
  readonly revelarPicks = computed(() => {
    if (this.esQuiniela()) return false;
    const j = this.jornadaActual();
    if (!j) return false;

    const cierre = fechaJornada(j);
    if (!cierre) return false;
    return cierre.getTime() <= this.ahora();
  });

  /** ¿Se pueden ver ya los cartones de todos? */
  readonly revelarQuinielas = computed(() => {
    if (!this.esQuiniela()) return false;
    const j = this.jornadaActual();
    if (!j) return false;

    const cierre = fechaJornada(j);
    if (!cierre) return false;
    return cierre.getTime() <= this.ahora();
  });

  /** Cartones de todos en la jornada. El tablero los ordena. */
  private readonly quinielasSignal = signal<Quiniela[]>([]);
  readonly quinielasJornada = this.quinielasSignal.asReadonly();

  /* ---- Historial de jornadas ---- */
  readonly verHistorial = signal(false);
  readonly jornadaHistorial = signal<number | null>(null);

  /** Jornadas ya jugadas: de la inicial hasta la anterior a la actual. */
  readonly jornadasPasadas = computed(() => {
    const t = this.torneo();
    if (!t) return [];
    const inicio = t.jornadaInicial ?? 1;
    const actual = t.jornadaActual ?? inicio;
    const fin = actual - 1; // la actual se ve arriba, no en historial
    const lista: number[] = [];
    for (let n = inicio; n <= fin; n++) lista.push(n);
    return lista.reverse(); // más reciente primero
  });

  /** Datos de la jornada de historial elegida (para nombres y resultados). */
  readonly jornadaHistorialData = toSignal(
    toObservable(computed(() => ({ t: this.torneo(), n: this.jornadaHistorial() }))).pipe(
      switchMap(({ t, n }) =>
        t && n ? this.competiciones.jornadaPorNumero(t.competicionId, n) : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** Cartones de la jornada de historial elegida. */
  readonly cartonesHistorial = toSignal(
    toObservable(this.jornadaHistorial).pipe(
      switchMap((n) => (n ? this.service.quinielasJornada(this.id, n) : of([]))),
    ),
    { initialValue: [] },
  );

  verJornadaHistorial(n: number): void {
    this.jornadaHistorial.set(this.jornadaHistorial() === n ? null : n);
  }

  /** Elecciones de la jornada en curso, una vez cerrada. */
  private readonly picksJornada = signal<Pick[]>([]);

  /** Qué eligió alguien en la jornada en curso. */
  eligio(uid: string): string | null {
    return this.picksJornada().find((p) => p.uid === uid)?.equipo ?? null;
  }

  /** Los equipos disponibles se consultan de vez en cuando: nacen ocultos. */
  readonly verEquipos = signal(false);

  /** ¿Este torneo se juega pronosticando marcadores? */
  readonly esQuiniela = computed(() => this.torneo()?.modo === 'quiniela');

  /** Mi quiniela de la jornada en curso. */
  private readonly quinielaSignal = signal<Quiniela | null>(null);
  readonly miQuinielaEnviada = computed(() => !!this.quinielaSignal());

  /** Marcadores que estoy capturando. */
  readonly marcadores = signal<Array<{ local: number | null; visitante: number | null }>>([]);

  ponerGol(indice: number, lado: 'local' | 'visitante', valor: unknown): void {
    const n = valor === null || valor === '' ? null : Math.trunc(Number(valor));
    this.marcadores.update((lista) => {
      const copia = [...lista];
      while (copia.length <= indice) copia.push({ local: null, visitante: null });
      copia[indice] = { ...copia[indice], [lado]: n };
      return copia;
    });
  }

  async enviarQuiniela(j: Jornada): Promise<void> {
    const lista = this.marcadores();
    const completos = j.partidos.every(
      (_, i) =>
        typeof lista[i]?.local === 'number' && typeof lista[i]?.visitante === 'number',
    );
    if (!completos) {
      this.toast.error('Falta capturar algún marcador.');
      return;
    }

    this.guardando.set(true);
    try {
      await this.service.guardarQuiniela(
        this.id,
        lista.slice(0, j.partidos.length).map((m) => ({
          local: Number(m.local),
          visitante: Number(m.visitante),
        })),
      );
      this.stats.evento('quiniela_guardada', { partidos: j.partidos.length });
      this.toast.exito('Pronósticos guardados.');
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudieron guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  readonly usados = computed(() => [...(this.yo()?.equiposUsados ?? [])].sort());

  /** Catálogo de equipos de la competición (y su tabla de posiciones cacheada). */
  readonly competicion = toSignal(
    toObservable(computed(() => this.torneo()?.competicionId)).pipe(
      switchMap((id) => (id ? this.competiciones.competicion(id) : of(null))),
    ),
    { initialValue: null },
  );

  /**
   * Mostramos la tabla de la liga solo si la competición está vinculada a la
   * API (tiene apiLigaId) y ya hay filas cacheadas. Si es una liga manual, no
   * aparece nada.
   */
  readonly mostrarTablaLiga = computed(() => {
    const c = this.competicion();
    return !!c?.apiLigaId && (c?.tabla?.length ?? 0) > 0;
  });

  /** Equipos comprometidos: los ya resueltos más los que están en juego. */
  readonly comprometidos = computed(() => {
    const resueltos = this.usados();
    const enJuego = this.pendientes().map((p) => p.equipo);
    return [...new Set([...resueltos, ...enJuego])].sort();
  });

  /** Equipos que todavía puedo usar en el resto del torneo. */
  readonly disponiblesTotales = computed(() => {
    const catalogo = this.competicion()?.equipos ?? [];
    const comprometidos = this.comprometidos();
    return catalogo.filter((e) => !comprometidos.includes(e));
  });

  readonly disponibles = computed(() => {
    const equipos = equiposDeJornada(this.jornadaActual());
    // El equipo elegido esta jornada sigue disponible: así se puede
    // cambiar mientras el plazo no cierre.
    const actual = this.miPick()?.equipo;
    const bloqueados = this.comprometidos().filter((e) => e !== actual);
    return equipos
      .filter((e) => !bloqueados.includes(e))
      .sort((a, b) => a.localeCompare(b));
  });

  /* --- Revivir --- */
  readonly reviviendo = signal(false);
  readonly mensajeRevivir = signal('');
  readonly errorRevivir = signal(false);

  /** ¿Puede revivir ahora? Solo en la jornada siguiente a su caída. */
  readonly puedeRevivir = computed(() => {
    const t = this.torneo();
    const yo = this.yo();
    if (!t?.permiteRevivir || t.estado !== 'en-curso') return false;
    if (!yo || yo.vivo || yo.revivioEn) return false;
    const cayo = yo.eliminadoEn ?? 0;
    return cayo > 0 && (t.jornadaActual ?? 0) === cayo + 1;
  });

  /** Costo de revivir: (jornada ÷ 2) × entrada, decimal tal cual. */
  readonly costoRevivir = computed(() => {
    const t = this.torneo();
    if (!t) return 0;
    return Math.round(((t.jornadaActual ?? 0) / 2) * (t.costoEntrada ?? 0));
  });

  async revivir(): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Revivir',
      mensaje:
        `Te costará ${this.costoRevivir()} pts y regresas con las mismas vidas ` +
        'que tenías al caer. Es tu única oportunidad.',
      aceptar: 'Revivir',
    });
    if (!ok) return;

    this.reviviendo.set(true);
    this.mensajeRevivir.set('');
    this.errorRevivir.set(false);
    try {
      await this.service.revivir(this.id);
      this.mensajeRevivir.set('¡Estás de vuelta! Elige con cuidado.');
    } catch (e: unknown) {
      this.errorRevivir.set(true);
      this.mensajeRevivir.set((e as Error)?.message ?? 'No se pudo revivir.');
    } finally {
      this.reviviendo.set(false);
    }
  }

  readonly puedeElegir = computed(() => {
    const j = this.jornadaActual();
    const f = fechaJornada(j);
    return !!this.yo()?.vivo && j?.estado === 'abierta' && (!f || f.getTime() > Date.now());
  });

  cierre(j: Jornada): Date | null {
    return fechaJornada(j);
  }

  /** Hasta cuándo se puede entrar al torneo. */
  readonly cierreInscripcion = computed(() => fechaInscripcion(this.torneo()));

  /** Cuánto falta para que cierren las inscripciones. */
  readonly restanteInscripcion = computed(() => {
    const f = this.cierreInscripcion();
    if (!f) return '';
    return this.enTexto(f.getTime() - this.ahora());
  });

  etiquetaEstado(e: Torneo['estado']): string {
    return e === 'inscripcion' ? 'Inscripciones' : e === 'en-curso' ? 'En curso' : 'Finalizado';
  }

  inicial(alias: string): string {
    return (alias?.[0] ?? '?').toUpperCase();
  }

  async elegir(equipo: string): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: this.miPick() ? `Cambiar a ${equipo}` : `Elegir a ${equipo}`,
      mensaje: 'No podrás usarlo de nuevo en el resto del torneo.',
      aceptar: 'Confirmar',
    });
    if (!ok) return;
    const yaTenia = !!this.miPick();
    this.guardando.set(true);
    try {
      await this.service.elegir(this.id, equipo);
      this.toast.exito(yaTenia ? `Cambiaste a ${equipo}.` : `Elegiste ${equipo}.`);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo guardar tu elección.');
    } finally {
      this.guardando.set(false);
    }
  }
}