const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

export const SUPERBET_CONFIG = {
  baseUrl: isLocal
    ? "https://production-superbet-offer-rs.freetls.fastly.net/sb-rs/api/v2"
    : "/sb-api",
  statsBaseUrl: "https://scorealarm-stats.freetls.fastly.net",
  statsVariant: "rssuperbetsport",
  locale: "sr-Latn-RS",
  soccerSportId: 5,
  basketballSportId: 4,
  tennisSportId: 2,
  upcomingDays: 14
};

export const MERKUR_CONFIG = {
  // Merkurxtip sends Access-Control-Allow-Origin: * so the browser can hit it
  // directly; the production rewrite exists only so the app keeps working if
  // that header is ever withdrawn.
  baseUrl: isLocal
    ? "https://www.merkurxtip.rs/restapi"
    : "/mx-api",
  locale: "sr"
};

export const FPL_CONFIG = {
  baseUrl: isLocal
    ? "http://127.0.0.1:5178"
    : "/fpl-api"
};
