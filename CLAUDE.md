# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step, no package manager, no test suite. ES modules require HTTP — opening `index.html` directly fails.

```powershell
python -m http.server 5177
```

Open `http://127.0.0.1:5177`. CORS is only an issue on non-localhost origins; `netlify.toml` proxies `/sb-api/*` → Superbet CDN for production.

## Deployment

`netlify.toml` sets `publish = "."` and rewrites `/sb-api/*` to the Superbet CDN. `js/config.js` detects `localhost`/`127.0.0.1` and uses the direct CDN URL locally; everywhere else it uses `/sb-api`.

## Architecture

Vanilla JS SPA, no framework, no bundler. All modules are native ES modules.

| File | Role |
|---|---|
| `js/config.js` | API base URLs, locale, sport ID — environment-aware |
| `js/api.js` | All network calls and response normalization |
| `js/ui.js` | DOM rendering, all UI state, component factories |
| `js/csv.js` | CSV generation, market name mapping, row manipulation |
| `js/main.js` | Orchestrator — wires events, owns CSV string state |

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

`createPlayerGroupCardsByTeam(markets, team, search)` builds collapsible cards. Cards start collapsed; clicking the header button toggles `is-expanded` which CSS-transitions `max-height` on `.player-odds-list`. `resolvePlayerName(odd)` handles the case where `odd.playerName` is a raw API ID (contains `:`), falling back to extracting `"Lastname, Firstname"` from `odd.name`.

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
