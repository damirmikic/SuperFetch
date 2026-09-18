# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step, no package manager, no test suite. ES modules require HTTP — opening any `.html` file directly fails.

```powershell
python -m http.server 5177
```

Open `http://127.0.0.1:5177/index.html` (soccer), `/basketball.html`, `/tennis.html`, `/daily-specials.html`, `/fantasy.html`, or `/missing.html`. CORS is only an issue on non-localhost origins for the Superbet API; `netlify.toml` proxies `/sb-api/*` → Superbet CDN for production.

`fantasy.html` additionally needs the FPL API proxy running, since `fantasy.premierleague.com` blocks CORS unconditionally (unlike the Superbet CDN, which allows direct localhost access):

```powershell
python fpl_proxy.py
```

This listens on port 5178 and must run alongside `python -m http.server 5177`. Without it, the Fantasy page's "Izracunaj" button fails with a CORS error in the console.

## Deployment

`netlify.toml` sets `publish = "."` and rewrites `/sb-api/*` to the Superbet CDN, `/fpl-api/*` to the FPL API, and `/mx-api/*` to the Merkurxtip REST API. `js/config.js` detects `localhost`/`127.0.0.1`: for Superbet it uses the direct CDN URL locally (no CORS restriction there); for FPL it always routes through a proxy — `fpl_proxy.py` locally, `/fpl-api` in production — since the FPL CDN blocks CORS from any origin.

## Architecture

Vanilla JS, no framework, no bundler. Six HTML pages, each a separate entry point loading exactly one `<script type="module">`; everything else comes in via ES imports.

| Page | Entry module | Sport |
|---|---|---|
| `index.html` | `js/main.js` | Soccer |
| `basketball.html` | `js/basketball_main.js` | Basketball |
| `tennis.html` | `js/tennis_main.js` | Tennis |
| `daily-specials.html` | `js/daily_specials_main.js` | Soccer (synthetic markets) |
| `fantasy.html` | `js/fantasy_main.js` | Soccer (EPL fantasy points, synthetic) |
| `missing.html` | `js/missing_main.js` | Soccer / basketball / tennis (Superbet vs Merkurxtip offer diff) |

### Shared modules

| File | Role |
|---|---|
| `js/config.js` | API base URLs, locale, per-sport sport IDs — environment-aware. Imported only by `api.js`. |
| `js/api.js` | All Superbet network calls and response normalization. `fetchSoccerCompetitions`/`fetchBasketballCompetitions`/`fetchTennisCompetitions` all funnel through a shared `fetchCompetitions(sportId)`. `fetchAllPrematchEventsForSport()` calls `/events/by-date` *without* `tournamentIds`, which returns the whole prematch offer across all sports in one request, then filters by `sportId` — used only by the offer-comparison page. |
| `js/merkur_api.js` | Merkurxtip network calls. One request returns the entire prematch offer for a sport as a flat `esMatches` array (no competition tree — league name and country arrive per match). Only imported by `missing_main.js`. |
| `js/sports.js` | Registry of the sports the comparison page compares, with the per-sport matching knobs. Adding a sport is one entry here. |
| `js/match_matcher.js` | Cross-book fixture reconciliation. Imported only by `missing_main.js`. |
| `js/merkur_team_names.js` | Static `[merkurName, superbetName]` alias tuples for sides whose names share no letters: shared national teams plus per-sport club tables. Imported by `missing_main.js`, which passes them to the matcher. |
| `js/ui.js` | DOM rendering, all UI state, component factories. **Single shared module across soccer/basketball/tennis**, not one per sport — sport-specific behavior is branched internally (e.g. `currentSportId === 4` for basketball's no-draws case, `isDefaultPlayerMarketBasketball`/`isDefaultPlayerMarketTennis`, `createPlayerGroupCardsBasketball`). |
| `js/csv.js` | CSV generation, market name mapping, row manipulation — shared by soccer/basketball/tennis. **Not used by daily-specials**, which has its own CSV layer. |
| `js/main.js` / `js/basketball_main.js` / `js/tennis_main.js` | Per-sport orchestrators — same shape (wire events, own the CSV string), each importing the same `ui.js`/`csv.js` surface plus a sport-specific competitions fetcher. |
| `js/simulator.js` | Monte Carlo tournament/group simulation (World Cup–style groups + knockout). Imported only by `ui.js` — reached only through the soccer flow, no HTML loads it directly. |
| `js/xg.js` | `calculateSoccerXg()` fits a Dixon-Coles Poisson model (via Shin-normalized 1X2 + Over/Under odds) to derive `lambdaHome`/`lambdaAway`/`rho` for a match. `calculateWorldCupPeriodOffer`/`calculateWorldCupSpecialMarkets` derive period-based goal markets from that fit. Consumed by `ui.js` (World Cup special markets in the soccer flow) and by `daily_specials_model.js` (synthetic markets). |
| `js/world_cup_team_names.js` | Static team-name alias/normalization table. Only imported by `daily_specials_main.js`, to reconcile feed spellings against World Cup grouping data. |
| `js/epl_team_names.js` | Static team-name alias/normalization table for the English Premier League (odds-feed spelling → FPL API spelling). Only imported by `fantasy_model.js`. |
| `js/fpl_api.js` | Fetches and caches the FPL `bootstrap-static` endpoint (`fetchFplData()`), normalizing it to `{ players, teamsById }`. Only imported by `fantasy_main.js`. Uses `FPL_CONFIG` from `config.js`, not `SUPERBET_CONFIG`. |

### Daily Specials (separate subsystem)

`daily-specials.html` fetches real soccer fixtures/odds via `api.js`, but does not reuse `csv.js`. Instead:
- `js/daily_specials_model.js` calls `calculateSoccerXg()` per match to get Dixon-Coles parameters, then synthesizes markets not present in the live feed: `buildMatchModel()`, `buildDailyTotals()`, `buildPlayerVsTeamRow()`, `buildTeamDuelRow()` (combines multiple matches into duel/vs markets).
- It has its own CSV schema (`DAILY_CSV_COLUMNS`) and its own row builder (`buildDailyCsv()`), independent of `csv.js`'s `CSV_COLUMNS`.
- `js/daily_specials_main.js` drives event/market selection and calls into the model to produce output.

### Fantasy calculator (separate subsystem)

`fantasy.html` projects **expected Fantasy Premier League points per player** for upcoming EPL fixtures, using real odds instead of manual stat entry. Like Daily Specials, it fetches via `api.js` but does not reuse `csv.js`.

- **Fixture scope**: `fantasy_main.js` filters the soccer competition tree to `categoryName === "Engleska"` + `tournamentName === "Premier League"` only — matching on tournament name alone is not enough, since many countries have a top flight literally named "Premier League" (Hong Kong, Israel, Kazakhstan, etc.).
- **Player identity/position**: the odds feed has no player-position field at all (no GK/DEF/MID/FWD anywhere), so `fpl_api.js` fetches the official FPL `bootstrap-static` endpoint as the source of truth for position, team, and canonical name. `fantasy_model.js`'s `matchFplPlayersToFixture()` reconciles odds-feed player names against the FPL squad for each fixture's two teams (narrowed by team via `epl_team_names.js` aliases first, to avoid cross-team surname collisions).
- **Odd-name shape matters**: anytime-scorer/assist/card markets in the feed are typically **one market per player** with a single priced odd (the odd's `name` *is* the player's name, e.g. `"Gyokeres, Viktor"` at price 1.78) — not a Yes/No pair. Assist markets go further: `odd.playerName` is often a raw `sr:player:<id>` string rather than a clean name, so the display name must be parsed out of `odd.name` instead (e.g. `"Hamer, Gustavo - Više od 0.5"`). `buildAnytimeProbabilityModel()`/`buildCardProbabilityModel()`/`oddBelongsToPlayer()` in `fantasy_model.js` handle both cases; don't assume the `daily_specials_model.js`-style Yes/No pattern applies here.
- **Scoring math**: an anytime market price → implied probability (de-vigged against a "No" leg when one exists) → Poisson goal-rate via `-ln(1-p)` → points by position. Clean-sheet and goals-conceded points come from the opponent's Dixon-Coles lambda (`calculateSoccerXg()`, reused as-is) rather than from any clean-sheet market. Bonus points, CBI/tackles thresholds, recoveries, saves, penalty saves/misses, and own goals have no odds signal and are intentionally left out of the total — surfaced as a static note in `fantasy.html`, not computed as zero.
- `js/fantasy_main.js` aggregates **across all selected fixtures** (a gameweek's worth), unlike Daily Specials which reasons mostly per-match — the natural unit of work is "per player across their match."

### Offer comparison: Superbet vs Merkurxtip (`missing.html` / `js/missing_main.js`)

Lists fixtures that Superbet has in its prematch offer but Merkurxtip does not. Display + copy/download only — it does **not** go through `csv.js`.

- **Feeds**: Superbet via `fetchAllPrematchEvents()` (one unfiltered `/events/by-date` call), Merkur via `fetchMerkurMatches(code)` (one `/custom/offer/sr/sport/<code>/mob?annex=0` call). Merkur sends `Access-Control-Allow-Origin: *`, so unlike FPL it needs no local proxy — the `/mx-api` rewrite exists only as a production fallback.
- **Tournament names**: the by-date payload carries `tournamentId`/`categoryId` but no names, so `missing_main.js` also fetches `fetchCompetitions(sportId)` purely to build an id→name lookup for grouping.
- **The date filter defaults to today at both ends** (`applyDefaultDateRange()`), because Superbet lists fixtures months out — 652 soccer rows unfiltered against 80 for today. Only `to` does any work here; `from` cannot exclude anything, since a prematch feed holds no past fixtures. Switching sports keeps whatever dates the user set.

#### Sport tabs

`sports.js` is the registry; adding a sport is one entry there and nothing else in the flow is sport-specific. Per-sport pairing rates against a full day's offer: soccer 93%, basketball 92%, handball 93%, tennis 86%.

**Merkur's sport codes are easy to mistake**: `H` is ice hockey (KHL/VHL/DEL) and handball is `HB`. A wrong code does not error — the endpoint returns 200 with some other sport's offer, which then pairs at roughly zero.

- **Superbet is fetched once for every sport.** `/events/by-date` without `tournamentIds` returns all sports in a single response, so the page caches it in `state.allSuperbetEvents` and filters by `sportId` per tab. Only the Merkur offer and the competition tree are per sport, and both load lazily on first visit to a tab. Do not "fix" this into a per-sport Superbet fetch.
- **Per-sport state** lives in `state.bySport`; everything persisted is namespaced by sport key (`superfetch.dismissedTournaments.tennis`). `migrateLegacyStorage()` moves the pre-tabs unsuffixed keys under `soccer` — it can be deleted once no browser holds them.
- **Club aliases are per sport, national teams are shared** (`CLUB_ALIASES_BY_SPORT` / `NATIONAL_TEAM_ALIASES`): a country is a country everywhere, but "Wolves" must not leak from football into another sport.
- `hasDraw` only picks the table columns — every sport's preselected Superbet market uses the same `1`/`X`/`2` outcome codes, so no per-sport market id is needed.

##### Two knobs that are genuinely per sport

- **`timeToleranceMinutes`.** Tennis has no scheduled start: play begins when the previous match on that court ends, so the books' estimates drift over an hour (`T. Skatov - K. Samrej` was 80 minutes apart). Measured — tennis 15min: 86/132, 60min: 110/132, 180min: 112/132; basketball 15min: 32/38, 180min: 33/38; hockey flat at 89/97. A wide window buys team sports nothing and only risks pairing two different fixtures.
- **`womenFromLeague`.** Merkur marks a women's competition in the *league* name and leaves team names alone (`Minnesota Lynx` in `WNBA`); Superbet marks the team (`Minnesota Lynx (Ž)`). For team sports `merkur_api.js` pushes the marker down onto the team names, or the matcher's women/men hard reject kills every such pair. **Individual sports must opt out**: Superbet marks none of its 187 tennis players, because a player's name identifies them outright — copying the marker down invented a mismatch and rejected 12 good pairs.
- **No shared match id.** Merkur exposes `brMatchId` (Betradar); Superbet exposes nothing comparable. `match_matcher.js` therefore pairs on **kickoff time (per-sport tolerance, bucketed per minute) + fuzzy team-name similarity**, assigned greedily best-first so each fixture claims its strongest partner.
- **Name normalization** (`normalizeTeamName()`) splits a team name into `core` tokens and `flags`. Flags are the markers that change *which* team it is — `w` (women: Superbet writes `Arsenal (Ž)`, Merkur writes `Arsenal W`), `b` (reserves: `II`/`2`/`B`/`(R)`/`(Am)`), and `uNN` age groups. A women/men flag mismatch hard-rejects the pair; a reserve/age mismatch only softens the score. Core tokens drop legal-form noise (`fc`, `fk`, `sc`, …) and run through a small alias table (`utd→united`, `wien→vienna`, `prof→professional`, …).
- **Core similarity is a directional max, not an average** — one book routinely carries extra words (`Hougang` vs `Hougang United`), and abbreviation prefixes are the dominant failure mode (`Ch. Odessa` / `Chernomorets Odesa`), so a prefix match scores 0.95 and everything else falls back to a Dice bigram coefficient.
- **Two passes** in `compareOffers()`: pass one pairs only high-confidence matches (≥0.85) and uses them to learn a Superbet `tournamentId` → Merkur `leagueId` map by majority vote; pass two re-runs with that map as a +0.12 tie-breaker, which rescues awkwardly-spelled fixtures inside an already-identified league.
- The UI **strictness** select (Labavo/Normalno/Strogo) just moves the pass-two `threshold` (0.62/0.72/0.82). Recomputing is local — only "Osvezi ponude" refetches.

#### Name aliases

Fuzzy similarity handles spelling drift but cannot bridge names that share no letters. `merkur_team_names.js` covers those:

- **National teams are the big one** — Merkur publishes them in English, Superbet in Serbian (`Turkey` / `Turska`, `Wales` / `Vels`). Without the table every international-break fixture reads as missing.
- The table is matched on **core tokens**, after `normalizeTeamName()` has pulled out age/reserve/women markers, so one entry covers a side's every variant: `Wolves` → `Wolverhampton` also pairs `Wolves U21`/`Wolverhampton U21` and `Wolves W`/`Wolverhampton (Ž)`.
- Entries are written **ASCII-only** (`Slovacka`, not `Slovačka`). `normalizeTeamName()` strips diacritics before comparing, so this costs nothing and keeps the file free of the encoding artifacts described under "Encoding note".
- Aliases confirmed in the UI are appended from localStorage (`superfetch.merkurAliases`); "Izvezi aliase" emits them in `CLUB_ALIASES` shape to be merged into the static table.

#### Two false-women traps

Both were live bugs, so do not "simplify" these back:

- `(Ž)` is Superbet's women's marker, but after diacritic-stripping it becomes a bare `z` — which is equally often an abbreviated first word (`Gornik Z.` = Zabrze, `Z. Moravce` = Zlate Moravce). The marker is therefore matched **parenthesized, before punctuation is stripped**, not as a token.
- Merkur's women's marker is a trailing `W` token, but it also abbreviates name tails the same way (`Havant & W` = Waterlooville). An `&` anywhere in the name disables the `w` marker.

#### Dismissing what should not be in the offer

A row and a league header each carry a checkbox meaning "this does not belong in our offer". Checked items drop out of the list **and out of copy/download**; `exportableRows()` filters them regardless of whether they are on screen, so review mode cannot leak them into an export.

- **Leagues are keyed by Superbet `tournamentId` and kept indefinitely** - "we don't take this league" is a standing decision. This is why `renderList()` groups by `tournamentId` rather than by the display title: two competitions can share a name.
- **Matches are keyed by `eventId` and pruned** by `pruneDismissedEvents()` after every successful load, since the feed is the complete offer and anything missing from it has already been played. Pruning only runs on success - never prune from an error path, it would discard live dismissals.
- A dismissed league already covers its fixtures, so their per-match checkboxes render **checked and disabled** rather than pretending to be independently undoable.
- "Prikazi cekirane" puts dismissed rows back on screen so they can be unchecked; `applyFilters()` honours it, `exportableRows()` does not.
- State lives in localStorage under `superfetch.dismissedEvents` / `superfetch.dismissedTournaments`.

#### Reviewing the result ("Neupareni sa Merkura" tab)

The audit surface is the **Merkur-only list (~75 rows), not the ~640 missing ones** — a fixture the matcher wrongly reports as missing must leave its Merkur counterpart unpaired, so every failure shows up there.

- `suggestPartners()` ranks still-unpaired Superbet events against one Merkur orphan. It is deliberately **much more permissive** than `fixtureSimilarity()` — no women/men hard reject, no token floor — because its whole job is to surface pairs the matcher threw away. Its scores are a sort order for a human, never grounds to pair automatically.
- "Povezi" stores the differing name pairs as aliases and recomputes; it does not pin the two fixture ids together, since an alias also fixes every future round.
- Most orphans are genuinely Merkur-only: women's leagues Superbet does not carry, plus Merkur's synthetic "Zamišljeni mečevi".

### FPL API proxy (local dev only)

`fantasy.premierleague.com` blocks CORS unconditionally, even from localhost (unlike the Superbet CDN). `fpl_proxy.py` (run separately, port 5178) mirrors the `/fpl-api/*` → FPL API rewrite that `netlify.toml` applies in production; `FPL_CONFIG.baseUrl` in `config.js` points at it when `isLocal`. See "Running the app" above.

## Soccer flow details (`index.html` / `js/main.js`)

The soccer entry point has the deepest feature set; the details below are specific to it (basketball/tennis reuse the same `ui.js`/`csv.js` machinery but only exercise a subset).

### Data flow

1. **Load** → `fetchSoccerCompetitions()` → `renderCompetitionDropdown()`
2. **Competition change** → `fetchPrematchEventsForCompetition(tournamentId)` → `renderEvents()`
3. **Event change** → `fetchMarketsForEvent(event)` → `renderMarkets()` → clears search + resets market tab display
4. **Tab / search / filter change** → `renderMarketsForCurrentFilter()` re-renders from cached `currentMarkets`
5. **CSV** — built entirely via individual "+" buttons; no bulk generate button

### Market tabs

Six tabs: **Sve, Obično, Statistika, Specijali, Dom. igrači, Gost. igrači** — controlled by `activeMarketTab` in `ui.js`.

- `filterMarketsByTab()` routes on `;` in market name (→ Specijali), `STATISTIKA_KEYWORDS` (→ Statistika), or `odd.playerTeam` (→ player tabs). Markets containing `"igrac"` in the normalized name are excluded from Statistika even if they match a keyword.
- The Specijali and both player tabs share the same **odds range filter** (`#specijali-min` / `#specijali-max`); `specijalFilter` div visibility is toggled for all three.
- A **market search** input (`#market-search`) filters by `marketName` for non-player tabs and by player name for player tabs. It clears on every new event load.

### Custom event bus

`ui.js` never imports `main.js`. Communication goes via `document.dispatchEvent`. Six events:

| Event | Direction | Payload |
|---|---|---|
| `add-odd-to-csv` | ui → main | `{ marketName, odd, button }` |
| `remove-odd-from-csv` | ui → main | `{ button }` |
| `add-specijal-to-csv` | ui → main | `{ marketName, odd, button }` |
| `remove-specijal-from-csv` | ui → main | `{ button }` |
| `add-statistika-to-csv` | ui → main | `{ market, button }` |
| `remove-statistika-from-csv` | ui → main | `{ button }` |

`main.js` owns the CSV string and calls `renderCsvOutput()` after every change.

### Three CSV paths

**Player props** (`add-odd-to-csv` → `buildSingleOddCsvRow()`):
- CSV structure: `MATCH_NAME:<team>` once at top, `LEAGUE_NAME:<player>` per new player, data rows below.
- Cross-team mixing is blocked with `alert()`. Same-team players just add a new `LEAGUE_NAME:` line.
- Removal: `removePlayerOddFromCsv()` walks back to the owning `LEAGUE_NAME:`, removes it if the player block is empty, then removes `MATCH_NAME:` if no `LEAGUE_NAME:` lines remain.
- Download filename: team name.

**Specijali** (`add-specijal-to-csv` → `buildSpecijalRow()` / `buildSpecijaliBlock()`):
- Block header: `MATCH_NAME:Specijal` / `LEAGUE_NAME:<home> - <away>`.
- Removal: `removeSpecijalRowFromCsv()` strips orphaned header pair when block empties.
- Download filename: full event name.

**Statistika** (`add-statistika-to-csv` → `buildStatistikaMarketCsvRow()`):
- One row per market; Under→col U (9), Over→col O (10), line→col GR (8).
- Block header on first add: `MATCH_NAME:Specijal` / `LEAGUE_NAME:<event>`.
- Download filename: full event name.

**Empty-CSV rule:** after every remove, `clearCsvIfNoSelections()` checks for any remaining `.add-odd-button.is-added` — if none, CSV is cleared entirely regardless of orphaned headers.

### Margin control (Promeni kvote)

`getMarginMultiplier()` in `ui.js` reads `#margin-pct` + `input[name="margin-dir"]` and returns a multiplier (e.g. 0.95 or 1.05). Applied at add-time to `odd.price`. Original (unadjusted) price is stored on `button.dataset.originalPrice` (or `originalPriceU`/`originalPriceO` for statistika). `applyMargin()` in `main.js` recalculates all checked rows from the originals whenever the inputs change (real-time). `refreshDisplayedPrices()` in `ui.js` updates the visible price spans at the same time.

### Player cards

`createPlayerGroupCardsByTeam(markets, team, search)` builds collapsible cards. Cards start collapsed; clicking the header button toggles `is-expanded` which CSS-transitions `max-height` on `.player-odds-list`. `resolvePlayerName(odd)` handles the case where `odd.playerName` is a raw API ID (contains `:`), falling back to extracting `"Lastname, Firstname"` from `odd.name`. Basketball has its own variants, `createPlayerGroupCardsBasketball`/`createPlayerGroupCardBasketball`.

### CSV market allow-list

`mapOddToCsvMarket()` in `csv.js` is an explicit allow-list. Returning `null` silently skips the market. Adding a new player-prop market type requires a new `mkt.includes(…)` condition here **and** a priority entry in `sortPlayerRows()`.

`toAsciiMarketName()` is applied to all market names going into the CSV — strips diacritics via NFD + combining-mark removal, maps `đ→d`. This avoids charset rendering bugs in the CSV output.

### Encoding note

`csv.js` has a historical encoding artifact in `normalizeSearchText` — the `đ`/`Đ` replace patterns are stored as garbled bytes rather than `\uXXXX` escapes. This affects search normalization only and does not affect CSV output. **Never add literal Serbian characters (š, ž, č, ć, đ) to hardcoded output strings in `csv.js`** — use ASCII equivalents or `\uXXXX` escapes.

### Other UI details

- **Sidebar CSV preview** (`#csv-preview-panel`): synced by `renderCsvOutput()`; hidden when CSV is empty.
- **Kickoff time** (`#datetime-display`): set by `setKickoffTime(event)` whenever a new event loads; cleared on reset. Uses `Europe/Belgrade` timezone.
- **Race conditions:** `eventsRequestId` / `marketsRequestId` counters in `main.js` discard stale responses.
- **Markets fetch fallback:** tries event endpoint without `marketId`; retries with seed `marketId` (`event.odds[0].marketId ?? 547`); falls back to inline odds.
- **`normalizeSearchText()`** is duplicated in `ui.js` and `csv.js` with slightly different `đ` handling. Both strip diacritics and lowercase for fuzzy matching.
