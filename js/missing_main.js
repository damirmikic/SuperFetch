import { fetchCompetitions, fetchAllPrematchEvents } from "./api.js";
import { fetchMerkurMatches } from "./merkur_api.js";
import { compareOffers, eventKickoffMs, suggestPartners } from "./match_matcher.js";
import { aliasPairsForSport } from "./merkur_team_names.js";
import { COMPARISON_SPORTS, DEFAULT_SPORT_KEY, findSport } from "./sports.js";

const STRICTNESS_PRESETS = {
  loose: { threshold: 0.62, label: "Labavo" },
  normal: { threshold: 0.72, label: "Normalno" },
  strict: { threshold: 0.82, label: "Strogo" }
};

const dateTimeFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// Every persisted set is namespaced by sport: a dismissed league or a club
// alias means nothing outside the sport it was recorded in.
const ALIAS_STORAGE_KEY = "superfetch.merkurAliases";
const DISMISSED_EVENTS_KEY = "superfetch.dismissedEvents";
const DISMISSED_TOURNAMENTS_KEY = "superfetch.dismissedTournaments";
// A suggestion below this is noise rather than a candidate worth showing.
const SUGGESTION_FLOOR = 0.3;

const elements = {
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  reloadButton: document.querySelector("#reload-button"),
  copyButton: document.querySelector("#copy-button"),
  downloadButton: document.querySelector("#download-button"),
  search: document.querySelector("#missing-search"),
  dateFrom: document.querySelector("#missing-date-from"),
  dateTo: document.querySelector("#missing-date-to"),
  strictness: document.querySelector("#missing-strictness"),
  onlyWithOdds: document.querySelector("#missing-only-odds"),
  summary: document.querySelector("#missing-summary"),
  resultStatus: document.querySelector("#missing-result-status"),
  list: document.querySelector("#missing-list"),
  sportTabs: document.querySelector("#sport-tabs"),
  tabMissing: document.querySelector("#tab-missing"),
  tabOrphans: document.querySelector("#tab-orphans"),
  missingPanel: document.querySelector("#missing-panel"),
  orphansPanel: document.querySelector("#orphans-panel"),
  orphansList: document.querySelector("#orphans-list"),
  aliasStatus: document.querySelector("#alias-status"),
  exportAliasesButton: document.querySelector("#export-aliases-button"),
  clearAliasesButton: document.querySelector("#clear-aliases-button"),
  showDismissed: document.querySelector("#missing-show-dismissed"),
  clearDismissedButton: document.querySelector("#clear-dismissed-button"),
  toleranceNote: document.querySelector("#tolerance-note")
};

const state = {
  // Superbet's by-date call returns every sport at once, so it is fetched once
  // and shared; only the Merkur offer and the competition tree are per sport.
  allSuperbetEvents: [],
  superbetLoaded: false,
  sportKey: DEFAULT_SPORT_KEY,
  bySport: new Map(),
  activeTab: "missing",
  loading: false
};

function storageKey(base, sportKey) {
  return `${base}.${sportKey}`;
}

function createSportState(sportKey) {
  return {
    tournamentsById: new Map(),
    merkurMatches: [],
    missing: [],
    visible: [],
    orphans: [],
    summaryBase: [],
    loaded: false,
    manualAliases: loadStoredAliases(sportKey),
    dismissedEvents: loadStoredIdSet(storageKey(DISMISSED_EVENTS_KEY, sportKey)),
    dismissedTournaments: loadStoredIdSet(storageKey(DISMISSED_TOURNAMENTS_KEY, sportKey))
  };
}

function sportState(sportKey = state.sportKey) {
  let entry = state.bySport.get(sportKey);

  if (!entry) {
    entry = createSportState(sportKey);
    state.bySport.set(sportKey, entry);
  }

  return entry;
}

function activeSport() {
  return findSport(state.sportKey);
}

/**
 * The page was single-sport before, so the first round of dismissals and
 * aliases sits under unsuffixed keys. Move them under the soccer namespace
 * once rather than silently dropping the user's work.
 */
function migrateLegacyStorage() {
  for (const base of [ALIAS_STORAGE_KEY, DISMISSED_EVENTS_KEY, DISMISSED_TOURNAMENTS_KEY]) {
    try {
      const legacy = localStorage.getItem(base);

      if (legacy === null) {
        continue;
      }

      const target = storageKey(base, "soccer");

      if (localStorage.getItem(target) === null) {
        localStorage.setItem(target, legacy);
      }

      localStorage.removeItem(base);
    } catch (error) {
      console.error(error);
    }
  }
}

function loadStoredAliases(sportKey) {
  try {
    const raw = localStorage.getItem(storageKey(ALIAS_STORAGE_KEY, sportKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((pair) => Array.isArray(pair) && pair.length === 2) : [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

function saveStoredAliases() {
  try {
    localStorage.setItem(
      storageKey(ALIAS_STORAGE_KEY, state.sportKey),
      JSON.stringify(sportState().manualAliases)
    );
  } catch (error) {
    console.error(error);
  }
}

function allAliasPairs() {
  return [...aliasPairsForSport(state.sportKey), ...sportState().manualAliases];
}

function loadStoredIdSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []);
  } catch (error) {
    console.error(error);
    return new Set();
  }
}

function saveStoredIdSet(base, ids) {
  try {
    localStorage.setItem(storageKey(base, state.sportKey), JSON.stringify([...ids]));
  } catch (error) {
    console.error(error);
  }
}

/**
 * Drops dismissed ids for fixtures that have left the feed, so the list does
 * not grow without bound. Only safe right after a successful load - the feed is
 * the full offer, so anything absent from it has already been played.
 */
function pruneDismissedEvents() {
  const current = sportState();
  const live = new Set(superbetEventsForSport().map((event) => event.eventId));
  let changed = false;

  for (const eventId of current.dismissedEvents) {
    if (!live.has(eventId)) {
      current.dismissedEvents.delete(eventId);
      changed = true;
    }
  }

  if (changed) {
    saveStoredIdSet(DISMISSED_EVENTS_KEY, current.dismissedEvents);
  }
}

function isTournamentDismissed(row) {
  return sportState().dismissedTournaments.has(row.event.tournamentId);
}

function isRowDismissed(row) {
  return isTournamentDismissed(row) || sportState().dismissedEvents.has(row.event.eventId);
}

function setEventDismissed(row, dismissed) {
  const current = sportState();

  if (dismissed) {
    current.dismissedEvents.add(row.event.eventId);
  } else {
    current.dismissedEvents.delete(row.event.eventId);
  }

  saveStoredIdSet(DISMISSED_EVENTS_KEY, current.dismissedEvents);
  renderList();
}

function setTournamentDismissed(tournamentId, dismissed) {
  const current = sportState();

  if (dismissed) {
    current.dismissedTournaments.add(tournamentId);
  } else {
    current.dismissedTournaments.delete(tournamentId);
  }

  saveStoredIdSet(DISMISSED_TOURNAMENTS_KEY, current.dismissedTournaments);
  renderList();
}

function clearDismissed() {
  const current = sportState();
  current.dismissedEvents.clear();
  current.dismissedTournaments.clear();
  saveStoredIdSet(DISMISSED_EVENTS_KEY, current.dismissedEvents);
  saveStoredIdSet(DISMISSED_TOURNAMENTS_KEY, current.dismissedTournaments);
  renderList();
}

function setStatus(message) {
  elements.status.textContent = message;
}

function superbetEventsForSport(sportKey = state.sportKey) {
  const sportId = findSport(sportKey).superbetSportId;
  return state.allSuperbetEvents.filter((event) => event.sportId === sportId);
}

/**
 * Loads whatever the active sport still needs. The Superbet offer is fetched
 * once for all sports; `force` (the refresh button) refetches it too.
 */
async function loadOffers({ force = false } = {}) {
  if (state.loading) {
    return;
  }

  const sport = activeSport();
  const current = sportState();

  if (!force && current.loaded) {
    recompute();
    return;
  }

  state.loading = true;
  setStatus(`Ucitavanje: ${sport.label}...`);
  elements.reloadButton.disabled = true;
  renderEmpty("Ucitavanje...");

  try {
    const needsSuperbet = force || !state.superbetLoaded;

    const [competitions, superbetEvents, merkurMatches] = await Promise.all([
      fetchCompetitions(sport.superbetSportId),
      needsSuperbet ? fetchAllPrematchEvents() : Promise.resolve(null),
      fetchMerkurMatches(sport.merkurCode, { womenFromLeague: sport.womenFromLeague })
    ]);

    if (superbetEvents) {
      state.allSuperbetEvents = superbetEvents;
      state.superbetLoaded = true;
    }

    current.tournamentsById = buildTournamentLookup(competitions);
    current.merkurMatches = merkurMatches;
    current.loaded = true;

    pruneDismissedEvents();
    setStatus(`${sport.label}: Superbet ${superbetEventsForSport().length} / Merkur ${merkurMatches.length}`);
    recompute();
  } catch (error) {
    console.error(error);
    setStatus("Greska pri ucitavanju");
    renderEmpty(`Greska: ${error.message}`);
  } finally {
    state.loading = false;
    elements.reloadButton.disabled = false;
  }
}

function buildTournamentLookup(categories) {
  const lookup = new Map();

  for (const category of categories) {
    for (const competition of category.competitions) {
      lookup.set(competition.tournamentId, {
        categoryName: category.categoryName,
        tournamentName: competition.tournamentName
      });
    }
  }

  return lookup;
}

function recompute() {
  const sport = activeSport();
  const current = sportState();
  const superbetEvents = superbetEventsForSport();

  if (!current.loaded) {
    return;
  }

  const preset = STRICTNESS_PRESETS[elements.strictness.value] ?? STRICTNESS_PRESETS.normal;
  const result = compareOffers(superbetEvents, current.merkurMatches, {
    threshold: preset.threshold,
    timeToleranceMinutes: sport.timeToleranceMinutes,
    aliasPairs: allAliasPairs()
  });

  current.missing = result.missingOnMerkur
    .map(decorateEvent)
    .sort((a, b) => a.kickoffMs - b.kickoffMs);

  // Kept as a base because renderList() re-renders the summary on its own
  // whenever a dismissal changes, without a full recompute.
  current.summaryBase = [
    `Superbet: ${superbetEvents.length}`,
    `Merkur: ${current.merkurMatches.length}`,
    `upareno: ${result.pairs.length}`,
    `nedostaje na Merkuru: ${result.missingOnMerkur.length}`
  ];

  current.orphans = result.missingOnSuperbet
    .map((match) => ({
      match,
      suggestions: suggestPartners(match, result.missingOnMerkur, {
        timeToleranceMinutes: sport.timeToleranceMinutes
      }).filter((suggestion) => suggestion.score >= SUGGESTION_FLOOR)
    }))
    .sort((a, b) => (b.suggestions[0]?.score ?? 0) - (a.suggestions[0]?.score ?? 0));

  renderList();
  renderOrphans();
  renderAliasStatus();
}

function decorateEvent(event) {
  const tournament = sportState().tournamentsById.get(event.tournamentId);
  const kickoffMs = eventKickoffMs(event);

  return {
    event,
    kickoffMs,
    dayKey: kickoffMs ? dayKeyFmt.format(new Date(kickoffMs)) : "",
    kickoffLabel: kickoffMs ? dateTimeFmt.format(new Date(kickoffMs)) : "-",
    categoryName: tournament?.categoryName ?? "Nepoznata zemlja",
    tournamentName: tournament?.tournamentName ?? `Turnir ${event.tournamentId}`,
    outcomes: extractOutcomes(event)
  };
}

// by-date carries only the preselected market, which is exactly what is useful
// here - the full market list would need one request per event. Every sport
// uses the same "1"/"X"/"2" outcome codes, so no per-sport market id is needed.
function extractOutcomes(event) {
  const byName = new Map();

  for (const odd of event.odds ?? []) {
    if (odd.price > 0) {
      byName.set(String(odd.name).toUpperCase(), odd.price);
    }
  }

  return {
    home: byName.get("1") ?? null,
    draw: byName.get("X") ?? null,
    away: byName.get("2") ?? null
  };
}

function applyFilters() {
  const query = normalizeSearch(elements.search.value);
  const from = elements.dateFrom.value;
  const to = elements.dateTo.value;
  const onlyWithOdds = elements.onlyWithOdds.checked;
  const showDismissed = elements.showDismissed.checked;

  return sportState().missing.filter((row) => {
    // Dismissed rows stay in `visible` while the review toggle is on so they
    // can be unchecked; `exportableRows()` drops them regardless.
    if (!showDismissed && isRowDismissed(row)) {
      return false;
    }

    if (from && row.dayKey && row.dayKey < from) {
      return false;
    }

    if (to && row.dayKey && row.dayKey > to) {
      return false;
    }

    if (onlyWithOdds && row.outcomes.home === null) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = normalizeSearch([
      row.event.matchName,
      row.categoryName,
      row.tournamentName
    ].join(" "));

    return haystack.includes(query);
  });
}

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "d")
    .toLowerCase()
    .trim();
}

function renderSummary() {
  const current = sportState();

  if (!current.summaryBase.length) {
    return;
  }

  const summary = [...current.summaryBase];

  if (current.dismissedTournaments.size) {
    summary.push(`cekirano liga: ${current.dismissedTournaments.size}`);
  }

  if (current.dismissedEvents.size) {
    summary.push(`cekirano meceva: ${current.dismissedEvents.size}`);
  }

  elements.summary.textContent = summary.join(" | ");
}

function exportableRows() {
  return sportState().visible.filter((row) => !isRowDismissed(row));
}

function renderList() {
  const current = sportState();
  current.visible = applyFilters();
  renderSummary();

  const exportable = exportableRows();
  const dismissedCount = current.visible.length - exportable.length;

  elements.copyButton.disabled = !exportable.length;
  elements.downloadButton.disabled = !exportable.length;
  elements.clearDismissedButton.disabled =
    !current.dismissedEvents.size && !current.dismissedTournaments.size;

  elements.resultStatus.textContent = current.visible.length
    ? `${exportable.length} meceva${dismissedCount ? ` (+${dismissedCount} cekirano)` : ""}`
    : "Nema rezultata";

  if (!current.visible.length) {
    renderEmpty(current.missing.length ? "Nema meceva za zadate filtere" : "Nema razlika");
    return;
  }

  // Grouped by tournamentId rather than by display title, because the league
  // checkbox acts on the id and two competitions can share a name.
  const groups = new Map();

  for (const row of current.visible) {
    const group = groups.get(row.event.tournamentId);

    if (group) {
      group.rows.push(row);
    } else {
      groups.set(row.event.tournamentId, {
        title: `${row.categoryName} - ${row.tournamentName}`,
        rows: [row]
      });
    }
  }

  const fragment = document.createDocumentFragment();

  for (const [tournamentId, group] of groups) {
    fragment.append(createGroupSection(tournamentId, group.title, group.rows));
  }

  elements.list.replaceChildren(fragment);
}

function createGroupSection(tournamentId, title, rows) {
  const dismissed = sportState().dismissedTournaments.has(tournamentId);

  const section = document.createElement("section");
  section.className = dismissed ? "missing-group is-dismissed" : "missing-group";

  const head = document.createElement("div");
  head.className = "missing-group-head";

  const toggle = document.createElement("label");
  toggle.className = "missing-dismiss";
  toggle.title = "Ne treba u ponudi - cela liga";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = dismissed;
  checkbox.addEventListener("change", () => setTournamentDismissed(tournamentId, checkbox.checked));

  toggle.append(checkbox);

  const heading = document.createElement("h3");
  heading.className = "missing-group-title";
  heading.textContent = title;

  const count = document.createElement("span");
  count.className = "missing-group-count";
  count.textContent = String(rows.length);

  head.append(toggle, heading, count);

  const table = document.createElement("table");
  table.className = "missing-table";
  table.append(createTableHead(), createTableBody(rows));

  section.append(head, table);
  return section;
}

function outcomeColumns() {
  return activeSport().hasDraw ? ["1", "X", "2"] : ["1", "2"];
}

function createTableHead() {
  const thead = document.createElement("thead");
  const row = document.createElement("tr");

  const dismissHeader = document.createElement("th");
  dismissHeader.className = "missing-dismiss-col";
  dismissHeader.title = "Ne treba u ponudi";
  dismissHeader.textContent = "-";
  row.append(dismissHeader);

  for (const label of ["Vreme", "Mec", ...outcomeColumns()]) {
    const cell = document.createElement("th");
    cell.textContent = label;

    if (label.length === 1) {
      cell.className = "col-numeric";
    }

    row.append(cell);
  }

  thead.append(row);
  return thead;
}

function rowPrices(row) {
  return activeSport().hasDraw
    ? [row.outcomes.home, row.outcomes.draw, row.outcomes.away]
    : [row.outcomes.home, row.outcomes.away];
}

function createTableBody(rows) {
  const tbody = document.createElement("tbody");

  for (const row of rows) {
    const tr = document.createElement("tr");

    if (isRowDismissed(row)) {
      tr.className = "is-dismissed";
    }

    tr.append(createDismissCell(row));

    const time = document.createElement("td");
    time.className = "missing-time";
    time.textContent = row.kickoffLabel;

    const match = document.createElement("td");
    match.className = "missing-match";
    match.textContent = `${row.event.homeTeam} - ${row.event.awayTeam}`;

    tr.append(time, match);

    for (const price of rowPrices(row)) {
      const cell = document.createElement("td");
      cell.className = "col-numeric";
      cell.textContent = price === null ? "-" : price.toFixed(2);
      tr.append(cell);
    }

    tbody.append(tr);
  }

  return tbody;
}

function createDismissCell(row) {
  const cell = document.createElement("td");
  cell.className = "missing-dismiss-col";

  const label = document.createElement("label");
  label.className = "missing-dismiss";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isRowDismissed(row);

  // A dismissed league already covers every fixture in it, so the per-match
  // checkbox would be lying if it claimed to be independently undoable.
  if (isTournamentDismissed(row)) {
    checkbox.disabled = true;
    label.title = "Cela liga je cekirana";
  } else {
    label.title = "Ne treba u ponudi";
    checkbox.addEventListener("change", () => setEventDismissed(row, checkbox.checked));
  }

  label.append(checkbox);
  cell.append(label);
  return cell;
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";

  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.textContent = "--";

  const text = document.createElement("span");
  text.textContent = message;

  empty.append(icon, text);
  elements.list.replaceChildren(empty);
}

function renderOrphans() {
  const current = sportState();

  if (!current.orphans.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Svi Merkur mecevi su upareni";
    elements.orphansList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const orphan of current.orphans) {
    fragment.append(createOrphanCard(orphan));
  }

  elements.orphansList.replaceChildren(fragment);
}

function createOrphanCard({ match, suggestions }) {
  const card = document.createElement("section");
  card.className = "orphan-card";

  const head = document.createElement("div");
  head.className = "orphan-head";

  const title = document.createElement("span");
  title.className = "orphan-title";
  title.textContent = `${match.home} - ${match.away}`;

  const meta = document.createElement("span");
  meta.className = "orphan-meta";
  meta.textContent = `${dateTimeFmt.format(new Date(match.kickoffMs))} | ${match.leagueName}`;

  head.append(title, meta);
  card.append(head);

  if (!suggestions.length) {
    const none = document.createElement("div");
    none.className = "orphan-empty";
    none.textContent = "Nema kandidata u vremenskom prozoru - mec verovatno stvarno ne postoji na Superbetu.";
    card.append(none);
    return card;
  }

  for (const suggestion of suggestions) {
    card.append(createSuggestionRow(match, suggestion));
  }

  return card;
}

function createSuggestionRow(match, { event, score }) {
  const row = document.createElement("div");
  row.className = "orphan-suggestion";

  const scoreChip = document.createElement("span");
  scoreChip.className = "orphan-score";
  scoreChip.textContent = score.toFixed(2);

  const name = document.createElement("span");
  name.className = "orphan-candidate";
  name.textContent = `${event.homeTeam} - ${event.awayTeam}`;

  const link = document.createElement("button");
  link.className = "action-btn action-btn--secondary";
  link.type = "button";
  link.textContent = "Povezi";
  link.addEventListener("click", () => linkFixture(match, event));

  row.append(scoreChip, name, link);
  return row;
}

/**
 * Records the name pairs that would have made these two fixtures match, then
 * recomputes. Only the sides whose names actually differ are stored - adding an
 * alias for a pair that already matches would just bloat the exported table.
 */
function linkFixture(match, event) {
  const candidates = [
    [match.home, event.homeTeam],
    [match.away, event.awayTeam]
  ];

  const current = sportState();
  let added = 0;

  for (const [merkurName, superbetName] of candidates) {
    if (!merkurName || !superbetName) {
      continue;
    }

    const exists = allAliasPairs().some(([m, sb]) => m === merkurName && sb === superbetName);

    if (exists) {
      continue;
    }

    current.manualAliases.push([merkurName, superbetName]);
    added += 1;
  }

  if (!added) {
    elements.aliasStatus.textContent = "Taj par je vec zabelezen";
    return;
  }

  saveStoredAliases();
  recompute();
  setActiveTab("orphans");
}

function renderAliasStatus() {
  const count = sportState().manualAliases.length;
  elements.aliasStatus.textContent = count
    ? `${count} rucnih aliasa (jos nisu u kodu)`
    : "Nema rucnih aliasa";
  elements.exportAliasesButton.disabled = count === 0;
  elements.clearAliasesButton.disabled = count === 0;
}

/**
 * Emits the manual aliases in the shape of a CLUB_ALIASES_BY_SPORT entry, so
 * they can be committed and stop depending on one browser's localStorage.
 */
function exportAliases() {
  const lines = sportState().manualAliases
    .map(([merkurName, superbetName]) => `    [${JSON.stringify(merkurName)}, ${JSON.stringify(superbetName)}],`);

  const content = [
    "// Aliases confirmed in the Razlike page. Merge these into the matching",
    "// CLUB_ALIASES_BY_SPORT entry in js/merkur_team_names.js, then clear them.",
    `  ${state.sportKey}: [`,
    ...lines,
    "  ],",
    ""
  ].join("\n");

  const blob = new Blob([content], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `merkur_aliases_${state.sportKey}.js`;
  link.click();

  URL.revokeObjectURL(url);
}

function clearAliases() {
  sportState().manualAliases = [];
  saveStoredAliases();
  recompute();
}

function setActiveTab(tab) {
  state.activeTab = tab;
  elements.tabMissing.classList.toggle("is-active", tab === "missing");
  elements.tabOrphans.classList.toggle("is-active", tab === "orphans");
  elements.missingPanel.hidden = tab !== "missing";
  elements.orphansPanel.hidden = tab !== "orphans";
}

function renderSportTabs() {
  const fragment = document.createDocumentFragment();

  for (const sport of COMPARISON_SPORTS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.role = "tab";
    tab.className = sport.key === state.sportKey ? "market-tab is-active" : "market-tab";
    tab.textContent = sport.label;
    tab.addEventListener("click", () => selectSport(sport.key));
    fragment.append(tab);
  }

  elements.sportTabs.replaceChildren(fragment);
  // Tennis runs on a far wider window than the team sports, so the note has to
  // follow the active sport rather than state a single number.
  elements.toleranceNote.textContent = `tolerancija ${activeSport().timeToleranceMinutes} min`;
}

function selectSport(sportKey) {
  if (state.loading || sportKey === state.sportKey) {
    return;
  }

  state.sportKey = sportKey;
  renderSportTabs();
  setActiveTab("missing");
  // Filters are per-sport concepts only in spirit; the search box in
  // particular carries over a team name that cannot match the new sport.
  elements.search.value = "";
  loadOffers();
}

function buildExportText() {
  const header = ["Vreme", "Zemlja", "Liga", "Domacin", "Gost", ...outcomeColumns()].join("\t");

  const lines = exportableRows().map((row) => [
    row.kickoffLabel,
    row.categoryName,
    row.tournamentName,
    row.event.homeTeam,
    row.event.awayTeam,
    ...rowPrices(row).map(formatPrice)
  ].join("\t"));

  return [header, ...lines].join("\n");
}

function formatPrice(price) {
  return price === null ? "" : price.toFixed(2);
}

async function copyList() {
  try {
    await navigator.clipboard.writeText(buildExportText());
    elements.resultStatus.textContent = `Kopirano ${exportableRows().length} meceva`;
  } catch (error) {
    console.error(error);
    elements.resultStatus.textContent = "Kopiranje nije uspelo";
  }
}

function downloadList() {
  const blob = new Blob([buildExportText()], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `superbet-bez-merkura-${state.sportKey}-${dayKeyFmt.format(new Date())}.tsv`;
  link.click();

  URL.revokeObjectURL(url);
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", () => loadOffers({ force: true }));
  elements.reloadButton.addEventListener("click", () => loadOffers({ force: true }));
  elements.copyButton.addEventListener("click", copyList);
  elements.downloadButton.addEventListener("click", downloadList);
  elements.strictness.addEventListener("change", recompute);
  elements.search.addEventListener("input", renderList);
  elements.dateFrom.addEventListener("change", renderList);
  elements.dateTo.addEventListener("change", renderList);
  elements.onlyWithOdds.addEventListener("change", renderList);
  elements.tabMissing.addEventListener("click", () => setActiveTab("missing"));
  elements.tabOrphans.addEventListener("click", () => setActiveTab("orphans"));
  elements.exportAliasesButton.addEventListener("click", exportAliases);
  elements.clearAliasesButton.addEventListener("click", clearAliases);
  elements.showDismissed.addEventListener("change", renderList);
  elements.clearDismissedButton.addEventListener("click", clearDismissed);
}

/**
 * Defaults both ends of the date filter to today, so the page opens on today's
 * offer rather than on everything the feed carries - Superbet lists fixtures
 * months out, which buries the matches actually worth acting on.
 *
 * `dayKeyFmt` is en-CA precisely because it yields YYYY-MM-DD, which is both
 * what `input[type=date]` expects and what `applyFilters()` compares against.
 */
function applyDefaultDateRange() {
  const today = dayKeyFmt.format(new Date());
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
}

migrateLegacyStorage();
applyDefaultDateRange();
renderSportTabs();
wireEvents();
renderAliasStatus();
loadOffers();
