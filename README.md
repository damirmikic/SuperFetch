# SPECIJALI

Browser-based CSV generator for Superbet soccer/basketball/tennis odds, tournament group simulations, daily specials, and a Fantasy Premier League expected-points calculator.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Soccer — CSV generator (this README covers it in detail below) |
| `basketball.html` | Basketball — same CSV generator flow |
| `tennis.html` | Tennis — same CSV generator flow |
| `daily-specials.html` | Synthesizes cross-match "daily specials" (totals, player vs team, team duels) from real odds via a Dixon-Coles xG fit |
| `fantasy.html` | Fantasy Premier League expected-points calculator (see below) |

## Run locally

Because the app uses ES modules, serve the folder with a local static server:

```powershell
python -m http.server 5177
```

Then open `http://127.0.0.1:5177`.

The Fantasy page additionally needs a local proxy for the FPL API, since `fantasy.premierleague.com` blocks CORS unconditionally:

```powershell
python fpl_proxy.py
```

Run this alongside the static server (listens on port 5178). Without it, `fantasy.html` fails to load player data.

## Deploy

Push to GitHub and connect to Netlify. `netlify.toml` is already configured — it sets the publish directory to the repo root and proxies Superbet calls through `/sb-api` and FPL API calls through `/fpl-api` to solve CORS. No build step needed.

## Fantasy Premier League calculator (`fantasy.html`)

Projects **expected Fantasy Premier League points per player** for upcoming Premier League fixtures, derived from real odds rather than manual entry.

- **Fixtures** — pulled from the same Superbet feed as the soccer page, filtered to the English Premier League only.
- **Player identity & position** — reconciled against the official FPL API (`fantasy.premierleague.com/api/bootstrap-static/`), which is the only source for GK/DEF/MID/FWD position (not present in the odds feed).
- **Scoring** — official FPL rules, computed from odds-implied probabilities:
  - Goals (10/6/5/4 pts by position) and assists (3 pts): anytime-scorer/assist market price → implied probability → Poisson goal-rate (`-ln(1-p)`) → points.
  - Clean sheets (4 GK/DEF, 1 MID) and goals-conceded penalty (GK/DEF, -1 per 2 conceded): derived from the opponent's expected goals (Dixon-Coles xG fit, same model used by `daily-specials.html`).
  - Cards (-1 yellow, -3 red): same anytime-market-to-probability conversion, applied to per-player card odds.
  - Appearance (1-2 pts): approximated — awarded if any market exists for the player, since props are rarely offered for unlikely starters.
- **Not modeled** (no corresponding odds market exists): bonus points, CBI/tackles thresholds, recoveries, saves, penalty saves/misses, own goals. Shown as a standing note in the UI rather than silently scored as zero.
- Only players with at least one odds market in a selected fixture are shown — no guessed squad fill-in.

## Usage

1. **Competition** — select a league from the dropdown; events load automatically.
2. **Event** — pick a match; markets and player tabs load automatically.
3. **Tabs** — switch between market categories:
   - **Sve** — all markets
   - **Obično** — standard match markets
   - **Statistika** — team-level stats (corners, fouls, shots…); markets with 1–2 odds (e.g. Under/Over) get a single "+" that adds one CSV row; markets with 3+ odds (e.g. Korneri raspon) get an individual "+" per selection, each adding its own row
   - **Specijali** — combo/accumulator markets; one "+" button per odd
   - **Igrači** — player props grouped by player in collapsible cards
   - **Simulacija** — (Soccer only) tournament group stage simulation view. Simulates match scores and standing probabilities to compute fair odds and lines.
4. **Search** — filter visible markets or players by name within the active tab.
5. **Odds range filter** — available on Specijali and player tabs; hides odds outside the od/do range.
6. **Margin controls** — configure and apply betting margins separately:
   - **Margin Outrights** — affects Outright/Special markets (e.g. 1X2, combo/specijali, winner, exact forecast, top 2, etc.)
   - **Margin O/U** — affects Over/Under and stats markets (e.g. corners, cards, player points/props, group total goals/draws lines)
   - Real-time changes are reflected on the odds buttons and in the CSV preview.
7. **+ buttons** — add individual odds to the CSV. Click again to remove. The CSV clears automatically when all selections are unchecked.
8. **Primeni** — re-applies the current margins to all already-added rows.
9. **Početna šifra** — configure the starting Sifra (code) number in the CSV actions toolbar (defaults to `50049`), which increments sequentially for generated rows.
10. **Dodaj default** — bulk-adds a preset list of statistika markets for the loaded event. For each market the most balanced Under/Over line is picked automatically; range markets (3+ odds) add every selection. Skips markets not available for the current event; clicking again skips already-added entries.
11. **Download** — saves the CSV. Filename is the team name for player props, or the full event name for Specijali/Statistika.

## CSV structure

For standard markets:
```
Datum,Vreme,Sifra,Domacin,Gost,1,X,2,GR,U,O,Yes,No
MATCH_NAME:<team or event>
LEAGUE_NAME:<player or event>
<data rows...>
```

Player-prop files group rows by team (`MATCH_NAME`) and player (`LEAGUE_NAME`). Mixing players from different teams in one CSV is blocked. Specijali and Statistika files use `MATCH_NAME:Specijal` with the event name as `LEAGUE_NAME`.

For Soccer Group Simulations, the exported CSV formats all selections under a single tournament-level header:
```
Datum,Vreme,Sifra,Domacin,Gost,1,X,2,GR,U,O,Yes,No
MATCH_NAME:<competitionName>
LEAGUE_NAME:<groupName> (e.g., Grupa A)
<outrights, exact forecast, top 2, total lines, and efficiency rows...>
```
Combination markets (`Tacan poredak`, `Prva dva u grupi`) are automatically sorted by odds in ascending order. Individual team points are omitted from the export.

All market and odd names in the CSV are ASCII-normalized (ć→c, č→c, š→s, ž→z, đ→d).

## Default markets (Dodaj default)

The preset list, in order:

| Market | Notes |
|---|---|
| 1. poluvreme - ukupno kornera | most balanced line |
| 1. poluvreme - ukupno kornera {home} / {away} | most balanced line, both teams |
| 1. poluvreme - ukupno kartona | most balanced line |
| Ukupno kornera | most balanced line |
| Ukupno kornera {home} / {away} | most balanced line, both teams |
| Korneri raspon {home} / {away} | all range selections, both teams |
| Ukupno kartona | most balanced line |
| Ukupno kartona {home} / {away} | most balanced line, both teams |
| Ukupno crvenih kartona | most balanced line |
| Ukupno crvenih kartona {home} / {away} | most balanced line, both teams |
| Ukupno šuteva u okvir gola | most balanced line |
| {home} / {away} ukupno šuteva u okvir gola | most balanced line, both teams |
| Ukupno faulova | most balanced line |
| {home} / {away} Ukupno faulova | most balanced line, both teams |
| Ukupno ofsajda | most balanced line |
| {home} / {away} ukupno ofsajda | most balanced line, both teams |
| Ukupno dosuđenih penala | Više od 0.5 (1+) line |
| Ukupno šuteva | most balanced line |
| Ukupno šuteva {home} / {away} | most balanced line, both teams |
