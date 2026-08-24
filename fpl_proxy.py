"""Local dev proxy for the FPL API, mirroring the /fpl-api/* -> fantasy.premierleague.com/api/* rewrite that netlify.toml applies in production.

Run alongside the static file server:
    python fpl_proxy.py
    python -m http.server 5177

Listens on port 5178. js/config.js points isLocal requests at http://127.0.0.1:5178.
"""

import json
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

UPSTREAM = "https://fantasy.premierleague.com/api"
PORT = 5178


class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        upstream_url = f"{UPSTREAM}{self.path}"
        try:
            req = urllib.request.Request(upstream_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
        except Exception as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    print(f"FPL proxy listening on http://127.0.0.1:{PORT} -> {UPSTREAM}")
    server.serve_forever()
