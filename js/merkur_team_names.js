/**
 * Name aliases between the Merkurxtip feed and the Superbet feed.
 *
 * `match_matcher.js` pairs fixtures on fuzzy name similarity, which covers
 * spelling drift ("Zhytomyr"/"Zhytomir") but cannot bridge two names that share
 * no letters. Those go here, as `[merkurName, superbetName]` tuples.
 *
 * By far the biggest group is national teams: Merkur publishes them in English,
 * Superbet in Serbian, so "Turkey" has to be told it means "Turska".
 *
 * Names are written WITHOUT Serbian diacritics on purpose: `normalizeTeamName()`
 * strips them before comparing, so "Slovacka" here matches the feed's
 * "Slovacka" all the same, and the file stays pure ASCII (see the encoding note
 * in CLAUDE.md).
 *
 * The comparison happens on *core* tokens, after `normalizeTeamName()` has
 * pulled out age/reserve/women markers. One entry therefore covers every
 * variant of a side: aliasing "Wolves" to "Wolverhampton" also pairs
 * "Wolves U21" with "Wolverhampton U21" and "Wolves W" with "Wolverhampton (Z)".
 */

export const NATIONAL_TEAM_ALIASES = [
  ["Albania", "Albanija"],
  ["Algeria", "Alzir"],
  ["Andorra", "Andora"],
  ["Argentina", "Argentina"],
  ["Armenia", "Jermenija"],
  ["Australia", "Australija"],
  ["Austria", "Austrija"],
  ["Azerbaijan", "Azerbejdzan"],
  ["Belarus", "Belorusija"],
  ["Belgium", "Belgija"],
  ["Bolivia", "Bolivija"],
  ["Bosnia & Herzegovina", "Bosna i Hercegovina"],
  ["Brazil", "Brazil"],
  ["Bulgaria", "Bugarska"],
  ["Cameroon", "Kamerun"],
  ["Canada", "Kanada"],
  ["Cape Verde", "Zelenortska Ostrva"],
  ["Chile", "Cile"],
  ["China", "Kina"],
  ["Colombia", "Kolumbija"],
  ["Costa Rica", "Kostarika"],
  ["Croatia", "Hrvatska"],
  ["Cyprus", "Kipar"],
  ["Czech Republic", "Ceska"],
  ["Denmark", "Danska"],
  ["DR Congo", "DR Kongo"],
  ["Ecuador", "Ekvador"],
  ["Egypt", "Egipat"],
  ["England", "Engleska"],
  ["Estonia", "Estonija"],
  ["Ethiopia", "Etiopija"],
  ["Faroe Islands", "Farska Ostrva"],
  ["Finland", "Finska"],
  ["France", "Francuska"],
  ["Georgia", "Gruzija"],
  ["Germany", "Nemacka"],
  ["Ghana", "Gana"],
  ["Greece", "Grcka"],
  ["Guinea", "Gvineja"],
  ["Hungary", "Madarska"],
  ["Iceland", "Island"],
  ["India", "Indija"],
  ["Indonesia", "Indonezija"],
  ["Iraq", "Irak"],
  ["Ireland", "Irska"],
  ["Israel", "Izrael"],
  ["Italy", "Italija"],
  ["Ivory Coast", "Obala Slonovace"],
  ["Jamaica", "Jamajka"],
  ["Japan", "Japan"],
  ["Jordan", "Jordan"],
  ["Kazakhstan", "Kazahstan"],
  ["Kenya", "Kenija"],
  ["Kuwait", "Kuvajt"],
  ["Latvia", "Letonija"],
  ["Lebanon", "Liban"],
  ["Libya", "Libija"],
  ["Liechtenstein", "Lihtenstajn"],
  ["Lithuania", "Litvanija"],
  ["Luxembourg", "Luksemburg"],
  ["Malaysia", "Malezija"],
  ["Mexico", "Meksiko"],
  ["Moldova", "Moldavija"],
  ["Mongolia", "Mongolija"],
  ["Montenegro", "Crna Gora"],
  ["Morocco", "Maroko"],
  ["Netherlands", "Holandija"],
  ["New Zealand", "Novi Zeland"],
  ["Nigeria", "Nigerija"],
  ["North Korea", "Severna Koreja"],
  ["North Macedonia", "Severna Makedonija"],
  ["Northern Ireland", "Severna Irska"],
  ["Norway", "Norveska"],
  ["Paraguay", "Paragvaj"],
  ["Philippines", "Filipini"],
  ["Poland", "Poljska"],
  ["Romania", "Rumunija"],
  ["Russia", "Rusija"],
  ["Saudi Arabia", "Saudijska Arabija"],
  ["Scotland", "Skotska"],
  ["Senegal", "Senegal"],
  ["Serbia", "Srbija"],
  ["Singapore", "Singapur"],
  ["Slovakia", "Slovacka"],
  ["Slovenia", "Slovenija"],
  ["South Africa", "Juznoafricka Republika"],
  ["South Korea", "Juzna Koreja"],
  ["Spain", "Spanija"],
  ["Sweden", "Svedska"],
  ["Switzerland", "Svajcarska"],
  ["Syria", "Sirija"],
  ["Taiwan", "Tajvan"],
  ["Tajikistan", "Tadzikistan"],
  ["Thailand", "Tajland"],
  ["Tunisia", "Tunis"],
  ["Turkey", "Turska"],
  ["Turkmenistan", "Turkmenistan"],
  ["Uganda", "Uganda"],
  ["Ukraine", "Ukrajina"],
  ["Uruguay", "Urugvaj"],
  ["USA", "SAD"],
  ["Uzbekistan", "Uzbekistan"],
  ["Venezuela", "Venecuela"],
  ["Vietnam", "Vijetnam"],
  ["Wales", "Vels"],
  ["Zambia", "Zambija"],
  ["Zimbabwe", "Zimbabve"]
];

/**
 * Club aliases are kept per sport: the same short name can mean different
 * clubs in different sports, so "Wolves" must not leak from football into
 * hockey. National teams above are shared, since a country is a country.
 */
export const CLUB_ALIASES_BY_SPORT = {
  soccer: [
    ["ACF", "Abo CF"],
    ["Al Taee", "Al Tai"],
    ["Al Bukayriyah", "Al Bukiryah"],
    ["Videoton", "Fehervar"],
    ["Floridsdorfer AC", "FAC Viena"],
    ["HB Torshavn", "Havnar Boltfelag"],
    ["QPR", "Queens Park Rangers"],
    ["Sefa", "Shafa Baku"],
    ["Telaghema", "NRB Teleghma"],
    ["TNS", "The New Saints"],
    ["Wolves", "Wolverhampton"]
  ],
  basketball: [],
  handball: [
    ["DRHV 06", "Dessau-Rosslauer"],
    ["Hoej Elite", "HOJ"]
  ],
  // Hockey diverges systematically: Merkur names the city, Superbet the club.
  // The last three are OHL franchises that relocated and which Merkur still
  // lists under their former city.
  hockey: [
    ["Cologne", "Kolner Haie"],
    ["Debreceni", "DEAC"],
    ["FTC-Telekom", "Ferencvaros"],
    ["Krakow", "Cracovia"],
    ["Langnau", "Langenau Tigers"],
    ["Steinbach BW", "Black Wings Linz"],
    ["Villacher", "EC VSV"],
    ["Zurich", "ZSC Lions"],
    ["Hamilton", "Brantford Bulldogs"],
    ["Marie", "Soo Greyhounds"],
    ["Mississauga", "Brampton Steelheads"]
  ],
  tennis: []
};

export function aliasPairsForSport(sportKey) {
  return [...NATIONAL_TEAM_ALIASES, ...(CLUB_ALIASES_BY_SPORT[sportKey] ?? [])];
}
