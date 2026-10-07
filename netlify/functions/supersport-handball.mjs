import { fetchSupersportHandballPlayerLines } from "../../js/supersport_api.js";

/**
 * Opens the SuperSport WebSocket server-side and returns the handball player
 * lines as JSON, so the Rukomet page never opens the socket from the browser.
 * A browser socket carries the user's supersport.hr cookies and runs through
 * their extensions, and in some profiles the server then goes silent - see
 * SUPERSPORT_CONFIG in js/config.js.
 *
 * Needs a Node runtime with a global WebSocket (Node 22+), pinned in
 * netlify.toml.
 */
export default async () => {
  if (typeof WebSocket === "undefined") {
    return json({ error: "Netlify funkcija nema WebSocket - treba Node 22+" }, 500);
  }

  try {
    const result = await fetchSupersportHandballPlayerLines();
    // A short shared cache: everyone opening the page within the window gets
    // the same snapshot instead of each fanning out ~20 sockets.
    return json(result, 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    return json({ error: error?.message || String(error) }, 502);
  }
};

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
