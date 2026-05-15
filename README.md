# SuperFetch

SuperFetch is a browser-based odds workflow. The first step fetches Superbet soccer competitions and renders them in a dropdown.

## Run

Because the app uses ES modules, serve the folder with a local static server:

```powershell
cd C:\Users\kvoter2\Desktop\Projects\Betting\SuperFetch
python -m http.server 5177
```

Then open:

```text
http://127.0.0.1:5177
```

If the browser blocks the Superbet request with CORS, the next step should be a small local JavaScript proxy so the frontend can call `http://127.0.0.1` while the proxy talks to Superbet.
