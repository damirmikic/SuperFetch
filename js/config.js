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

export const BALKANBET_CONFIG = {
  // Balkanbet runs on NSoft's Seven platform, so the offer lives on NSoft's
  // distribution API rather than on balkanbet.rs. It sends
  // Access-Control-Allow-Origin: * and needs no auth, so the browser can hit it
  // directly; the production rewrite is only a fallback if that ever changes.
  baseUrl: isLocal
    ? "https://sports-sm-distribution-api.de-2.nsoftcdn.com/api/v1"
    : "/bb-api",
  // Balkanbet's tenant on the Seven platform - every call is scoped to it.
  companyUuid: "4f54c6aa-82a9-475d-bf0e-dc02ded89225",
  locale: "sr-Latn",
  timezone: "Europe/Belgrade"
};

export const FPL_CONFIG = {
  baseUrl: isLocal
    ? "http://127.0.0.1:5178"
    : "/fpl-api"
};
