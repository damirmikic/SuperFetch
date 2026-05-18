# SPECIJALI

Browser-based CSV generator for Superbet soccer odds.

## Run locally

Because the app uses ES modules, serve the folder with a local static server:

```powershell
python -m http.server 5177
```

Then open `http://127.0.0.1:5177`.

## Deploy

Push to GitHub and connect to Netlify. `netlify.toml` is already configured — it sets the publish directory to the repo root and proxies all API calls through `/sb-api` to solve CORS. No build step needed.

## Usage

1. **Competition** — select a league from the dropdown; events load automatically.
2. **Event** — pick a match; markets and player tabs load automatically.
3. **Tabs** — switch between market categories:
   - **Sve** — all markets
   - **Obično** — standard match markets
   - **Statistika** — team-level stats (corners, fouls, shots…); markets with 1–2 odds (e.g. Under/Over) get a single "+" that adds one CSV row; markets with 3+ odds (e.g. Korneri raspon) get an individual "+" per selection, each adding its own row
   - **Specijali** — combo/accumulator markets; one "+" button per odd
   - **Dom. igrači / Gost. igrači** — player props grouped by player in collapsible cards
4. **Search** — filter visible markets or players by name within the active tab.
5. **Odds range filter** — available on Specijali and both player tabs; hides odds outside the od/do range.
6. **Promeni kvote** — apply a percentage decrease or increase to all odds before they enter the CSV; changes are reflected in real time on the odds buttons and in the CSV preview.
7. **+ buttons** — add individual odds to the CSV. Click again to remove. The CSV clears automatically when all selections are unchecked.
8. **Primeni** — re-applies the current margin to all already-added rows.
9. **Dodaj default** — bulk-adds a preset list of statistika markets for the loaded event. For each market the most balanced Under/Over line is picked automatically; range markets (3+ odds) add every selection. Skips markets not available for the current event; clicking again skips already-added entries.
10. **Download** — saves the CSV. Filename is the team name for player props, or the full event name for Specijali/Statistika.

## CSV structure

```
Datum,Vreme,Sifra,Domacin,Gost,1,X,2,GR,U,O,Yes,No
MATCH_NAME:<team or event>
LEAGUE_NAME:<player or event>
<data rows...>
```

Player-prop files group rows by team (`MATCH_NAME`) and player (`LEAGUE_NAME`). Mixing players from different teams in one CSV is blocked. Specijali and Statistika files use `MATCH_NAME:Specijal` with the event name as `LEAGUE_NAME`.

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
| Ukupno šuteva u okvir gola | most balanced line |
| {home} / {away} ukupno šuteva u okvir gola | most balanced line, both teams |
| Ukupno faulova | most balanced line |
| Ukupno ofsajda | most balanced line |
| Ukupno šuteva | most balanced line |
| Ukupno šuteva {home} / {away} | most balanced line, both teams |
