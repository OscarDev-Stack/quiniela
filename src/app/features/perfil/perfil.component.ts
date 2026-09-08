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
import { StatsService } from '../../shared/stats.service';
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

        @if (esMio() && me()?.email; as correo) {
          <p class="correo">{{ correo }}</p>
        }

        @if (posicion(); as p) {
          <p class="posicion">Lugar #{{ p }} del ranking</p>
        }
      </header>

      <section class="tarjetas">
        <div class="tarjeta">
          <span class="tarjeta-icono icono-acierto"><i class="ti ti-target-arrow"></i></span>
          <span class="val acento">
            {{ porcentaje() }}%
          </span>
          <span class="etq">Acierto</span>
          <small class="sub">{{ aciertos() }}/{{ resueltos() }}</small>
        </div>
        <div class="tarjeta">
          <span class="tarjeta-icono icono-racha"><i class="ti ti-flame"></i></span>
          <span class="val">
            {{ racha() }}
            @if (racha() >= 3) { <span class="fuego">🔥</span> }
          </span>
          <span class="etq">Racha</span>
          <small class="sub">mejor {{ mejorRacha() }}</small>
        </div>
        <div class="tarjeta">
          <span class="tarjeta-icono icono-puntos"><i class="ti ti-coins"></i></span>
          <span class="val" [class.neg]="historicos() < 0">{{ historicos() | number }}</span>
          <span class="etq">Puntos históricos</span>
        </div>
        <div class="tarjeta">
          <span class="tarjeta-icono icono-torneos"><i class="ti ti-trophy"></i></span>
          <span class="val dorado">{{ trofeos().length || torneosGanados() }}</span>
          <span class="etq">Torneos ganados</span>
        </div>
      </section>

      @if (esMio()) {
        <section class="panel">
          <h2>Mi actividad</h2>
          <div class="actividad">
            <div class="act-tarjeta act-tarjeta--saldo">
              <span class="act-icono"><i class="ti ti-wallet"></i></span>
              <span class="act-val" [class.neg]="(me()?.puntos ?? 0) < 0">{{ me()?.puntos ?? 0 | number }} pts</span>
              <span class="act-etq">Saldo disponible</span>
            </div>
            <div class="act-tarjeta act-tarjeta--apostado">
              <span class="act-icono"><i class="ti ti-chart-bar"></i></span>
              <span class="act-val">{{ resumen()?.totalApostado ?? 0 | number }} pts</span>
              <span class="act-etq">Total apostado</span>
            </div>
            <div class="act-tarjeta act-tarjeta--premio">
              <span class="act-icono"><i class="ti ti-trophy"></i></span>
              <span class="act-val">{{ resumen()?.mejorPremio ?? 0 | number }} pts</span>
              <span class="act-etq">Mejor premio</span>
            </div>
          </div>

          <button class="ver-movs" (click)="verMovimientos()">
            <span><i class="ti ti-receipt"></i> Ver todos mis movimientos</span>
            <i class="ti ti-chevron-right"></i>
          </button>
        </section>
      }

      @if (trofeos().length > 0) {
      <section class="panel panel--trofeos">
        <h2><i class="ti ti-trophy"></i> Trofeos <span class="trofeos-conteo">{{ trofeos().length }}</span></h2>
        <div class="trofeos-lista">
        @for (t of trofeos(); track t.id) {
          <div class="trofeo">
            <span class="copa"><i class="ti ti-trophy"></i></span>
            <div class="trofeo-nombre">{{ t.torneo }}</div>
            <div class="trofeo-sub">
              {{ t.competicion }}
              @if (t.compartido) { <span class="chip-compartido"><i class="ti ti-users"></i> compartido</span> }
            </div>
            @if (t.premio > 0) {
              <span class="trofeo-premio">+{{ t.premio | number }}</span>
            }
          </div>
        }
        </div>
      </section>
      }

      @if (esMio() && validada()) {
        <!-- Un solo panel de Notificaciones con los dos canales adentro. -->
        <section class="panel panel--notif">
          <div class="panel-head">
            <h3><i class="ti ti-bell"></i> Notificaciones</h3>
          </div>
          <p class="notif-intro">
            Elige por dónde recibir los avisos de tus jornadas, resultados y torneos.
          </p>

          <!-- Canal 1: este dispositivo (push) -->
          <div class="canal">
            <app-notificaciones-boton [pushTokens]="me()?.pushTokens ?? []" />
          </div>

          <!-- Canal 2: Telegram -->
          <div class="canal canal--tg">
            <div class="fila">
              <span class="cat-icono cat-icono--tg"><i class="ti ti-brand-telegram"></i></span>
              <div class="txt">
                <span class="tit">Telegram</span>
                <small class="pista">
                  @if (conectado()) {
                    Recibes los avisos en tu chat de Telegram.
                  } @else {
                    Conéctalo con un toque y recibe los avisos en tu chat, sin copiar códigos.
                  }
                </small>
              </div>

              @if (conectado()) {
                <label class="switch">
                  <input
                    type="checkbox"
                    class="switch-input"
                    [ngModel]="activo"
                    (ngModelChange)="alternarAvisos($event)"
                  />
                  <span class="switch-pista" aria-hidden="true"></span>
                </label>
              } @else {
                <button class="btn-tg" [disabled]="guardandoTg()" (click)="conectar()">
                  <i class="ti ti-brand-telegram"></i>
                  {{ guardandoTg() ? 'Preparando…' : 'Conectar' }}
                </button>
              }
            </div>

            @if (conectado()) {
              <p class="ayuda-tg ayuda-tg--chica">
                Escribe <strong>/stop</strong> en el chat del bot para dejar de recibirlos.
              </p>
            }
            @if (mensajeTg()) {
              <p class="aviso-tg" [class.aviso-tg--error]="errorTg()">{{ mensajeTg() }}</p>
            }
            @if (!conectado() && enlaceTg(); as enlace) {
              <a class="btn-tg btn-tg--enlace" [href]="enlace" target="_blank" rel="noopener">
                <i class="ti ti-brand-telegram"></i> ¿No abrió? Abre Telegram
              </a>
            }
          </div>

          <!-- Categorías: qué tipo de avisos recibir. Solo tiene sentido si
               hay algún canal activo (push o Telegram). -->
          @if (algunCanalActivo()) {
            <div class="canal canal--cat">
              <p class="cat-titulo">¿Qué avisos quieres recibir?</p>

              <label class="switch switch--cat">
                <span class="cat-icono"><i class="ti ti-trophy"></i></span>
                <span class="txt">
                  <span class="tit">Torneos donde participo</span>
                  <small class="pista">Jornadas, resultados y premios de tus torneos y eliminatorias.</small>
                </span>
                <input
                  type="checkbox"
                  class="switch-input"
                  [ngModel]="catInscritos()"
                  (ngModelChange)="alternarCategoria('torneosInscritos', $event)"
                />
                <span class="switch-pista" aria-hidden="true"></span>
              </label>

              <label class="switch switch--cat">
                <span class="cat-icono"><i class="ti ti-calendar-event"></i></span>
                <span class="txt">
                  <span class="tit">Resumen del día</span>
                  <small class="pista">Un aviso diario con los torneos públicos y partidos por cerrar de tu grupo o global.</small>
                </span>
                <input
                  type="checkbox"
                  class="switch-input"
                  [ngModel]="catOportunidades()"
                  (ngModelChange)="alternarCategoria('oportunidades', $event)"
                />
                <span class="switch-pista" aria-hidden="true"></span>
              </label>

              <label class="switch switch--cat">
                <span class="cat-icono"><i class="ti ti-chart-bar"></i></span>
                <span class="txt">
                  <span class="tit">Resultados de mis pronósticos</span>
                  <small class="pista">Cuando se liquida un partido que pronosticaste.</small>
                </span>
                <input
                  type="checkbox"
                  class="switch-input"
                  [ngModel]="catPartidos()"
                  (ngModelChange)="alternarCategoria('partidos', $event)"
                />
                <span class="switch-pista" aria-hidden="true"></span>
              </label>
            </div>
          }
        </section>
      }

      @if (esMio() && validada()) {
        <div class="reinicio">
          @if (yaSolicitado()) {
            <div class="reinicio-fila reinicio-fila--pend">
              <span class="reinicio-icono"><i class="ti ti-clock"></i></span>
              <div class="reinicio-txt">
                <span class="reinicio-tit">Solicitud enviada</span>
                <small class="reinicio-sub">
                  El administrador la revisará. Si tu saldo se mueve, podrás pedirlo de nuevo.
                </small>
              </div>
            </div>
          } @else {
            <button class="reinicio-fila" [disabled]="pidiendo()" (click)="pedirReinicio()">
              <span class="reinicio-icono"><i class="ti ti-refresh-dot"></i></span>
              <div class="reinicio-txt">
                <span class="reinicio-tit">{{ pidiendo() ? 'Enviando…' : 'Reiniciar saldo' }}</span>
                <small class="reinicio-sub">
                  @if (saldo() < 0) {
                    Tu saldo está en rojo. Pide que lo regresen a cero.
                  } @else {
                    Tu saldo actual es de {{ saldo() | number }} pts. Al reiniciar, los datos comenzarán nuevamente desde cero.
                  }
                </small>
              </div>
              <i class="ti ti-chevron-right reinicio-flecha"></i>
            </button>
          }

          @if (mensajeReinicio()) {
            <p class="aviso-tg" [class.aviso-tg--error]="errorReinicio()">
              {{ mensajeReinicio() }}
            </p>
          }
        </div>
      }

      @if (esMio()) {
        <app-instalar-boton />

        <button class="salir" (click)="salir()">
          <i class="ti ti-logout"></i> Cerrar sesión
        </button>
      }

      <button class="version" (click)="verNovedades()">
        v{{ version }} · Ver novedades
        <span class="marca-agua">Fut by AutomatePower</span>
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
      .correo { font-size: 12px; color: var(--text-muted); margin: 2px 0 0; opacity: 0.8; }

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
        border-radius: var(--radius); padding: 14px 12px;
        display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3px; }
      .tarjeta-icono {
        display: inline-flex; align-items: center; justify-content: center;
        width: 34px; height: 34px; border-radius: 50%; font-size: 17px; margin-bottom: 4px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .icono-acierto { background: var(--accent-bg); color: var(--accent-text); }
      .icono-racha { background: var(--danger-bg); color: var(--danger-text); }
      .icono-puntos { background: var(--surface-1); color: var(--text-secondary); }
      .icono-torneos { background: var(--warning-bg); color: var(--warning-text); }
      .etq { display: block; font-size: 11px; color: var(--text-muted); }
      .val { font-size: 22px; font-weight: 700; display: flex; align-items: baseline; justify-content: center; gap: 5px; line-height: 1.1; }
      .sub { font-size: 11px; font-weight: 400; color: var(--text-muted); }
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

      /* Mi actividad: tres tarjetitas con lo más importante del saldo. */
      .actividad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .act-tarjeta {
        display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
        padding: 12px 10px; border-radius: var(--radius);
        border: 1px solid var(--border); background: var(--surface-1);
      }
      .act-icono {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 50%; font-size: 15px; margin-bottom: 2px;
        background: var(--surface-2); color: var(--text-secondary);
      }
      .act-val { font-size: 16px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
      .act-etq { font-size: 11px; color: var(--text-muted); line-height: 1.3; }
      .act-tarjeta--saldo .act-icono { background: var(--success-bg); color: var(--success-text); }
      .act-tarjeta--apostado .act-icono { background: var(--accent-bg); color: var(--accent-text); }
      .act-tarjeta--premio .act-icono { background: var(--warning-bg); color: var(--warning-text); }
      .act-tarjeta--premio .act-val { color: var(--success-text); }
      .act-val.neg { color: var(--danger-text); }

      /* --- Trofeos: acabado dorado, cada logro como una tarjeta destacada --- */
      .panel--trofeos h2 { display: flex; align-items: center; gap: 8px; }
      .panel--trofeos h2 .ti-trophy { color: #c9a227; }
      .trofeos-conteo { margin-left: auto; font-size: 12px; font-weight: 700;
        line-height: 1; padding: 4px 9px; border-radius: 999px;
        color: #6b5518; background: linear-gradient(180deg, #e6d6a8, #c9a227);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }

      .trofeos-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px; margin-top: 4px; }

      /* Tarjeta de logro: copa arriba al centro, nombre debajo, luego el resto */
      .trofeo { position: relative; display: flex; flex-direction: column; align-items: center;
        text-align: center; gap: 8px; padding: 16px 12px; border-radius: 14px; overflow: hidden;
        border: 1px solid rgba(201, 162, 39, 0.28);
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(201, 162, 39, 0.10), transparent 60%),
          var(--surface-2, var(--card-bg, rgba(255, 255, 255, 0.03)));
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease; }
      /* Franja dorada superior que marca el logro */
      .trofeo::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px;
        background: linear-gradient(90deg, #d8c690, #c9a227, #a8842a); }
      .trofeo:hover { transform: translateY(-1px);
        border-color: rgba(201, 162, 39, 0.45);
        box-shadow: 0 6px 18px rgba(168, 132, 42, 0.14); }

      .copa { position: relative; width: 52px; height: 52px; border-radius: 50%;
        flex-shrink: 0; color: #fff; font-size: 24px; margin-top: 4px;
        display: flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at 30% 25%, #ded1a5, #c9a227 48%, #a8842a 100%);
        box-shadow: 0 2px 6px rgba(168, 132, 42, 0.32),
          inset 0 1px 2px rgba(255, 255, 255, 0.45); }
      /* Anillo suave alrededor de la copa */
      .copa::after { content: ''; position: absolute; inset: -4px; border-radius: 50%;
        border: 2px solid rgba(201, 162, 39, 0.28); }

      .trofeo-nombre { font-size: 15px; font-weight: 700; letter-spacing: 0.2px;
        line-height: 1.25; }
      .trofeo-sub { font-size: 12px; color: var(--text-muted); display: flex;
        flex-direction: column; align-items: center; gap: 6px; }
      .chip-compartido { display: inline-flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
        color: var(--text-secondary); background: var(--chip-bg, rgba(127, 127, 127, 0.14)); }
      .chip-compartido .ti { font-size: 12px; }

      .trofeo-premio { font-size: 14px; font-weight: 700;
        color: var(--success-text);
        padding: 4px 12px; border-radius: 999px;
        background: color-mix(in srgb, var(--success-text) 14%, transparent); }

      @media (prefers-reduced-motion: reduce) {
        .trofeo { transition: none; }
        .trofeo:hover { transform: none; }
      }
      .ayuda-tg { font-size: 13px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.5; }
      .ayuda-tg strong { color: var(--text-primary); }
      .ayuda-tg--chica { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; }

      /* Panel de notificaciones con los dos canales como filas separadas. */
      .notif-intro { font-size: 12px; color: var(--text-secondary); margin: 0 0 4px; line-height: 1.45; }
      .canal { padding: 14px 0; border-top: 1px solid var(--border); }
      .canal:first-of-type { border-top: none; }
      .canal .fila {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      }
      .canal .txt { min-width: 0; flex: 1; }
      .canal .tit { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; }
      .canal .pista { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.4; }
      .btn-tg {
        flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
        padding: 9px 15px; border-radius: var(--radius); cursor: pointer;
        border: none; background: var(--accent-fill); color: #fff; font-weight: 600; font-size: 13px;
      }
      .btn-tg:hover { filter: brightness(1.06); }
      .btn-tg:disabled { opacity: 0.6; cursor: default; }
      /* Enlace de respaldo: si el salto automático no abrió Telegram. */
      .btn-tg--enlace { margin-top: 10px; text-decoration: none; width: fit-content; }
      .switch {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        margin-bottom: 16px; font-size: 14px; cursor: pointer;
      }
      .switch-texto { flex: 1; }
      /* Dentro de un canal, el switch es solo el interruptor a la derecha. */
      .canal .switch { margin-bottom: 0; flex-shrink: 0; }

      /* Categorías: título y switches con texto a la izquierda. */
      .canal--cat { display: flex; flex-direction: column; gap: 14px; }
      .cat-titulo { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
      .canal .switch--cat { margin-bottom: 0; flex-shrink: 1; width: 100%; }
      .switch--cat .txt { flex: 1; display: flex; flex-direction: column; }
      .switch--cat .tit { font-size: 14px; font-weight: 600; }
      .switch--cat .pista { font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.4; }

      /* Ícono redondo a la izquierda de cada fila de notificación. */
      .cat-icono {
        display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
        width: 34px; height: 34px; border-radius: 50%; font-size: 17px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .cat-icono--tg { background: var(--accent-bg); color: var(--accent-text); }

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

      /* Reinicio de saldo: fila sutil de advertencia, al final del perfil. */
      .reinicio { margin-bottom: 14px; }
      .reinicio-fila {
        display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
        padding: 13px 14px; cursor: pointer;
        border: 1px solid var(--danger-border, var(--danger-bg)); border-radius: var(--radius-lg);
        background: var(--danger-bg); color: var(--danger-text);
      }
      .reinicio-fila:disabled { opacity: 0.6; cursor: default; }
      .reinicio-fila--pend { cursor: default; background: var(--warning-bg); border-color: var(--warning-bg); color: var(--warning-text); }
      .reinicio-icono {
        display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
        width: 34px; height: 34px; border-radius: 50%; font-size: 17px;
        background: rgba(0, 0, 0, 0.06); color: inherit;
      }
      .reinicio-txt { flex: 1; min-width: 0; }
      .reinicio-tit { display: block; font-size: 14px; font-weight: 600; }
      .reinicio-sub { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }
      .reinicio-flecha { flex-shrink: 0; opacity: 0.7; }

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
      .marca-agua {
        display: block; margin-top: 3px;
        font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
        color: var(--text-muted); opacity: 0.7;
      }
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
  private readonly stats = inject(StatsService);

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
      this.stats.evento('alias_cambiado');
      this.stats.evento('perfil_editado', { campo: 'alias' });
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

  /** Enlace de conexión listo, como respaldo por si el salto no abre solo. */
  readonly enlaceTg = signal('');

  /** Abre Telegram con el enlace personal de conexión. */
  async conectar(): Promise<void> {
    this.guardandoTg.set(true);
    this.mensajeTg.set('');
    this.errorTg.set(false);
    this.enlaceTg.set('');

    try {
      const enlace = await this.perfil.vincularTelegram();
      // Guardamos el enlace para ofrecer un botón directo de respaldo.
      this.enlaceTg.set(enlace);

      // En una PWA instalada en iOS (modo standalone), window.open('_blank')
      // se pierde: no hay pestaña a donde ir. Navegar en la misma ventana con
      // location.href sí dispara la apertura de Telegram. Fuera de standalone,
      // una pestaña nueva es lo más cómodo.
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;

      if (standalone) {
        window.location.href = enlace;
      } else {
        window.open(enlace, '_blank');
      }
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

  /* --- Categorías de notificación --- */
  /** ¿Tiene algún canal activo? Solo entonces mostramos las categorías. */
  readonly algunCanalActivo = computed(
    () => this.me()?.pushActivo === true || this.conectado(),
  );

  /**
   * Override optimista mientras Firestore propaga el cambio, para que el
   * switch reaccione al instante. Se limpia solo cuando llega el valor real.
   */
  private readonly prefsOverride = signal<Partial<{
    torneosInscritos: boolean;
    oportunidades: boolean;
    partidos: boolean;
  }>>({});

  /** Lee una categoría con default y respetando el override optimista. */
  private leerCat(cat: 'torneosInscritos' | 'oportunidades' | 'partidos', porDefecto: boolean): boolean {
    const ov = this.prefsOverride()[cat];
    if (ov !== undefined) return ov;
    return this.me()?.prefsNotif?.[cat] ?? porDefecto;
  }

  readonly catInscritos = computed(() => this.leerCat('torneosInscritos', true));
  readonly catOportunidades = computed(() => this.leerCat('oportunidades', false));
  readonly catPartidos = computed(() => this.leerCat('partidos', true));

  /** Cambia una categoría y guarda las tres en el servidor. */
  async alternarCategoria(
    cat: 'torneosInscritos' | 'oportunidades' | 'partidos',
    valor: boolean,
  ): Promise<void> {
    // Optimista: reflejamos el toque de inmediato.
    this.prefsOverride.update((p) => ({ ...p, [cat]: valor }));

    const prefs = {
      torneosInscritos: this.catInscritos(),
      oportunidades: this.catOportunidades(),
      partidos: this.catPartidos(),
    };

    try {
      await this.perfil.guardarPrefsNotif(prefs);
      this.toast.exito('Preferencias guardadas.');
    } catch (e: unknown) {
      // Revertimos el override de esa categoría.
      this.prefsOverride.update((p) => ({ ...p, [cat]: !valor }));
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

    this.stats.evento('logout', { origen: 'perfil' });
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