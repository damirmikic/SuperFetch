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

export const FPL_CONFIG = {
  baseUrl: isLocal
    ? "http://127.0.0.1:5178"
    : "/fpl-api"
};
