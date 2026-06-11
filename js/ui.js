import { buildSpecijalRow, buildGroupOutrightCsvBlock, buildGroupPointsCsvRows, countCsvRows, CSV_COLUMNS, buildFullGroupSimulationCsv, buildTeamSimulationCsv, buildStatistikaMarketCsvRow, buildSingleOddCsvRow, makeCsvFilename, replaceTeamNameInText, detectCsvState, toAsciiMarketName, getRewrittenString } from "./csv.js";
import { detectGroups, getEventWinnerOdds, runGroupSimulation, runTournamentSimulation, calculateOddsForGroup } from "./simulator.js";

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
  specijalFilterClear: document.querySelector("#specijali-filter-clear"),
  eventNameRewrite: document.querySelector("#event-name-rewrite"),
  eventNameRewriteWrap: document.querySelector("#event-name-rewrite-wrap")
};

let optionIndex = new Map();
let eventIndex = new Map();
let currentMarkets = [];
let currentEvent = null;
let previousEventName = "";
/** @type {"all"|"standard"|"statistika"|"specijali"|"home-players"|"away-players"|"players"} */
let activeMarketTab = "all";
let marketSearch = "";
let currentSportId = 5; // Default is soccer (5)
let activeSimSubTab = "groups";
const expandedPlayers = new Set();

const WORLD_CUP_2026_FALLBACK_OUTRIGHTS = {
  "Španija": 5.50,
  "Francuska": 6.00,
  "Engleska": 8.00,
  "Brazil": 9.00,
  "Argentina": 9.50,
  "Portugal": 12.00,
  "Nemačka": 14.00,
  "Holandija": 20.00,
  "Norveška": 35.00,
  "Belgija": 40.00,
  "Kolumbija": 45.00,
  "Japan": 65.00,
  "Maroko": 65.00,
  "SAD": 65.00,
  "USA": 65.00,
  "Sjedinjene Američke Države": 65.00,
  "Meksiko": 75.00,
  "Urugvaj": 75.00,
  "Švajcarska": 85.00,
  "Hrvatska": 100.00,
  "Ekvador": 100.00,
  "Turska": 100.00,
  "Austrija": 150.00,
  "Senegal": 150.00,
  "Švedska": 150.00,
  "Paragvaj": 200.00,
  "Kanada": 250.00,
  "Egipat": 250.00,
  "Obala Slonovače": 250.00,
  "Škotska": 250.00,
  "Češka": 350.00,
  "Gana": 350.00,
  "Bosna i Hercegovina": 475.00,
  "Alžir": 500.00,
  "Australija": 500.00,
  "Iran": 500.00,
  "Južna Koreja": 500.00,
  "Tunis": 500.00,
  "DR Kongo": 750.00,
  "Irak": 1000.00,
  "Novi Zeland": 1000.00,
  "Panama": 1000.00,
  "Katar": 1000.00,
  "Saudijska Arabija": 1000.00
};

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

export function getEventName() {
  const event = getSelectedEvent();
  if (!event) return "";
  const defaultEventName = event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : event.matchName;
  if (elements.eventNameRewrite) {
    const val = elements.eventNameRewrite.value.trim();
    if (!val) return defaultEventName;
    let parts = val.split(/\s+-\s+/);
    if (parts.length !== 2) {
      parts = val.split(/\s*-\s*/);
    }
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return val;
    }
  }
  return defaultEventName;
}

export function getRewrittenTeamNames() {
  const event = getSelectedEvent();
  if (!event) return { home: "", away: "" };
  const name = getEventName();
  let parts = name.split(/\s+-\s+/);
  if (parts.length !== 2) {
    parts = name.split(/\s*-\s*/);
  }
  if (parts.length === 2) {
    return {
      home: parts[0].trim(),
      away: parts[1].trim()
    };
  }
  return {
    home: event.homeTeam || "",
    away: event.awayTeam || ""
  };
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

  const defaultEventName = event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : (event.matchName || "");
  previousEventName = defaultEventName;
  if (elements.eventNameRewrite) {
    elements.eventNameRewrite.value = defaultEventName;
    elements.eventNameRewrite.classList.remove("is-invalid");
  }
  if (elements.eventNameRewriteWrap) {
    elements.eventNameRewriteWrap.style.display = "flex";
  }

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

  previousEventName = "";
  expandedPlayers.clear();
  if (elements.eventNameRewrite) {
    elements.eventNameRewrite.value = "";
    elements.eventNameRewrite.classList.remove("is-invalid");
  }
  if (elements.eventNameRewriteWrap) {
    elements.eventNameRewriteWrap.style.display = "none";
  }

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
  expandedPlayers.clear();
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

  // Auto-check default statistika markets on render
  addDefaultStatistikaMarkets();

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

export function getOutrightMarginMultiplier() {
  const input = document.querySelector("#margin-pct-outright");
  const pct = input ? parseFloat(input.value) : NaN;
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  const rad = document.querySelector('input[name="margin-dir-outright"]:checked');
  const direction = rad ? rad.value : "decrease";
  return direction === "decrease" ? 1 - pct / 100 : 1 + pct / 100;
}

export function getOuMarginMultiplier() {
  const input = document.querySelector("#margin-pct-ou");
  const pct = input ? parseFloat(input.value) : NaN;
  if (!Number.isFinite(pct) || pct <= 0) return 1;
  const rad = document.querySelector('input[name="margin-dir-ou"]:checked');
  const direction = rad ? rad.value : "decrease";
  return direction === "decrease" ? 1 - pct / 100 : 1 + pct / 100;
}

export function refreshDisplayedPrices() {
  const outrightM = getOutrightMarginMultiplier();
  const ouM = getOuMarginMultiplier();
  for (const el of document.querySelectorAll(".odd-price[data-original-price], .player-odd-price[data-original-price], .odds-value-display[data-original-price]")) {
    const orig = parseFloat(el.dataset.originalPrice);
    if (!Number.isFinite(orig)) continue;
    const type = el.dataset.marketType || "outright";
    const m = type === "ou" ? ouM : outrightM;
    el.textContent = (orig * m).toFixed(2);
  }
}

export async function renderMarketsForCurrentFilter(preserveScroll = false) {
  const scrollY = window.scrollY;

  const rewrittenTeams = getRewrittenTeamNames();
  const homeTab = document.querySelector('[data-tab="home-players"]');
  const awayTab = document.querySelector('[data-tab="away-players"]');
  if (homeTab) homeTab.textContent = rewrittenTeams.home || "Dom. igrači";
  if (awayTab) awayTab.textContent = rewrittenTeams.away || "Gost. igrači";

  const startSifraContainer = document.querySelector("#start-sifra-container");
  if (startSifraContainer) {
    startSifraContainer.style.display = (activeMarketTab === "simulation") ? "inline-flex" : "none";
  }

  if (activeMarketTab === "simulation") {
    if (!currentOutrightOdds || Object.keys(currentOutrightOdds).length === 0) {
      elements.marketsList.replaceChildren(createEmptyState("Učitavanje autrajt kvota...", "⏳"));
      try {
        const events = Array.from(eventIndex.values());
        const outrightEvent = findOutrightEvent(events);
        if (outrightEvent) {
          const markets = await fetchMarketsForEvent(outrightEvent);
          currentOutrightOdds = extractOutrightOdds(markets);
        } else {
          currentOutrightOdds = {};
        }
      } catch (err) {
        console.warn("Failed to fetch outright odds:", err);
        currentOutrightOdds = {};
      }

      const comp = getSelectedCompetition();
      const compName = (comp ? comp.tournamentName : "").toLowerCase();
      const isWorldCupComp = compName.includes("world cup") || compName.includes("svetsko prvenstvo") || compName.includes("svetsko");
      if (isWorldCupComp && (!currentOutrightOdds || Object.keys(currentOutrightOdds).length === 0)) {
        console.log("Using static fallback outright odds for World Cup 2026.");
        currentOutrightOdds = Object.assign({}, WORLD_CUP_2026_FALLBACK_OUTRIGHTS);
      }
    }
    renderSimulationView();
    if (preserveScroll) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    return;
  }

  if (!currentMarkets.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets found", "🏟️"));
    if (preserveScroll) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    return;
  }

  const tabFiltered = filterMarketsByTab(currentMarkets, activeMarketTab);

  if (activeMarketTab === "home-players" || activeMarketTab === "away-players") {
    const side = activeMarketTab === "home-players" ? "home" : "away";
    const cards = createPlayerGroupCardsByTeam(tabFiltered, side, marketSearch);
    if (!cards.length) {
      elements.marketsList.replaceChildren(createEmptyState("No player props found", "👤"));
      if (preserveScroll) {
        window.scrollTo(0, scrollY);
      } else {
        window.scrollTo(0, 0);
      }
      return;
    }
    elements.marketsList.replaceChildren(...cards);
    if (preserveScroll) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    return;
  }

  if (activeMarketTab === "players") {
    const cards = createPlayerGroupCardsBasketball(tabFiltered, marketSearch);
    if (!cards.length) {
      elements.marketsList.replaceChildren(createEmptyState("No player props found", "👤"));
      if (preserveScroll) {
        window.scrollTo(0, scrollY);
      } else {
        window.scrollTo(0, 0);
      }
      return;
    }
    elements.marketsList.replaceChildren(...cards);
    if (preserveScroll) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    return;
  }

  const searchNorm = normalizeSearchText(marketSearch);
  const visible = searchNorm
    ? tabFiltered.filter((m) => normalizeSearchText(getRewrittenString(m.marketName, currentEvent, getEventName())).includes(searchNorm))
    : tabFiltered;

  if (!visible.length) {
    elements.marketsList.replaceChildren(createEmptyState("No markets in this category", "🔍"));
    if (preserveScroll) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    return;
  }

  // Sort visible: selected default markets on top
  const selectedDefaults = [];
  const others = [];
  for (const m of visible) {
    if (isDefaultStatistikaMarket(m.marketName) && isMarketSelected(m)) {
      selectedDefaults.push(m);
    } else {
      others.push(m);
    }
  }
  const sortedVisible = [...selectedDefaults, ...others];

  elements.marketsList.replaceChildren(...sortedVisible.map(createMarketCard));
  if (preserveScroll) {
    window.scrollTo(0, scrollY);
  } else {
    window.scrollTo(0, 0);
  }
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
  "penal", "penali", "penala",
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

function isMarketCombo(market) {
  const norm = normalizeSearchText(market.marketName);
  if (norm.includes(";")) return true;
  if (currentSportId === 2) {
    if (norm.includes("&")) return true;
    if (norm.includes("osvaja") && norm.includes("set")) return true;
    if (norm.includes("sa nulom")) return true;
    if (norm.includes("posle") && norm.includes("gemova")) return true;
    if (norm.includes("nakon zaostatka")) return true;
    if (norm.includes("bez izgubljenog")) return true;
    if (norm.includes("oba igraca ce")) return true;
  }
  return false;
}

function filterMarketsByTab(markets, tab) {
  if (tab === "specijali") {
    return applyOddsRangeFilter(markets.filter(isMarketCombo));
  }

  if (tab === "all") return applyOddsRangeFilter(markets);

  // Both "standard" and "statistika" start from non-combo markets
  const nonCombo = markets.filter((m) => !isMarketCombo(m));

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
  "blokada", "blokade", "blokova", "blok",
  "izgubljenih lopti", "izgubljene lopte",
  "ukradenih lopti", "ukradene lopte",
  "slobodnih bacanja", "slobodna bacanja",
  "pogodaka za 3 poena", "postignutih 3 poena", "3 poena",
  "trojki", "trojke"
];

const TENNIS_STATISTIKA_KEYWORDS = [
  "asov", "asev", "dupl", "brejk", "poen", "servis"
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
    : currentSportId === 2
      ? TENNIS_STATISTIKA_KEYWORDS
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

      renderMarketsForCurrentFilter(false);
    });
  }

  elements.specijalMin.addEventListener("input", () => renderMarketsForCurrentFilter(true));
  elements.specijalMax.addEventListener("input", () => renderMarketsForCurrentFilter(true));
  elements.specijalFilterClear.addEventListener("click", () => {
    elements.specijalMin.value = "";
    elements.specijalMax.value = "";
    renderMarketsForCurrentFilter(true);
  });

  const searchInput = document.querySelector("#market-search");
  searchInput.addEventListener("input", () => {
    marketSearch = searchInput.value.trim();
    renderMarketsForCurrentFilter(true);
  });

  // Re-sort and render markets list when items are added/removed
  document.addEventListener("add-odd-to-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));
  document.addEventListener("remove-odd-from-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));
  document.addEventListener("add-specijal-to-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));
  document.addEventListener("remove-specijal-from-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));
  document.addEventListener("add-statistika-to-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));
  document.addEventListener("remove-statistika-from-csv", () => setTimeout(() => renderMarketsForCurrentFilter(true), 0));

function replaceTeamNameInCsv(csv, oldTeam, newTeam) {
  if (!csv) return csv;
  const lines = csv.split(/\r?\n/);
  if (lines.length <= 1) return csv;
  const replaced = [
    lines[0],
    ...lines.slice(1).map(line => replaceTeamNameInText(line, oldTeam, newTeam))
  ];
  return replaced.join("\r\n");
}

  if (elements.eventNameRewrite) {
    let debounceTimer = null;
    elements.eventNameRewrite.addEventListener("input", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const rawInput = elements.eventNameRewrite.value.trim();
        const event = getSelectedEvent();
        if (!event) return;

        const defaultEventName = event.homeTeam && event.awayTeam ? `${event.homeTeam} - ${event.awayTeam}` : (event.matchName || "");

        // 1. Validate custom input format
        let isValid = false;
        let newHome = "", newAway = "";

        if (rawInput === "") {
          isValid = true; // Empty is valid (reverts to default)
          const defaultParts = defaultEventName.split(/\s+-\s+/);
          if (defaultParts.length === 2) {
            newHome = defaultParts[0].trim();
            newAway = defaultParts[1].trim();
          }
        } else {
          let parts = rawInput.split(/\s+-\s+/);
          if (parts.length !== 2) {
            parts = rawInput.split(/\s*-\s*/);
          }
          if (parts.length === 2) {
            newHome = parts[0].trim();
            newAway = parts[1].trim();
            if (newHome && newAway) {
              isValid = true;
            }
          }
        }

        if (!isValid) {
          elements.eventNameRewrite.classList.add("is-invalid");
          return; // Prevent updating CSV / state
        }

        elements.eventNameRewrite.classList.remove("is-invalid");

        const newName = rawInput || defaultEventName;
        const csv = getCsvOutput();
        const baseName = previousEventName || defaultEventName;

        let prevHome = "", prevAway = "";
        let baseParts = baseName.split(/\s+-\s+/);
        if (baseParts.length !== 2) {
          baseParts = baseName.split(/\s*-\s*/);
        }
        if (baseParts.length === 2) {
          prevHome = baseParts[0].trim();
          prevAway = baseParts[1].trim();
        }

        if (csv) {
          let newCsv = csv;
          
          // 1. Replace team names in CSV body, keeping header row intact
          if (prevHome && newHome && prevHome !== newHome) {
            newCsv = replaceTeamNameInCsv(newCsv, prevHome, newHome);
            if (toAsciiMarketName(prevHome) !== prevHome) {
              newCsv = replaceTeamNameInCsv(newCsv, toAsciiMarketName(prevHome), toAsciiMarketName(newHome));
            }
          }
          if (prevAway && newAway && prevAway !== newAway) {
            newCsv = replaceTeamNameInCsv(newCsv, prevAway, newAway);
            if (toAsciiMarketName(prevAway) !== prevAway) {
              newCsv = replaceTeamNameInCsv(newCsv, toAsciiMarketName(prevAway), toAsciiMarketName(newAway));
            }
          }

          // 2. Replace LEAGUE_NAME line
          const lines = newCsv.split(/\r?\n/);
          const hasSpecijal = lines.some(line => line.startsWith("MATCH_NAME:Specijal"));
          if (hasSpecijal) {
            newCsv = lines.map(line => {
              if (line.startsWith("LEAGUE_NAME:")) {
                return `LEAGUE_NAME:${newName}`;
              }
              return line;
            }).join("\r\n");
          }

          // 3. Update button datasets
          for (const btn of document.querySelectorAll(".add-odd-button, .player-select-btn")) {
            if (btn.dataset.csvRow) {
              let row = btn.dataset.csvRow;
              if (prevHome && newHome && prevHome !== newHome) {
                row = replaceTeamNameInText(row, prevHome, newHome);
                if (toAsciiMarketName(prevHome) !== prevHome) {
                  row = replaceTeamNameInText(row, toAsciiMarketName(prevHome), toAsciiMarketName(newHome));
                }
              }
              if (prevAway && newAway && prevAway !== newAway) {
                row = replaceTeamNameInText(row, prevAway, newAway);
                if (toAsciiMarketName(prevAway) !== prevAway) {
                  row = replaceTeamNameInText(row, toAsciiMarketName(prevAway), toAsciiMarketName(newAway));
                }
              }
              btn.dataset.csvRow = row;
            }
          }

          const filename = makeCsvFilename(event, newName);
          renderCsvOutput(newCsv, filename, countCsvRows(newCsv));
        }

        previousEventName = newName;

        // Re-render the markets list with the new team names
        renderMarketsForCurrentFilter(true);
      }, 150);
    });
  }
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
    if (isMarketCombo(market)) continue;

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
  (n) => (n.includes("ukupan") || n.includes("ukupno")) && n.includes("sutev") && n.includes("okvir") && !n.includes("levom") && !n.includes("desnom") && !n.includes("van"),
  (n) => n.includes("ukupno") && n.includes("sutev") && !n.includes("okvir") && !n.includes("van") && !n.includes("levom") && !n.includes("desnom"),
  (n) => n.includes("karton"),
  (n) => n.includes("faul") && n.includes("nacinjenih"),
];

function isDefaultPlayerMarket(marketName) {
  if (currentSportId === 4) {
    return isDefaultPlayerMarketBasketball(marketName);
  }
  if (currentSportId === 2) {
    return isDefaultPlayerMarketTennis(marketName);
  }
  const n = normalizeSearchText(marketName);
  return DEFAULT_MARKET_CHECKS.some((check) => check(n));
}

function isDefaultPlayerMarketTennis(marketName) {
  const n = normalizeSearchText(marketName);
  return n.includes("asova") || n.includes("aseva") || n.includes("duplih") || n.includes("brejk") || n.includes("osvojenih poena");
}

function isDefaultPlayerMarketBasketball(marketName) {
  const n = normalizeSearchText(marketName);
  return n.includes("poena") || n.includes("asistenc") || n.includes("skok") || n.includes("trojk") || n.includes("3 poen");
}

function isDefaultStatistikaMarket(marketName) {
  if (!currentEvent) return false;
  const home = currentEvent.homeTeam || "";
  const away = currentEvent.awayTeam || "";
  const bases = currentSportId === 4
    ? BASKETBALL_DEFAULT_MARKET_BASES
    : currentSportId === 2
      ? TENNIS_DEFAULT_MARKET_BASES
      : DEFAULT_MARKET_BASES;
  const specNorm = normalizeSearchText(marketName);
  return bases.some((base) => {
    if (base.includes("{home}") && !home) return false;
    if (base.includes("{away}") && !away) return false;
    const resolved = base.replace("{home}", home).replace("{away}", away);
    return normalizeSearchText(resolved) === specNorm;
  });
}

function isMarketSelected(market) {
  const csv = elements.csvOutput.value;
  if (!csv) return false;
  
  const isCombo = isMarketCombo(market);
  const isStatistika = !isCombo && isStatistikaMarket(market.marketName);
  const isSplitStatistika = isStatistika && market.odds.length >= 3;
  
  if (isStatistika && !isSplitStatistika) {
    const type = "ou";
    const m = getOuMarginMultiplier();
    const adjustedMarket = m !== 1
      ? { ...market, odds: market.odds.map((o) => ({ ...o, price: o.price * m })) }
      : market;
    const row = buildStatistikaMarketCsvRow({ event: currentEvent, market: adjustedMarket, rewrittenEventName: getEventName() });
    return csvContainsRow(csv, row);
  } else {
    return market.odds.some((o) => {
      const type = "outright";
      const m = getOutrightMarginMultiplier();
      const adjustedOdd = m !== 1 ? { ...o, price: o.price * m } : o;
      const row = buildSpecijalRow({ event: currentEvent, marketName: market.marketName, odd: adjustedOdd, rewrittenEventName: getEventName() });
      return csvContainsRow(csv, row);
    });
  }
}

function isPlayerOddSelected(playerName, marketName, odd) {
  const csv = elements.csvOutput.value;
  if (!csv) return false;
  
  const event = currentEvent;
  if (!event) return false;
  
  const type = "ou";
  const m = getOuMarginMultiplier();
  const adjustedOdd = m !== 1 ? { ...odd, price: odd.price * m } : odd;
  const row = buildSingleOddCsvRow({ event, marketName, odd: adjustedOdd, rewrittenEventName: getEventName() });
  return csvContainsPlayerRow(csv, playerName, row);
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

  const defaultOdds = matches.filter(({ marketName }) => isDefaultPlayerMarket(marketName));
  const allDefaultsSelected = defaultOdds.length > 0 && defaultOdds.every(({ marketName, odd }) => isPlayerOddSelected(query, marketName, odd));

  if (allDefaultsSelected) {
    selectBtn.classList.add("is-selected");
    selectBtn.textContent = "✓";
    selectBtn.title = "Remove from CSV";
  } else {
    selectBtn.title = "Add default markets to CSV";
    selectBtn.textContent = "+";
  }
  oddsList.className = "player-odds-list";

  title.textContent = query;
  count.textContent = `${matches.length} odds`;
  chevron.textContent = "›";
  const sortedMatches = [...matches].sort((a, b) => {
    const aDefault = isDefaultPlayerMarket(a.marketName);
    const bDefault = isDefaultPlayerMarket(b.marketName);
    const aSelected = isPlayerOddSelected(query, a.marketName, a.odd);
    const bSelected = isPlayerOddSelected(query, b.marketName, b.odd);
    const aVal = (aDefault && aSelected) ? 1 : 0;
    const bVal = (bDefault && bSelected) ? 1 : 0;
    return bVal - aVal;
  });
  oddsList.append(...sortedMatches.map(({ marketName, odd }) => createPlayerOddRow(query, marketName, odd)));

  const normQuery = normalizeSearchText(query);
  if (expandedPlayers.has(normQuery)) {
    card.classList.add("is-expanded");
  }

  header.addEventListener("click", () => {
    const isExpanded = card.classList.toggle("is-expanded");
    if (isExpanded) {
      expandedPlayers.add(normQuery);
    } else {
      expandedPlayers.delete(normQuery);
    }
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
      const state = detectCsvState(csvValue);
      if (state === "statistika") {
        showToast("Ocisti statistiku prvo", "warning");
        return;
      }
      if (state === "specijali") {
        showToast("Nije dozvoljeno mešanje specijala i igrača", "warning");
        return;
      }
      const csvLines = csvValue.split(/\r?\n/);
      const firstMatchLine = csvLines.find((l) => l.startsWith("MATCH_NAME:"));
      const csvTeam = firstMatchLine ? firstMatchLine.slice("MATCH_NAME:".length).split(",")[0].trim() : "";
      if (csvTeam === "Specijal") {
        const differentTeamAdded = Array.from(document.querySelectorAll(".add-odd-button.is-added"))
          .some((btn) => btn.dataset.playerTeam && btn.dataset.playerTeam !== side);
        if (differentTeamAdded) return;
      } else {
        const rewritten = getRewrittenTeamNames();
        const playerTeam = side === "home" ? rewritten.home : rewritten.away;
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

function createPlayerOddRow(playerName, marketName, odd) {
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
  addButton.dataset.marketName = marketName;
  addButton.dataset.marketType = "ou";
  if (odd.playerTeam) {
    addButton.dataset.playerTeam = odd.playerTeam;
  }
  price.className = "player-odd-price player-odd-price--editable";
  price.contentEditable = "true";
  price.spellcheck = false;
  
  price.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  
  price.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      price.blur();
    }
  });

  price.addEventListener("blur", () => {
    const newPrice = parseFloat(price.textContent.trim());
    if (Number.isFinite(newPrice)) {
      const pM = getOuMarginMultiplier();
      odd.price = newPrice / pM;
      price.dataset.originalPrice = odd.price;
      
      if (addButton.classList.contains("is-added")) {
        const oldRow = addButton.dataset.csvRow;
        const event = currentEvent;
        const adjustedOdd = pM !== 1 ? { ...odd, price: odd.price * pM } : odd;
        const newRow = buildSingleOddCsvRow({ event, marketName, odd: adjustedOdd, rewrittenEventName: getEventName() });
        if (newRow && oldRow && newRow !== oldRow) {
          addButton.dataset.csvRow = newRow;
          addButton.dataset.originalPrice = odd.price;
          document.dispatchEvent(new CustomEvent("update-csv-row", { detail: { oldRow, newRow, button: addButton } }));
        }
      }
    } else {
      const pM = getOuMarginMultiplier();
      price.textContent = Number.isFinite(odd.price) ? (odd.price * pM).toFixed(2) : "-";
    }
  });

  const rewrittenEventName = getEventName();
  const finalMarketName = getRewrittenString(marketName, currentEvent, rewrittenEventName);
  const finalOddName = getRewrittenString(odd.name, currentEvent, rewrittenEventName);
  market.textContent = finalMarketName;
  name.textContent = finalOddName;
  price.dataset.marketType = "ou";
  price.dataset.originalPrice = odd.price;
  price.textContent = Number.isFinite(odd.price) ? (odd.price * getOuMarginMultiplier()).toFixed(2) : "-";

  const event = currentEvent;
  const pM = getOuMarginMultiplier();
  const adjustedOdd = pM !== 1 ? { ...odd, price: odd.price * pM } : odd;
  const pRow = buildSingleOddCsvRow({ event, marketName, odd: adjustedOdd, rewrittenEventName });
  if (csvContainsPlayerRow(elements.csvOutput.value, playerName, pRow)) {
    addButton.classList.add("is-added");
    addButton.textContent = "✓";
    addButton.title = "Remove from CSV";
    addButton.dataset.csvRow = pRow;
    addButton.dataset.originalPrice = odd.price;
  } else {
    addButton.textContent = "+";
  }

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
  const isCombo = isMarketCombo(market);
  const isStatistika = !isCombo && isStatistikaMarket(market.marketName);
  const isSplitStatistika = isStatistika && market.odds.length >= 3;
  const rewrittenEventName = getEventName();
  const finalMarketName = getRewrittenString(market.marketName, currentEvent, rewrittenEventName);

  card.className = isCombo ? "market-card market-card--combo" : "market-card";
  oddsGrid.className = "odds-grid";

  if (isCombo) {
    const comboEntries = market.odds.map((odd) => ({ wrapper: createOddButton(odd, "", finalMarketName, market.uuid), odd }));
    oddsGrid.append(...comboEntries.map((e) => e.wrapper));

    const titleArea = document.createElement("div");
    const title = document.createElement("h3");
    const resetBtn = document.createElement("button");
    const originalNameEl = document.createElement("p");

    titleArea.className = "market-title-area";
    title.className = "market-title market-title--editable";
    title.contentEditable = "true";
    title.spellcheck = false;
    title.textContent = finalMarketName;
    resetBtn.className = "market-reset-btn";
    resetBtn.type = "button";
    resetBtn.title = "Vrati originalni naziv";
    resetBtn.textContent = "↺";
    resetBtn.hidden = true;
    originalNameEl.className = "market-original-name";
    originalNameEl.textContent = finalMarketName;
    originalNameEl.hidden = true;

    const applyEdit = (newName) => {
      const changed = newName !== finalMarketName;
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
          const price = Number.isFinite(origPrice) ? origPrice * getOutrightMarginMultiplier() : odd.price;
          const oddForRow = lbl?.dataset.usesMarketName === "true"
            ? { ...odd, name: newName, price }
            : { ...odd, price };
          const newRow = buildSpecijalRow({ event: currentEvent, marketName: newName, odd: oddForRow, rewrittenEventName: getEventName() });
          document.dispatchEvent(new CustomEvent("update-csv-row", { detail: { oldRow, newRow, button: addBtn } }));
        }
      }
    };

    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
    title.addEventListener("input", () => { applyEdit(title.textContent.trim() || finalMarketName); });
    resetBtn.addEventListener("click", () => { title.textContent = finalMarketName; applyEdit(finalMarketName); });

    titleArea.append(title, resetBtn);
    card.append(titleArea, originalNameEl, oddsGrid);
    return card;
  }

  oddsGrid.append(...market.odds.map((odd) => createOddButton(odd, "", isSplitStatistika ? finalMarketName : null, market.uuid, isStatistika && !isSplitStatistika)));

  if (isStatistika && !isSplitStatistika) {
    const titleArea = document.createElement("div");
    const title = document.createElement("h3");
    const addBtn = document.createElement("button");
    titleArea.className = "market-title-area";
    title.className = "market-title";
    title.textContent = finalMarketName;
    addBtn.className = "add-odd-button";
    addBtn.type = "button";
    addBtn.dataset.marketUuid = market.uuid;
    addBtn.dataset.marketType = "ou";
    addBtn.title = "Add to CSV";

    const type = "ou";
    const m = getOuMarginMultiplier();
    const adjustedMarket = m !== 1
      ? { ...market, odds: market.odds.map((o) => ({ ...o, price: o.price * m })) }
      : market;
    const row = buildStatistikaMarketCsvRow({ event: currentEvent, market: adjustedMarket, rewrittenEventName: getEventName() });
    if (csvContainsRow(elements.csvOutput.value, row)) {
      addBtn.classList.add("is-added");
      addBtn.textContent = "✓";
      addBtn.title = "Remove from CSV";
      addBtn.dataset.csvRow = row;
      for (const o of market.odds) {
        const n = String(o.name).toLowerCase();
        if (n.includes("manje") || n.includes("under")) addBtn.dataset.originalPriceU = o.price;
        else if (n.includes("vise") || n.includes("over")) addBtn.dataset.originalPriceO = o.price;
      }
    } else {
      addBtn.textContent = "+";
    }

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
    title.textContent = finalMarketName;
    card.append(title, oddsGrid);
  }

  return card;
}

function createOddButton(odd, contextText = "", comboMarketName = null, marketUuid = null, isOu = false) {
  const isCombo = comboMarketName !== null;
  const button = document.createElement("button");
  const label = document.createElement("span");
  const price = document.createElement("span");

  button.className = "odd-button";
  button.type = "button";
  label.className = "odd-label";
  price.className = "odd-price odd-price--editable";
  price.contentEditable = "true";
  price.spellcheck = false;
  
  price.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  
  price.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      price.blur();
    }
  });

  price.addEventListener("blur", () => {
    const newPrice = parseFloat(price.textContent.trim());
    if (Number.isFinite(newPrice)) {
      const multiplier = isOu ? getOuMarginMultiplier() : getOutrightMarginMultiplier();
      odd.price = newPrice / multiplier;
      price.dataset.originalPrice = odd.price;
      
      // Find if the button or parent is added to CSV
      // 1. For statistika market (where add button is in card title area)
      const card = button.closest(".market-card");
      const marketAddBtn = card?.querySelector(".market-title-area > .add-odd-button");
      if (marketAddBtn && marketAddBtn.classList.contains("is-added")) {
        const market = currentMarkets.find(m => String(m.uuid) === String(marketAddBtn.dataset.marketUuid));
        if (market) {
          const oldRow = marketAddBtn.dataset.csvRow;
          const type = "ou";
          const m = getOuMarginMultiplier();
          const adjustedMarket = m !== 1
            ? { ...market, odds: market.odds.map((o) => ({ ...o, price: o.price * m })) }
            : market;
          const newRow = buildStatistikaMarketCsvRow({ event: currentEvent, market: adjustedMarket, rewrittenEventName: getEventName() });
          if (newRow && oldRow && newRow !== oldRow) {
            marketAddBtn.dataset.csvRow = newRow;
            document.dispatchEvent(new CustomEvent("update-csv-row", { detail: { oldRow, newRow, button: marketAddBtn } }));
          }
        }
      }
      
      // 2. For combo markets (where addBtn is .add-odd-button inside the combo wrapper)
      const addBtn = button.nextElementSibling;
      if (addBtn && addBtn.classList.contains("add-odd-button") && addBtn.classList.contains("is-added")) {
        const oldRow = addBtn.dataset.csvRow;
        const type = addBtn.dataset.marketType || "outright";
        const m = type === "ou" ? getOuMarginMultiplier() : getOutrightMarginMultiplier();
        const adjustedOdd = m !== 1 ? { ...odd, price: odd.price * m } : odd;
        const currentMarketName = addBtn.dataset.currentMarketName;
        const dispatchOdd = label.dataset.usesMarketName === "true" ? { ...odd, name: currentMarketName, price: adjustedOdd.price } : adjustedOdd;
        const newRow = buildSpecijalRow({ event: currentEvent, marketName: currentMarketName, odd: dispatchOdd, rewrittenEventName: getEventName() });
        if (newRow && oldRow && newRow !== oldRow) {
          addBtn.dataset.csvRow = newRow;
          addBtn.dataset.originalPrice = odd.price;
          document.dispatchEvent(new CustomEvent("update-csv-row", { detail: { oldRow, newRow, button: addBtn } }));
        }
      }
    } else {
      const multiplier = isOu ? getOuMarginMultiplier() : getOutrightMarginMultiplier();
      price.textContent = Number.isFinite(odd.price) ? (odd.price * multiplier).toFixed(2) : "-";
    }
  });

  const rewrittenEventName = getEventName();
  const finalComboMarketName = getRewrittenString(comboMarketName, currentEvent, rewrittenEventName);
  const finalOddName = getRewrittenString(odd.name, currentEvent, rewrittenEventName);
  const finalContextText = getRewrittenString(contextText, currentEvent, rewrittenEventName);

  label.textContent = finalContextText ? `${finalContextText} - ${finalOddName}` : finalOddName;
  price.dataset.marketType = isOu ? "ou" : "outright";
  price.dataset.originalPrice = odd.price;
  const m = isOu ? getOuMarginMultiplier() : getOutrightMarginMultiplier();
  price.textContent = Number.isFinite(odd.price) ? (odd.price * m).toFixed(2) : "-";
  button.append(label, price);

  if (!isCombo) return button;

  // Mark the label so the card title editor knows to sync it
  if (odd.name === comboMarketName) label.dataset.usesMarketName = "true";

  // Combo market: wrap the odd button with an add (+) button
  const addBtn = document.createElement("button");
  addBtn.className = "add-odd-button add-odd-button--inline";
  addBtn.type = "button";
  addBtn.title = "Add to CSV as Specijali";
  addBtn.dataset.currentMarketName = finalComboMarketName;
  addBtn.dataset.marketType = "outright";
  if (marketUuid) addBtn.dataset.marketUuid = marketUuid;
  if (odd.uuid) addBtn.dataset.oddUuid = odd.uuid;

  const type = "outright";
  const marginM = getOutrightMarginMultiplier();
  const adjustedOdd = marginM !== 1 ? { ...odd, price: odd.price * marginM } : odd;
  const row = buildSpecijalRow({ event: currentEvent, marketName: finalComboMarketName, odd: adjustedOdd, rewrittenEventName });
  if (csvContainsRow(elements.csvOutput.value, row)) {
    addBtn.classList.add("is-added");
    addBtn.textContent = "✓";
    addBtn.title = "Remove from CSV";
    addBtn.dataset.csvRow = row;
    addBtn.dataset.originalPrice = odd.price;
  } else {
    addBtn.textContent = "+";
  }

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (addBtn.classList.contains("is-added")) {
      document.dispatchEvent(new CustomEvent("remove-specijal-from-csv", { detail: { button: addBtn } }));
    } else {
      const currentMarketName = addBtn.dataset.currentMarketName;
      // For single-outcome combos the label mirrors the market name; keep "DA" in Gost even after an edit
      const dispatchOdd = label.dataset.usesMarketName === "true" ? { ...odd, name: currentMarketName } : odd;
      document.dispatchEvent(new CustomEvent("add-specijal-to-csv", { detail: { marketName: currentMarketName, odd: dispatchOdd, button: addBtn } }));
    }
  });

  button.addEventListener("click", (e) => {
    if (e.target.closest(".odd-price")) return;
    addBtn.click();
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
  "Ukupno crvenih kartona {home}",
  "Ukupno crvenih kartona {away}",
  "Ukupno šuteva u okvir gola",
  "{home} ukupno šuteva u okvir gola",
  "{away} ukupno šuteva u okvir gola",
  "Ukupno šuteva",
  "Ukupno šuteva {home}",
  "Ukupno šuteva {away}",
  "Ukupno faulova",
  "{home} Ukupno faulova",
  "{away} Ukupno faulova",
  "Ukupno ofsajda",
  "{home} ukupno ofsajda",
  "{away} ukupno ofsajda",
  "Ukupno dosuđenih penala",
];

const DEFAULT_OU_MARKET_RULES = new Map([
  ["ukupno dosudenih penala", { overLine: 0.5 }],
  ["ukupno dosudjenih penala", { overLine: 0.5 }],
]);


const BASKETBALL_DEFAULT_MARKET_BASES = [
  "Ukupno asistencija (uklj. produžetke)",
  "Ukupno skokova (uklj. produžetke)",
  "Ukupno blokada (uklj. produžetke)",
  "Ukupno trojki (uklj. produžetke)",
  "Ukupno postignutih 3 poena (uklj. produžetke)",
  "{home} - Ukupno asistencija (uklj. produžetke)",
  "{away} - Ukupno asistencija (uklj. produžetke)",
  "Ukupno skokova {home} (uklj. produžetke)",
  "Ukupno skokova {away} (uklj. produžetke)",
  "Ukupno blokada {home} (uklj. produžetke)",
  "Ukupno blokada {away} (uklj. produžetke)",
  "{home} - Ukupno trojki (uklj. produžetke)",
  "{away} - Ukupno trojki (uklj. produžetke)",
  "{home} - Ukupno pogodaka za 3 poena (uklj. produžetke)",
  "{away} - Ukupno pogodaka za 3 poena (uklj. produžetke)"
];

const TENNIS_DEFAULT_MARKET_BASES = [
  "Ukupno asova",
  "Ukupno asova - {home}",
  "Ukupno asova - {away}",
  "Ukupno duplih grešaka",
  "Ukupno duplih grešaka - {home}",
  "Ukupno duplih grešaka - {away}",
  "Ukupno asova + duplih grešaka",
  "Ukupno brejkova",
  "Ukupno brejkova - {home}",
  "Ukupno brejkova - {away}",
  "1. set - Ukupno asova",
  "1. set - Ukupno duplih grešaka",
  "1. Set - ukupno brejkova",
  "{home} osvaja tačno 1 set",
  "{away} osvaja tačno 1 set",
  "{home} osvaja tačno 2 seta",
  "{away} osvaja tačno 2 seta",
  "Barem jedan set sa nulom",
  "1. set - Tačan rezultat posle 6 gemova"
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

function csvContainsPlayerRow(csv, playerName, row) {
  if (!csv || !row) return false;
  const lines = csv.split(/\r?\n/);
  const normPlayer = normalizeSearchText(playerName);

  let currentPlayer = null;
  for (const line of lines) {
    if (line.startsWith("LEAGUE_NAME:")) {
      currentPlayer = normalizeSearchText(line.slice("LEAGUE_NAME:".length).trim());
    } else if (line.startsWith("MATCH_NAME:")) {
      currentPlayer = null;
    } else if (line.trim() === row.trim()) {
      console.log(`[csvContainsPlayerRow] Match line found! row: "${row.trim()}", currentPlayer: "${currentPlayer}", normPlayer: "${normPlayer}"`);
      if (currentPlayer === normPlayer) {
        return true;
      }
    }
  }
  return false;
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

function _extractOddLine(odd) {
  const m = String(odd?.name || "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) : NaN;
}

function _matchesDefaultOuRule(market, rule) {
  if (!rule) return true;
  if (Number.isFinite(rule.overLine)) {
    return market.odds.some((odd) => {
      const norm = normalizeSearchText(odd.name);
      return (norm.includes("vise") || norm.includes("over")) && _extractOddLine(odd) === rule.overLine;
    });
  }
  return true;
}

export function addDefaultStatistikaMarkets() {
  if (!currentEvent || !currentMarkets.length) return;

  const csv = elements.csvOutput.value.trim();
  if (csv && detectCsvState(csv) === "players") {
    showToast("Ocisti igrače prvo", "warning");
    return;
  }

  const home = currentEvent.homeTeam || "";
  const away = currentEvent.awayTeam || "";
  const host = _getDefaultHost();

  syncHiddenDefaultButtons();

  // Remove stale non-added buttons from previous partial runs
  for (const btn of Array.from(host.children)) {
    if (!btn.classList.contains("is-added")) btn.remove();
  }

  const bases = currentSportId === 4
    ? BASKETBALL_DEFAULT_MARKET_BASES
    : currentSportId === 2
      ? TENNIS_DEFAULT_MARKET_BASES
      : DEFAULT_MARKET_BASES;

  for (const base of bases) {
    if (base.includes("{home}") && !home) continue;
    if (base.includes("{away}") && !away) continue;

    const resolved = base.replace("{home}", home).replace("{away}", away);
    const specNorm = normalizeSearchText(resolved);

    const matches = currentMarkets.filter((m) => normalizeSearchText(m.marketName) === specNorm);
    if (!matches.length) continue;

    const isCombo = isMarketCombo(matches[0]);
    const isSplit = matches[0].odds.length >= 3;

    if (isCombo || isSplit) {
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
          btn.dataset.marketType = "outright";
          host.appendChild(btn);
          document.dispatchEvent(new CustomEvent("add-specijal-to-csv", {
            detail: { marketName: market.marketName, odd, button: btn }
          }));
        }
      }
    } else {
      const rule = DEFAULT_OU_MARKET_RULES.get(specNorm);
      const ruleMatches = rule ? matches.filter((m) => _matchesDefaultOuRule(m, rule)) : matches;
      if (!ruleMatches.length) continue;

      const best = ruleMatches.reduce((b, m) => _balanceScore(m) < _balanceScore(b) ? m : b);
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
      btn.dataset.marketType = "ou";
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

function guessPlayerTeam(playerName, homeTeam, awayTeam) {
  const normName = normalizeSearchText(playerName);
  const normHome = normalizeSearchText(homeTeam);
  const normAway = normalizeSearchText(awayTeam);

  if (currentSportId === 4) {
    for (const [teamKey, players] of Object.entries(BASKETBALL_ROSTERS)) {
      for (const p of players) {
        if (normName.includes(p)) {
          if (normHome.includes(teamKey)) return "home";
          if (normAway.includes(teamKey)) return "away";
        }
      }
    }
  }

  // General word containment check (works for Tennis and other sports)
  const homeWords = normHome.split(/\s+/).filter(w => w.length > 2);
  const awayWords = normAway.split(/\s+/).filter(w => w.length > 2);

  if (homeWords.some(word => normName.includes(word))) return "home";
  if (awayWords.some(word => normName.includes(word))) return "away";

  if (normHome.includes(normName) || normName.includes(normHome)) return "home";
  if (normAway.includes(normName) || normName.includes(normAway)) return "away";

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

  const defaultOdds = matches.filter(({ marketName }) => isDefaultPlayerMarket(marketName));
  const allDefaultsSelected = defaultOdds.length > 0 && defaultOdds.every(({ marketName, odd }) => isPlayerOddSelected(query, marketName, odd));

  if (allDefaultsSelected) {
    selectBtn.classList.add("is-selected");
    selectBtn.textContent = "✓";
    selectBtn.title = "Remove from CSV";
  } else {
    selectBtn.title = "Add default markets to CSV";
    selectBtn.textContent = "+";
  }
  oddsList.className = "player-odds-list";

  title.textContent = query;
  count.textContent = `${matches.length} odds`;
  chevron.textContent = "›";
  const sortedMatches = [...matches].sort((a, b) => {
    const aDefault = isDefaultPlayerMarket(a.marketName);
    const bDefault = isDefaultPlayerMarket(b.marketName);
    const aSelected = isPlayerOddSelected(query, a.marketName, a.odd);
    const bSelected = isPlayerOddSelected(query, b.marketName, b.odd);
    const aVal = (aDefault && aSelected) ? 1 : 0;
    const bVal = (bDefault && bSelected) ? 1 : 0;
    return bVal - aVal;
  });
  oddsList.append(...sortedMatches.map(({ marketName, odd }) => createPlayerOddRow(query, marketName, odd)));

  const normQuery = normalizeSearchText(query);
  if (expandedPlayers.has(normQuery)) {
    card.classList.add("is-expanded");
  }

  header.addEventListener("click", () => {
    const isExpanded = card.classList.toggle("is-expanded");
    if (isExpanded) {
      expandedPlayers.add(normQuery);
    } else {
      expandedPlayers.delete(normQuery);
    }
  });

  const teamSelect = document.createElement("select");
  teamSelect.className = "player-team-select";
  
  const homeTeam = currentEvent?.homeTeam || "Domaćin";
  const awayTeam = currentEvent?.awayTeam || "Gost";
  
  const optHome = new Option(homeTeam, "home");
  const optAway = new Option(awayTeam, "away");
  teamSelect.add(optHome);
  teamSelect.add(optAway);

  let initialSide = guessPlayerTeam(query, homeTeam, awayTeam);
  teamSelect.value = initialSide;
  
  matches.forEach(({ odd }) => {
    odd.playerTeam = initialSide;
  });

  let previousValue = initialSide;
  teamSelect.addEventListener("change", () => {
    const hasAdded = oddsList.querySelector(".add-odd-button.is-added");
    if (hasAdded) {
      showToast("Ne možete promeniti tim igrača jer su njegove kvote već dodate u CSV.", "warning");
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
        const csvTeam = firstMatchLine ? firstMatchLine.slice("MATCH_NAME:".length).split(",")[0].trim() : "";
        if (csvTeam === "Specijal") {
          const differentTeamAdded = Array.from(document.querySelectorAll(".add-odd-button.is-added"))
            .some((btn) => btn.dataset.playerTeam && btn.dataset.playerTeam !== currentSide);
          if (differentTeamAdded) return;
        } else {
          const rewritten = getRewrittenTeamNames();
          const playerTeam = currentSide === "home" ? rewritten.home : rewritten.away;
          if (csvTeam && playerTeam && csvTeam !== playerTeam) return;
        }
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

function findMatchingTeam(superbetTeam, euroleagueTeams) {
  if (!superbetTeam) return null;
  
  const normalize = (str) => {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove diacritics
      .replace(/[^a-z0-9\s]/g, "")      // remove non-alphanumeric except spaces
      .trim();
  };

  const normSuperbet = normalize(superbetTeam);
  if (!normSuperbet) return null;

  // 1. Exact match on normalized names
  for (const team of euroleagueTeams) {
    const normEl = normalize(team.teamName);
    if (normEl === normSuperbet) return team;
  }
  
  // 2. Substring match
  for (const team of euroleagueTeams) {
    const normEl = normalize(team.teamName);
    if (normEl.includes(normSuperbet) || normSuperbet.includes(normEl)) {
      return team;
    }
  }

  // 3. Word intersection
  const superbetWords = normSuperbet.split(/\s+/).filter(w => w.length > 2);
  for (const team of euroleagueTeams) {
    const normEl = normalize(team.teamName);
    const elWords = normEl.split(/\s+/).filter(w => w.length > 2);
    const intersection = superbetWords.filter(w => elWords.includes(w));
    if (intersection.length > 0) {
      return team;
    }
  }

  // 4. clubId matches
  for (const team of euroleagueTeams) {
    if (team.clubId) {
      const normClubId = normalize(team.clubId.replace(/-/g, " "));
      if (normClubId.includes(normSuperbet) || normSuperbet.includes(normClubId)) {
        return team;
      }
    }
  }

  return null;
}

export function renderEuroleagueStats(statsData, homeTeamName, awayTeamName) {
  const container = document.querySelector("#euroleague-stats-container");
  if (!container) return;

  const teams = statsData.teams || [];
  if (!teams.length) {
    container.innerHTML = `<div class="empty-state">No Euroleague team stats available.</div>`;
    return;
  }

  // Sort teams alphabetically by name
  const sortedTeams = [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName));

  // Build options for dropdowns
  const optionsHtml = sortedTeams.map(t => `<option value="${t.clubId}">${t.teamName}</option>`).join("");

  // Determine matching home and away teams
  const matchedHome = findMatchingTeam(homeTeamName, teams);
  const matchedAway = findMatchingTeam(awayTeamName, teams);

  // Set up container structure
  container.innerHTML = `
    <div class="euroleague-stats-header">
      <span class="euroleague-stats-title">🏀 Evroliga — Statistika Timova</span>
    </div>
    <div class="euroleague-stats-selectors">
      <div class="euroleague-select-wrap">
        <span class="euroleague-select-label">Domaćin - Statistika</span>
        <select id="euroleague-home-select" class="euroleague-team-select">${optionsHtml}</select>
      </div>
      <div class="euroleague-select-wrap">
        <span class="euroleague-select-label">Gost - Statistika</span>
        <select id="euroleague-away-select" class="euroleague-team-select">${optionsHtml}</select>
      </div>
    </div>
    <div class="euroleague-stats-cards">
      <div class="euroleague-stats-card" id="euroleague-home-card"></div>
      <div class="euroleague-stats-card" id="euroleague-away-card"></div>
    </div>
  `;

  const homeSelect = container.querySelector("#euroleague-home-select");
  const awaySelect = container.querySelector("#euroleague-away-select");

  // Pre-select matches
  if (matchedHome) {
    homeSelect.value = matchedHome.clubId;
  } else if (teams.length > 0) {
    homeSelect.value = teams[0].clubId;
  }

  if (matchedAway) {
    awaySelect.value = matchedAway.clubId;
  } else if (teams.length > 1) {
    awaySelect.value = teams[1].clubId;
  } else if (teams.length > 0) {
    awaySelect.value = teams[0].clubId;
  }

  // Function to render card stats
  const renderCard = (cardEl, team) => {
    if (!team) {
      cardEl.innerHTML = `<div class="empty-state">Izaberite tim</div>`;
      return;
    }

    const g = team.games || 1;

    // Calculations
    const pointsFor = ((team.madeTwo * 2 + team.madeThree * 3 + team.madeFt) / g).toFixed(1);
    const pointsAgainst = ((team.oppMadeTwo * 2 + team.oppMadeThree * 3 + team.oppMadeFt) / g).toFixed(1);
    const ftMade = (team.madeFt / g).toFixed(1);
    const twoMade = (team.madeTwo / g).toFixed(1);
    const threeMade = (team.madeThree / g).toFixed(1);
    const rebounds = ((team.defRebounds + team.offRebounds) / g).toFixed(1);
    const assists = (team.assists / g).toFixed(1);
    const turnovers = (team.turnovers / g).toFixed(1);

    const oppFtMade = (team.oppMadeFt / g).toFixed(1);
    const oppTwoMade = (team.oppMadeTwo / g).toFixed(1);
    const oppThreeMade = (team.oppMadeThree / g).toFixed(1);
    const oppRebounds = ((team.oppDefRebounds + team.oppOffRebounds) / g).toFixed(1);
    const oppAssists = (team.oppAssists / g).toFixed(1);
    const oppTurnovers = (team.oppTurnovers / g).toFixed(1);

    cardEl.innerHTML = `
      <h3 class="euroleague-card-team-name">${team.teamName}</h3>
      
      <div class="euroleague-card-section">
        <div class="euroleague-section-title">Prosek Tima</div>
        <div class="euroleague-section-grid">
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Poeni (Za)</span>
            <span class="euroleague-stat-value is-points-for">${pointsFor}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Poeni (Protiv)</span>
            <span class="euroleague-stat-value is-points-against">${pointsAgainst}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođena Sl. Bacanja</span>
            <span class="euroleague-stat-value">${ftMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođene 2P</span>
            <span class="euroleague-stat-value">${twoMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođene 3P</span>
            <span class="euroleague-stat-value">${threeMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Skokovi</span>
            <span class="euroleague-stat-value">${rebounds}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Asistencije</span>
            <span class="euroleague-stat-value">${assists}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Izg. Lopte</span>
            <span class="euroleague-stat-value">${turnovers}</span>
          </div>
        </div>
      </div>
      
      <div class="euroleague-card-section">
        <div class="euroleague-section-title">Prosek Protivnika (protiv ovog tima)</div>
        <div class="euroleague-section-grid">
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođena Sl. Bacanja</span>
            <span class="euroleague-stat-value">${oppFtMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođene 2P</span>
            <span class="euroleague-stat-value">${oppTwoMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Pogođene 3P</span>
            <span class="euroleague-stat-value">${oppThreeMade}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Skokovi</span>
            <span class="euroleague-stat-value">${oppRebounds}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Asistencije</span>
            <span class="euroleague-stat-value">${oppAssists}</span>
          </div>
          <div class="euroleague-stat-item">
            <span class="euroleague-stat-label">Izg. Lopte</span>
            <span class="euroleague-stat-value">${oppTurnovers}</span>
          </div>
        </div>
      </div>
    `;
  };

  const updateCards = () => {
    const homeTeam = teams.find(t => t.clubId === homeSelect.value);
    const awayTeam = teams.find(t => t.clubId === awaySelect.value);
    renderCard(container.querySelector("#euroleague-home-card"), homeTeam);
    renderCard(container.querySelector("#euroleague-away-card"), awayTeam);
  };

  homeSelect.addEventListener("change", updateCards);
  awaySelect.addEventListener("change", updateCards);

  // Initial render
  updateCards();
}

export let simulationOverrides = {};
let currentOutrightOdds = null;

export function clearSimulationOverrides() {
  simulationOverrides = {};
  currentOutrightOdds = null;
  activeSimSubTab = "groups";
}

function findOutrightEvent(events) {
  if (!events) return null;
  return events.find(ev => {
    const name = String(ev.matchName || "").toLowerCase();
    const hasKeyword = name.includes("pobednik") || name.includes("winner") || name.includes("outright");
    const isOutright = !ev.homeTeam && !ev.awayTeam;
    return isOutright && (hasKeyword || ev.oddsCount > 10);
  });
}

function extractOutrightOdds(markets) {
  if (!markets) return {};
  const winnerMarket = markets.find(m => {
    const name = String(m.marketName || "").toLowerCase();
    return name.includes("pobednik") || name.includes("winner") || name.includes("outright");
  }) || markets.sort((a, b) => (b.odds?.length || 0) - (a.odds?.length || 0))[0];

  if (!winnerMarket || !winnerMarket.odds) return {};

  const oddsMap = {};
  for (const o of winnerMarket.odds) {
    const teamName = String(o.name).trim();
    if (o.price > 1) {
      oddsMap[teamName] = Number(o.price);
    }
  }
  return oddsMap;
}

export function renderSimulationView() {
  const events = Array.from(eventIndex.values());
  let groups = detectGroups(events) || [];

  const comp = getSelectedCompetition();
  const compName = (comp ? comp.tournamentName : "").toLowerCase();
  const isWorldCupComp = compName.includes("world cup") || compName.includes("svetsko prvenstvo") || compName.includes("svetsko");

  if (isWorldCupComp && currentOutrightOdds && currentSportId === 5) {
    const activeTeams = new Set();
    for (const g of groups) {
      for (const t of g.teams) {
        activeTeams.add(t);
      }
    }

    const allOutrightTeams = Object.keys(currentOutrightOdds);
    const remainingTeams = allOutrightTeams.filter(t => !activeTeams.has(t));

    let groupCharCodes = [];
    const existingLetters = new Set(groups.map(g => g.name.replace("Grupa ", "").trim()));
    for (let i = 0; i < 12; i++) {
      const letter = String.fromCharCode(65 + i); // A to L
      if (!existingLetters.has(letter)) {
        groupCharCodes.push(letter);
      }
    }

    const earliestMatch = events.find(ev => ev.matchDate) || {};
    const eventDate = earliestMatch.matchDate || new Date().toISOString();

    let dummyTeamCounter = 1;
    while (groups.length < 12 && groupCharCodes.length > 0) {
      const letter = groupCharCodes.shift();
      const groupTeams = [];
      for (let i = 0; i < 4; i++) {
        if (remainingTeams.length > 0) {
          groupTeams.push(remainingTeams.shift());
        } else {
          groupTeams.push(`Dummy Team ${dummyTeamCounter++}`);
        }
      }

      const dummyMatches = [];
      const combos = [
        [0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]
      ];
      for (const [i1, i2] of combos) {
        const t1 = groupTeams[i1];
        const t2 = groupTeams[i2];
        dummyMatches.push({
          eventId: `dummy-${letter}-${t1}-${t2}`,
          matchName: `${t1} - ${t2}`,
          homeTeam: t1,
          awayTeam: t2,
          matchDate: eventDate,
          odds: []
        });
      }

      groups.push({
        name: `Grupa ${letter}`,
        teams: groupTeams.sort(),
        matches: dummyMatches
      });
    }
  }

  if (!groups || !groups.length) {
    elements.marketsList.replaceChildren(createEmptyState("Nema pronađenih grupa za simulaciju u ovom takmičenju.", "🏟️"));
    return;
  }

  const prevInput = document.querySelector("#sim-iterations-input");
  let iterations = prevInput ? parseInt(prevInput.value, 10) : 10000;
  if (isNaN(iterations) || iterations < 1000) {
    iterations = 10000;
  } else if (iterations > 500000) {
    iterations = 500000;
  }

  let bestThirdCount = 0;
  if (compName.includes("world cup") || compName.includes("svetsko prvenstvo") || compName.includes("svetsko")) {
    bestThirdCount = 8;
  } else if (
    (compName.includes("euro") || compName.includes("evropsko prvenstvo") || compName.includes("evro")) &&
    !compName.includes("euroleague") && !compName.includes("evroliga")
  ) {
    bestThirdCount = 4;
  }

  let ruleBadge = "";
  if (bestThirdCount === 8) {
    ruleBadge = `<span style="background: rgba(220, 100, 0, 0.2); color: #ff9f43; border: 1px solid rgba(220, 100, 0, 0.4); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: auto;">🏆 Prolaze: prva 2 + 8 najboljih 3.</span>`;
  } else if (bestThirdCount === 4) {
    ruleBadge = `<span style="background: rgba(0, 150, 255, 0.2); color: #54a0ff; border: 1px solid rgba(0, 150, 255, 0.4); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: auto;">🇪🇺 Prolaze: prva 2 + 4 najboljih 3.</span>`;
  } else {
    ruleBadge = `<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-3); border: 1px solid var(--line); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: normal; margin-left: auto;">Prolaze prva 2</span>`;
  }

  const container = document.createElement("div");
  container.className = "simulation-container";

  const controls = document.createElement("div");
  controls.className = "simulation-controls";
  controls.style.width = "100%";
  controls.innerHTML = `
    <span style="display: flex; align-items: center; gap: 8px;">
      <span>⚙️</span>
      <span>Broj simulacija (Monte Carlo):</span>
    </span>
    <input type="number" id="sim-iterations-input" class="sim-iterations-input" value="${iterations}" min="1000" max="500000" step="1000">
    <button id="run-all-sims-btn" class="action-btn action-btn--primary" style="min-height: 26px; height: 26px; padding: 0 10px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
      <span class="btn-icon">🔄</span> Pokreni sve
    </button>
    ${ruleBadge}
  `;
  container.append(controls);

  // Setup event listeners for simulation controls
  const inputEl = controls.querySelector("#sim-iterations-input");
  const runAllBtn = controls.querySelector("#run-all-sims-btn");

  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        renderSimulationView();
      }
    });
    inputEl.addEventListener("change", () => {
      renderSimulationView();
    });
  }

  if (runAllBtn) {
    runAllBtn.addEventListener("click", () => {
      renderSimulationView();
    });
  }

  // Create sub-tabs for standings vs tournament outrights
  const subTabs = document.createElement("div");
  subTabs.style.display = "flex";
  subTabs.style.gap = "8px";
  subTabs.style.marginTop = "12px";
  subTabs.style.marginBottom = "16px";
  
  const groupsBtn = document.createElement("button");
  groupsBtn.className = `action-btn ${activeSimSubTab === "groups" ? "action-btn--primary" : "action-btn--secondary"}`;
  groupsBtn.textContent = "Standings po grupama";
  groupsBtn.style.fontSize = "11px";
  groupsBtn.style.height = "26px";
  groupsBtn.style.padding = "0 12px";
  groupsBtn.style.borderRadius = "4px";
  groupsBtn.addEventListener("click", () => {
    activeSimSubTab = "groups";
    renderSimulationView();
  });

  const outrightsBtn = document.createElement("button");
  outrightsBtn.className = `action-btn ${activeSimSubTab === "outrights" ? "action-btn--primary" : "action-btn--secondary"}`;
  outrightsBtn.textContent = "Autrajti turnira (Knockout)";
  outrightsBtn.style.fontSize = "11px";
  outrightsBtn.style.height = "26px";
  outrightsBtn.style.padding = "0 12px";
  outrightsBtn.style.borderRadius = "4px";
  outrightsBtn.addEventListener("click", () => {
    activeSimSubTab = "outrights";
    renderSimulationView();
  });

  subTabs.append(groupsBtn, outrightsBtn);
  container.append(subTabs);


  // Run tournament-wide simulation to correctly rank 3rd-placed teams and calculate their qualification odds
  const { teamResults, groupResults } = runTournamentSimulation(groups, currentSportId, simulationOverrides, iterations, bestThirdCount, currentOutrightOdds);
  const outrightM = getOutrightMarginMultiplier();
  const ouM = getOuMarginMultiplier();

  if (activeSimSubTab === "outrights") {
    const outrightsCard = document.createElement("div");
    outrightsCard.className = "simulation-group-card";
    outrightsCard.style.width = "100%";
    
    const title = document.createElement("h3");
    title.className = "simulation-group-name";
    title.textContent = "Simulirani autrajti turnira (Knockout faza)";
    outrightsCard.append(title);

    const table = document.createElement("table");
    table.className = "standings-table";
    table.style.width = "100%";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Tim</th>
          <th>Pobednik</th>
          <th>Dolazi do finala</th>
          <th>1/2 finale</th>
          <th>1/4 finale</th>
          <th>1/8 finale</th>
          <th>1/16 finale</th>
        </tr>
      </thead>
    `;

    const body = document.createElement("tbody");
    
    // Get all unique teams from all groups
    const allTeams = [];
    groups.forEach(g => {
      g.teams.forEach(t => {
        if (!allTeams.includes(t)) {
          allTeams.push(t);
        }
      });
    });

    // Sort teams by pTournamentWinner descending
    allTeams.sort((a, b) => {
      const resA = teamResults[a];
      const resB = teamResults[b];
      const pA = resA ? resA.pTournamentWinner : 0;
      const pB = resB ? resB.pTournamentWinner : 0;
      return pB - pA;
    });

    allTeams.forEach(team => {
      const res = teamResults[team];
      if (!res) return;

      const formatKoOdd = (prob) => {
        if (prob <= 0.0001) return "999.00";
        return (1 / prob * outrightM).toFixed(2);
      };

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="standings-team-name">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span>${team}</span>
            <button class="add-team-csv-btn icon-btn" data-team="${team}" title="Export Team CSV" style="padding: 2px; border: none; background: transparent; cursor: pointer; font-size: 11px; margin: 0;">📝</button>
          </div>
        </td>
        <td><strong class="odds-value-display" data-market-type="outright" data-original-price="${res.pTournamentWinner > 0.0001 ? 1/res.pTournamentWinner : 999}">${formatKoOdd(res.pTournamentWinner)}</strong></td>
        <td><span class="odds-value-display" data-market-type="outright" data-original-price="${res.pReachesFinal > 0.0001 ? 1/res.pReachesFinal : 999}">${formatKoOdd(res.pReachesFinal)}</span></td>
        <td><span class="odds-value-display" data-market-type="outright" data-original-price="${res.pReachesSF > 0.0001 ? 1/res.pReachesSF : 999}">${formatKoOdd(res.pReachesSF)}</span></td>
        <td><span class="odds-value-display" data-market-type="outright" data-original-price="${res.pReachesQF > 0.0001 ? 1/res.pReachesQF : 999}">${formatKoOdd(res.pReachesQF)}</span></td>
        <td><span class="odds-value-display" data-market-type="outright" data-original-price="${res.pReachesR16 > 0.0001 ? 1/res.pReachesR16 : 999}">${formatKoOdd(res.pReachesR16)}</span></td>
        <td><span class="odds-value-display" data-market-type="outright" data-original-price="${res.pReachesR32 > 0.0001 ? 1/res.pReachesR32 : 999}">${formatKoOdd(res.pReachesR32)}</span></td>
      `;
      body.append(tr);
    });

    table.append(body);

    table.addEventListener("click", (e) => {
      const btn = e.target.closest(".add-team-csv-btn");
      if (!btn) return;

      const teamName = btn.dataset.team;
      const teamGroup = groups.find(g => g.teams.includes(teamName)) || {};
      const earliestMatch = teamGroup.matches ? teamGroup.matches[0] : null;
      const eventDate = earliestMatch ? earliestMatch.matchDate : "";

      const comp = getSelectedCompetition();
      const competitionName = comp ? comp.tournamentName : "";
      const sifraInput = document.querySelector("#start-sifra");
      const startSifra = sifraInput ? parseInt(sifraInput.value, 10) : 50518;

      const outrightM = getOutrightMarginMultiplier();
      const ouM = getOuMarginMultiplier();

      const csvContent = buildTeamSimulationCsv({
        teamName,
        teamResults,
        eventDate,
        competitionName,
        startSifra: Number.isInteger(startSifra) ? startSifra : 50518,
        outrightMultiplier: outrightM,
        ouMultiplier: ouM
      });

      const existing = getCsvOutput().trim();
      let newCsv;
      if (!existing) {
        newCsv = `${CSV_COLUMNS.join(",")}\r\n${csvContent}`;
      } else {
        newCsv = `${existing}\r\n${csvContent}`;
      }

      const filename = `${teamName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_specijali.csv`;
      renderCsvOutput(newCsv, filename, countCsvRows(newCsv));
    });

    outrightsCard.append(table);
    container.append(outrightsCard);
  } else {
    groups.forEach((group) => {
      // 1. Get results for the teams in this group from the tournament-wide simulation results
      const results = teamResults;
      const gRes = groupResults ? groupResults[group.name] : null;
      const { teamOdds: odds, groupOdds } = calculateOddsForGroup(group, teamResults, groupResults, outrightM, ouM);

      // 2. Create card element
      const card = document.createElement("div");
      card.className = "simulation-group-card";

      // 3. Header
      const header = document.createElement("div");
      header.className = "simulation-group-header";

      const title = document.createElement("h3");
      title.className = "simulation-group-name";
      title.textContent = group.name;

      const actions = document.createElement("div");
      actions.className = "simulation-group-actions";

      const simBtn = document.createElement("button");
      simBtn.className = "action-btn action-btn--primary";
      simBtn.innerHTML = `<span class="btn-icon">🔄</span> Pokreni simulaciju`;
      simBtn.addEventListener("click", () => {
        renderSimulationView();
      });

      const csvBtn = document.createElement("button");
      csvBtn.className = "action-btn";
      csvBtn.innerHTML = `<span class="btn-icon">📝</span> Dodaj Grupu u CSV`;
      csvBtn.addEventListener("click", () => {
        const earliestMatch = group.matches[0];
        const eventDate = earliestMatch ? earliestMatch.matchDate : "";
        
        let combinedBlock;
        if (currentSportId === 5) {
          const comp = getSelectedCompetition();
          const competitionName = comp ? comp.tournamentName : "";
          const sifraInput = document.querySelector("#start-sifra");
          const startSifra = sifraInput ? parseInt(sifraInput.value, 10) : 50049;
          combinedBlock = buildFullGroupSimulationCsv({
            group,
            teamOdds: odds,
            groupOdds,
            eventDate,
            competitionName,
            startSifra: Number.isInteger(startSifra) ? startSifra : 50049
          });
        } else {
          const winnerCsv = buildGroupOutrightCsvBlock({
            groupName: group.name,
            marketTitle: "Pobednik Grupe",
            teams: group.teams,
            oddsMap: odds,
            oddsField: "winnerOdds",
            eventDate
          });
          const qualifyCsv = buildGroupOutrightCsvBlock({
            groupName: group.name,
            marketTitle: "Prolazi Grupu",
            teams: group.teams,
            oddsMap: odds,
            oddsField: "qualifyOdds",
            eventDate
          });
          const lastCsv = buildGroupOutrightCsvBlock({
            groupName: group.name,
            marketTitle: "Zavrsava Poslednji Grupa",
            teams: group.teams,
            oddsMap: odds,
            oddsField: "lastOdds",
            eventDate
          });
          const pointsCsv = buildGroupPointsCsvRows({
            groupName: group.name,
            teams: group.teams,
            oddsMap: odds,
            eventDate
          });
          combinedBlock = [winnerCsv, qualifyCsv, lastCsv, pointsCsv].filter(Boolean).join("\r\n");
        }

        const existing = getCsvOutput().trim();
        let newCsv;
        if (!existing) {
          newCsv = `${CSV_COLUMNS.join(",")}\r\n${combinedBlock}`;
        } else {
          newCsv = `${existing}\r\n${combinedBlock}`;
        }

        const comp = getSelectedCompetition();
        const subject = comp ? `${comp.tournamentName}_simulacija` : "simulacija";
        const filename = `${subject.toLowerCase().replace(/[^a-z0-9]/g, "_")}_odds.csv`;

        renderCsvOutput(newCsv, filename, countCsvRows(newCsv));
      });

      actions.append(simBtn, csvBtn);
      header.append(title, actions);
      card.append(header);

      // 4. Grid containing Standings and Matches
      const grid = document.createElement("div");
      grid.className = "simulation-grid";

      // ─── LEFT COLUMN: Standings ───
      const standingsCol = document.createElement("div");
      const standingsTitle = document.createElement("h4");
      standingsTitle.className = "simulation-section-title";
      standingsTitle.textContent = "Tabela & Proporcije";
      standingsCol.append(standingsTitle);

      const standingsTable = document.createElement("table");
      standingsTable.className = "standings-table";
      standingsTable.innerHTML = `
        <thead>
          <tr>
            <th>Tim</th>
            <th>Proj Bod</th>
            <th>Pobednik</th>
            <th>Prolaz</th>
            <th>Poslednji</th>
            <th>Granica</th>
            <th>Manje</th>
            <th>Više</th>
          </tr>
        </thead>
      `;

      const standingsBody = document.createElement("tbody");
      const sortedTeams = [...group.teams].sort((a, b) => results[b].expectedPoints - results[a].expectedPoints);

      sortedTeams.forEach((team) => {
        const o = odds[team];
        const res = results[team];

        const fairWinner = res.pWinner <= 0.0001 ? 999.00 : 1 / res.pWinner;
        const fairQualify = res.pQualify <= 0.0001 ? 999.00 : 1 / res.pQualify;
        const fairLast = res.pLast <= 0.0001 ? 999.00 : 1 / res.pLast;

        let pUnder = 0;
        let pOver = 0;
        for (const [ptsStr, prob] of Object.entries(res.pointsDistribution || {})) {
          if (Number(ptsStr) < o.line) pUnder += prob;
          else pOver += prob;
        }
        const fairUnder = pUnder <= 0.0001 ? 999.00 : 1 / pUnder;
        const fairOver = pOver <= 0.0001 ? 999.00 : 1 / pOver;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="standings-team-name">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span>${team}</span>
              <button class="add-team-csv-btn icon-btn" data-team="${team}" title="Export Team CSV" style="padding: 2px; border: none; background: transparent; cursor: pointer; font-size: 11px; margin: 0;">📝</button>
            </div>
          </td>
          <td class="standings-exp-pts">${res.expectedPoints.toFixed(2)}</td>
          <td><span class="odds-value-display" data-market-type="outright" data-original-price="${fairWinner}">${o.winnerOdds.toFixed(2)}</span></td>
          <td><span class="odds-value-display" data-market-type="outright" data-original-price="${fairQualify}">${o.qualifyOdds.toFixed(2)}</span></td>
          <td><span class="odds-value-display" data-market-type="outright" data-original-price="${fairLast}">${o.lastOdds.toFixed(2)}</span></td>
          <td class="odds-value-display">${o.line.toFixed(1)}</td>
          <td><span class="odds-value-display" data-market-type="ou" data-original-price="${fairUnder}">${o.underOdds.toFixed(2)}</span></td>
          <td><span class="odds-value-display" data-market-type="ou" data-original-price="${fairOver}">${o.overOdds.toFixed(2)}</span></td>
        `;
        standingsBody.append(tr);
      });
      standingsTable.append(standingsBody);

      standingsTable.addEventListener("click", (e) => {
        const btn = e.target.closest(".add-team-csv-btn");
        if (!btn) return;

        const teamName = btn.dataset.team;
        const earliestMatch = group.matches[0];
        const eventDate = earliestMatch ? earliestMatch.matchDate : "";

        const comp = getSelectedCompetition();
        const competitionName = comp ? comp.tournamentName : "";
        const sifraInput = document.querySelector("#start-sifra");
        const startSifra = sifraInput ? parseInt(sifraInput.value, 10) : 50518;

        const outrightM = getOutrightMarginMultiplier();
        const ouM = getOuMarginMultiplier();

        const csvContent = buildTeamSimulationCsv({
          teamName,
          teamResults: results,
          eventDate,
          competitionName,
          startSifra: Number.isInteger(startSifra) ? startSifra : 50518,
          outrightMultiplier: outrightM,
          ouMultiplier: ouM
        });

        const existing = getCsvOutput().trim();
        let newCsv;
        if (!existing) {
          newCsv = `${CSV_COLUMNS.join(",")}\r\n${csvContent}`;
        } else {
          newCsv = `${existing}\r\n${csvContent}`;
        }

        const filename = `${teamName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_specijali.csv`;
        renderCsvOutput(newCsv, filename, countCsvRows(newCsv));
      });

      standingsCol.append(standingsTable);

      // ─── RIGHT COLUMN: Matches ───
      const matchesCol = document.createElement("div");
      const matchesTitle = document.createElement("h4");
      matchesTitle.className = "simulation-section-title";
      matchesTitle.textContent = "Utakmice & Kvota overrides";
      matchesCol.append(matchesTitle);

      const matchesTable = document.createElement("table");
      matchesTable.className = "matches-table";
      matchesTable.innerHTML = `
        <thead>
          <tr>
            <th>Utakmica</th>
            <th>Kvote</th>
          </tr>
        </thead>
      `;

      const matchesBody = document.createElement("tbody");
      group.matches.forEach((match) => {
        const tr = document.createElement("tr");

        const tdMatch = document.createElement("td");
        const teamsDiv = document.createElement("div");
        teamsDiv.className = "match-row-teams";
        teamsDiv.textContent = `${match.homeTeam} - ${match.awayTeam}`;
        
        const dateDiv = document.createElement("div");
        dateDiv.className = "match-row-date";
        const dateVal = match.matchDate ? new Date(match.matchDate.replace(" ", "T") + "Z") : null;
        dateDiv.textContent = dateVal && !isNaN(dateVal.getTime()) ? datetimeFmt.format(dateVal) : (match.matchDate || "");

        tdMatch.append(teamsDiv, dateDiv);

        const tdOdds = document.createElement("td");
        const currentOdds = simulationOverrides[match.eventId] || getEventWinnerOdds(match, currentSportId);

        const oddsGroup = document.createElement("div");
        oddsGroup.className = "simulation-odds-input-group";

        const createInputContainer = (label, outcome, value) => {
          const wrap = document.createElement("div");
          wrap.className = "sim-odds-input-container";
          const labelSpan = document.createElement("span");
          labelSpan.className = "sim-odds-input-label";
          labelSpan.textContent = label;
          const input = document.createElement("input");
          input.type = "number";
          input.step = "0.01";
          input.min = "1.01";
          input.className = "sim-odds-input";
          input.value = value.toFixed(2);
          input.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val) && val > 0) {
              if (!simulationOverrides[match.eventId]) {
                simulationOverrides[match.eventId] = Object.assign({}, getEventWinnerOdds(match, currentSportId));
              }
              simulationOverrides[match.eventId][outcome] = val;
            }
          });
          wrap.append(labelSpan, input);
          return wrap;
        };

        if (currentSportId === 4) { // Basketball (no draws)
          oddsGroup.append(
            createInputContainer("1", "home", currentOdds.home),
            createInputContainer("2", "away", currentOdds.away)
          );
        } else { // Soccer
          oddsGroup.append(
            createInputContainer("1", "home", currentOdds.home),
            createInputContainer("X", "draw", currentOdds.draw),
            createInputContainer("2", "away", currentOdds.away)
          );
        }

        tdOdds.append(oddsGroup);
        tr.append(tdMatch, tdOdds);
        matchesBody.append(tr);
      });

      matchesTable.append(matchesBody);
      matchesCol.append(matchesTable);

      grid.append(standingsCol, matchesCol);
      card.append(grid);

      // ─── ADD ADDITIONAL SOCCER MARKETS UI ───
      if (groupOdds && currentSportId === 5) {
        const details = document.createElement("details");
        details.className = "simulation-additional-markets";
        details.style.marginTop = "16px";
        details.style.borderTop = "1px solid var(--line)";
        details.style.paddingTop = "12px";

        const summary = document.createElement("summary");
        summary.style.cursor = "pointer";
        summary.style.fontWeight = "600";
        summary.style.fontSize = "13px";
        summary.style.color = "var(--accent)";
        summary.style.display = "flex";
        summary.style.alignItems = "center";
        summary.style.gap = "6px";
        summary.innerHTML = "<span>📊</span> <span>Prikaži dodatne igre (Tačan poredak, Prva dva, Golovi...)</span>";
        details.append(summary);

        const content = document.createElement("div");
        content.style.marginTop = "12px";
        content.style.display = "grid";
        content.style.gridTemplateColumns = "repeat(auto-fit, minmax(300px, 1fr))";
        content.style.gap = "16px";

        // Column 1: Forecast & Top 2 & Outrights
        const col1 = document.createElement("div");
        col1.innerHTML = `<h5 style="margin: 0 0 8px; color: var(--text-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Poredak i Specijali</h5>`;
        
        const col1Table = document.createElement("table");
        col1Table.className = "standings-table";
        col1Table.style.width = "100%";
        col1Table.innerHTML = `
          <thead>
            <tr>
              <th>Opklada</th>
              <th class="text-center col-numeric">Kvota</th>
            </tr>
          </thead>
          <tbody>
          </tbody>
        `;
        const col1Body = col1Table.querySelector("tbody");

        const getFair = (prob) => (prob <= 0.0001 ? 999.00 : 1 / prob);
        const outrights = [
          { label: "Bilo koji tim: 9 bodova", price: groupOdds.any9PtsOdds, fair: getFair(gRes.pAny9Pts) },
          { label: "Bilo koji tim: 0 bodova", price: groupOdds.any0PtsOdds, fair: getFair(gRes.pAny0Pts) },
          { label: "Treće mesto: ide dalje", price: groupOdds.thirdQualifiesOdds, fair: getFair(gRes.pThirdQualifies) }
        ];
        for (const item of outrights) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${item.label}</td>
            <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="outright" data-original-price="${item.fair}">${item.price.toFixed(2)}</span></td>
          `;
          col1Body.append(tr);
        }

        const sortedTopTwoTeams = [...group.teams].sort();
        for (let i = 0; i < sortedTopTwoTeams.length; i++) {
          for (let j = i + 1; j < sortedTopTwoTeams.length; j++) {
            const t1 = sortedTopTwoTeams[i];
            const t2 = sortedTopTwoTeams[j];
            const key = `${t1}|${t2}`;
            const price = groupOdds.topTwo[key] ?? 999.00;
            const fair = getFair(gRes.topTwo[key]);
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td>Prva dva: ${t1}/${t2}</td>
              <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="outright" data-original-price="${fair}">${price.toFixed(2)}</span></td>
            `;
            col1Body.append(tr);
          }
        }
        col1.append(col1Table);

        // Column 2: Exact Forecast
        const col2 = document.createElement("div");
        col2.innerHTML = `<h5 style="margin: 0 0 8px; color: var(--text-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Tačan poredak (1. / 2. mesto)</h5>`;
        
        const col2Table = document.createElement("table");
        col2Table.className = "standings-table";
        col2Table.style.width = "100%";
        col2Table.innerHTML = `
          <thead>
            <tr>
              <th>Poredak</th>
              <th class="text-center col-numeric">Kvota</th>
            </tr>
          </thead>
          <tbody>
          </tbody>
        `;
        const col2Body = col2Table.querySelector("tbody");

        for (const t1 of group.teams) {
          for (const t2 of group.teams) {
            if (t1 === t2) continue;
            const key = `${t1}|${t2}`;
            const price = groupOdds.exactForecast[key] ?? 999.00;
            const fair = getFair(gRes.exactForecast[key]);
            const tr = document.createElement("tr");
            tr.innerHTML = `
              <td>1. ${t1} / 2. ${t2}</td>
              <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="outright" data-original-price="${fair}">${price.toFixed(2)}</span></td>
            `;
            col2Body.append(tr);
          }
        }
        col2.append(col2Table);

        // Column 3: Group Goals, Draws, Match Stats, Winner/Last Points & Most Goals
        const col3 = document.createElement("div");
        col3.innerHTML = `<h5 style="margin: 0 0 8px; color: var(--text-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Golovi, Bodovi i Najefikasniji</h5>`;
        
        const col3Table = document.createElement("table");
        col3Table.className = "standings-table";
        col3Table.style.width = "100%";
        col3Table.innerHTML = `
          <thead>
            <tr>
              <th>Igra</th>
              <th class="text-center col-numeric">Granica</th>
              <th class="text-center col-numeric">Manje</th>
              <th class="text-center col-numeric">Više</th>
            </tr>
          </thead>
          <tbody>
          </tbody>
        `;
        const col3Body = col3Table.querySelector("tbody");

        const tg = groupOdds.totalGoals;
        const getFairOu = (line, distribution) => {
          let pUnder = 0;
          let pOver = 0;
          for (const [valStr, prob] of Object.entries(distribution || {})) {
            const val = Number(valStr);
            if (val < line) pUnder += prob;
            else pOver += prob;
          }
          const fairUnder = pUnder <= 0.0001 ? 999.00 : 1 / pUnder;
          const fairOver = pOver <= 0.0001 ? 999.00 : 1 / pOver;
          return { fairUnder, fairOver };
        };

        const addOuRow = (label, line, oddsObj, distribution) => {
          const tr = document.createElement("tr");
          const { fairUnder, fairOver } = getFairOu(line, distribution);
          tr.innerHTML = `
            <td>${label}</td>
            <td class="text-center col-numeric">${line.toFixed(1)}</td>
            <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="ou" data-original-price="${fairUnder}">${oddsObj.underOdds.toFixed(2)}</span></td>
            <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="ou" data-original-price="${fairOver}">${oddsObj.overOdds.toFixed(2)}</span></td>
          `;
          col3Body.append(tr);
        };
        
        addOuRow("Ukupno golova 1", tg.line1, tg.odds1, gRes.goalsDistribution);
        addOuRow("Ukupno golova 2", tg.line2, tg.odds2, gRes.goalsDistribution);
        addOuRow("Ukupno golova 3", tg.line3, tg.odds3, gRes.goalsDistribution);

        const td = groupOdds.totalDraws;
        addOuRow("Ukupno nerešenih", td.line, td, gRes.drawsDistribution);

        const m3 = groupOdds.matches3Plus;
        addOuRow("Broj mečeva 3+", m3.line, m3, gRes.matches3PlusDistribution);

        const m00 = groupOdds.matches00;
        addOuRow("Broj mečeva 0-0", m00.line, m00, gRes.matches00Distribution);

        const mGG = groupOdds.matchesGG;
        addOuRow("Broj mečeva GG", mGG.line, mGG, gRes.matchesGGDistribution);

        const wp = groupOdds.winnerPoints;
        addOuRow("Bodovi prvoplasiranog", wp.line, wp, gRes.winnerPointsDistribution);

        const lp = groupOdds.lastPoints;
        addOuRow("Bodovi poslednjeg", lp.line, lp, gRes.lastPointsDistribution);

        col3.append(col3Table);

        const col3EfficientTitle = document.createElement("h5");
        col3EfficientTitle.style.margin = "16px 0 8px";
        col3EfficientTitle.style.color = "var(--text-2)";
        col3EfficientTitle.style.fontSize = "11px";
        col3EfficientTitle.style.textTransform = "uppercase";
        col3EfficientTitle.style.letterSpacing = "0.05em";
        col3EfficientTitle.textContent = "Najefikasniji tim u grupi";
        col3.append(col3EfficientTitle);

        const col3EfficientTable = document.createElement("table");
        col3EfficientTable.className = "standings-table";
        col3EfficientTable.style.width = "100%";
        col3EfficientTable.innerHTML = `
          <thead>
            <tr>
              <th>Tim</th>
              <th class="text-center col-numeric">Kvota</th>
            </tr>
          </thead>
          <tbody>
          </tbody>
        `;
        const col3EfficientBody = col3EfficientTable.querySelector("tbody");
        for (const team of group.teams) {
          const price = odds[team].mostGoalsOdds;
          const fair = getFair(teamResults[team].pMostGoals);
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${team}</td>
            <td class="text-center col-numeric"><span class="odds-value-display" data-market-type="outright" data-original-price="${fair}">${price.toFixed(2)}</span></td>
          `;
          col3EfficientBody.append(tr);
        }
        col3.append(col3EfficientTable);

        content.append(col1, col2, col3);
        details.append(content);
        card.append(details);
      }

      container.append(card);
    });
  }

  elements.marketsList.replaceChildren(container);
}

export function showToast(message, type = "info") {
  // Remove any existing toast first (only one modal at a time)
  const existing = document.querySelector(".toast-container");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const iconMap = {
    info: "ℹ️",
    warning: "⚠️",
    error: "❌",
    success: "✅"
  };
  const icon = iconMap[type] || "ℹ️";

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" type="button" aria-label="Close">U redu</button>
  `;

  container.appendChild(toast);

  // Trigger reflow to animate in
  toast.offsetHeight;
  toast.classList.add("is-visible");

  const dismiss = () => {
    toast.classList.remove("is-visible");
    container.style.background = "transparent";
    container.style.backdropFilter = "none";
    toast.addEventListener("transitionend", () => {
      container.remove();
    }, { once: true });
  };

  // "U redu" button dismisses
  toast.querySelector(".toast-close").addEventListener("click", dismiss);

  // Clicking backdrop (container) outside the card also dismisses
  container.addEventListener("click", (e) => {
    if (e.target === container) dismiss();
  });

  // Auto dismiss after 8 seconds
  setTimeout(dismiss, 8000);
}

export let lastPromptEventId = null;
export let lastPromptTimestamp = 0;

export function showEventNameConfirmationModal(onConfirm, onEdit) {
  // Remove any existing toast first
  const existing = document.querySelector(".toast-container");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);

  const toast = document.createElement("div");
  toast.className = `toast toast--info`; 

  toast.innerHTML = `
    <span class="toast-icon" style="font-size: 24px;">📝</span>
    <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
      <span class="toast-message" style="margin: 0; line-height: 1.4;">Da li želite da zadržite postojeći naziv eventa ili da ga izmenite pre preuzimanja?</span>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="toast-btn-keep" type="button" style="background: var(--surface-1); border: 1px solid var(--border-color); color: var(--text-1); padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.2s;">Zadrži postojeći</button>
        <button class="toast-btn-edit" type="button" style="background: var(--primary-color); color: var(--background); padding: 8px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.2s;">Izmeni ime</button>
      </div>
    </div>
  `;

  container.appendChild(toast);

  // Hover effects for inline styles
  const btnKeep = toast.querySelector('.toast-btn-keep');
  btnKeep.addEventListener('mouseenter', () => btnKeep.style.background = 'var(--surface-2)');
  btnKeep.addEventListener('mouseleave', () => btnKeep.style.background = 'var(--surface-1)');

  const btnEdit = toast.querySelector('.toast-btn-edit');
  btnEdit.addEventListener('mouseenter', () => btnEdit.style.opacity = '0.9');
  btnEdit.addEventListener('mouseleave', () => btnEdit.style.opacity = '1');

  // Trigger reflow to animate in
  toast.offsetHeight;
  toast.classList.add("is-visible");

  const dismiss = () => {
    toast.classList.remove("is-visible");
    container.style.background = "transparent";
    container.style.backdropFilter = "none";
    toast.addEventListener("transitionend", () => {
      container.remove();
    }, { once: true });
  };

  toast.querySelector(".toast-btn-keep").addEventListener("click", () => {
    dismiss();
    if (onConfirm) onConfirm();
  });

  toast.querySelector(".toast-btn-edit").addEventListener("click", () => {
    dismiss();
    if (onEdit) onEdit();
  });

  // Clicking backdrop outside the modal dismisses it without action
  container.addEventListener("click", (e) => {
    if (e.target === container) dismiss();
  });
}

export function handleCsvDownloadWithConfirmation(eventId, downloadCallback) {
  const now = Date.now();
  // Prompt if it's a new event OR if 10 seconds have passed since the last prompt
  if (eventId !== lastPromptEventId || (now - lastPromptTimestamp) > 10000) {
    showEventNameConfirmationModal(
      () => {
        // User confirmed existing name
        lastPromptEventId = eventId;
        lastPromptTimestamp = Date.now();
        downloadCallback();
      },
      () => {
        // User wants to edit, focus the input
        lastPromptEventId = eventId;
        lastPromptTimestamp = Date.now();
        elements.eventNameRewrite.focus();
        elements.eventNameRewrite.select();
      }
    );
  } else {
    // Less than 10 seconds passed on the same event, download directly
    downloadCallback();
  }
}


