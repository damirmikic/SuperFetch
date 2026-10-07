import { fetchSupersportHandballPlayerLines } from "./supersport_api.js";
import { CSV_COLUMNS, makeCsvFilename, toAsciiMarketName } from "./csv.js";
import { HANDBALL_PLAYER_TEAMS } from "./handball_player_teams.js";

// Player -> team links learned from "+ Dom" / "+ Gost" clicks, on top of the
// static table. Stored as { normalizedPlayer: [player, team] }.
const LEARNED_TEAMS_KEY = "superfetch.handballPlayerTeams";

// CSV layout: one MATCH_NAME header for the whole file, LEAGUE_NAME per team,
// and each row carries the player in "Domacin" and the market in "Gost".
const CSV_MATCH_NAME = "golovi igraca";

// The label that goes into the CSV "Gost" column, per SuperSport market id.
// Any other player over/under market falls back to its ASCII-folded feed name.
const MARKET_LABELS = {
  "1098": "broj golova"
};

const els = {
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  fixtureList: document.querySelector("#fixture-list"),
  playersTitle: document.querySelector("#players-title"),
  datetime: document.querySelector("#datetime-display"),
  tableWrap: document.querySelector("#players-table-wrap"),
  csvOutput: document.querySelector("#csv-output"),
  csvStatus: document.querySelector("#csv-status"),
  copyButton: document.querySelector("#copy-csv-button"),
  downloadButton: document.querySelector("#download-csv-button"),
  clearButton: document.querySelector("#clear-csv-button"),
  teamsStatus: document.querySelector("#teams-status"),
  exportTeamsButton: document.querySelector("#export-teams-button"),
  clearTeamsButton: document.querySelector("#clear-teams-button")
};

const staticTeams = HANDBALL_PLAYER_TEAMS.map(([player, team]) => ({ player, team, words: nameWords(player) }));
const learnedTeams = loadLearnedTeams();

const state = {
  fixtures: [],
  selectedFixtureId: null,
  // `${fixtureId}|${lineId}` -> "home" | "away"
  added: new Map(),
  // `${fixtureId}|${feed player name}` -> edited display name
  nameOverrides: new Map(),
  // Bumped per load so a slow, superseded response cannot overwrite a newer one.
  requestId: 0
};

const dateFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false
});

els.refreshButton.addEventListener("click", () => loadOffer());
els.copyButton.addEventListener("click", copyCsv);
els.downloadButton.addEventListener("click", downloadCsv);
els.clearButton.addEventListener("click", () => {
  state.added.clear();
  renderPlayers();
  renderCsv();
});
els.exportTeamsButton.addEventListener("click", exportLearnedTeams);
els.clearTeamsButton.addEventListener("click", () => {
  if (!confirm("Obrisati sve naučene veze igrač–tim? Veze iz fajla ostaju.")) return;
  learnedTeams.clear();
  saveLearnedTeams();
  renderPlayers();
});

renderTeamsStatus();
loadOffer();

async function loadOffer() {
  const requestId = ++state.requestId;
  setStatus("Učitavanje SuperSport ponude…");
  els.eventsStatus.textContent = "Učitavanje…";
  els.refreshButton.disabled = true;

  try {
    const { fixtures, totalFixtures, missingTournaments } = await fetchSupersportHandballPlayerLines();
    if (requestId !== state.requestId) return;

    state.fixtures = fixtures;
    // Selections whose line has left the offer cannot be exported any more.
    const liveKeys = new Set(fixtures.flatMap((f) => f.players.map((p) => lineKey(f.fixtureId, p.lineId))));
    for (const key of state.added.keys()) {
      if (!liveKeys.has(key)) state.added.delete(key);
    }
    if (!fixtures.some((f) => f.fixtureId === state.selectedFixtureId)) {
      state.selectedFixtureId = fixtures[0]?.fixtureId ?? null;
    }

    const lineCount = fixtures.reduce((sum, f) => sum + f.players.length, 0);
    const gap = missingTournaments ? ` · ${missingTournaments} turnira nije odgovorilo, osvježi` : "";
    setStatus(`${totalFixtures} mečeva, ${lineCount} granica igrača${gap}`, Boolean(missingTournaments));
    els.eventsStatus.textContent = `${fixtures.length} s igračima`;
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.error(error);
    setStatus(error.message || "Greška pri učitavanju", true);
    els.eventsStatus.textContent = "Greška";
  } finally {
    if (requestId === state.requestId) els.refreshButton.disabled = false;
  }

  renderFixtures();
  renderPlayers();
  renderCsv();
}

function renderFixtures() {
  els.fixtureList.replaceChildren();

  if (!state.fixtures.length) {
    els.fixtureList.append(emptyState("Trenutno nema mečeva s granicama igrača"));
    return;
  }

  let lastGroup = "";
  for (const fixture of state.fixtures) {
    const group = `${fixture.categoryName} · ${fixture.tournamentName}`;
    if (group !== lastGroup) {
      lastGroup = group;
      const heading = document.createElement("div");
      heading.className = "daily-competition-category";
      heading.textContent = group;
      els.fixtureList.append(heading);
    }

    const row = document.createElement("label");
    row.className = "daily-event-row";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "fixture";
    radio.checked = fixture.fixtureId === state.selectedFixtureId;
    radio.addEventListener("change", () => {
      state.selectedFixtureId = fixture.fixtureId;
      renderPlayers();
    });

    const main = document.createElement("span");
    main.className = "daily-event-main";
    main.textContent = `${fixture.home} - ${fixture.away}`;

    const addedCount = fixture.players.filter((p) => state.added.has(lineKey(fixture.fixtureId, p.lineId))).length;
    const meta = document.createElement("span");
    meta.className = "daily-event-meta";
    const { date, time } = formatKickoff(fixture.startsAt);
    meta.textContent = `${date} ${time} · ${fixture.players.length} igrača${addedCount ? ` · ${addedCount} dodano` : ""}`;

    row.append(radio, main, meta);
    els.fixtureList.append(row);
  }
}

function renderPlayers() {
  const fixture = selectedFixture();

  if (!fixture) {
    els.playersTitle.textContent = "Odaberi meč";
    els.datetime.textContent = "";
    els.tableWrap.replaceChildren(emptyState("Odaberi meč lijevo"));
    return;
  }

  els.playersTitle.textContent = `${fixture.home} - ${fixture.away}`;
  const { date, time } = formatKickoff(fixture.startsAt);
  els.datetime.textContent = `${date} ${time}`;

  const knownPending = fixture.players.filter((row) =>
    knownSide(fixture, row) && !state.added.has(lineKey(fixture.fixtureId, row.lineId)));
  const toolbar = document.createElement("div");
  toolbar.className = "daily-csv-actions handball-toolbar";
  const addKnownButton = document.createElement("button");
  addKnownButton.type = "button";
  addKnownButton.className = "action-btn action-btn--secondary";
  addKnownButton.textContent = `Dodaj poznate (${knownPending.length})`;
  addKnownButton.disabled = !knownPending.length;
  addKnownButton.title = "Dodaje sve igrače čiji je tim poznat iz fajla ili ranijih klikova";
  addKnownButton.addEventListener("click", () => {
    for (const row of knownPending) {
      state.added.set(lineKey(fixture.fixtureId, row.lineId), knownSide(fixture, row));
    }
    renderPlayers();
    renderFixtures();
    renderCsv();
  });
  const knownCount = fixture.players.filter((row) => knownSide(fixture, row)).length;
  const knownNote = document.createElement("span");
  knownNote.className = "csv-status-text";
  knownNote.textContent = `Tim poznat za ${knownCount} od ${fixture.players.length} igrača`;
  toolbar.append(addKnownButton, knownNote);

  const table = document.createElement("table");
  table.className = "daily-table";
  table.innerHTML = `
    <thead>
      <tr><th>Igrač</th><th>GR</th><th>Manje</th><th>Više</th><th>Dodaj</th></tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  for (const row of fixture.players) {
    const key = lineKey(fixture.fixtureId, row.lineId);
    const team = state.added.get(key);
    const tr = document.createElement("tr");
    if (!team) tr.classList.add("is-muted");

    const nameCell = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.className = "daily-team-input";
    nameInput.value = displayName(fixture, row);
    nameInput.title = row.marketName;
    nameInput.addEventListener("input", () => {
      state.nameOverrides.set(nameKey(fixture, row), nameInput.value);
      if (state.added.has(key)) renderCsv();
    });
    nameCell.append(nameInput);

    const actions = document.createElement("td");
    actions.className = "handball-team-actions";
    const suggested = knownSide(fixture, row);
    actions.append(
      teamButton(fixture, row, "home", `+ Dom (${fixture.home})`, team, suggested),
      teamButton(fixture, row, "away", `+ Gost (${fixture.away})`, team, suggested)
    );

    tr.append(nameCell, cell(row.line), cell(row.under.toFixed(2)), cell(row.over.toFixed(2)), actions);
    tbody.append(tr);
  }

  table.append(tbody);
  els.tableWrap.replaceChildren(toolbar, table);
}

function teamButton(fixture, row, side, label, currentTeam, suggestedSide) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-btn action-btn--secondary handball-team-btn";
  button.textContent = label;
  button.classList.toggle("is-added", currentTeam === side);
  button.classList.toggle("is-suggested", !currentTeam && suggestedSide === side);
  if (!currentTeam && suggestedSide === side) button.title = "Poznat tim igrača";
  button.addEventListener("click", () => {
    const key = lineKey(fixture.fixtureId, row.lineId);
    // Clicking the active side removes the row; the other side moves it.
    if (state.added.get(key) === side) {
      state.added.delete(key);
    } else {
      state.added.set(key, side);
      learnTeam(row.player, side === "home" ? fixture.home : fixture.away);
    }
    renderPlayers();
    renderFixtures();
    renderCsv();
  });
  return button;
}

function buildCsv() {
  const lines = [];
  const teamNames = new Set();
  const fixtureNames = new Set();

  for (const fixture of state.fixtures) {
    for (const side of ["home", "away"]) {
      const rows = fixture.players.filter((p) => state.added.get(lineKey(fixture.fixtureId, p.lineId)) === side);
      if (!rows.length) continue;

      const teamName = side === "home" ? fixture.home : fixture.away;
      teamNames.add(teamName);
      fixtureNames.add(`${fixture.home} ${fixture.away}`);
      lines.push(`LEAGUE_NAME:${teamName}`);

      const { date, time } = formatKickoff(fixture.startsAt);
      for (const row of rows) {
        const player = displayName(fixture, row).trim() || row.player;
        lines.push(formatRow([
          date, time, "", player, marketLabel(row), "", "", "",
          row.line, row.under.toFixed(2), row.over.toFixed(2), "", ""
        ]));
      }
    }
  }

  if (!lines.length) return { csv: "", teamNames, fixtureNames };
  return {
    csv: [CSV_COLUMNS.join(","), `MATCH_NAME:${CSV_MATCH_NAME}`, ...lines].join("\r\n"),
    teamNames,
    fixtureNames
  };
}

function renderCsv() {
  const { csv, teamNames, fixtureNames } = buildCsv();
  const count = state.added.size;

  els.csvOutput.value = csv;
  els.csvStatus.textContent = count ? `Dodano granica: ${count}` : "Ništa nije dodano";
  for (const button of [els.copyButton, els.downloadButton, els.clearButton]) button.disabled = !csv;

  // One team gets its own filename, like the other player CSVs; both teams
  // of one match are named after the match.
  const subject = teamNames.size === 1
    ? [...teamNames][0]
    : fixtureNames.size === 1 ? [...fixtureNames][0] : "rukomet";
  els.downloadButton.dataset.filename = makeCsvFilename({}, subject);
}

async function copyCsv() {
  const csv = els.csvOutput.value;
  if (!csv) return;
  try {
    await navigator.clipboard.writeText(csv);
    els.csvStatus.textContent = "Kopirano";
  } catch {
    els.csvOutput.select();
    els.csvStatus.textContent = "Kopiranje nije uspjelo — označeno, Ctrl+C";
  }
}

function downloadCsv() {
  const csv = els.csvOutput.value;
  if (!csv) return;

  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = els.downloadButton.dataset.filename || "rukomet_odds.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The side of this fixture the player's known team is on, or null. Learned
// links win over the static table, so a click overrides a stale entry.
function knownSide(fixture, row) {
  const team = learnedTeams.get(playerKey(row.player))?.[1] ?? staticTeamFor(fixture, row.player);
  if (!team) return null;
  if (teamMatches(team, fixture.home)) return "home";
  if (teamMatches(team, fixture.away)) return "away";
  return null;
}

// Looks the player up among the two teams of this fixture only - ~40 names,
// which is what makes a loose match safe. Same words in any order wins
// outright ("Aleks Vlah" = "Vlah Aleks"); failing that, one name's words all
// inside the other's ("Gisli Kristjansson" in "Kristjansson Gisli Thorgeir"),
// but only with two or more words and only when exactly one player fits.
function staticTeamFor(fixture, player) {
  const words = nameWords(player);
  const candidates = staticTeams.filter((entry) =>
    teamMatches(entry.team, fixture.home) || teamMatches(entry.team, fixture.away));

  const exact = candidates.filter((entry) => sameWords(entry.words, words));
  if (exact.length === 1) return exact[0].team;
  if (exact.length > 1) return null;

  const partial = candidates.filter((entry) => containsWords(entry.words, words));
  return partial.length === 1 ? partial[0].team : null;
}

function sameWords(a, b) {
  return a.length === b.length && containsWords(a, b);
}

function containsWords(a, b) {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 2 && shorter.every((word) => longer.includes(word));
}

// Equal after folding, or one name's words all appear in the other, so
// "Kielce" matches "Vive Kielce" but "SC Magdeburg" never matches "Kielce".
function teamMatches(known, feedTeam) {
  const a = nameWords(known);
  const b = nameWords(feedTeam);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((word) => longer.includes(word));
}

function learnTeam(player, team) {
  const key = playerKey(player);
  if (learnedTeams.get(key)?.[1] === team) return;
  learnedTeams.set(key, [player, team]);
  saveLearnedTeams();
}

function loadLearnedTeams() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEARNED_TEAMS_KEY) ?? "{}");
    // Re-key on load so entries saved under an older key shape still resolve.
    return new Map(Object.values(stored).map(([player, team]) => [playerKey(player), [player, team]]));
  } catch {
    return new Map();
  }
}

// Order-independent identity of a player name: "Vlah Aleks" and "Aleks Vlah"
// share a key.
function playerKey(player) {
  return [...nameWords(player)].sort().join(" ");
}

function nameWords(value) {
  return normalizeName(value).split(" ").filter(Boolean);
}

function saveLearnedTeams() {
  try {
    localStorage.setItem(LEARNED_TEAMS_KEY, JSON.stringify(Object.fromEntries(learnedTeams)));
  } catch (error) {
    console.warn("Veze igrač–tim nisu sačuvane", error);
  }
  renderTeamsStatus();
}

function renderTeamsStatus() {
  els.teamsStatus.textContent = `U fajlu: ${staticTeams.length} · naučeno: ${learnedTeams.size}`;
  els.exportTeamsButton.disabled = !learnedTeams.size;
  els.clearTeamsButton.disabled = !learnedTeams.size;
}

// Emits the learned links as tuples, ASCII-folded and sorted by team, to be
// pasted into HANDBALL_PLAYER_TEAMS. An entry that corrects a static one
// replaces it there - learned links already win at runtime.
function exportLearnedTeams() {
  const entries = [...learnedTeams.values()]
    .map(([player, team]) => [toAsciiMarketName(player), toAsciiMarketName(team)])
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  const lines = [
    "// Veze igrač-tim naučene na stranici Rukomet. Zalijepi u HANDBALL_PLAYER_TEAMS",
    "// u js/handball_player_teams.js (postojeći unos za istog igrača zamijeni), pa",
    "// klikni \"Obriši naučene\".",
    ...entries.map(([player, team]) => `  [${JSON.stringify(player)}, ${JSON.stringify(team)}],`)
  ];
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "handball_player_teams_novo.js";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// NFD leaves some letters whole; fold those the way build_handball_teams.py
// does, or "Gísli Þorgeir" from one side never meets "Gisli Thorgeir".
const SPECIAL_LETTERS = { "þ": "th", "ð": "d", "æ": "ae", "ø": "o", "ł": "l", "ß": "ss", "đ": "dj" };

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[þðæøłßđ]/g, (letter) => SPECIAL_LETTERS[letter])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function selectedFixture() {
  return state.fixtures.find((f) => f.fixtureId === state.selectedFixtureId) ?? null;
}

function lineKey(fixtureId, lineId) {
  return `${fixtureId}|${lineId}`;
}

function nameKey(fixture, row) {
  return `${fixture.fixtureId}|${row.player}`;
}

function displayName(fixture, row) {
  return state.nameOverrides.get(nameKey(fixture, row)) ?? row.player;
}

function marketLabel(row) {
  return MARKET_LABELS[row.marketId] ?? toAsciiMarketName(row.marketName);
}

function formatKickoff(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const parts = dateFmt.formatToParts(parsed);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("day")}.${get("month")}.${get("year")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

function formatRow(values) {
  return CSV_COLUMNS.map((_, index) => escapeCsv(values[index] ?? "")).join(",");
}

function escapeCsv(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function emptyState(text) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const label = document.createElement("span");
  label.textContent = text;
  wrap.append(label);
  return wrap;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("is-error", isError);
}
