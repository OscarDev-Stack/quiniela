/**
 * Catálogo de equipos de la Liga MX con su escudo.
 *
 * Cada equipo tiene un nombre "oficial", el archivo de su escudo (en
 * public/escudos/) y una lista de "alias": otras formas en que puede
 * llegar el nombre (de la API, escrito a mano, abreviado). Así, aunque
 * un partido diga "Chivas" y otro "Guadalajara", ambos encuentran el
 * mismo escudo.
 *
 * Para agregar una liga nueva: pon los escudos en public/escudos/ y
 * añade sus equipos a esta lista con sus alias.
 */
export interface EquipoCatalogo {
  nombre: string;
  escudo: string; // archivo dentro de public/escudos/
  alias: string[]; // otras formas del nombre, en minúsculas
  liga: string; // 'Liga MX', 'MLS', 'Selecciones', etc. Para organizar.
}

export const EQUIPOS_LIGA_MX: EquipoCatalogo[] = [
  /* ---------------- Liga MX (18) ---------------- */
  { nombre: 'América', escudo: 'america.png', alias: ['america', 'club america', 'club américa'], liga: 'Liga MX' },
  { nombre: 'Guadalajara', escudo: 'guadalajara.png', alias: ['guadalajara', 'chivas', 'cd guadalajara'], liga: 'Liga MX' },
  { nombre: 'Cruz Azul', escudo: 'cruz-azul.png', alias: ['cruz azul', 'cruzazul'], liga: 'Liga MX' },
  { nombre: 'Pumas', escudo: 'pumas.png', alias: ['pumas', 'pumas unam', 'unam'], liga: 'Liga MX' },
  { nombre: 'Monterrey', escudo: 'monterrey.png', alias: ['monterrey', 'rayados', 'cf monterrey'], liga: 'Liga MX' },
  { nombre: 'Tigres', escudo: 'tigres.png', alias: ['tigres', 'tigres uanl', 'uanl'], liga: 'Liga MX' },
  { nombre: 'Toluca', escudo: 'toluca.png', alias: ['toluca', 'deportivo toluca'], liga: 'Liga MX' },
  { nombre: 'Pachuca', escudo: 'pachuca.png', alias: ['pachuca', 'cf pachuca'], liga: 'Liga MX' },
  { nombre: 'Santos', escudo: 'santos.png', alias: ['santos', 'santos laguna'], liga: 'Liga MX' },
  { nombre: 'León', escudo: 'leon.png', alias: ['leon', 'león', 'club leon'], liga: 'Liga MX' },
  { nombre: 'Atlas', escudo: 'atlas.png', alias: ['atlas', 'atlas fc'], liga: 'Liga MX' },
  { nombre: 'Necaxa', escudo: 'necaxa.png', alias: ['necaxa'], liga: 'Liga MX' },
  { nombre: 'Puebla', escudo: 'puebla.png', alias: ['puebla', 'club puebla'], liga: 'Liga MX' },
  { nombre: 'Querétaro', escudo: 'queretaro.png', alias: ['queretaro', 'querétaro', 'gallos'], liga: 'Liga MX' },
  { nombre: 'Atlético San Luis', escudo: 'atleticosl.png', alias: ['atletico san luis', 'atlético san luis', 'san luis'], liga: 'Liga MX' },
  { nombre: 'Atlante', escudo: 'atlante.png', alias: ['atlante', 'club atlante', 'atlante fc'], liga: 'Liga MX' },
  { nombre: 'Juárez', escudo: 'juarez.png', alias: ['juarez', 'juárez', 'fc juarez', 'bravos'], liga: 'Liga MX' },
  { nombre: 'Tijuana', escudo: 'tijuana.png', alias: ['tijuana', 'xolos', 'club tijuana'], liga: 'Liga MX' },

  /* ---------------- MLS temporada 2026 (30 clubes) ---------------- */
  { nombre: 'Atlanta United', escudo: 'atlanta.png', alias: ['atlanta united', 'atlanta', 'atlanta utd'], liga: 'MLS' },
  { nombre: 'Charlotte FC', escudo: 'charlotte.png', alias: ['charlotte fc', 'charlotte'], liga: 'MLS' },
  { nombre: 'Chicago Fire', escudo: 'chicago.png', alias: ['chicago fire', 'chicago', 'chicago fire fc'], liga: 'MLS' },
  { nombre: 'FC Cincinnati', escudo: 'cincinnati.png', alias: ['fc cincinnati', 'cincinnati'], liga: 'MLS' },
  { nombre: 'Columbus Crew', escudo: 'columbus.png', alias: ['columbus crew', 'columbus'], liga: 'MLS' },
  { nombre: 'D.C. United', escudo: 'dcunited.png', alias: ['d.c. united', 'dc united', 'dc', 'washington'], liga: 'MLS' },
  { nombre: 'Inter Miami', escudo: 'intermiami.png', alias: ['inter miami', 'inter miami cf', 'miami'], liga: 'MLS' },
  { nombre: 'CF Montréal', escudo: 'montreal.png', alias: ['cf montreal', 'cf montréal', 'montreal', 'montréal'], liga: 'MLS' },
  { nombre: 'Nashville SC', escudo: 'nashville.png', alias: ['nashville sc', 'nashville'], liga: 'MLS' },
  { nombre: 'New England Revolution', escudo: 'newengland.png', alias: ['new england revolution', 'new england', 'revolution'], liga: 'MLS' },
  { nombre: 'New York City FC', escudo: 'newyorkcity.png', alias: ['new york city fc', 'nycfc', 'nyc fc', 'new york city'], liga: 'MLS' },
  { nombre: 'New York Red Bulls', escudo: 'newyork.png', alias: ['new york red bulls', 'ny red bulls', 'red bulls', 'red bull new york'], liga: 'MLS' },
  { nombre: 'Orlando City', escudo: 'orlandocity.png', alias: ['orlando city', 'orlando', 'orlando city sc'], liga: 'MLS' },
  { nombre: 'Philadelphia Union', escudo: 'philadelphia.png', alias: ['philadelphia union', 'philadelphia', 'philly'], liga: 'MLS' },
  { nombre: 'Toronto FC', escudo: 'toronto.png', alias: ['toronto fc', 'toronto'], liga: 'MLS' },
  { nombre: 'Austin FC', escudo: 'austin.png', alias: ['austin fc', 'austin'], liga: 'MLS' },
  { nombre: 'Colorado Rapids', escudo: 'colorado.png', alias: ['colorado rapids', 'colorado', 'rapids'], liga: 'MLS' },
  { nombre: 'FC Dallas', escudo: 'dallas.png', alias: ['fc dallas', 'dallas'], liga: 'MLS' },
  { nombre: 'Houston Dynamo', escudo: 'houstondynamo.png', alias: ['houston dynamo', 'houston', 'dynamo'], liga: 'MLS' },
  { nombre: 'Sporting Kansas City', escudo: 'kansascity.png', alias: ['sporting kansas city', 'sporting kc', 'kansas city', 'skc'], liga: 'MLS' },
  { nombre: 'LA Galaxy', escudo: 'losangelesgalaxy.png', alias: ['la galaxy', 'galaxy', 'los angeles galaxy'], liga: 'MLS' },
  { nombre: 'LAFC', escudo: 'losangeles.png', alias: ['lafc', 'los angeles fc'], liga: 'MLS' },
  { nombre: 'Minnesota United', escudo: 'minnesota.png', alias: ['minnesota united', 'minnesota', 'mnufc', 'the loons'], liga: 'MLS' },
  { nombre: 'Portland Timbers', escudo: 'portland.png', alias: ['portland timbers', 'portland', 'timbers'], liga: 'MLS' },
  { nombre: 'Real Salt Lake', escudo: 'realstaltlake.png', alias: ['real salt lake', 'rsl', 'salt lake'], liga: 'MLS' },
  { nombre: 'San Diego FC', escudo: 'sandiego.png', alias: ['san diego fc', 'san diego'], liga: 'MLS' },
  { nombre: 'San Jose Earthquakes', escudo: 'sanjose.png', alias: ['san jose earthquakes', 'san jose', 'earthquakes'], liga: 'MLS' },
  { nombre: 'Seattle Sounders', escudo: 'seattle.png', alias: ['seattle sounders', 'seattle', 'sounders'], liga: 'MLS' },
  { nombre: 'St. Louis City', escudo: 'st_louis_city.png', alias: ['st. louis city', 'st louis city', 'st louis', 'stl city'], liga: 'MLS' },
  { nombre: 'Vancouver Whitecaps', escudo: 'vancouver.png', alias: ['vancouver whitecaps', 'vancouver', 'whitecaps'], liga: 'MLS' },

  /* ---------------- LaLiga de España (20) ---------------- */
  { nombre: 'Real Madrid', escudo: 'realmadrid.png', alias: ['real madrid', 'real'], liga: 'LaLiga' },
  { nombre: 'Barcelona', escudo: 'barcelona.png', alias: ['barcelona', 'barca', 'barça', 'fc barcelona'], liga: 'LaLiga' },
  { nombre: 'Atlético de Madrid', escudo: 'atlmadrid.png', alias: ['atletico de madrid', 'atlético de madrid', 'atletico madrid', 'atleti', 'atletico'], liga: 'LaLiga' },
  { nombre: 'Athletic Club', escudo: 'athletic.png', alias: ['athletic club', 'athletic bilbao', 'athletic'], liga: 'LaLiga' },
  { nombre: 'Real Sociedad', escudo: 'realsociedad.png', alias: ['real sociedad', 'la real'], liga: 'LaLiga' },
  { nombre: 'Real Betis', escudo: 'betis.png', alias: ['real betis', 'betis'], liga: 'LaLiga' },
  { nombre: 'Sevilla', escudo: 'sevilla.png', alias: ['sevilla', 'sevilla fc'], liga: 'LaLiga' },
  { nombre: 'Valencia', escudo: 'valencia.png', alias: ['valencia', 'valencia cf'], liga: 'LaLiga' },
  { nombre: 'Villarreal', escudo: 'villarreal.png', alias: ['villarreal', 'villarreal cf', 'submarino amarillo'], liga: 'LaLiga' },
  { nombre: 'Celta de Vigo', escudo: 'celta.png', alias: ['celta de vigo', 'celta', 'celta vigo'], liga: 'LaLiga' },
  { nombre: 'Osasuna', escudo: 'osasuna.png', alias: ['osasuna', 'ca osasuna'], liga: 'LaLiga' },
  { nombre: 'Rayo Vallecano', escudo: 'rayovallecano.png', alias: ['rayo vallecano', 'rayo'], liga: 'LaLiga' },
  { nombre: 'Getafe', escudo: 'getafe.png', alias: ['getafe', 'getafe cf'], liga: 'LaLiga' },
  { nombre: 'Espanyol', escudo: 'espanyol.png', alias: ['espanyol', 'rcd espanyol'], liga: 'LaLiga' },
  { nombre: 'Deportivo Alavés', escudo: 'alaves.png', alias: ['deportivo alaves', 'deportivo alavés', 'alaves', 'alavés'], liga: 'LaLiga' },
  { nombre: 'Elche', escudo: 'elche.png', alias: ['elche', 'elche cf'], liga: 'LaLiga' },
  { nombre: 'Levante', escudo: 'levante.png', alias: ['levante', 'levante ud'], liga: 'LaLiga' },
  { nombre: 'Málaga', escudo: 'malaga.png', alias: ['malaga', 'málaga', 'malaga cf'], liga: 'LaLiga' },
  { nombre: 'Deportivo La Coruña', escudo: 'deportivocoruna.png', alias: ['deportivo la coruna', 'deportivo la coruña', 'deportivo', 'depor'], liga: 'LaLiga' },
  { nombre: 'Racing de Santander', escudo: 'racingsantander.png', alias: ['racing de santander', 'racing santander', 'racing'], liga: 'LaLiga' },

  /* ---------------- Selecciones (76) ---------------- */
  { nombre: 'México', escudo: 'mexico.png', alias: ['mexico', 'méxico', 'seleccion mexicana', 'el tri'], liga: 'Selecciones' },
  { nombre: 'Estados Unidos', escudo: 'usa.png', alias: ['estados unidos', 'usa', 'united states', 'usmnt'], liga: 'Selecciones' },
  { nombre: 'Canadá', escudo: 'canada.png', alias: ['canada', 'canadá'], liga: 'Selecciones' },
  { nombre: 'Costa Rica', escudo: 'costarica.png', alias: ['costa rica'], liga: 'Selecciones' },
  { nombre: 'Panamá', escudo: 'panama.png', alias: ['panama', 'panamá'], liga: 'Selecciones' },
  { nombre: 'Honduras', escudo: 'honduras.png', alias: ['honduras'], liga: 'Selecciones' },
  { nombre: 'Jamaica', escudo: 'jamaica.png', alias: ['jamaica'], liga: 'Selecciones' },
  { nombre: 'El Salvador', escudo: 'elsalvador.png', alias: ['el salvador'], liga: 'Selecciones' },
  { nombre: 'Guatemala', escudo: 'guatemala.png', alias: ['guatemala'], liga: 'Selecciones' },
  { nombre: 'República Dominicana', escudo: 'republica_dominicana.png', alias: ['republica dominicana', 'república dominicana'], liga: 'Selecciones' },
  { nombre: 'Argentina', escudo: 'argentina.png', alias: ['argentina', 'albiceleste'], liga: 'Selecciones' },
  { nombre: 'Brasil', escudo: 'brasil.png', alias: ['brasil', 'brazil'], liga: 'Selecciones' },
  { nombre: 'Colombia', escudo: 'colombia.png', alias: ['colombia'], liga: 'Selecciones' },
  { nombre: 'Uruguay', escudo: 'uruguay.png', alias: ['uruguay'], liga: 'Selecciones' },
  { nombre: 'Chile', escudo: 'chile.png', alias: ['chile'], liga: 'Selecciones' },
  { nombre: 'Perú', escudo: 'peru.png', alias: ['peru', 'perú'], liga: 'Selecciones' },
  { nombre: 'Ecuador', escudo: 'ecuador.png', alias: ['ecuador'], liga: 'Selecciones' },
  { nombre: 'Paraguay', escudo: 'paraguay.png', alias: ['paraguay'], liga: 'Selecciones' },
  { nombre: 'Bolivia', escudo: 'bolivia.png', alias: ['bolivia'], liga: 'Selecciones' },
  { nombre: 'Venezuela', escudo: 'venezuela.png', alias: ['venezuela'], liga: 'Selecciones' },
  { nombre: 'España', escudo: 'espana.png', alias: ['espana', 'españa', 'spain'], liga: 'Selecciones' },
  { nombre: 'Francia', escudo: 'francia.png', alias: ['francia', 'france'], liga: 'Selecciones' },
  { nombre: 'Inglaterra', escudo: 'inglaterra.png', alias: ['inglaterra', 'england'], liga: 'Selecciones' },
  { nombre: 'Alemania', escudo: 'alemania.png', alias: ['alemania', 'germany'], liga: 'Selecciones' },
  { nombre: 'Italia', escudo: 'italia.png', alias: ['italia', 'italy'], liga: 'Selecciones' },
  { nombre: 'Portugal', escudo: 'portugal.png', alias: ['portugal'], liga: 'Selecciones' },
  { nombre: 'Países Bajos', escudo: 'paisesbajos.png', alias: ['paises bajos', 'países bajos', 'holanda', 'netherlands'], liga: 'Selecciones' },
  { nombre: 'Bélgica', escudo: 'belgica.png', alias: ['belgica', 'bélgica', 'belgium'], liga: 'Selecciones' },
  { nombre: 'Croacia', escudo: 'croacia.png', alias: ['croacia', 'croatia'], liga: 'Selecciones' },
  { nombre: 'Suiza', escudo: 'suiza.png', alias: ['suiza', 'switzerland'], liga: 'Selecciones' },
  { nombre: 'Austria', escudo: 'austria.png', alias: ['austria'], liga: 'Selecciones' },
  { nombre: 'Dinamarca', escudo: 'dinamarca.png', alias: ['dinamarca', 'denmark'], liga: 'Selecciones' },
  { nombre: 'Suecia', escudo: 'suecia.png', alias: ['suecia', 'sweden'], liga: 'Selecciones' },
  { nombre: 'Noruega', escudo: 'noruega.png', alias: ['noruega', 'norway'], liga: 'Selecciones' },
  { nombre: 'Finlandia', escudo: 'finlandia.png', alias: ['finlandia', 'finland'], liga: 'Selecciones' },
  { nombre: 'Islandia', escudo: 'islandia.png', alias: ['islandia', 'iceland'], liga: 'Selecciones' },
  { nombre: 'Polonia', escudo: 'polonia.png', alias: ['polonia', 'poland'], liga: 'Selecciones' },
  { nombre: 'Ucrania', escudo: 'ucrania.png', alias: ['ucrania', 'ukraine'], liga: 'Selecciones' },
  { nombre: 'Rusia', escudo: 'rusia.png', alias: ['rusia', 'russia'], liga: 'Selecciones' },
  { nombre: 'Serbia', escudo: 'serbia.png', alias: ['serbia'], liga: 'Selecciones' },
  { nombre: 'Grecia', escudo: 'grecia.png', alias: ['grecia', 'greece'], liga: 'Selecciones' },
  { nombre: 'Turquía', escudo: 'turquia.png', alias: ['turquia', 'turquía', 'turkey'], liga: 'Selecciones' },
  { nombre: 'República Checa', escudo: 'republicacheca.png', alias: ['republica checa', 'república checa', 'czech republic'], liga: 'Selecciones' },
  { nombre: 'Eslovaquia', escudo: 'eslovaquia.png', alias: ['eslovaquia', 'slovakia'], liga: 'Selecciones' },
  { nombre: 'Eslovenia', escudo: 'eslovenia.png', alias: ['eslovenia', 'slovenia'], liga: 'Selecciones' },
  { nombre: 'Hungría', escudo: 'hungria.png', alias: ['hungria', 'hungría', 'hungary'], liga: 'Selecciones' },
  { nombre: 'Rumania', escudo: 'rumania.png', alias: ['rumania', 'romania'], liga: 'Selecciones' },
  { nombre: 'Bosnia', escudo: 'bosnia.png', alias: ['bosnia', 'bosnia y herzegovina'], liga: 'Selecciones' },
  { nombre: 'Kosovo', escudo: 'kosovo.png', alias: ['kosovo'], liga: 'Selecciones' },
  { nombre: 'Escocia', escudo: 'escocia.png', alias: ['escocia', 'scotland'], liga: 'Selecciones' },
  { nombre: 'Gales', escudo: 'gales.png', alias: ['gales', 'wales'], liga: 'Selecciones' },
  { nombre: 'Irlanda', escudo: 'irlanda.png', alias: ['irlanda', 'ireland'], liga: 'Selecciones' },
  { nombre: 'Irlanda del Norte', escudo: 'irlandadelnorte.png', alias: ['irlanda del norte', 'northern ireland'], liga: 'Selecciones' },
  { nombre: 'Estonia', escudo: 'estonia.png', alias: ['estonia'], liga: 'Selecciones' },
  { nombre: 'Letonia', escudo: 'letonia.png', alias: ['letonia', 'latvia'], liga: 'Selecciones' },
  { nombre: 'San Marino', escudo: 'san_marino.png', alias: ['san marino'], liga: 'Selecciones' },
  { nombre: 'Israel', escudo: 'israel.png', alias: ['israel'], liga: 'Selecciones' },
  { nombre: 'Marruecos', escudo: 'marruecos.png', alias: ['marruecos', 'morocco'], liga: 'Selecciones' },
  { nombre: 'Argelia', escudo: 'argelia.png', alias: ['argelia', 'algeria'], liga: 'Selecciones' },
  { nombre: 'Túnez', escudo: 'tunez.png', alias: ['tunez', 'túnez', 'tunisia'], liga: 'Selecciones' },
  { nombre: 'Egipto', escudo: 'egipto.png', alias: ['egipto', 'egypt'], liga: 'Selecciones' },
  { nombre: 'Senegal', escudo: 'senegal.png', alias: ['senegal'], liga: 'Selecciones' },
  { nombre: 'Nigeria', escudo: 'nigeria.png', alias: ['nigeria'], liga: 'Selecciones' },
  { nombre: 'Camerún', escudo: 'camerun.png', alias: ['camerun', 'camerún', 'cameroon'], liga: 'Selecciones' },
  { nombre: 'Ghana', escudo: 'ghana.png', alias: ['ghana'], liga: 'Selecciones' },
  { nombre: 'Japón', escudo: 'japon.png', alias: ['japon', 'japón', 'japan'], liga: 'Selecciones' },
  { nombre: 'Corea del Sur', escudo: 'coreadelsur.png', alias: ['corea del sur', 'south korea'], liga: 'Selecciones' },
  { nombre: 'China', escudo: 'china.png', alias: ['china'], liga: 'Selecciones' },
  { nombre: 'Irán', escudo: 'iran.png', alias: ['iran', 'irán'], liga: 'Selecciones' },
  { nombre: 'Arabia Saudita', escudo: 'arabiasaudita.png', alias: ['arabia saudita', 'saudi arabia'], liga: 'Selecciones' },
  { nombre: 'Catar', escudo: 'qatar.png', alias: ['catar', 'qatar'], liga: 'Selecciones' },
  { nombre: 'Australia', escudo: 'australia.png', alias: ['australia', 'socceroos'], liga: 'Selecciones' },
  { nombre: 'Nueva Zelanda', escudo: 'nuevazelanda.png', alias: ['nueva zelanda', 'new zealand'], liga: 'Selecciones' },
  { nombre: 'Tahití', escudo: 'tahiti.png', alias: ['tahiti', 'tahití'], liga: 'Selecciones' },
  { nombre: 'Bangladesh', escudo: 'bangladesh.png', alias: ['bangladesh'], liga: 'Selecciones' },
  { nombre: 'Argentina (alt.)', escudo: 'argentina2.png', alias: ['argentina 2', 'argentina alterna'], liga: 'Selecciones' },

  /* ---------------- Bundesliga 2026/27 (18 clubes) ---------------- */
  { nombre: 'Bayern Munich', escudo: 'bayernmunchen.png', alias: ['bayern munich', 'bayern münchen', 'bayern', 'fc bayern', 'bayern munchen'], liga: 'Bundesliga' },
  { nombre: 'Borussia Dortmund', escudo: 'borussiadortmund.png', alias: ['borussia dortmund', 'dortmund', 'bvb'], liga: 'Bundesliga' },
  { nombre: 'RB Leipzig', escudo: 'rbleipzig.png', alias: ['rb leipzig', 'leipzig', 'red bull leipzig'], liga: 'Bundesliga' },
  { nombre: 'VfB Stuttgart', escudo: 'stuttgart.png', alias: ['vfb stuttgart', 'stuttgart'], liga: 'Bundesliga' },
  { nombre: 'Hoffenheim', escudo: 'hoffenheim.png', alias: ['hoffenheim', 'tsg hoffenheim', '1899 hoffenheim'], liga: 'Bundesliga' },
  { nombre: 'Bayer Leverkusen', escudo: 'bayerleverkusen.png', alias: ['bayer leverkusen', 'leverkusen', 'bayer 04 leverkusen'], liga: 'Bundesliga' },
  { nombre: 'Freiburg', escudo: 'freiburg.png', alias: ['freiburg', 'sc freiburg'], liga: 'Bundesliga' },
  { nombre: 'Eintracht Frankfurt', escudo: 'eintrachtfrankfurt.png', alias: ['eintracht frankfurt', 'frankfurt', 'eintracht'], liga: 'Bundesliga' },
  { nombre: 'Augsburg', escudo: 'augsburgo.png', alias: ['augsburg', 'fc augsburg'], liga: 'Bundesliga' },
  { nombre: 'Mainz 05', escudo: 'mainz05.png', alias: ['mainz', 'mainz 05', '1. fsv mainz 05'], liga: 'Bundesliga' },
  { nombre: 'Union Berlin', escudo: 'unionberlin.png', alias: ['union berlin', '1. fc union berlin'], liga: 'Bundesliga' },
  { nombre: 'Borussia Mönchengladbach', escudo: 'bmonchengladbach.png', alias: ['borussia monchengladbach', 'borussia mönchengladbach', 'monchengladbach', 'mgladbach', "m'gladbach"], liga: 'Bundesliga' },
  { nombre: 'Hamburgo', escudo: 'hamburgo.png', alias: ['hamburgo', 'hamburg', 'hsv', 'hamburger sv'], liga: 'Bundesliga' },
  { nombre: 'FC Köln', escudo: 'koln.png', alias: ['fc koln', 'fc köln', 'koln', 'köln', 'cologne', '1. fc köln'], liga: 'Bundesliga' },
  { nombre: 'Werder Bremen', escudo: 'werderbremen.png', alias: ['werder bremen', 'bremen', 'werder'], liga: 'Bundesliga' },
  { nombre: 'Schalke 04', escudo: 'schalke04.png', alias: ['schalke 04', 'schalke', 'fc schalke 04'], liga: 'Bundesliga' },
  { nombre: 'Elversberg', escudo: 'elversberg.png', alias: ['elversberg', 'sv elversberg'], liga: 'Bundesliga' },
  { nombre: 'Paderborn', escudo: 'paderborn07.png', alias: ['paderborn', 'sc paderborn', 'sc paderborn 07'], liga: 'Bundesliga' },

  /* ---------------- Premier League 2026/27 (20 clubes) ---------------- */
  { nombre: 'Arsenal', escudo: 'arsenal.png', alias: ['arsenal', 'arsenal fc'], liga: 'Premier League' },
  { nombre: 'Aston Villa', escudo: 'astonvilla.png', alias: ['aston villa', 'aston villa fc'], liga: 'Premier League' },
  { nombre: 'Bournemouth', escudo: 'bournemouth.png', alias: ['bournemouth', 'afc bournemouth'], liga: 'Premier League' },
  { nombre: 'Brentford', escudo: 'brentford.png', alias: ['brentford', 'brentford fc'], liga: 'Premier League' },
  { nombre: 'Brighton', escudo: 'brighton.png', alias: ['Brighton Hove', 'brighton', 'brighton & hove albion', 'brighton and hove albion'], liga: 'Premier League' },
  { nombre: 'Chelsea', escudo: 'chelsea.png', alias: ['chelsea', 'chelsea fc'], liga: 'Premier League' },
  { nombre: 'Coventry City', escudo: 'coventry.png', alias: ['coventry city', 'coventry', 'coventry city fc'], liga: 'Premier League' },
  { nombre: 'Crystal Palace', escudo: 'crystalpalace.png', alias: ['crystal palace', 'crystal palace fc'], liga: 'Premier League' },
  { nombre: 'Everton', escudo: 'everton.png', alias: ['everton', 'everton fc'], liga: 'Premier League' },
  { nombre: 'Fulham', escudo: 'fulham.png', alias: ['fulham', 'fulham fc'], liga: 'Premier League' },
  { nombre: 'Hull City', escudo: 'hull_city.png', alias: ['hull city', 'hull', 'hull city afc'], liga: 'Premier League' },
  { nombre: 'Ipswich Town', escudo: 'ipswich_.png', alias: ['ipswich town', 'ipswich', 'ipswich town fc'], liga: 'Premier League' },
  { nombre: 'Leeds United', escudo: 'leeds.png', alias: ['leeds united', 'leeds', 'leeds united fc'], liga: 'Premier League' },
  { nombre: 'Liverpool', escudo: 'liverpool.png', alias: ['liverpool', 'liverpool fc'], liga: 'Premier League' },
  { nombre: 'Manchester City', escudo: 'manchestercity.png', alias: ['manchester city', 'man city', 'mancity', 'mcfc'], liga: 'Premier League' },
  { nombre: 'Manchester United', escudo: 'manchesterunited.png', alias: ['manchester united', 'man united', 'man utd', 'manutd', 'mufc'], liga: 'Premier League' },
  { nombre: 'Newcastle United', escudo: 'newcastle.png', alias: ['newcastle united', 'newcastle', 'newcastle utd'], liga: 'Premier League' },
  { nombre: 'Nottingham Forest', escudo: 'nottingham_forest.png', alias: ['nottingham forest', 'nottingham', 'forest'], liga: 'Premier League' },
  { nombre: 'Sunderland', escudo: 'sunderland.png', alias: ['sunderland', 'sunderland afc'], liga: 'Premier League' },
  { nombre: 'Tottenham Hotspur', escudo: 'tottenham.png', alias: ['tottenham', 'tottenham hotspur', 'spurs'], liga: 'Premier League' },

  /* ---------------- Ligue 1 2026/27 (18 clubes) ---------------- */
  { nombre: 'Angers', escudo: 'angers.png', alias: ['angers', 'angers sco', 'sco angers'], liga: 'Ligue 1' },
  { nombre: 'Auxerre', escudo: 'auxerre.png', alias: ['auxerre', 'aj auxerre'], liga: 'Ligue 1' },
  { nombre: 'Brest', escudo: 'stadebretois.png', alias: ['brest', 'stade brestois', 'stade brestois 29'], liga: 'Ligue 1' },
  { nombre: 'Le Havre', escudo: 'havre.png', alias: ['le havre', 'havre', 'le havre ac', 'havre ac'], liga: 'Ligue 1' },
  { nombre: 'Le Mans', escudo: 'le_mans.png', alias: ['le mans', 'le mans fc'], liga: 'Ligue 1' },
  { nombre: 'Lens', escudo: 'racinglens.png', alias: ['lens', 'rc lens', 'racing lens'], liga: 'Ligue 1' },
  { nombre: 'Lille', escudo: 'lille.png', alias: ['lille', 'losc', 'losc lille', 'lille osc'], liga: 'Ligue 1' },
  { nombre: 'Lorient', escudo: 'lorient.png', alias: ['lorient', 'fc lorient'], liga: 'Ligue 1' },
  { nombre: 'Lyon', escudo: 'olympiquelyon.png', alias: ['lyon', 'olympique lyonnais', 'ol lyon', 'ol'], liga: 'Ligue 1' },
  { nombre: 'Olympique de Marseille', escudo: 'olimpiquemarsella.png', alias: ['olympique de marseille', 'marseille', 'om', 'olympique marseille'], liga: 'Ligue 1' },
  { nombre: 'Monaco', escudo: 'monaco.png', alias: ['monaco', 'as monaco', 'asm'], liga: 'Ligue 1' },
  { nombre: 'Nice', escudo: 'niza.png', alias: ['nice', 'ogc nice', 'niza'], liga: 'Ligue 1' },
  { nombre: 'Paris Saint-Germain', escudo: 'psg.png', alias: ['paris saint germain', 'paris saint-germain', 'psg', 'paris sg'], liga: 'Ligue 1' },
  { nombre: 'Paris FC', escudo: 'paris_fc.png', alias: ['paris fc', 'paris football club'], liga: 'Ligue 1' },
  { nombre: 'Rennes', escudo: 'rennais.png', alias: ['rennes', 'stade rennais', 'stade rennais fc', 'rennais'], liga: 'Ligue 1' },
  { nombre: 'Strasbourg', escudo: 'racingetrasburgo.png', alias: ['strasbourg', 'rc strasbourg', 'rc strasbourg alsace', 'racing strasbourg'], liga: 'Ligue 1' },
  { nombre: 'Toulouse', escudo: 'toulouse.png', alias: ['toulouse', 'toulouse fc'], liga: 'Ligue 1' },
  { nombre: 'Troyes', escudo: 'troyes.png', alias: ['troyes', 'estac', 'estac troyes'], liga: 'Ligue 1' },

  /* ---------------- Serie A 2026/27 (20 clubes) ---------------- */
  { nombre: 'Atalanta', escudo: 'atalanta.png', alias: ['atalanta', 'atalanta bc', 'bergamo'], liga: 'Serie A' },
  { nombre: 'Bologna', escudo: 'bologna.png', alias: ['bologna', 'bologna fc', 'bologna fc 1909'], liga: 'Serie A' },
  { nombre: 'Cagliari', escudo: 'cagliari.png', alias: ['cagliari', 'cagliari calcio'], liga: 'Serie A' },
  { nombre: 'Como', escudo: 'como.png', alias: ['como', 'como 1907', 'como calcio'], liga: 'Serie A' },
  { nombre: 'Fiorentina', escudo: 'fiorentina.png', alias: ['fiorentina', 'acf fiorentina', 'fiorentina fc'], liga: 'Serie A' },
  { nombre: 'Frosinone', escudo: 'frosinone.png', alias: ['frosinone', 'frosinone calcio'], liga: 'Serie A' },
  { nombre: 'Genoa', escudo: 'genoa.png', alias: ['genoa', 'genoa cfc', 'genoa cricket and football club'], liga: 'Serie A' },
  { nombre: 'Inter', escudo: 'inter.png', alias: ['inter', 'inter milan', 'internazionale', 'inter milan fc', 'fc internazionale'], liga: 'Serie A' },
  { nombre: 'Juventus', escudo: 'juventus.png', alias: ['juventus', 'juve', 'juventus fc'], liga: 'Serie A' },
  { nombre: 'Lazio', escudo: 'lazio.png', alias: ['lazio', 'ss lazio'], liga: 'Serie A' },
  { nombre: 'Lecce', escudo: 'lecce.png', alias: ['lecce', 'us lecce', 'us lecce calcio'], liga: 'Serie A' },
  { nombre: 'Milan', escudo: 'milan.png', alias: ['milan', 'ac milan', 'milan ac', 'acmilan'], liga: 'Serie A' },
  { nombre: 'Monza', escudo: 'monza.png', alias: ['monza', 'ac monza', 'monza calcio'], liga: 'Serie A' },
  { nombre: 'Napoli', escudo: 'napoli.png', alias: ['napoli', 'ssc napoli', 'napoli fc'], liga: 'Serie A' },
  { nombre: 'Parma', escudo: 'parma.png', alias: ['parma', 'parma calcio', 'parma fc'], liga: 'Serie A' },
  { nombre: 'Roma', escudo: 'roma.png', alias: ['roma', 'as roma', 'as roma calcio'], liga: 'Serie A' },
  { nombre: 'Sassuolo', escudo: 'sassuolo.png', alias: ['sassuolo', 'us sassuolo', 'sassuolo calcio'], liga: 'Serie A' },
  { nombre: 'Torino', escudo: 'torino.png', alias: ['torino', 'torino fc', 'torino calcio'], liga: 'Serie A' },
  { nombre: 'Udinese', escudo: 'udinese.png', alias: ['udinese', 'udinese calcio'], liga: 'Serie A' },
  { nombre: 'Venezia', escudo: 'venezia.png', alias: ['venezia', 'venezia fc', 'venice'], liga: 'Serie A' },

  /* ---------------- NFL (32) — escudos de TheSportsDB (list/teams/4391) ---------------- */
  /* AFC East */
  { nombre: 'Buffalo Bills', escudo: 'nfl-bills.png', alias: ['buffalo bills', 'buffalo', 'bills'], liga: 'NFL' },
  { nombre: 'Miami Dolphins', escudo: 'nfl-dolphins.png', alias: ['miami dolphins', 'miami', 'dolphins'], liga: 'NFL' },
  { nombre: 'New England Patriots', escudo: 'nfl-patriots.png', alias: ['new england patriots', 'new england', 'patriots'], liga: 'NFL' },
  { nombre: 'New York Jets', escudo: 'nfl-jets.png', alias: ['new york jets', 'ny jets', 'jets'], liga: 'NFL' },
  /* AFC North */
  { nombre: 'Baltimore Ravens', escudo: 'nfl-ravens.png', alias: ['baltimore ravens', 'baltimore', 'ravens'], liga: 'NFL' },
  { nombre: 'Cincinnati Bengals', escudo: 'nfl-bengals.png', alias: ['cincinnati bengals', 'cincinnati', 'bengals'], liga: 'NFL' },
  { nombre: 'Cleveland Browns', escudo: 'nfl-browns.png', alias: ['cleveland browns', 'cleveland', 'browns'], liga: 'NFL' },
  { nombre: 'Pittsburgh Steelers', escudo: 'nfl-steelers.png', alias: ['pittsburgh steelers', 'pittsburgh', 'steelers'], liga: 'NFL' },
  /* AFC South */
  { nombre: 'Houston Texans', escudo: 'nfl-texans.png', alias: ['houston texans', 'houston', 'texans'], liga: 'NFL' },
  { nombre: 'Indianapolis Colts', escudo: 'nfl-colts.png', alias: ['indianapolis colts', 'indianapolis', 'colts'], liga: 'NFL' },
  { nombre: 'Jacksonville Jaguars', escudo: 'nfl-jaguars.png', alias: ['jacksonville jaguars', 'jacksonville', 'jaguars', 'jags'], liga: 'NFL' },
  { nombre: 'Tennessee Titans', escudo: 'nfl-titans.png', alias: ['tennessee titans', 'tennessee', 'titans'], liga: 'NFL' },
  /* AFC West */
  { nombre: 'Denver Broncos', escudo: 'nfl-broncos.png', alias: ['denver broncos', 'denver', 'broncos'], liga: 'NFL' },
  { nombre: 'Kansas City Chiefs', escudo: 'nfl-chiefs.png', alias: ['kansas city chiefs', 'kansas city', 'chiefs', 'kc chiefs'], liga: 'NFL' },
  { nombre: 'Las Vegas Raiders', escudo: 'nfl-raiders.png', alias: ['las vegas raiders', 'las vegas', 'raiders', 'oakland raiders'], liga: 'NFL' },
  { nombre: 'Los Angeles Chargers', escudo: 'nfl-chargers.png', alias: ['los angeles chargers', 'la chargers', 'chargers', 'san diego chargers'], liga: 'NFL' },
  /* NFC East */
  { nombre: 'Dallas Cowboys', escudo: 'nfl-cowboys.png', alias: ['dallas cowboys', 'dallas', 'cowboys'], liga: 'NFL' },
  { nombre: 'New York Giants', escudo: 'nfl-giants.png', alias: ['new york giants', 'ny giants', 'giants'], liga: 'NFL' },
  { nombre: 'Philadelphia Eagles', escudo: 'nfl-eagles.png', alias: ['philadelphia eagles', 'philadelphia', 'eagles', 'philly'], liga: 'NFL' },
  { nombre: 'Washington Commanders', escudo: 'nfl-commanders.png', alias: ['washington commanders', 'washington', 'commanders', 'washington football team'], liga: 'NFL' },
  /* NFC North */
  { nombre: 'Chicago Bears', escudo: 'nfl-bears.png', alias: ['chicago bears', 'chicago', 'bears'], liga: 'NFL' },
  { nombre: 'Detroit Lions', escudo: 'nfl-lions.png', alias: ['detroit lions', 'detroit', 'lions'], liga: 'NFL' },
  { nombre: 'Green Bay Packers', escudo: 'nfl-packers.png', alias: ['green bay packers', 'green bay', 'packers'], liga: 'NFL' },
  { nombre: 'Minnesota Vikings', escudo: 'nfl-vikings.png', alias: ['minnesota vikings', 'minnesota', 'vikings'], liga: 'NFL' },
  /* NFC South */
  { nombre: 'Atlanta Falcons', escudo: 'nfl-falcons.png', alias: ['atlanta falcons', 'atlanta', 'falcons'], liga: 'NFL' },
  { nombre: 'Carolina Panthers', escudo: 'nfl-panthers.png', alias: ['carolina panthers', 'carolina', 'panthers'], liga: 'NFL' },
  { nombre: 'New Orleans Saints', escudo: 'nfl-saints.png', alias: ['new orleans saints', 'new orleans', 'saints'], liga: 'NFL' },
  { nombre: 'Tampa Bay Buccaneers', escudo: 'nfl-buccaneers.png', alias: ['tampa bay buccaneers', 'tampa bay', 'buccaneers', 'bucs', 'tampa'], liga: 'NFL' },
  /* NFC West */
  { nombre: 'Arizona Cardinals', escudo: 'nfl-cardinals.png', alias: ['arizona cardinals', 'arizona', 'cardinals'], liga: 'NFL' },
  { nombre: 'Los Angeles Rams', escudo: 'nfl-rams.png', alias: ['los angeles rams', 'la rams', 'rams', 'st louis rams'], liga: 'NFL' },
  { nombre: 'San Francisco 49ers', escudo: 'nfl-49ers.png', alias: ['san francisco 49ers', 'san francisco', '49ers', 'niners', 'sf 49ers'], liga: 'NFL' },
  { nombre: 'Seattle Seahawks', escudo: 'nfl-seahawks.png', alias: ['seattle seahawks', 'seattle', 'seahawks'], liga: 'NFL' },
];

/** Quita acentos y espacios extra, para comparar nombres sin fallar por tildes. */
function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita las tildes
    .replace(/\s+/g, ' ');
}

/** Índice nombre/alias → equipo, para búsquedas rápidas. */
const INDICE = new Map<string, EquipoCatalogo>();
for (const eq of EQUIPOS_LIGA_MX) {
  INDICE.set(normalizar(eq.nombre), eq);
  for (const a of eq.alias) INDICE.set(normalizar(a), eq);
}

/**
 * Devuelve el equipo del catálogo que corresponde a un nombre dado
 * (probando nombre y alias, sin distinguir mayúsculas ni acentos), o
 * null si no está en el catálogo.
 */
export function equipoPorNombre(nombre: string | null | undefined): EquipoCatalogo | null {
  if (!nombre) return null;
  return INDICE.get(normalizar(nombre)) ?? null;
}

/**
 * Traduce un nombre al oficial del catálogo si lo reconoce; si no, lo
 * deja tal cual (limpio). Úsalo al guardar partidos/equipos para que los
 * nombres queden consistentes y encuentren su escudo — sobre todo con los
 * que llegan de la API.
 */
export function nombreOficial(nombre: string | null | undefined): string {
  if (!nombre) return '';
  const eq = equipoPorNombre(nombre);
  return eq ? eq.nombre : nombre.trim();
}

/** Ruta del escudo de un equipo, o null si no está en el catálogo. */
export function escudoDe(nombre: string | null | undefined): string | null {
  const eq = equipoPorNombre(nombre);
  return eq ? `escudos/${eq.escudo}` : null;
}

/* ============================================================
   Utilidades de organización por liga.
   Sirven para saber qué tienes y armar selectores filtrados.
   ============================================================ */

/** Lista de ligas presentes en el catálogo, sin repetir. */
export function ligas(): string[] {
  return [...new Set(EQUIPOS_LIGA_MX.map((e) => e.liga))];
}

/** Equipos de una liga específica. */
export function equiposDeLiga(liga: string): EquipoCatalogo[] {
  return EQUIPOS_LIGA_MX.filter((e) => e.liga === liga);
}

/** Cuántos equipos hay por liga: { 'Liga MX': 18, 'MLS': 29, ... } */
export function conteoPorLiga(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of EQUIPOS_LIGA_MX) r[e.liga] = (r[e.liga] ?? 0) + 1;
  return r;
}