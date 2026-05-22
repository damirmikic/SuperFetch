import { buildSpecijalRow } from "./csv.js";

const datetimeDisplay = document.querySelector("#datetime-display");
const datetimeFmt = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit",
  hour12: false
});
function setKickoffTime(event) {
  if (!event?.matchDate) { datetimeDisplay.textContent = ""; return; }
  const date = new Date(event.matchDate.replace(" ", "T") + "Z");
  datetimeDisplay.textContent = Number.isNaN(date.getTime()) ? "" : datetimeFmt.format(date);
}

const elements = {
  select: document.querySelector("#competition-select"),
  eventSelect: document.querySelector("#event-select"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  clearCsvButton: document.querySelector("#clear-csv-button"),
  csvOutput: document.querySelector("#csv-output"),
  csvPreviewPanel: document.querySelector("#csv-preview-panel"),
  csvPreviewContent: document.querySelector("#csv-preview-content"),
  csvPreviewStatus: document.querySelector("#csv-preview-status"),
  marketsList: document.querySelector("#markets-list"),
  status: document.querySelector("#status"),
  refreshButton: document.querySelector("#refresh-button"),
  eventsStatus: document.querySelector("#events-status"),
  csvStatus: document.querySelector("#csv-status"),
  marketsStatus: document.querySelector("#markets-status"),
  marketTabs: document.querySelectorAll(".market-tab"),
  specijalFilter: document.querySelector("#specijali-filter"),
  specijalMin: document.querySelector("#specijali-min"),
  specijalMax: document.querySelector("#specijali-max"),
  specijalFilterClear: document.querySelector("#specijali-filter-clear")
};

let optionIndex = new Map();
let eventIndex = new Map();
let currentMarkets = [];
let currentEvent = null;
/** @type {"all"|"standard"|"statistika"|"specijali"|"home-players"|"away-players"|"players"} */
let activeMarketTab = "all";
let marketSearch = "";
let currentSportId = 5; // Default is soccer (5)

export function setSportId(sportId) {
  currentSportId = sportId;
}

export function getElements() {
  return elements;
}

export function setLoading() {
  elements.select.disabled = true;
  elements.select.replaceChildren(new Option("Loading competitions...", ""));
  elements.status.classList.remove("is-error");
  elements.status.textContent = "Fetching Superbet competitions...";
}

export function setError(error) {
  elements.select.disabled = true;
  elements.select.replaceChildren(new Option("Unable to load competitions", ""));
  elements.status.classList.add("is-error");
  elements.status.textContent = error.message;
}

export function renderCompetitionDropdown(categories) {
  optionIndex = new Map();
  const fragment = document.createDocumentFragment();

  for (const category of categories) {
    const group = document.createElement("optgroup");
    group.label = category.categoryName;

    for (const competition of category.competitions) {
      const option = new Option(competition.tournamentName, String(competition.tournamentId));
      group.append(option);
      optionIndex.set(option.value, competition);
    }

    fragment.append(group);
  }

  elements.select.replaceChildren(fragment);
  elements.select.disabled = optionIndex.size === 0;
  elements.status.classList.remove("is-error");
  elements.status.textContent = optionIndex.size
    ? `${optionIndex.size} competitions loaded`
    : "No competitions returned";

}

export function getSelectedCompetition() {
  const selected = optionIndex.get(elements.select.value);

  if (!selected) {
    return null;
  }

  return selected;
}

export function getSelectedEvent() {
  return eventIndex.get(elements.eventSelect.value) ?? null;
}

export function getCurrentMarkets() {
  return currentMarkets;
}

export function setEventsLoading(competition) {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = `Loading events for ${competition.tournamentName}...`;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Loading events...", ""));
}

export function setEventsError(error) {
  elements.eventsStatus.classList.add("is-error");
  elements.eventsStatus.textContent = error.message;
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Unable to load events", ""));
}

export function resetEvents() {
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = "Choose a competition";
  eventIndex = new Map();
  elements.eventSelect.disabled = true;
  elements.eventSelect.replaceChildren(new Option("Choose a competition first", ""));
}

export function renderEvents(events) {
  eventIndex = new Map();
  elements.eventsStatus.classList.remove("is-error");
  elements.eventsStatus.textContent = events.length
    ? `${events.length} upcoming events loaded`
    : "No upcoming events for selected competition";

  if (!events.length) {
    elements.eventSelect.disabled = true;
    elements.eventSelect.replaceChildren(new Option("No prematch events found", ""));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const event of events) {
    const option = new Option(formatEventOption(event), String(event.eventId));
    fragment.append(option);
    eventIndex.set(option.value, event);
  }

  elements.eventSelect.replaceChildren(fragment);
  elements.eventSelect.disabled = false;
}


export function setMarketsLoading(event) {
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = `Loading markets for ${formatMatchName(event)}...`;
  currentMarkets = [];
  currentEvent = event;
  setKickoffTime(event);
  resetCsvOutput("Loading markets...");
  elements.marketsList.replaceChildren(createEmptyState("Loading markets...", "⏳"));
}

export function setMarketsError(error) {
  elements.marketsStatus.classList.add("is-error");
  elements.marketsStatus.textContent = error.message;
  currentMarkets = [];
  setKickoffTime(null);
  resetCsvOutput("Unable to generate CSV");
  elements.marketsList.replaceChildren(createEmptyState("Unable to load markets.", "⚠️"));
}

export function resetMarkets() {
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = "Choose an event";
  currentMarkets = [];
  currentEvent = null;
  setKickoffTime(null);
  resetCsvOutput("Choose an event first");
  elements.marketsList.replaceChildren(createEmptyState("Choose an event first", "📅"));
  _resetDefaultHost();
  const dodajBtn = document.querySelector("#dodaj-default-button");
  if (dodajBtn) dodajBtn.disabled = true;
}


export function renderMarkets(markets) {
  _resetDefaultHost();
  currentMarkets = markets;
  marketSearch = "";
  document.querySelector("#market-search").value = "";
  elements.marketsStatus.classList.remove("is-error");
  elements.marketsStatus.textContent = markets.length
    ? `${markets.length} markets loaded`
    : "No markets for selected event";

  const dodajBtn = document.querySelector("#dodaj-default-button");
  if (dodajBtn) dodajBtn.disabled = !markets.length;

  if (!markets.length) {
    resetCsvOutput("No markets for CSV");
    elements.marketsList.replaceChildren(createEmptyState("No markets found", "🏟️"));
    return;
  }

  const homeTab = document.querySelector('[data-tab="home-players"]');
  const awayTab = document.querySelector('[data-tab="away-players"]');
  if (homeTab) homeTab.textContent = currentEvent?.homeTeam || "Dom. igrači";
  if (awayTab) awayTab.textContent = currentEvent?.awayTeam || "Gost. igrači";
  elements.csvStatus.textContent = "Use + buttons to add markets";
  renderMarketsForCurrentFilter();
}

export function renderCsvOutput(csv, filename, rowCount) {
  elements.csvOutput.value = csv;
  elements.downloadCsvButton.disabled = !csv;
  elements.clearCsvButton.disabled = !csv;
  elements.downloadCsvButton.dataset.filename = filename;
  elements.csvStatus.textContent = csv ? `${rowCount} CSV rows generated` : "No CSV rows generated";
  elements.csvPreviewPanel.hidden = !csv;
  elements.csvPreviewContent.textContent = csv;
  elements.csvPreviewStatus.textContent = csv ? `${rowCount} rows` : "";
}

export function getCsvOutput() {
  return elements.csvOutput.value;
}

export function getCurrentCsvFilename() {
  return elements.downloadCsvButton.dataset.filename || "odds.csv";
}

export function getMarginMultiplier() {
  const pct = parseFloat(document.querySelector("#margin-pct").value);
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  const direction = document.querySelector('input[name="margin-dir"]:checked').value;
  return direction === "decrease" ? 1 - pct / 100 : 1 + pct / 100;
}

export function refreshDisplayedPrices() {
  const m = getMarginMultiplier();
  for (const el of document.querySelectorAll(".odd-price[data-original-price], .player-odd-price[data-original-price]")) {
    const orig = parseFloat(el.dataset.originalPrice);
    if (Number.isFinite(orig)) el.textContent = (orig * m).toFixed(2);
  }
}

export function renderMarketsForCurrentFilter() {
  if (!currentMarkets.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets found", "🏟️"));
    return;
  }

  const tabFiltered = filterMarketsByTab(currentMarkets, activeMarketTab);

  if (activeMarketTab === "home-players" || activeMarketTab === "away-players") {
    const side = activeMarketTab === "home-players" ? "home" : "away";
    const cards = createPlayerGroupCardsByTeam(tabFiltered, side, marketSearch);
    if (!cards.length) {
      elements.marketsList.replaceChildren(createEmptyState("No player props found", "👤"));
      return;
    }
    elements.marketsList.replaceChildren(...cards);
    return;
  }

  if (activeMarketTab === "players") {
    const cards = createPlayerGroupCardsBasketball(tabFiltered, marketSearch);
    if (!cards.length) {
      elements.marketsList.replaceChildren(createEmptyState("No player props found", "👤"));
      return;
    }
    elements.marketsList.replaceChildren(...cards);
    return;
  }

  const searchNorm = normalizeSearchText(marketSearch);
  const visible = searchNorm
    ? tabFiltered.filter((m) => normalizeSearchText(m.marketName).includes(searchNorm))
    : tabFiltered;

  if (!visible.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets in this category", "🔍"));
    return;
  }

  elements.marketsList.replaceChildren(...visible.map(createMarketCard));
}

/**
 * Keywords that identify team-level "statistika" markets.
 * The match is done on the normalised (lowercased, diacritic-stripped) market name.
 * A market qualifies when ANY of these terms appears AND the market is not a combo (no ";")
 * AND is not a player-prop (i.e. it does NOT also match a player-prop word from PROP_WORDS).
 */
const STATISTIKA_KEYWORDS = [
  "korneri", "korner", "corner",
  "karton", "kartoni", "crveni karton", "zuti karton", "žuti karton",
  "faul", "faulovi",
  "ofsajd", "ofsajdi",
  "autogol", "auto gol", "own goal",
  "šut", "sut", "sutev", "šuteva", "udarac", "udarci",
  "šutevi na gol", "sutevi na gol", "šuteve u okvir", "suteve u okvir",
  "saves", "obrane", "odbrane",
  "ubačaj", "ubackaj", "throw-in",
  "slobodan udarac", "slobodni udarac",
];

/**
 * Filter markets based on the selected tab.
 * - "all"        → all markets
 * - "standard"   → no ";" and not a statistika market
 * - "statistika" → no ";" and matches at least one statistika keyword, not player-specific
 * - "specijali"  → contains ";"
 * @param {Array} markets
 * @param {"all"|"standard"|"statistika"|"specijali"} tab
 */
function applyOddsRangeFilter(markets) {
  const min = parseFloat(elements.specijalMin.value);
  const max = parseFloat(elements.specijalMax.value);
  if (Number.isNaN(min) && Number.isNaN(max)) return markets;
  return markets.filter((m) => m.odds.some((o) => {
    if (!Number.isFinite(o.price)) return false;
    if (!Number.isNaN(min) && o.price < min) return false;
    if (!Number.isNaN(max) && o.price > max) return false;
    return true;
  }));
}

function filterMarketsByTab(markets, tab) {
  if (tab === "specijali") {
    return applyOddsRangeFilter(markets.filter((m) => m.marketName.includes(";")));
  }

  if (tab === "all") return applyOddsRangeFilter(markets);

  // Both "standard" and "statistika" start from non-combo markets
  const nonCombo = markets.filter((m) => !m.marketName.includes(";"));

  if (tab === "statistika") {
    return applyOddsRangeFilter(nonCombo.filter((m) => isStatistikaMarket(m.marketName)));
  }

  if (tab === "standard") {
    return applyOddsRangeFilter(nonCombo.filter((m) => !isStatistikaMarket(m.marketName)));
  }

  if (tab === "home-players") {
    return applyOddsRangeFilter(nonCombo.filter((m) => m.odds.some((o) => o.playerName && o.playerTeam === "home")));
  }

  if (tab === "away-players") {
    return applyOddsRangeFilter(nonCombo.filter((m) => m.odds.some((o) => o.playerName && o.playerTeam === "away")));
  }

  if (tab === "players") {
    return applyOddsRangeFilter(nonCombo.filter((m) => m.odds.some((o) => o.playerName)));
  }

  return applyOddsRangeFilter(markets);
}

const BASKETBALL_STATISTIKA_KEYWORDS = [
  "asistencija", "asistencije",
  "skokova", "skokovi", "skok",
  "izgubljenih lopti", "izgubljene lopte",
  "ukradenih lopti", "ukradene lopte",
  "slobodnih bacanja", "slobodna bacanja",
  "pogodaka za 3 poena", "postignutih 3 poena", "3 poena"
];

/**
 * Returns true if the market name matches a team-level statistika keyword.
 * Player-prop markets that incidentally contain "šut" or "faul" etc. are excluded
 * by requiring the keyword to appear without a preceding likely-player-name token.
 */
function isStatistikaMarket(marketName) {
  const norm = normalizeSearchText(marketName);
  if (norm.includes("igrac")) return false;
  const keywords = currentSportId === 4
    ? BASKETBALL_STATISTIKA_KEYWORDS
    : STATISTIKA_KEYWORDS;
  return keywords.some((kw) => norm.includes(normalizeSearchText(kw)));
}

/** Initialize tab-switching click listeners. Call once on startup. */
export function initMarketTabs() {
  for (const tab of elements.marketTabs) {
    tab.addEventListener("click", () => {
      activeMarketTab = tab.dataset.tab;

      for (const t of elements.marketTabs) {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      }

      renderMarketsForCurrentFilter();
    });
  }

  elements.specijalMin.addEventListener("input", renderMarketsForCurrentFilter);
  elements.specijalMax.addEventListener("input", renderMarketsForCurrentFilter);
  elements.specijalFilterClear.addEventListener("click", () => {
    elements.specijalMin.value = "";
    elements.specijalMax.value = "";
    renderMarketsForCurrentFilter();
  });

  const searchInput = document.querySelector("#market-search");
  searchInput.addEventListener("input", () => {
    marketSearch = searchInput.value.trim();
    renderMarketsForCurrentFilter();
  });
}


function resetCsvOutput(label) {
  elements.downloadCsvButton.disabled = true;
  elements.clearCsvButton.disabled = true;
  elements.downloadCsvButton.dataset.filename = "";
  elements.csvOutput.value = "";
  elements.csvStatus.textContent = label;
  elements.csvPreviewPanel.hidden = true;
  elements.csvPreviewContent.textContent = "";
}

function extractPlayers(markets) {
  const players = new Map();
  const teamNames = new Set(
    [currentEvent?.homeTeam, currentEvent?.awayTeam]
      .filter(Boolean)
      .map(normalizeSearchText)
  );

  for (const market of markets) {
    if (market.marketName.includes(";")) continue;

    for (const odd of market.odds) {
      const candidates = [
        ...extractPlayerCandidates(market.marketName),
        ...extractPlayerCandidates(odd.name)
      ];

      for (const candidate of candidates) {
        const normalized = normalizeSearchText(candidate);

        if (!normalized || teamNames.has(normalized)) {
          continue;
        }

        players.set(normalized, candidate);
      }
    }
  }

  return Array.from(players.values()).sort((a, b) => a.localeCompare(b));
}

const PROP_WORDS = [
  "vise od",
  "manje od",
  "over",
  "under",
  "da postigne",
  "postize",
  "postiže",
  "asist",
  "karton",
  "suteva",
  "šuteva",
  "udaraca",
  "poena",
  "skokova"
];

const DEFAULT_MARKET_CHECKS = [
  (n) => n.includes("postize") && !n.includes("levom") && !n.includes("desnom") && !n.includes("1."),
  (n) => n.includes("ukupan") && n.includes("asistencij"),
  (n) => n.includes("gol") && n.includes("ili") && n.includes("asistir"),
  (n) => n.includes("gol") && n.includes("asistir") && !n.includes("ili"),
  (n) => n.includes("ukupan") && n.includes("sutev") && n.includes("okvir") && !n.includes("levom") && !n.includes("desnom") && !n.includes("van"),
  (n) => n.includes("ukupno") && n.includes("sutev") && !n.includes("van") && !n.includes("levom") && !n.includes("desnom"),
  (n) => n.includes("karton"),
  (n) => n.includes("faul") && n.includes("nacinjenih"),
];

function isDefaultPlayerMarket(marketName) {
  if (currentSportId === 4) {
    return isDefaultPlayerMarketBasketball(marketName);
  }
  const n = normalizeSearchText(marketName);
  return DEFAULT_MARKET_CHECKS.some((check) => check(n));
}

function isDefaultPlayerMarketBasketball(marketName) {
  const n = normalizeSearchText(marketName);
  return n.includes("poena") || n.includes("asistenc") || n.includes("skok") || n.includes("trojk") || n.includes("3 poen");
}


function extractPlayerCandidates(text) {
  const candidates = [];
  const commaNamePattern = /\b((?:[\p{Lu}][\p{L}'.-]+\s+)?[\p{Lu}][\p{L}'.-]+),\s*([\p{Lu}][\p{L}'.-]+(?:-[\p{Lu}][\p{L}'.-]+)?)\b/gu;
  let match;

  while ((match = commaNamePattern.exec(text)) !== null) {
    candidates.push(`${match[1]}, ${match[2]}`);
  }

  const propWords = PROP_WORDS;

  for (const part of String(text).split(";")) {
    const clean = cleanCandidateText(part);
    const normalized = normalizeSearchText(clean);
    const hit = propWords
      .map((word) => normalized.indexOf(normalizeSearchText(word)))
      .filter((index) => index > 1)
      .sort((a, b) => a - b)[0];

    if (hit) {
      const candidate = clean.slice(0, hit).trim();

      if (isLikelyPlayerName(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function cleanCandidateText(value) {
  return String(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+([.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPlayerName(value) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-ZČĆŽŠĐA-Z][\p{L}',.-]+$/u.test(word));
}


function resolvePlayerName(odd) {
  // playerName is sometimes a raw API ID like "sr:player:1347728" — fall back to odd.name
  if (odd.playerName && !String(odd.playerName).includes(":")) return odd.playerName;
  // odd.name format: "Lastname, Firstname - condition text"  — take only the name part
  const namePart = String(odd.name).split(" - ")[0].trim();
  const m = namePart.match(/^([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*),\s*([\p{L}'.\-]+(?:\s[\p{L}'.\-]+)*)$/u);
  return m ? `${m[1]}, ${m[2]}` : null;
}

function createPlayerGroupCardsByTeam(markets, team, search = "") {
  const playerMap = new Map();
  const searchNorm = normalizeSearchText(search);
  const minPrice = parseFloat(elements.specijalMin.value);
  const maxPrice = parseFloat(elements.specijalMax.value);

  for (const market of markets) {
    for (const odd of market.odds) {
      if (!odd.playerName || odd.playerTeam !== team) continue;
      if (Number.isFinite(odd.price) && (odd.price > 50 || odd.price < 1.01)) continue;
      if (Number.isFinite(odd.price)) {
        if (!Number.isNaN(minPrice) && odd.price < minPrice) continue;
        if (!Number.isNaN(maxPrice) && odd.price > maxPrice) continue;
      }
      const playerName = resolvePlayerName(odd);
      if (!playerName) continue;
      const norm = normalizeSearchText(playerName);
      if (!playerMap.has(norm)) {
        playerMap.set(norm, { name: playerName, matches: [] });
      }
      playerMap.get(norm).matches.push({ marketName: market.marketName, odd });
    }
  }

  return Array.from(playerMap.values())
    .filter(({ name }) => !searchNorm || normalizeSearchText(formatPlayerName(name)).includes(searchNorm))
    .sort((a, b) => formatPlayerName(a.name).localeCompare(formatPlayerName(b.name)))
    .map(({ name, matches }) => createPlayerGroupCard(formatPlayerName(name), matches, team));
}

function createPlayerGroupCard(query, matches, side) {
  const card = document.createElement("article");
  const headerArea = document.createElement("div");
  const header = document.createElement("button");
  const headerText = document.createElement("div");
  const title = document.createElement("h3");
  const count = document.createElement("span");
  const chevron = document.createElement("span");
  const selectBtn = document.createElement("button");
  const oddsList = document.createElement("div");

  card.className = "market-card player-results";
  headerArea.className = "player-card-header-area";
  header.className = "player-card-header";
  header.type = "button";
  headerText.className = "player-card-header-text";
  title.className = "market-title";
  count.className = "player-card-count";
  chevron.className = "player-card-chevron";
  selectBtn.className = "player-select-btn";
  selectBtn.type = "button";
  selectBtn.title = "Add default markets to CSV";
  selectBtn.textContent = "+";
  oddsList.className = "player-odds-list";

  title.textContent = query;
  count.textContent = `${matches.length} odds`;
  chevron.textContent = "›";
  oddsList.append(...matches.map(({ marketName, odd }) => createPlayerOddRow(marketName, odd)));

  header.addEventListener("click", () => card.classList.toggle("is-expanded"));

  selectBtn.addEventListener("click", () => {
    if (selectBtn.classList.contains("is-selected")) {
      selectBtn.classList.remove("is-selected");
      selectBtn.textContent = "+";
      selectBtn.title = "Add default markets to CSV";
      for (const btn of oddsList.querySelectorAll(".add-odd-button.is-added")) {
        btn.click();
      }
    } else {
      const csvValue = elements.csvOutput.value.trim();
      if (csvValue) {
        const csvLines = csvValue.split(/\r?\n/);
        const firstMatchLine = csvLines.find((l) => l.startsWith("MATCH_NAME:"));
        const csvTeam = firstMatchLine ? firstMatchLine.slice("MATCH_NAME:".length) : "";
        const playerTeam = side === "home" ? currentEvent?.homeTeam : currentEvent?.awayTeam;
        if (csvTeam && playerTeam && csvTeam !== playerTeam) return;
      }
      selectBtn.classList.add("is-selected");
      selectBtn.textContent = "✓";
      selectBtn.title = "Remove from CSV";
      for (const btn of oddsList.querySelectorAll(".add-odd-button:not(.is-added)")) {
        if (btn.dataset.marketName && isDefaultPlayerMarket(btn.dataset.marketName)) {
          btn.click();
        }
      }
    }
  });

  headerText.append(title, count);
  header.append(headerText, chevron);
  headerArea.append(header, selectBtn);
  card.append(headerArea, oddsList);

  return card;
}

function createPlayerOddRow(marketName, odd) {
  const row = document.createElement("div");
  const text = document.createElement("div");
  const market = document.createElement("span");
  const name = document.createElement("span");
  const addButton = document.createElement("button");
  const price = document.createElement("span");

  row.className = "player-odd-row";
  text.className = "player-odd-text";
  market.className = "player-odd-market";
  name.className = "player-odd-name";
  addButton.className = "add-odd-button";
  addButton.type = "button";
  addButton.title = "Add to CSV";
  addButton.textContent = "+";
  addButton.dataset.marketName = marketName;
  price.className = "player-odd-price";
  market.textContent = marketName;
  name.textContent = odd.name;
  price.dataset.originalPrice = odd.price;
  price.textContent = Number.isFinite(odd.price) ? (odd.price * getMarginMultiplier()).toFixed(2) : "-";

  addButton.addEventListener("click", () => {
    if (addButton.classList.contains("is-added")) {
      document.dispatchEvent(new CustomEvent("remove-odd-from-csv", { detail: { button: addButton } }));
    } else {
      document.dispatchEvent(new CustomEvent("add-odd-to-csv", { detail: { marketName, odd, button: addButton } }));
    }
  });

  text.append(market, name);
  row.append(text, addButton, price);

  return row;
}

function formatPlayerName(value) {
  const parts = String(value).split(",").map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return String(value);
}


function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
}

function formatMatchName(event) {
  if (event.homeTeam && event.awayTeam) {
    return `${event.homeTeam} vs ${event.awayTeam}`;
  }

  return event.matchName;
}

function formatEventOption(event) {
  return formatMatchName(event);
}

function createMarketCard(market) {
  const card = document.createElement("article");
  const oddsGrid = document.createElement("div");
  const isCombo = market.marketName.includes(";");
  const isStatistika = !isCombo && isStatistikaMarket(market.marketName);
  const isSplitStatistika = isStatistika && market.odds.length >= 3;

  card.className = isCombo ? "market-card market-card--combo" : "market-card";
  oddsGrid.className = "odds-grid";

  if (isCombo) {
    const comboEntries = market.odds.map((odd) => ({ wrapper: createOddButton(odd, "", market.marketName, market.uuid), odd }));
    oddsGrid.append(...comboEntries.map((e) => e.wrapper));

    const titleArea = document.createElement("div");
    const title = document.createElement("h3");
    const resetBtn = document.createElement("button");
    const originalNameEl = document.createElement("p");

    titleArea.className = "market-title-area";
    title.className = "market-title market-title--editable";
    title.contentEditable = "true";
    title.spellcheck = false;
    title.textContent = market.marketName;
    resetBtn.className = "market-reset-btn";
    resetBtn.type = "button";
    resetBtn.title = "Vrati originalni naziv";
    resetBtn.textContent = "↺";
    resetBtn.hidden = true;
    originalNameEl.className = "market-original-name";
    originalNameEl.textContent = market.marketName;
    originalNameEl.hidden = true;

    const applyEdit = (newName) => {
      const changed = newName !== market.marketName;
      resetBtn.hidden = !changed;
      originalNameEl.hidden = !changed;
      for (const { wrapper, odd } of comboEntries) {
        const addBtn = wrapper.querySelector(".add-odd-button");
        if (!addBtn) continue;
        addBtn.dataset.currentMarketName = newName;
        const lbl = wrapper.querySelector(".odd-label");
        // Sync the chip label for single-outcome combos (label was originally the market name)
        if (lbl?.dataset.usesMarketName === "true") lbl.textContent = newName;
        if (addBtn.classList.contains("is-added")) {
          const oldRow = addBtn.dataset.csvRow;
          const origPrice = parseFloat(addBtn.dataset.originalPrice);
          const price = Number.isFinite(origPrice) ? origPrice * getMarginMultiplier() : odd.price;
          const oddForRow = lbl?.dataset.usesMarketName === "true"
            ? { ...odd, name: newName, price }
            : { ...odd, price };
          const newRow = buildSpecijalRow({ event: currentEvent, marketName: newName, odd: oddForRow });
          document.dispatchEvent(new CustomEvent("update-csv-row", { detail: { oldRow, newRow, button: addBtn } }));
        }
      }
    };

    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
    title.addEventListener("input", () => { applyEdit(title.textContent.trim() || market.marketName); });
    resetBtn.addEventListener("click", () => { title.textContent = market.marketName; applyEdit(market.marketName); });

    titleArea.append(title, resetBtn);
    card.append(titleArea, originalNameEl, oddsGrid);
    return card;
  }

  oddsGrid.append(...market.odds.map((odd) => createOddButton(odd, "", isSplitStatistika ? market.marketName : null, market.uuid)));

  if (isStatistika && !isSplitStatistika) {
    const titleArea = document.createElement("div");
    const title = document.createElement("h3");
    const addBtn = document.createElement("button");
    titleArea.className = "market-title-area";
    title.className = "market-title";
    title.textContent = market.marketName;
    addBtn.className = "add-odd-button";
    addBtn.type = "button";
    addBtn.dataset.marketUuid = market.uuid;
    addBtn.title = "Add to CSV";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => {
      if (addBtn.classList.contains("is-added")) {
        document.dispatchEvent(new CustomEvent("remove-statistika-from-csv", { detail: { button: addBtn } }));
      } else {
        document.dispatchEvent(new CustomEvent("add-statistika-to-csv", { detail: { market, button: addBtn } }));
      }
    });
    titleArea.append(title, addBtn);
    card.append(titleArea, oddsGrid);
  } else {
    const title = document.createElement("h3");
    title.className = "market-title";
    title.textContent = market.marketName;
    card.append(title, oddsGrid);
  }

  return card;
}

function createOddButton(odd, contextText = "", comboMarketName = null, marketUuid = null) {
  const isCombo = comboMarketName !== null;
  const button = document.createElement("button");
  const label = document.createElement("span");
  const price = document.createElement("span");

  button.className = "odd-button";
  button.type = "button";
  label.className = "odd-label";
  price.className = "odd-price";
  label.textContent = contextText ? `${contextText} - ${odd.name}` : odd.name;
  price.dataset.originalPrice = odd.price;
  price.textContent = Number.isFinite(odd.price) ? (odd.price * getMarginMultiplier()).toFixed(2) : "-";
  button.append(label, price);

  if (!isCombo) return button;

  // Mark the label so the card title editor knows to sync it
  if (odd.name === comboMarketName) label.dataset.usesMarketName = "true";

  // Combo market: wrap the odd button with an add (+) button
  const addBtn = document.createElement("button");
  addBtn.className = "add-odd-button add-odd-button--inline";
  addBtn.type = "button";
  addBtn.title = "Add to CSV as Specijali";
  addBtn.textContent = "+";
  addBtn.dataset.currentMarketName = comboMarketName;
  if (marketUuid) addBtn.dataset.marketUuid = marketUuid;
  if (odd.uuid) addBtn.dataset.oddUuid = odd.uuid;
  addBtn.addEventListener("click", () => {
    if (addBtn.classList.contains("is-added")) {
      document.dispatchEvent(new CustomEvent("remove-specijal-from-csv", { detail: { button: addBtn } }));
    } else {
      const currentMarketName = addBtn.dataset.currentMarketName;
      // For single-outcome combos the label mirrors the market name; keep "DA" in Gost even after an edit
      const dispatchOdd = label.dataset.usesMarketName === "true" ? { ...odd, name: currentMarketName } : odd;
      document.dispatchEvent(new CustomEvent("add-specijal-to-csv", { detail: { marketName: currentMarketName, odd: dispatchOdd, button: addBtn } }));
    }
  });

  const wrapper = document.createElement("div");
  wrapper.className = "combo-odd-wrapper";
  wrapper.append(button, addBtn);
  return wrapper;
}

function createEmptyState(text, icon = "📋") {
  const empty = document.createElement("div");
  const iconEl = document.createElement("span");
  const textEl = document.createElement("span");
  empty.className = "empty-state";
  iconEl.className = "empty-icon";
  iconEl.textContent = icon;
  textEl.textContent = text;
  empty.append(iconEl, textEl);
  return empty;
}

// ── Default statistika markets ────────────────────────────────────────────────

const DEFAULT_MARKET_BASES = [
  "1. poluvreme - ukupno kornera",
  "1. poluvreme - ukupno kornera {home}",
  "1. poluvreme - ukupno kornera {away}",
  "1. poluvreme - ukupno kartona",
  "Ukupno kornera",
  "Ukupno kornera {home}",
  "Ukupno kornera {away}",
  "Korneri raspon {home}",
  "Korneri raspon {away}",
  "Ukupno kartona",
  "Ukupno kartona {home}",
  "Ukupno kartona {away}",
  "Ukupno crvenih kartona",
  "Ukupno šuteva u okvir gola",
  "{home} ukupno šuteva u okvir gola",
  "{away} ukupno šuteva u okvir gola",
  "Ukupno faulova",
  "Ukupno ofsajda",
];

const BASKETBALL_DEFAULT_MARKET_BASES = [
  "Ukupno asistencija (uklj. produžetke)",
  "Ukupno skokova (uklj. produžetke)",
  "Ukupno postignutih 3 poena (uklj. produžetke)",
  "{home} - Ukupno asistencija (uklj. produžetke)",
  "{away} - Ukupno asistencija (uklj. produžetke)",
  "Ukupno skokova {home} (uklj. produžetke)",
  "Ukupno skokova {away} (uklj. produžetke)",
  "{home} - Ukupno pogodaka za 3 poena (uklj. produžetke)",
  "{away} - Ukupno pogodaka za 3 poena (uklj. produžetke)"
];

let _defaultHost = null;

function _resetDefaultHost() {
  if (_defaultHost) _defaultHost.replaceChildren();
}

function _getDefaultHost() {
  if (!_defaultHost) {
    _defaultHost = document.createElement("div");
    _defaultHost.id = "default-btn-host";
    _defaultHost.style.display = "none";
    document.body.appendChild(_defaultHost);
  }
  return _defaultHost;
}

function csvContainsRow(csv, row) {
  return String(csv).split(/\r?\n/).some((line) => line === row);
}

function findVisibleStatistikaButton(marketUuid, odd = null) {
  for (const button of document.querySelectorAll(".add-odd-button")) {
    if (button.closest("#default-btn-host")) continue;
    if (!button.dataset.marketUuid || String(button.dataset.marketUuid) !== String(marketUuid)) continue;
    if (odd === null) return button;
    if (button.dataset.oddUuid && String(button.dataset.oddUuid) === String(odd.uuid)) return button;
  }
  return null;
}

function copyButtonState(source, target) {
  for (const key of ["csvRow", "originalPrice", "originalPriceU", "originalPriceO", "oddUuid", "marketUuid"]) {
    if (source.dataset[key]) {
      target.dataset[key] = source.dataset[key];
    }
  }
  target.classList.add("is-added");
  target.textContent = "✓";
  target.title = "Remove from CSV";
}

function syncHiddenDefaultButtons() {
  const host = _getDefaultHost();
  if (!host) return;

  for (const hiddenButton of Array.from(host.querySelectorAll(".add-odd-button.is-added"))) {
    if (!hiddenButton.dataset.marketUuid) continue;
    const visibleButton = Array.from(document.querySelectorAll(".add-odd-button")).find((button) => {
      if (button.closest("#default-btn-host")) return false;
      if (!button.dataset.marketUuid || String(button.dataset.marketUuid) !== String(hiddenButton.dataset.marketUuid)) return false;
      if (hiddenButton.dataset.oddUuid) {
        return button.dataset.oddUuid === hiddenButton.dataset.oddUuid;
      }
      return !button.dataset.oddUuid;
    });
    if (!visibleButton || visibleButton.classList.contains("is-added")) continue;
    copyButtonState(hiddenButton, visibleButton);
    hiddenButton.remove();
  }
}

function _balanceScore(market) {
  let under = null, over = null;
  for (const odd of market.odds) {
    const n = normalizeSearchText(odd.name);
    if (n.includes("manje") || n.includes("under")) under = odd.price;
    else if (n.includes("vise") || n.includes("over")) over = odd.price;
  }
  return (under != null && over != null) ? Math.abs(under - over) : Infinity;
}

export function addDefaultStatistikaMarkets() {
  if (!currentEvent || !currentMarkets.length) return;

  const home = currentEvent.homeTeam || "";
  const away = currentEvent.awayTeam || "";
  const host = _getDefaultHost();

  syncHiddenDefaultButtons();

  // Remove stale non-added buttons from previous partial runs
  for (const btn of Array.from(host.children)) {
    if (!btn.classList.contains("is-added")) btn.remove();
  }

  const bases = currentSportId === 4 ? BASKETBALL_DEFAULT_MARKET_BASES : DEFAULT_MARKET_BASES;

  for (const base of bases) {
    if (base.includes("{home}") && !home) continue;
    if (base.includes("{away}") && !away) continue;

    const resolved = base.replace("{home}", home).replace("{away}", away);
    const specNorm = normalizeSearchText(resolved);

    const matches = currentMarkets.filter((m) => normalizeSearchText(m.marketName) === specNorm);
    if (!matches.length) continue;

    const isSplit = matches[0].odds.length >= 3;

    if (isSplit) {
      for (const market of matches) {
        for (const odd of market.odds) {
          const specKey = `${specNorm}|${normalizeSearchText(odd.name)}`;
          if (host.querySelector(`[data-spec-key="${CSS.escape(specKey)}"].is-added`)) continue;

          const visibleButton = findVisibleStatistikaButton(market.uuid, odd);
          if (visibleButton) {
            if (!visibleButton.classList.contains("is-added")) {
              visibleButton.click();
            }
            continue;
          }

          const btn = document.createElement("button");
          btn.className = "add-odd-button add-odd-button--inline";
          btn.dataset.specKey = specKey;
          host.appendChild(btn);
          document.dispatchEvent(new CustomEvent("add-specijal-to-csv", {
            detail: { marketName: market.marketName, odd, button: btn }
          }));
        }
      }
    } else {
      const best = matches.reduce((b, m) => _balanceScore(m) < _balanceScore(b) ? m : b);
      const specKey = specNorm;
      if (host.querySelector(`[data-spec-key="${CSS.escape(specKey)}"].is-added`)) continue;

      const visibleButton = findVisibleStatistikaButton(best.uuid);
      if (visibleButton) {
        if (!visibleButton.classList.contains("is-added")) {
          visibleButton.click();
        }
        continue;
      }

      const btn = document.createElement("button");
      btn.className = "add-odd-button";
      btn.dataset.specKey = specKey;
      host.appendChild(btn);
      document.dispatchEvent(new CustomEvent("add-statistika-to-csv", {
        detail: { market: best, button: btn }
      }));
    }
  }
}

// ── Basketball rosters and player team guessing ────────────────────────────────

const BASKETBALL_ROSTERS = {
  "olympiacos": [
    "fournier", "milutinov", "papanikolaou", "dorsey", "vezenkov", "walkup",
    "williams-goss", "vildoza", "wright", "peters", "mckissic", "fall", "mitrou-long", "larentzakis"
  ],
  "fenerbahce": [
    "baldwin", "biberovic", "birch", "colson", "hall", "melli", "guduric",
    "hayes-davis", "zagars", "marjanovic", "sanli", "wilbekin", "mays", "pierre", "gazi", "mahmutoglu", "birsen", "sestina"
  ],
  "zvezda": [
    "teodosic", "nedovic", "mitrovic", "giedraitis", "bolomboy", "canaan",
    "miller-mcintyre", "kalinic", "dos santos", "yago", "daum", "plavsic", "davidovac", "dobric", "lazic", "kenan"
  ],
  "partizan": [
    "ntilikina", "lundberg", "bonga", "davies", "brown", "washington",
    "marinkovic", "nakic", "pokusevski", "koprivica", "lakic", "carlik", "tyrique"
  ]
};

function guessBasketballPlayerTeam(playerName, homeTeam, awayTeam) {
  const normName = normalizeSearchText(playerName);
  const normHome = normalizeSearchText(homeTeam);
  const normAway = normalizeSearchText(awayTeam);

  for (const [teamKey, players] of Object.entries(BASKETBALL_ROSTERS)) {
    for (const p of players) {
      if (normName.includes(p)) {
        if (normHome.includes(teamKey)) return "home";
        if (normAway.includes(teamKey)) return "away";
      }
    }
  }

  if (normHome.split(/\s+/).some(word => word.length > 3 && normName.includes(word))) return "home";
  if (normAway.split(/\s+/).some(word => word.length > 3 && normName.includes(word))) return "away";

  return "home";
}

function createPlayerGroupCardsBasketball(markets, search = "") {
  const playerMap = new Map();
  const searchNorm = normalizeSearchText(search);
  const minPrice = parseFloat(elements.specijalMin.value);
  const maxPrice = parseFloat(elements.specijalMax.value);

  for (const market of markets) {
    for (const odd of market.odds) {
      if (!odd.playerName) continue;
      if (Number.isFinite(odd.price) && (odd.price > 50 || odd.price < 1.01)) continue;
      if (Number.isFinite(odd.price)) {
        if (!Number.isNaN(minPrice) && odd.price < minPrice) continue;
        if (!Number.isNaN(maxPrice) && odd.price > maxPrice) continue;
      }
      const playerName = resolvePlayerName(odd);
      if (!playerName) continue;
      const norm = normalizeSearchText(playerName);
      if (!playerMap.has(norm)) {
        playerMap.set(norm, { name: playerName, matches: [] });
      }
      playerMap.get(norm).matches.push({ marketName: market.marketName, odd });
    }
  }

  return Array.from(playerMap.values())
    .filter(({ name }) => !searchNorm || normalizeSearchText(formatPlayerName(name)).includes(searchNorm))
    .sort((a, b) => formatPlayerName(a.name).localeCompare(formatPlayerName(b.name)))
    .map(({ name, matches }) => createPlayerGroupCardBasketball(formatPlayerName(name), matches));
}

function createPlayerGroupCardBasketball(query, matches) {
  const card = document.createElement("article");
  const headerArea = document.createElement("div");
  const header = document.createElement("button");
  const headerText = document.createElement("div");
  const title = document.createElement("h3");
  const count = document.createElement("span");
  const chevron = document.createElement("span");
  const selectBtn = document.createElement("button");
  const oddsList = document.createElement("div");

  card.className = "market-card player-results";
  headerArea.className = "player-card-header-area";
  header.className = "player-card-header";
  header.type = "button";
  headerText.className = "player-card-header-text";
  title.className = "market-title";
  count.className = "player-card-count";
  chevron.className = "player-card-chevron";
  selectBtn.className = "player-select-btn";
  selectBtn.type = "button";
  selectBtn.title = "Add default markets to CSV";
  selectBtn.textContent = "+";
  oddsList.className = "player-odds-list";

  title.textContent = query;
  count.textContent = `${matches.length} odds`;
  chevron.textContent = "›";
  oddsList.append(...matches.map(({ marketName, odd }) => createPlayerOddRow(marketName, odd)));

  header.addEventListener("click", () => card.classList.toggle("is-expanded"));

  const teamSelect = document.createElement("select");
  teamSelect.className = "player-team-select";
  
  const homeTeam = currentEvent?.homeTeam || "Domaćin";
  const awayTeam = currentEvent?.awayTeam || "Gost";
  
  const optHome = new Option(homeTeam, "home");
  const optAway = new Option(awayTeam, "away");
  teamSelect.add(optHome);
  teamSelect.add(optAway);

  let initialSide = guessBasketballPlayerTeam(query, homeTeam, awayTeam);
  teamSelect.value = initialSide;
  
  matches.forEach(({ odd }) => {
    odd.playerTeam = initialSide;
  });

  let previousValue = initialSide;
  teamSelect.addEventListener("change", () => {
    const hasAdded = oddsList.querySelector(".add-odd-button.is-added");
    if (hasAdded) {
      alert("Ne možete promeniti tim igrača jer su njegove kvote već dodate u CSV.");
      teamSelect.value = previousValue;
      return;
    }
    const newSide = teamSelect.value;
    previousValue = newSide;
    matches.forEach(({ odd }) => {
      odd.playerTeam = newSide;
    });
  });

  teamSelect.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  selectBtn.addEventListener("click", () => {
    if (selectBtn.classList.contains("is-selected")) {
      selectBtn.classList.remove("is-selected");
      selectBtn.textContent = "+";
      selectBtn.title = "Add default markets to CSV";
      for (const btn of oddsList.querySelectorAll(".add-odd-button.is-added")) {
        btn.click();
      }
    } else {
      const csvValue = elements.csvOutput.value.trim();
      const currentSide = teamSelect.value;
      if (csvValue) {
        const csvLines = csvValue.split(/\r?\n/);
        const firstMatchLine = csvLines.find((l) => l.startsWith("MATCH_NAME:"));
        const csvTeam = firstMatchLine ? firstMatchLine.slice("MATCH_NAME:".length) : "";
        const playerTeam = currentSide === "home" ? currentEvent?.homeTeam : currentEvent?.awayTeam;
        if (csvTeam && playerTeam && csvTeam !== playerTeam) return;
      }
      selectBtn.classList.add("is-selected");
      selectBtn.textContent = "✓";
      selectBtn.title = "Remove from CSV";
      for (const btn of oddsList.querySelectorAll(".add-odd-button:not(.is-added)")) {
        if (btn.dataset.marketName && isDefaultPlayerMarket(btn.dataset.marketName)) {
          btn.click();
        }
      }
    }
  });

  headerText.append(title, count);
  header.append(headerText, chevron);
  headerArea.append(header, teamSelect, selectBtn);
  card.append(headerArea, oddsList);

  return card;
}
