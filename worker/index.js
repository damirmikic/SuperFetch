import { fetchSupersportHandballPlayerLines } from "../js/supersport_api.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    try {
      const data = await fetchSupersportHandballPlayerLines();
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=30"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || String(err) }), {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};
