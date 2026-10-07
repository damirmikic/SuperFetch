import { SUPERSPORT_CONFIG } from "./config.js";

/**
 * SuperSport serves its offer over a single pub/sub WebSocket (protocol "v1"
 * in their bundle). Every frame holds one or more messages separated by a
 * blank line; a message is a JSON header line, optionally followed by a JSON
 * body line. Header keys are abbreviated:
 *   t  type        1 subscribe, 4 ping, 5 pong (absent = publish)
 *   s  stream      the topic name
 *   f  full        1 when the body is a complete snapshot, else a diff
 *
 * Topics are `<prefix>_<id>_<lang>`. Two are enough here:
 *   i_hr               the index - every sport's fixture tree, but only the
 *                      main markets, and player lines arrive as empty `{}`
 *   t_<tournament>_hr  one tournament with every line filled in, player
 *                      markets included
 * The fixture topic (f_f<id>_hr) is no help: it also leaves player lines empty.
 *
 * Body keys are abbreviated too (their "sbkLegend"): B meta, S sports,
 * C categories, T tournaments, FX fixtures, H/A home/away, t startsAt,
 * a offerIds, P offers, m markets, l lines, o outcomes, O odds, n name,
 * D order, U market group.
 */

const PING_INTERVAL_MS = 4000;
// Several topics on one connection are unreliable: the server silently skips
// some of them - no error, the snapshot just never arrives. Measured on 20
// handball tournaments: 14-15 back when batched by 10 or all at once, 17 by 5,
// and all 20 at one topic per connection (in under 2s). So every tournament
// gets its own short-lived socket, a few at a time.
const PARALLEL_CONNECTIONS = 4;

function openFeed() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SUPERSPORT_CONFIG.wsUrl);
    const pending = new Map();
    // Diagnostics for the timeout message: did anything arrive at all?
    const stats = { messages: 0, topics: new Set() };
    let pingTimer = null;

    ws.onopen = () => {
      pingTimer = setInterval(() => send({ t: 4, s: Date.now() }), PING_INTERVAL_MS);
      resolve({ subscribe, close });
    };
    ws.onerror = () => reject(new Error("SuperSport WebSocket se nije mogao otvoriti"));
    ws.onclose = () => {
      clearInterval(pingTimer);
      for (const waiter of pending.values()) waiter.fail(new Error("SuperSport WebSocket je zatvoren"));
      pending.clear();
    };
    ws.onmessage = (event) => {
      for (const chunk of String(event.data).split("\n\n")) {
        const message = parseMessage(chunk);
        if (!message) continue;
        stats.messages += 1;
        if (message.header.s) stats.topics.add(message.header.s);
        if (!message.header.f) continue;
        pending.get(message.header.s)?.receive(message.body);
      }
    };

    function send(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    // Resolves with Map<topic, body> once every topic has sent its full
    // snapshot. With allowPartial, a topic that never answers is dropped at
    // the timeout instead of failing the whole batch.
    function subscribe(topics, { timeoutMs = 30000, allowPartial = false } = {}) {
      return new Promise((done, fail) => {
        const results = new Map();
        const waiting = new Set(topics);
        const finish = () => {
          clearTimeout(timer);
          for (const topic of topics) pending.delete(topic);
          done(results);
        };
        const timer = setTimeout(() => {
          if (allowPartial) return finish();
          for (const topic of topics) pending.delete(topic);
          const seen = stats.topics.size ? `, teme: ${[...stats.topics].join(", ")}` : "";
          fail(new Error(`SuperSport nije odgovorio na ${[...waiting].join(", ")} (primljeno poruka: ${stats.messages}${seen})`));
        }, timeoutMs);

        for (const topic of topics) {
          pending.set(topic, {
            receive(body) {
              results.set(topic, body);
              waiting.delete(topic);
              if (!waiting.size) finish();
            },
            fail(error) {
              clearTimeout(timer);
              fail(error);
            }
          });
        }
        if (!topics.length) return finish();
        send({ t: 1, u: topics.map((topic) => ({ s: topic, n: 0 })) });
      });
    }

    function close() {
      ws.close();
    }
  });
}

function parseMessage(chunk) {
  const [headerLine, bodyLine] = chunk.split("\n");
  if (!headerLine) return null;
  try {
    return {
      header: JSON.parse(headerLine),
      body: bodyLine ? JSON.parse(bodyLine) : null
    };
  } catch {
    return null;
  }
}

/**
 * Every handball fixture that carries player over/under lines.
 * Returns { fixtures, totalFixtures, missingTournaments }, where each fixture is
 * { fixtureId, home, away, startsAt, categoryName, tournamentName, players }
 * and each player row is { lineId, marketId, marketName, player, line, under, over }.
 */
export async function fetchSupersportHandballPlayerLines() {
  const { lang, handballSportId } = SUPERSPORT_CONFIG;

  const indexTopic = `i_${lang}`;
  const index = await fetchTopic(indexTopic, { timeoutMs: 10000, attempts: 3 });
  const sport = index?.B?.S?.[handballSportId];
  if (!sport) return { fixtures: [], totalFixtures: 0, missingTournaments: 0 };

  const tournamentIds = Object.values(sport.C ?? {}).flatMap((category) => Object.keys(category.T ?? {}));
  const topics = tournamentIds.map((id) => `t_${id}_${lang}`);
  const bodies = await mapWithConcurrency(topics, PARALLEL_CONNECTIONS, async (topic) => {
    try {
      return await fetchTopic(topic, { timeoutMs: 6000, attempts: 2 });
    } catch (error) {
      console.warn(`SuperSport: ${topic}`, error);
      return null;
    }
  });

  const fixtures = [];
  let totalFixtures = 0;
  for (const body of bodies) {
    if (!body) continue;
    const parsed = parseTournamentBody(body, handballSportId);
    totalFixtures += parsed.totalFixtures;
    fixtures.push(...parsed.fixtures);
  }

  fixtures.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.home.localeCompare(b.home));
  return { fixtures, totalFixtures, missingTournaments: bodies.filter((body) => !body).length };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// The server now and then never answers a subscription - the same silent
// skip as with batched topics, just rarer. A fresh connection usually gets it,
// so each topic is retried on a new socket with a short timeout rather than
// waiting long on one.
async function fetchTopic(topic, { timeoutMs, attempts }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return (await subscribeOnce([topic], { timeoutMs })).get(topic);
    } catch (error) {
      lastError = error;
      console.warn(`SuperSport: ${topic}, pokušaj ${attempt}/${attempts}`, error);
    }
  }
  throw lastError;
}

async function subscribeOnce(topics, options) {
  const feed = await openFeed();
  try {
    return await feed.subscribe(topics, options);
  } finally {
    feed.close();
  }
}

function parseTournamentBody(body, sportId) {
  const sport = body?.B?.S?.[sportId];
  if (!sport) return { fixtures: [], totalFixtures: 0 };

  const playerMarkets = findPlayerOverUnderMarkets(sport.m ?? {});
  const offers = body.P ?? {};
  const fixtures = [];
  let totalFixtures = 0;

  for (const category of Object.values(sport.C ?? {})) {
    for (const tournament of Object.values(category.T ?? {})) {
      for (const [fixtureId, fixture] of Object.entries(tournament.FX ?? {})) {
        // Season entries (outrights) have no home/away.
        if (!fixture.H || !fixture.A) continue;
        totalFixtures += 1;

        const players = Object.keys(fixture.a ?? {})
          .flatMap((offerId) => extractPlayerRows(offers[offerId], playerMarkets));
        if (!players.length) continue;

        fixtures.push({
          fixtureId,
          home: String(fixture.H.n ?? "").trim(),
          away: String(fixture.A.n ?? "").trim(),
          startsAt: String(fixture.t ?? ""),
          categoryName: String(category.n ?? ""),
          tournamentName: String(tournament.n ?? ""),
          players
        });
      }
    }
  }

  return { fixtures, totalFixtures };
}

// Player markets are the ones filed under the "Igrači" group. Only those with
// a više/manje outcome pair are kept - that is the shape the CSV row expects.
function findPlayerOverUnderMarkets(marketMeta) {
  const markets = new Map();

  for (const [marketId, meta] of Object.entries(marketMeta)) {
    const groups = Object.keys(meta.U ?? {}).map(normalize);
    if (!groups.some((group) => group.startsWith("igrac"))) continue;

    let overId = null;
    let underId = null;
    for (const [outcomeId, outcome] of Object.entries(meta.o ?? {})) {
      const name = normalize(outcome.n);
      if (name.startsWith("vise")) overId = outcomeId;
      else if (name.startsWith("manje")) underId = outcomeId;
    }
    if (!overId || !underId) continue;

    const name = String(meta.n ?? "").trim();
    markets.set(marketId, {
      name,
      // Line names repeat the market name minus its trailing "igrača":
      // market "zbroj golova igrača" -> line "zbroj golova Vlah Aleks (5.5)".
      linePrefix: name.replace(/\s*igra\S*$/i, "").trim(),
      overId,
      underId
    });
  }

  return markets;
}

function extractPlayerRows(offer, playerMarkets) {
  if (!offer?.m) return [];
  const rows = [];

  for (const [marketId, market] of playerMarkets) {
    const lines = offer.m[marketId]?.l ?? {};
    const ordered = Object.entries(lines).sort(([, a], [, b]) => (a.D ?? 0) - (b.D ?? 0));

    for (const [lineId, line] of ordered) {
      const parsed = parseLineName(line.n, market.linePrefix);
      const over = Number(line.o?.[market.overId]?.O);
      const under = Number(line.o?.[market.underId]?.O);
      if (!parsed || !(over > 1) || !(under > 1)) continue;

      rows.push({
        lineId,
        marketId,
        marketName: market.name,
        player: parsed.player,
        line: parsed.line,
        under,
        over
      });
    }
  }

  return rows;
}

function parseLineName(name, prefix) {
  const match = String(name ?? "").match(/^(.*?)\s*\(\s*([-+]?\d+(?:[.,]\d+)?)\s*\)\s*$/);
  if (!match) return null;

  let player = match[1].trim();
  if (prefix && normalize(player).startsWith(normalize(prefix))) {
    player = player.slice(prefix.length).trim();
  }
  if (!player) return null;

  return { player, line: match[2].replace(",", ".") };
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
