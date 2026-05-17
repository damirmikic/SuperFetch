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
   - **Statistika** — team-level stats (corners, fouls, shots…); one "+" button per market adds an Under/Over row
   - **Specijali** — combo/accumulator markets; one "+" button per odd
   - **Dom. igrači / Gost. igrači** — player props grouped by player in collapsible cards
4. **Search** — filter visible markets or players by name within the active tab.
5. **Odds range filter** — available on Specijali and both player tabs; hides odds outside the od/do range.
6. **Promeni kvote** — apply a percentage decrease or increase to all odds before they enter the CSV; changes are reflected in real time on the odds buttons and in the CSV preview.
7. **+ buttons** — add individual odds to the CSV. Click again to remove. The CSV clears automatically when all selections are unchecked.
8. **Primeni** — re-applies the current margin to all already-added rows.
9. **Download** — saves the CSV. Filename is the team name for player props, or the full event name for Specijali/Statistika.

## CSV structure

```
Datum,Vreme,Sifra,Domacin,Gost,1,X,2,GR,U,O,Yes,No
MATCH_NAME:<team or event>
LEAGUE_NAME:<player or event>
<data rows...>
```

Player-prop files group rows by team (`MATCH_NAME`) and player (`LEAGUE_NAME`). Mixing players from different teams in one CSV is blocked. Specijali and Statistika files use `MATCH_NAME:Specijal` with the event name as `LEAGUE_NAME`.
