import { fetchSupersportHandballPlayerLines } from "../../js/supersport_api.js";
import { SUPERSPORT_CONFIG } from "../../js/config.js";

/**
 * Opens the SuperSport WebSocket server-side and returns the handball player
 * lines as JSON, so the Rukomet page never opens the socket from the browser.
 * A browser socket carries the user's supersport.hr cookies and runs through
 * their extensions, and in some profiles the server then goes silent - see
 * SUPERSPORT_CONFIG in js/config.js.
 *
 * Needs a Node runtime with a global WebSocket (Node 22+), pinned in
 * netlify.toml.
 *
 * `?debug=1` skips the offer and reports why a connection might fail from
 * here: the function's region, what a plain HTTPS request to supersport.hr
 * gets back, and the raw WebSocket error.
 */
export default async (request) => {
  if (new URL(request.url).searchParams.has("debug")) {
    return json(await diagnose(), 200, { "cache-control": "no-store" });
  }

  if (typeof WebSocket === "undefined") {
    return json({ error: "Netlify funkcija nema WebSocket - treba Node 22+" }, 500);
  }

  try {
    const result = await fetchSupersportHandballPlayerLines();
    // A short shared cache: everyone opening the page within the window gets
    // the same snapshot instead of each fanning out ~20 sockets.
    return json(result, 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    return json({ error: error?.message || String(error), region: process.env.AWS_REGION ?? null }, 502);
  }
};

async function diagnose() {
  const report = {
    region: process.env.AWS_REGION ?? null,
    node: process.version,
    hasWebSocket: typeof WebSocket !== "undefined"
  };

  try {
    const response = await fetch("https://www.supersport.hr/", {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000)
    });
    const text = await response.text();
    report.http = {
      status: response.status,
      server: response.headers.get("server"),
      bytes: text.length,
      // A block page is usually short; its title says who blocked it.
      title: text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null
    };
  } catch (error) {
    report.http = { error: String(error?.cause ?? error) };
  }

  if (report.hasWebSocket) report.ws = await probeSocket();
  return report;
}

function probeSocket() {
  return new Promise((resolve) => {
    const started = Date.now();
    const events = [];
    const ws = new WebSocket(SUPERSPORT_CONFIG.wsUrl);
    const done = (outcome) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve({ outcome, ms: Date.now() - started, events });
    };
    const timer = setTimeout(() => done("timeout"), 8000);

    ws.onopen = () => {
      events.push("open");
      ws.send(JSON.stringify({ t: 4, s: Date.now() }));
    };
    ws.onmessage = (event) => {
      events.push(`message: ${String(event.data).slice(0, 60)}`);
      done("ok");
    };
    ws.onerror = (event) => {
      events.push(`error: ${String(event?.error?.cause ?? event?.error ?? event?.message ?? "unknown")}`);
    };
    ws.onclose = (event) => {
      events.push(`close: code=${event.code} reason=${event.reason || "-"}`);
      done("closed");
    };
  });
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
