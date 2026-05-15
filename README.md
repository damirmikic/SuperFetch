# SuperFetch

Browser-based tool for fetching Superbet soccer odds and exporting them as CSV files.

## Run

Because the app uses ES modules, serve the folder with a local static server:

```powershell
python -m http.server 5177
```

Then open `http://127.0.0.1:5177`.

If the browser blocks Superbet requests with CORS errors, run a local proxy that accepts calls on `http://127.0.0.1` and forwards them to the Superbet CDN.

## Usage

1. **Competition** — select a league from the dropdown; events load automatically.
2. **Event** — pick a match; markets load and the player dropdown is populated.
3. **Player** — filter the markets view to a single player's odds. Multi-player combo markets (names joined with `;`) are excluded automatically.
4. **CSV export** — three options:
   - **Generate CSV** — builds a full CSV for the selected player (or all players if none selected) and fills the text area.
   - **Add to CSV** — appends a block for the selected player to whatever is already in the text area.
   - **+** buttons — add individual odds one at a time; the first click on an empty text area also writes the column header and `MATCH_NAME`/`LEAGUE_NAME` rows.
   - **Download CSV** — saves the text area contents as a `.csv` file.
