import { loadHandballPlayerLines } from "./supersport_api.js";
import { CSV_COLUMNS, makeCsvFilename, toAsciiMarketName } from "./csv.js";
import { HANDBALL_PLAYER_TEAMS } from "./handball_player_teams.js";

// Player -> team links learned from "+ Dom" / "+ Gost" clicks, on top of the
// static table. Stored as { normalizedPlayer: [player, team] }.
const LEARNED_TEAMS_KEY = "superfetch.handballPlayerTeams";

// Lines typed in by hand, for fixtures SuperSport prices no players for (or
// does not list at all). Stored as { fixtureId: { fixture, rows } }, with the
// fixture's own fields kept so it still shows if it drops out of the feed.
const MANUAL_KEY = "superfetch.handballManual";
const SHOW_ALL_KEY = "superfetch.handballShowAll";
// A manual entry outlives its fixture by this much, then is pruned on load.
const MANUAL_EXPIRY_MS = 12 * 60 * 60 * 1000;
const MANUAL_MARKET = { marketId: "1098", marketName: "zbroj golova igrača" };

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
  clearTeamsButton: document.querySelector("#clear-teams-button"),
  showAll: document.querySelector("#show-all-fixtures"),
  search: document.querySelector("#fixture-search"),
  manualFixtureForm: document.querySelector("#manual-fixture-form"),
  manualHome: document.querySelector("#manual-home"),
  manualAway: document.querySelector("#manual-away"),
  manualStart: document.querySelector("#manual-start"),
  teamOptions: document.querySelector("#team-options")
};

const staticTeams = HANDBALL_PLAYER_TEAMS.map(([player, team]) => ({ player, team, words: nameWords(player) }));
const learnedTeams = loadLearnedTeams();
const manual = loadManual();

const state = {
  fixtures: [],
  selectedFixtureId: null,
  // `${fixtureId}|${lineId}` -> "home" | "away"
  added: new Map(),
  // `${fixtureId}|${feed player name}` -> edited display name
  nameOverrides: new Map(),
  showAll: loadShowAll(),
  // Normalized words typed into the fixture search; every one must match.
  searchWords: [],
  // Odds the manual form starts with: the last ones entered.
  manualOdds: { under: "1.85", over: "1.85" },
  // Set after a manual add so the re-rendered form gets focus back.
  focusManualPlayer: false,
  // Bumped per load so a slow, superseded response cannot overwrite a newer one.
  requestId: 0,
  totalFixtures: 0
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

// The browser may restore the field's text on reload, so read it once now.
state.searchWords = nameWords(els.search.value);
els.search.addEventListener("input", () => {
  state.searchWords = nameWords(els.search.value);
  renderFixtures();
});
els.showAll.checked = state.showAll;
els.showAll.addEventListener("change", () => {
  state.showAll = els.showAll.checked;
  try { localStorage.setItem(SHOW_ALL_KEY, state.showAll ? "1" : ""); } catch { /* per-viewer nicety */ }
  renderFixtures();
});
els.manualFixtureForm.addEventListener("submit", addManualFixture);

// Manual rows remember their side, so a reload puts them back in the CSV.
for (const { fixture, rows } of manual.values()) {
  for (const row of rows) {
    if (row.side) state.added.set(lineKey(fixture.fixtureId, row.lineId), row.side);
  }
}

renderTeamOptions();
renderTeamsStatus();
loadOffer();

async function loadOffer() {
  const requestId = ++state.requestId;
  setStatus("Učitavanje SuperSport ponude…");
  els.eventsStatus.textContent = "Učitavanje…";
  els.refreshButton.disabled = true;

  try {
    const { fixtures, totalFixtures, missingTournaments } = await loadHandballPlayerLines();
    if (requestId !== state.requestId) return;

    state.fixtures = fixtures;
    state.totalFixtures = totalFixtures;
    // Selections whose line has left the offer cannot be exported any more.
    const all = allFixtures();
    const liveKeys = new Set(all.flatMap((f) => rowsFor(f).map((p) => lineKey(f.fixtureId, p.lineId))));
    for (const key of state.added.keys()) {
      if (!liveKeys.has(key)) state.added.delete(key);
    }
    if (!all.some((f) => f.fixtureId === state.selectedFixtureId)) {
      state.selectedFixtureId = all.find(hasLines)?.fixtureId ?? null;
    }

    const lineCount = fixtures.reduce((sum, f) => sum + f.players.length, 0);
    const gap = missingTournaments ? ` · ${missingTournaments} turnira nije odgovorilo, osvježi` : "";
    setStatus(`${totalFixtures} mečeva, ${lineCount} granica igrača${gap}`, Boolean(missingTournaments));
    els.eventsStatus.textContent = `${all.filter(hasLines).length} s igračima`;
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
  const searching = state.searchWords.length > 0;
  const fixtures = allFixtures().filter(matchesSearch);
  const withLines = fixtures.filter(hasLines);
  const withoutLines = fixtures.filter((f) => !hasLines(f));

  // The toggle alone decides whether fixtures without players show; a search
  // only narrows whatever is shown.
  if (searching && !withLines.length && !(state.showAll && withoutLines.length)) {
    els.fixtureList.append(emptyState("Nijedan meč ne odgovara pretrazi"));
    return;
  }
  if (!withLines.length && !searching) {
    els.fixtureList.append(emptyState("Trenutno nema mečeva s granicama igrača"));
  }
  appendFixtureRows(withLines);

  if (withoutLines.length && state.showAll) {
    const heading = document.createElement("div");
    heading.className = "daily-competition-category handball-section-head";
    heading.textContent = `Bez igrača u ponudi (${withoutLines.length}) — ručni unos`;
    els.fixtureList.append(heading);
    appendFixtureRows(withoutLines);
  } else if (state.showAll && state.totalFixtures > state.fixtures.length) {
    // A Worker deployed before fixtures without players were kept still
    // drops them, though it counts them in totalFixtures.
    const note = document.createElement("p");
    note.className = "fantasy-note";
    note.textContent = `SuperSport ima ${state.totalFixtures} mečeva, ali server šalje samo one s igračima — ` +
      "Cloudflare Worker treba ponovo deployati (wrangler deploy).";
    els.fixtureList.append(note);
  }
}

function matchesSearch(fixture) {
  if (!state.searchWords.length) return true;
  const haystack = nameWords(
    `${fixture.home} ${fixture.away} ${fixture.categoryName} ${fixture.tournamentName}`
  );
  // Prefix match per word, so "magd" finds Magdeburg.
  return state.searchWords.every((word) => haystack.some((h) => h.startsWith(word)));
}

function appendFixtureRows(fixtures) {
  let lastGroup = "";
  for (const fixture of fixtures) {
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

    const rows = rowsFor(fixture);
    const manualCount = rows.filter((p) => p.manual).length;
    const addedCount = rows.filter((p) => state.added.has(lineKey(fixture.fixtureId, p.lineId))).length;
    const meta = document.createElement("span");
    meta.className = "daily-event-meta";
    const { date, time } = formatKickoff(fixture.startsAt);
    meta.textContent = [
      `${date} ${time}`,
      `${rows.length} igrača`,
      manualCount ? `${manualCount} ručno` : "",
      addedCount ? `${addedCount} dodano` : ""
    ].filter(Boolean).join(" · ");

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

  const rows = rowsFor(fixture);
  const knownPending = rows.filter((row) =>
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
      const side = knownSide(fixture, row);
      state.added.set(lineKey(fixture.fixtureId, row.lineId), side);
      if (row.manual) row.side = side;
    }
    saveManual();
    renderPlayers();
    renderFixtures();
    renderCsv();
  });
  const knownCount = rows.filter((row) => knownSide(fixture, row)).length;
  const knownNote = document.createElement("span");
  knownNote.className = "csv-status-text";
  knownNote.textContent = `Tim poznat za ${knownCount} od ${rows.length} igrača`;
  toolbar.append(addKnownButton, knownNote);
  if (fixture.manual) {
    const removeFixtureButton = document.createElement("button");
    removeFixtureButton.type = "button";
    removeFixtureButton.className = "action-btn action-btn--danger";
    removeFixtureButton.textContent = "Obriši meč";
    removeFixtureButton.addEventListener("click", () => {
      if (!confirm(`Obrisati ručni meč ${fixture.home} - ${fixture.away} i njegove igrače?`)) return;
      removeManualFixture(fixture);
    });
    toolbar.append(removeFixtureButton);
  }

  const manualForm = renderManualForm(fixture, rows);
  if (!rows.length) {
    els.tableWrap.replaceChildren(
      toolbar,
      emptyState(fixture.manual ? "Ručni meč — unesi igrače ispod" : "SuperSport nema igrače za ovaj meč — unesi ih ispod"),
      manualForm
    );
    focusManualForm(manualForm);
    return;
  }

  const table = document.createElement("table");
  table.className = "daily-table";
  table.innerHTML = `
    <thead>
      <tr><th>Igrač</th><th>GR</th><th>Manje</th><th>Više</th><th>Dodaj</th></tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  for (const row of rows) {
    const key = lineKey(fixture.fixtureId, row.lineId);
    const team = state.added.get(key);
    const tr = document.createElement("tr");
    if (!team) tr.classList.add("is-muted");

    const nameCell = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.className = "daily-team-input";
    nameInput.value = displayName(fixture, row);
    nameInput.title = row.manual ? "Ručno uneseno" : row.marketName;
    nameInput.addEventListener("input", () => {
      // A manual row owns its name; a feed row keeps the feed's as fallback.
      if (row.manual) {
        row.player = nameInput.value;
        saveManual();
      } else {
        state.nameOverrides.set(nameKey(fixture, row), nameInput.value);
      }
      if (state.added.has(key)) renderCsv();
    });
    nameCell.append(nameInput);
    if (row.manual) {
      const badge = document.createElement("span");
      badge.className = "handball-manual-badge";
      badge.textContent = "ručno";
      nameCell.append(badge);
    }

    const actions = document.createElement("td");
    actions.className = "handball-team-actions";
    const suggested = knownSide(fixture, row);
    actions.append(
      teamButton(fixture, row, "home", `+ Dom (${fixture.home})`, team, suggested),
      teamButton(fixture, row, "away", `+ Gost (${fixture.away})`, team, suggested)
    );

    if (row.manual) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "action-btn action-btn--danger handball-team-btn";
      removeButton.textContent = "✕";
      removeButton.title = "Obriši ručni unos";
      removeButton.addEventListener("click", () => removeManualRow(fixture, row));
      actions.append(removeButton);
      tr.append(
        nameCell,
        manualValueCell(row, "line", key, parseLine),
        manualValueCell(row, "under", key, parseOdd),
        manualValueCell(row, "over", key, parseOdd),
        actions
      );
    } else {
      tr.append(nameCell, cell(row.line), cell(row.under.toFixed(2)), cell(row.over.toFixed(2)), actions);
    }
    tbody.append(tr);
  }

  table.append(tbody);
  els.tableWrap.replaceChildren(toolbar, table, manualForm);
  focusManualForm(manualForm);
}

// An editable line/odds cell of a manual row. An invalid value is flagged and
// not saved, so the CSV keeps the last good one.
function manualValueCell(row, field, key, parse) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.className = "daily-odds-edit";
  input.inputMode = "decimal";
  input.value = field === "line" ? row.line : row[field].toFixed(2);
  input.addEventListener("input", () => {
    const value = parse(input.value);
    input.classList.toggle("is-invalid", value === null);
    if (value === null) return;
    row[field] = value;
    saveManual();
    if (state.added.has(key)) renderCsv();
  });
  td.append(input);
  return td;
}

// The manual entry form under the table: roster chips for both teams, then
// player / team / line / odds.
function renderManualForm(fixture, rows) {
  const wrap = document.createElement("div");
  wrap.className = "handball-manual";

  const head = document.createElement("div");
  head.className = "eyebrow";
  head.textContent = "Ručni unos igrača";
  wrap.append(head);

  const form = document.createElement("form");
  form.className = "handball-manual-form";

  const listId = `roster-${fixture.fixtureId}`;
  const datalist = document.createElement("datalist");
  datalist.id = listId;

  const playerInput = document.createElement("input");
  playerInput.className = "daily-team-input handball-manual-player";
  playerInput.placeholder = "Igrač";
  playerInput.setAttribute("list", listId);
  playerInput.required = true;

  const sideSelect = document.createElement("select");
  sideSelect.className = "daily-team-input";
  for (const [value, label] of [["home", `Dom (${fixture.home})`], ["away", `Gost (${fixture.away})`]]) {
    sideSelect.append(new Option(label, value));
  }

  const lineInput = manualInput("GR", "");
  const underInput = manualInput("Manje", state.manualOdds.under);
  const overInput = manualInput("Više", state.manualOdds.over);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "action-btn action-btn--primary";
  submit.textContent = "+ Dodaj";

  // Picking a known player sets the side - the same lookup the "+ Dom" /
  // "+ Gost" highlight uses.
  playerInput.addEventListener("input", () => {
    const side = knownSide(fixture, { player: playerInput.value });
    if (side) sideSelect.value = side;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const player = playerInput.value.trim();
    const line = parseLine(lineInput.value);
    const under = parseOdd(underInput.value);
    const over = parseOdd(overInput.value);
    lineInput.classList.toggle("is-invalid", line === null);
    underInput.classList.toggle("is-invalid", under === null);
    overInput.classList.toggle("is-invalid", over === null);
    if (!player || line === null || under === null || over === null) return;

    state.manualOdds = { under: underInput.value, over: overInput.value };
    addManualRow(fixture, { player, line, under, over, side: sideSelect.value });
  });

  form.append(playerInput, sideSelect, lineInput, underInput, overInput, submit, datalist);

  // Roster players of both teams not already listed for this fixture.
  const taken = new Set(rows.map((row) => playerKey(displayName(fixture, row))));
  const roster = rosterFor(fixture).filter((entry) => !taken.has(playerKey(entry.player)));
  for (const entry of roster) datalist.append(new Option(entry.player));

  const chips = document.createElement("div");
  chips.className = "handball-roster";
  for (const side of ["home", "away"]) {
    const sidePlayers = roster.filter((entry) => entry.side === side);
    const group = document.createElement("div");
    group.className = "handball-roster-group";
    const label = document.createElement("span");
    label.className = "csv-status-text";
    label.textContent = `${side === "home" ? fixture.home : fixture.away}:`;
    group.append(label);
    if (!sidePlayers.length) {
      const none = document.createElement("span");
      none.className = "csv-status-text";
      none.textContent = "nema igrača u rosteru";
      group.append(none);
    }
    for (const entry of sidePlayers) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "handball-roster-chip";
      chip.textContent = entry.player;
      chip.addEventListener("click", () => {
        playerInput.value = entry.player;
        sideSelect.value = side;
        lineInput.focus();
      });
      group.append(chip);
    }
    chips.append(group);
  }

  wrap.append(chips, form);
  return wrap;
}

function manualInput(placeholder, value) {
  const input = document.createElement("input");
  input.className = "daily-odds-edit";
  input.placeholder = placeholder;
  input.title = placeholder;
  input.inputMode = "decimal";
  input.value = value;
  return input;
}

function focusManualForm(form) {
  if (!state.focusManualPlayer) return;
  state.focusManualPlayer = false;
  form.querySelector(".handball-manual-player")?.focus();
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
    if (row.manual) {
      row.side = state.added.get(key) ?? null;
      saveManual();
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

  for (const fixture of allFixtures()) {
    for (const side of ["home", "away"]) {
      const rows = rowsFor(fixture).filter((p) => state.added.get(lineKey(fixture.fixtureId, p.lineId)) === side);
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
  return allFixtures().find((f) => f.fixtureId === state.selectedFixtureId) ?? null;
}

// Feed fixtures, plus stored manual entries the feed no longer (or never)
// lists - user-made fixtures, or one that dropped out with lines typed in.
function allFixtures() {
  const feedIds = new Set(state.fixtures.map((f) => f.fixtureId));
  const extra = [...manual.values()]
    .filter((entry) => !feedIds.has(entry.fixture.fixtureId))
    .map((entry) => ({ ...entry.fixture, players: [] }));
  if (!extra.length) return state.fixtures;
  return [...state.fixtures, ...extra]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.home.localeCompare(b.home));
}

function rowsFor(fixture) {
  return [...fixture.players, ...(manual.get(fixture.fixtureId)?.rows ?? [])];
}

function hasLines(fixture) {
  return fixture.manual || rowsFor(fixture).length > 0;
}

// Roster players of the fixture's two teams, learned links first so they win.
function rosterFor(fixture) {
  const byKey = new Map();
  const entries = [
    ...[...learnedTeams.values()].map(([player, team]) => ({ player, team })),
    ...staticTeams
  ];
  for (const { player, team } of entries) {
    const key = playerKey(player);
    if (byKey.has(key)) continue;
    const side = teamMatches(team, fixture.home) ? "home" : teamMatches(team, fixture.away) ? "away" : null;
    if (side) byKey.set(key, { player, side });
  }
  return [...byKey.values()].sort((a, b) => a.player.localeCompare(b.player));
}

function addManualRow(fixture, { player, line, under, over, side }) {
  const entry = manualEntry(fixture);
  const row = {
    ...MANUAL_MARKET,
    lineId: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    manual: true,
    player,
    line,
    under,
    over,
    side
  };
  entry.rows.push(row);
  state.added.set(lineKey(fixture.fixtureId, row.lineId), side);
  learnTeam(player, side === "home" ? fixture.home : fixture.away);
  saveManual();
  state.focusManualPlayer = true;
  renderPlayers();
  renderFixtures();
  renderCsv();
}

function removeManualRow(fixture, row) {
  const entry = manual.get(fixture.fixtureId);
  if (!entry) return;
  entry.rows = entry.rows.filter((r) => r !== row);
  state.added.delete(lineKey(fixture.fixtureId, row.lineId));
  saveManual();
  renderPlayers();
  renderFixtures();
  renderCsv();
}

function manualEntry(fixture) {
  let entry = manual.get(fixture.fixtureId);
  if (!entry) {
    const { players, ...meta } = fixture;
    entry = { fixture: meta, rows: [] };
    manual.set(fixture.fixtureId, entry);
  }
  return entry;
}

function addManualFixture(event) {
  event.preventDefault();
  const home = els.manualHome.value.trim();
  const away = els.manualAway.value.trim();
  const start = new Date(els.manualStart.value);
  if (!home || !away || Number.isNaN(start.getTime())) return;

  const fixture = {
    fixtureId: `manual-${Date.now().toString(36)}`,
    home,
    away,
    startsAt: start.toISOString(),
    categoryName: "Ručno",
    tournamentName: "Mečevi kojih nema na SuperSportu",
    manual: true,
    players: []
  };
  manualEntry(fixture);
  saveManual();
  els.manualFixtureForm.reset();
  state.selectedFixtureId = fixture.fixtureId;
  state.focusManualPlayer = true;
  renderFixtures();
  renderPlayers();
}

function removeManualFixture(fixture) {
  const entry = manual.get(fixture.fixtureId);
  for (const row of entry?.rows ?? []) state.added.delete(lineKey(fixture.fixtureId, row.lineId));
  manual.delete(fixture.fixtureId);
  saveManual();
  state.selectedFixtureId = allFixtures().find(hasLines)?.fixtureId ?? null;
  renderFixtures();
  renderPlayers();
  renderCsv();
}

// Drops entries whose fixture started more than MANUAL_EXPIRY_MS ago. Pruned
// by time rather than by absence from the feed, so a tournament that failed
// to load (or a fixture SuperSport never listed) cannot cost typed-in lines.
function loadManual() {
  try {
    const stored = JSON.parse(localStorage.getItem(MANUAL_KEY) ?? "{}");
    const cutoff = Date.now() - MANUAL_EXPIRY_MS;
    return new Map(Object.values(stored)
      .filter((entry) => entry?.fixture && !(new Date(entry.fixture.startsAt).getTime() < cutoff))
      .map((entry) => [entry.fixture.fixtureId, entry]));
  } catch {
    return new Map();
  }
}

// A feed fixture whose last manual row was removed leaves nothing to keep.
function saveManual() {
  for (const [id, entry] of manual) {
    if (!entry.rows.length && !entry.fixture.manual) manual.delete(id);
  }
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(Object.fromEntries(manual)));
  } catch (error) {
    console.warn("Ručni unosi nisu sačuvani", error);
  }
}

function loadShowAll() {
  try {
    return Boolean(localStorage.getItem(SHOW_ALL_KEY));
  } catch {
    return false;
  }
}

// Team names for the manual fixture form, from the roster and learned links.
function renderTeamOptions() {
  const teams = new Set([...staticTeams.map((e) => e.team), ...[...learnedTeams.values()].map(([, team]) => team)]);
  els.teamOptions.replaceChildren(...[...teams].sort().map((team) => new Option(team)));
}

// "5,5" -> "5.5"; null when not a number.
function parseLine(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? String(Number(text)) : null;
}

function parseOdd(value) {
  const number = Number(String(value ?? "").trim().replace(",", "."));
  return number > 1 ? number : null;
}

function lineKey(fixtureId, lineId) {
  return `${fixtureId}|${lineId}`;
}

function nameKey(fixture, row) {
  return `${fixture.fixtureId}|${row.player}`;
}

function displayName(fixture, row) {
  if (row.manual) return row.player;
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
