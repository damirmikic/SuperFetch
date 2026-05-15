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
3. **Event change** → two concurrent requests:
   - `fetchMarketsForEvent(event)` → `renderMarkets()` + `renderInferredLineups()`
   - `fetchProjectedLineupsForEvent(event)` → `renderLineups()`
4. **Player filter change** → `renderMarketsForCurrentFilter()` re-renders from cached `currentMarkets`
5. **Generate CSV** → `generateOddsCsv({ event, markets, player })` in `csv.js`

### Key implementation details

**Race conditions:** Three request ID counters (`eventsRequestId`, `marketsRequestId`, `lineupsRequestId`) in `main.js` prevent stale responses from overwriting newer ones.

**Lineups priority:** `lineupsMode` in `ui.js` tracks the source — `"stats"` (scorealarm API) beats `"inferred"` (derived from odds player specifiers). `renderInferredLineups()` is a no-op when `lineupsMode === "stats"`.

**Markets fetch fallback:** `fetchMarketsForEvent` tries the event endpoint without a `marketId` first; if that returns empty odds it retries with a seed `marketId` (from `event.odds[0].marketId ?? 547`), then falls back to the inline odds from the event object itself.

**CSV market mapping:** `mapOddToCsvMarket()` in `csv.js` translates Superbet market/outcome text into fixed Serbian market names (`"daje gol"`, `"asistencija"`, `"ukupno šuteva"`, etc.). The CSV columns are fixed: `Datum, Vreme, Sifra, Domacin, Gost, 1, X, 2, GR, U, O, Yes, No`.

**Player name format:** Names from Superbet often come as `"Lastname, Firstname"`. `formatPlayerName()` (defined in both `ui.js` and `csv.js`) converts them to `"Firstname Lastname"` for display.

**Stats API response:** The scorealarm lineups endpoint can return protobuf or JSON; only JSON is handled — a `"content-type"` sniff in `parseStatsPayload()` covers the JSON case, and a 204 means no lineups are available.

**Text normalization:** `normalizeSearchText()` is duplicated in `ui.js` and `csv.js` (slight encoding difference for `đ`/`Đ` due to character encoding of the source files). Both strip diacritics and lowercase for fuzzy matching.
