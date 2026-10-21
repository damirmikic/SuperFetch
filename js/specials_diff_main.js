import { fetchAllPrematchEvents, fetchMarketsForEvent } from "./api.js";
import { fetchMerkurSpecials } from "./merkur_specials_api.js";
import { SUPERBET_CONFIG } from "./config.js";
import { compareOffers, eventKickoffMs, teamSimilarity, buildAliasIndex } from "./match_matcher.js";
import { aliasPairsFor } from "./team_name_aliases.js";
import { canonicalizeMerkur, canonicalizeSuperbet, compareFixture, describeMarket, outcomeDelta, normalizeText } from "./specials_model.js";

const FETCH_CONCURRENCY = 4;

const timeFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const OUTCOME_LABELS = { over: "V", under: "M", yes: "" };

const state = {
  loading: false,
  fixtures: [],
  unpaired: [],
  visible: []
};

const elements = {
  status: document.querySelector("#status"),
  resultStatus: document.querySelector("#specials-result-status"),
  summary: document.querySelector("#specials-summary"),
  list: document.querySelector("#specials-list"),
  search: document.querySelector("#specials-search"),
  view: document.querySelector("#specials-view"),
  minDelta: document.querySelector("#specials-min-delta"),
  hideEmpty: document.querySelector("#specials-hide-empty"),
  reloadButton: document.querySelector("#reload-button"),
  refreshButton: document.querySelector("#refresh-button"),
  copyButton: document.querySelector("#copy-button"),
  downloadButton: document.querySelector("#download-button")
};

elements.reloadButton.addEventListener("click", load);
elements.refreshButton.addEventListener("click", load);
elements.copyButton.addEventListener("click", copyTsv);
elements.downloadButton.addEventListener("click", downloadTsv);

for (const control of [elements.search, elements.view, elements.minDelta, elements.hideEmpty]) {
  control.addEventListener("input", renderList);
}

load();

function setStatus(message) {
  elements.status.textContent = message;
}

async function load() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  elements.reloadButton.disabled = true;
  setStatus("Ucitavam ponude...");

  try {
    const [merkur, allEvents] = await Promise.all([fetchMerkurSpecials(), fetchAllPrematchEvents()]);
    const events = allEvents.filter((event) => event.sportId === SUPERBET_CONFIG.soccerSportId);
    const aliasPairs = aliasPairsFor("merkur", "soccer");
    const aliasIndex = buildAliasIndex(aliasPairs);

    // Each Merkur fixture is reduced to a match-shaped record so the existing
    // fixture matcher (kickoff + fuzzy team names) can pair it with Superbet.
    const matches = merkur.fixtures.map((fixture) => ({
      matchId: fixture.matchId,
      home: fixture.home,
      away: fixture.away,
      kickoffMs: fixture.kickoffMs,
      leagueId: fixture.leagueId
    }));
    const result = compareOffers(events, matches, { aliasPairs, timeToleranceMinutes: 15 });
    const fixtureById = new Map(merkur.fixtures.map((fixture) => [fixture.matchId, fixture]));

    state.unpaired = result.missingOnSuperbet.map((match) => fixtureById.get(match.matchId)).filter(Boolean);
    state.fixtures = [];

    const pairs = result.pairs.slice().sort((a, b) => a.match.kickoffMs - b.match.kickoffMs);
    let done = 0;

    await runPool(pairs, FETCH_CONCURRENCY, async (pair) => {
      const merkurFixture = fixtureById.get(pair.match.matchId);
      state.fixtures.push(await buildFixture(merkurFixture, pair.event, aliasIndex));
      done += 1;
      setStatus(`Superbet trzista ${done}/${pairs.length}`);
    });

    state.fixtures.sort((a, b) => a.kickoffMs - b.kickoffMs);
    setStatus(`Merkur ${merkur.fixtures.length} / Superbet ${events.length} / upareno ${pairs.length}`);
    renderList();
  } catch (error) {
    console.error(error);
    setStatus("Greska pri ucitavanju");
    renderEmpty(`Greska: ${error.message}`);
  } finally {
    state.loading = false;
    elements.reloadButton.disabled = false;
  }
}

async function buildFixture(merkurFixture, event, aliasIndex) {
  // Books occasionally list a fixture the other way round, and every
  // home/away subject has to be expressed in Superbet's orientation.
  const straight =
    teamSimilarity(event.homeTeam, merkurFixture.home, aliasIndex) +
    teamSimilarity(event.awayTeam, merkurFixture.away, aliasIndex);
  const crossed =
    teamSimilarity(event.homeTeam, merkurFixture.away, aliasIndex) +
    teamSimilarity(event.awayTeam, merkurFixture.home, aliasIndex);
  const flipped = crossed > straight;
  const merkurHome = normalizeText(merkurFixture.home);

  const sideOf = (teamName) => {
    const isMerkurHome = normalizeText(teamName) === merkurHome;
    return isMerkurHome !== flipped ? "home" : "away";
  };

  let rows = [];
  let unmapped = new Map();
  let error = "";

  try {
    const markets = await fetchMarketsForEvent(event);
    const merkur = canonicalizeMerkur(merkurFixture, sideOf);
    unmapped = merkur.unmapped;
    rows = compareFixture(merkur.entries, canonicalizeSuperbet(markets, event));
  } catch (caught) {
    console.error(caught);
    error = caught.message;
  }

  return {
    kickoffMs: eventKickoffMs(event),
    // Superbet's spelling, because every subject is already in its orientation.
    home: event.homeTeam,
    away: event.awayTeam,
    matchName: `${event.homeTeam} - ${event.awayTeam}`,
    merkurName: `${merkurFixture.home} - ${merkurFixture.away}`,
    competition: merkurFixture.leagueName,
    rows,
    unmappedCount: Array.from(unmapped.values()).reduce((sum, count) => sum + count, 0),
    error
  };
}

async function runPool(items, size, worker) {
  const queue = items.slice();

  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) {
        await worker(queue.shift());
      }
    })
  );
}

// ---- Filtering and rendering ----------------------------------------------

function passesFilter(row, view, minDelta) {
  const priceDiff = row.status === "both" && row.maxDelta >= minDelta;

  switch (view) {
    case "diff":
      return row.status === "mx" || priceDiff;
    case "mx":
      return row.status === "mx";
    case "sb":
      return row.status === "sb" || row.status === "sb-line";
    case "price":
      return priceDiff;
    case "both":
      return row.status === "both";
    default:
      return true;
  }
}

function applyFilters() {
  const view = elements.view.value;
  const minDelta = Math.max(0, Number(elements.minDelta.value) || 0);
  const search = normalizeText(elements.search.value);

  const visible = state.fixtures.map((fixture) => {
    const fixtureHit = !search || normalizeText(`${fixture.matchName} ${fixture.merkurName}`).includes(search);
    const rows = fixture.rows
      .filter((row) => passesFilter(row, view, minDelta))
      .filter((row) => fixtureHit || normalizeText(describeMarket(row, fixture).title).includes(search))
      .sort(compareRows);

    return { fixture, rows };
  });

  return elements.hideEmpty.checked ? visible.filter((entry) => entry.rows.length || entry.fixture.error) : visible;
}

const STATUS_ORDER = { mx: 0, both: 1, "sb-line": 2, sb: 3 };

function compareRows(a, b) {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.stat.localeCompare(b.stat) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

function renderList() {
  state.visible = applyFilters();

  const rowCount = state.visible.reduce((sum, entry) => sum + entry.rows.length, 0);
  const total = state.fixtures.reduce((sum, fixture) => sum + fixture.rows.length, 0);
  const unmapped = state.fixtures.reduce((sum, fixture) => sum + fixture.unmappedCount, 0);
  const counts = { mx: 0, both: 0, sb: 0 };

  for (const fixture of state.fixtures) {
    for (const row of fixture.rows) {
      if (row.status === "mx") {
        counts.mx += 1;
      } else if (row.status === "both") {
        counts.both += 1;
      } else {
        counts.sb += 1;
      }
    }
  }

  elements.summary.textContent = state.fixtures.length
    ? [
        `Mecevi: ${state.fixtures.length}`,
        `uparena trzista: ${counts.both}`,
        `samo Merkur: ${counts.mx}`,
        `samo Superbet: ${counts.sb}`,
        `nemapirano (kombinacije i sl.): ${unmapped}`,
        state.unpaired.length ? `Merkur mecevi bez Superbet para: ${state.unpaired.map((f) => `${f.home} - ${f.away}`).join(", ")}` : ""
      ].filter(Boolean).join(" / ")
    : "Nema podataka";

  elements.resultStatus.textContent = rowCount ? `${rowCount} od ${total} trzista` : "Nema rezultata";
  elements.copyButton.disabled = !rowCount;
  elements.downloadButton.disabled = !rowCount;

  if (!state.fixtures.length) {
    renderEmpty("Nema meceva u Merkur specijalima");
    return;
  }

  if (!state.visible.length) {
    renderEmpty("Nema trzista za zadate filtere");
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of state.visible) {
    fragment.append(createFixtureSection(entry));
  }

  elements.list.replaceChildren(fragment);
}

function renderEmpty(message) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.innerHTML = `<span class="empty-icon">--</span>`;
  const text = document.createElement("span");
  text.textContent = message;
  wrapper.append(text);
  elements.list.replaceChildren(wrapper);
}

function createFixtureSection({ fixture, rows }) {
  const section = document.createElement("section");
  section.className = "missing-group";

  const head = document.createElement("div");
  head.className = "missing-group-head";

  const title = document.createElement("h3");
  title.className = "missing-group-title";
  title.textContent = `${timeFmt.format(new Date(fixture.kickoffMs))}  ${fixture.matchName}`;

  if (fixture.competition) {
    title.title = `${fixture.competition} (Merkur: ${fixture.merkurName})`;
  }

  const count = document.createElement("span");
  count.className = "missing-group-count";
  count.textContent = String(rows.length);

  head.append(title, count);
  section.append(head);

  if (fixture.error) {
    const note = document.createElement("p");
    note.className = "fantasy-note";
    note.textContent = `Superbet trzista nisu ucitana: ${fixture.error}`;
    section.append(note);
  }

  if (rows.length) {
    section.append(createTable(rows, fixture));
  }

  return section;
}

function createTable(rows, fixture) {
  const table = document.createElement("table");
  table.className = "missing-table";
  table.innerHTML = `<thead><tr><th>Trziste</th><th>Linija</th><th>Merkur</th><th>Superbet</th><th>Razlika</th></tr></thead>`;

  const body = document.createElement("tbody");

  for (const row of rows) {
    const tr = document.createElement("tr");
    const { title, detail } = describeMarket(row, fixture);

    const market = document.createElement("td");
    market.className = "missing-match";
    market.textContent = title;

    if (detail) {
      const small = document.createElement("div");
      small.className = "missing-time";
      small.textContent = detail;
      market.append(small);
    }

    const line = document.createElement("td");
    line.textContent = row.line === null ? "" : String(row.line);

    // Merkur quotes a line Superbet does not have, while Superbet does price this market: the line moved.
    if (row.status === "mx" && row.sbLines.length) {
      line.textContent = `⚠ ${line.textContent}`;
      line.classList.add("delta-bad");
      line.title = `Linija nije na Superbetu (Superbet: ${row.sbLines.join(", ")})`;
    }

    const merkur = document.createElement("td");
    merkur.textContent = row.mx ? formatOutcomes(row.mx) : "nema";

    const superbet = document.createElement("td");
    superbet.textContent = row.sb ? formatOutcomes(row.sb) : row.sbLines.length ? `druge linije: ${row.sbLines.join(", ")}` : "nema";

    const delta = document.createElement("td");

    deltaParts(row).forEach((part, index) => {
      const span = document.createElement("span");
      span.textContent = index ? `  ${part.text}` : part.text;
      span.className = part.tone ? `delta-${part.tone}` : "";
      delta.append(span);
    });

    if (row.status === "mx") {
      delta.textContent = "samo Merkur";
    } else if (row.status !== "both") {
      delta.textContent = row.status === "sb-line" ? "druga linija" : "samo Superbet";
    }

    tr.append(market, line, merkur, superbet, delta);
    body.append(tr);
  }

  table.append(body);
  return table;
}

function outcomeRank(key) {
  if (key === "over") {
    return -2;
  }

  if (key === "under") {
    return -1;
  }

  // Range labels ("0-2", "3-4", "7+") sort by their lower bound.
  return parseFloat(key) || 0;
}

function formatOutcomes(outcomes) {
  // The books list outcomes in different orders; a fixed order keeps columns comparable.
  const entries = Object.entries(outcomes).sort((a, b) => outcomeRank(a[0]) - outcomeRank(b[0]));

  if (entries.length === 1 && entries[0][0] === "yes") {
    return entries[0][1].toFixed(2);
  }

  return entries.map(([key, price]) => `${OUTCOME_LABELS[key] ?? key} ${price.toFixed(2)}`.trim()).join("  ");
}

function formatDelta(row) {
  return deltaParts(row).map((part) => part.text).join("  ");
}

// `tone` is "good" where Merkur pays less than Superbet, "bad" where it pays more.
function deltaParts(row) {
  if (row.status !== "both") {
    return [];
  }

  const parts = [];

  for (const [key, mxPrice] of Object.entries(row.mx)) {
    const sbPrice = row.sb[key];

    if (sbPrice === undefined) {
      continue;
    }

    const delta = outcomeDelta(mxPrice, sbPrice);
    const label = OUTCOME_LABELS[key] ?? key;
    parts.push({
      text: `${label} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`.trim(),
      tone: delta >= 0.05 ? "good" : delta <= -0.05 ? "bad" : ""
    });
  }

  return parts;
}

// ---- Export ----------------------------------------------------------------

function exportLines() {
  const lines = [["Mec", "Trziste", "Linija", "Status", "Merkur", "Superbet", "Razlika"].join("\t")];

  for (const { fixture, rows } of state.visible) {
    for (const row of rows) {
      const { title } = describeMarket(row, fixture);
      const status = { both: "uparen", mx: "samo Merkur", sb: "samo Superbet", "sb-line": "druga linija" }[row.status];

      lines.push([
        fixture.matchName,
        title,
        row.line ?? "",
        status,
        row.mx ? formatOutcomes(row.mx) : "",
        row.sb ? formatOutcomes(row.sb) : "",
        formatDelta(row)
      ].join("\t"));
    }
  }

  return lines.join("\n");
}

async function copyTsv() {
  try {
    await navigator.clipboard.writeText(exportLines());
    elements.resultStatus.textContent = "Kopirano";
  } catch (error) {
    console.error(error);
    elements.resultStatus.textContent = "Kopiranje nije uspelo";
  }
}

function downloadTsv() {
  const blob = new Blob([exportLines()], { type: "text/tab-separated-values;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `specijali-razlike-${new Date().toISOString().slice(0, 10)}.tsv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
