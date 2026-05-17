# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

The app uses ES modules and must be served over HTTP — opening `index.html` directly will not work.

```powershell
python -m http.server 5177
```

Then open `http://127.0.0.1:5177`. If the browser blocks Superbet requests with CORS errors, a local proxy is needed (the frontend calls `http://127.0.0.1` while the proxy forwards to the Superbet CDN).

There is no build step, no package manager, and no test suite.

## Architecture

This is a vanilla JS single-page app with no framework or bundler. All modules are native ES modules loaded directly by the browser.

### Module responsibilities

| File | Role |
|---|---|
| `js/config.js` | API base URLs, locale (`sr-Latn-RS`), soccer sport ID, constants |
| `js/api.js` | All network calls and response normalization |
| `js/ui.js` | DOM rendering, component creation, and UI-level state |
| `js/csv.js` | CSV generation with Serbian market name mapping |
| `js/main.js` | Orchestrator — wires DOM events, calls api.js, passes results to ui.js |

### Data flow

1. **Load** → `fetchSoccerCompetitions()` → `renderCompetitionDropdown()`
2. **Competition change** → `fetchPrematchEventsForCompetition(tournamentId)` → `renderEvents()`
3. **Event change** → `fetchMarketsForEvent(event)` → `renderMarkets()`
4. **Player filter change** → `renderMarketsForCurrentFilter()` re-renders from cached `currentMarkets`
5. **Generate CSV** → `generateOddsCsv({ event, markets, player })` in `csv.js`

### Key implementation details

**Race conditions:** Two request ID counters (`eventsRequestId`, `marketsRequestId`) in `main.js` prevent stale responses from overwriting newer ones.

**Markets fetch fallback:** `fetchMarketsForEvent` tries the event endpoint without a `marketId` first; if that returns empty odds it retries with a seed `marketId` (from `event.odds[0].marketId ?? 547`), then falls back to the inline odds from the event object itself.

**Market tabs:** Four tabs in the UI — All, Obično (standard), Statistika, Specijali — controlled by `activeMarketTab` state in `ui.js`. `filterMarketsByTab()` dispatches on the `;` separator (combo = Specijali) and then on `STATISTIKA_KEYWORDS` to split the remaining markets into Statistika vs Obično.

**Custom event bus:** `ui.js` communicates back to `main.js` by dispatching custom events on `document`. Four events are used: `add-odd-to-csv`, `remove-odd-from-csv`, `add-specijal-to-csv`, `remove-specijal-from-csv`. `main.js` owns all CSV state and listens for these.

**Player-prop vs Specijali CSV paths:** These are distinct flows. Player-prop odds (from the player filter card) fire `add-odd-to-csv` → `buildSingleOddCsvRow()`. Combo/accumulator odds (markets whose name contains `;`) fire `add-specijal-to-csv` → `buildSpecijaliBlock()` / `buildSpecijalRow()`, with a block header of `MATCH_NAME:Specijali` and `LEAGUE_NAME:<home> - <away>`. Removal of a specijali row also removes the orphaned `MATCH_NAME`/`LEAGUE_NAME` header pair if no data rows remain in that block (`removeSpecijalRowFromCsv()` in `csv.js`).

**CSV market allow-list:** `mapOddToCsvMarket()` in `csv.js` is an explicit allow-list — only markets matching one of the `mkt.includes(…)` conditions produce a CSV row; everything else returns `null` and is silently skipped. Adding support for a new market type requires a new condition here **and** a sort-priority entry in `sortPlayerRows()`.

**Answer column logic:** `extractLineOrNull()` converts threshold text in the odds name or `specialBetValue` (e.g., "više od 3.5" → `"4+"`, "2+" style strings) into the answer column value. When no threshold is found it defaults to `"DA"`.

**CSV market mapping:** `mapOddToCsvMarket()` in `csv.js` translates Superbet market/outcome text into fixed Serbian market names. The CSV columns are fixed: `Datum, Vreme, Sifra, Domacin, Gost, 1, X, 2, GR, U, O, Yes, No`. When starting a fresh CSV via the "+" button, `MATCH_NAME:` (team) and `LEAGUE_NAME:` (player) header rows are prepended before the first data row.

**Player filter:** `extractPlayers()` in `ui.js` populates the player dropdown. Markets whose `marketName` contains `;` are skipped — these are multi-player combo/accumulator markets. The dropdown drives `renderMarketsForCurrentFilter()` which calls `groupOddsForPlayer()` to show only matching odds in a `player-results` card with individual "+" add-to-CSV buttons per odd row.

**Player name format:** Names from Superbet often come as `"Lastname, Firstname"`. `formatPlayerName()` (defined in both `ui.js` and `csv.js`) converts them to `"Firstname Lastname"`. The player name regex in `extractPlayerCandidates()` allows one optional capitalized prefix word before the last name (e.g. `Van Dijk, Virgil`).

**Text normalization:** `normalizeSearchText()` is duplicated in `ui.js` and `csv.js` (slight encoding difference for `đ`/`Đ` — raw chars vs escape sequences). Both strip diacritics and lowercase for fuzzy matching.

**CSV modes:** Three buttons control CSV output — "Generate CSV" replaces the textarea with all odds for the selected player/event; "Add to CSV" appends a `MATCH_NAME`/`LEAGUE_NAME` block for the selected player; individual "+" buttons on each odd row append single rows (prepending the full header block if the textarea was empty).
