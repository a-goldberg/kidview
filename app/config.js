const path = require("path");
require("dotenv").config();

const rootDir = path.resolve(__dirname, "..");
const DEVELOPMENT_SESSION_SECRET = "dev-only-change-me";
const DEFAULT_SEED_PASSWORD = "password123";

function fromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function integerFromEnvironment(name, fallback, { min, max }) {
  const value = Number(process.env[name] || fallback);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function parseOrigin(value) {
  if (!value) return "";

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute http or https origin.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error(
      "APP_ORIGIN must contain only an http or https origin, without a path.",
    );
  }

  return url.origin;
}

function parseTrustProxy(value) {
  if (!value) return false;

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (
    !entries.length ||
    entries.some((entry) => /^(true|false|\d+)$/i.test(entry))
  ) {
    throw new Error(
      "TRUST_PROXY must be an explicit proxy address, subnet, or named range.",
    );
  }

  return entries;
}

const env = process.env.NODE_ENV || "development";
const isProduction = env === "production";
const sessionSecret = process.env.SESSION_SECRET || DEVELOPMENT_SESSION_SECRET;
const appOrigin = parseOrigin(process.env.APP_ORIGIN || "");
const videoSource = (process.env.VIDEO_SOURCE || "mock").toLowerCase();
const youtubeSafeSearch = process.env.YOUTUBE_SAFE_SEARCH || "moderate";
const usageTimeZone = process.env.USAGE_TIME_ZONE || "America/Chicago";

if (!["development", "test", "production"].includes(env)) {
  throw new Error("NODE_ENV must be development, test, or production.");
}

if (!["mock", "youtube"].includes(videoSource)) {
  throw new Error("VIDEO_SOURCE must be mock or youtube.");
}

if (!["none", "moderate", "strict"].includes(youtubeSafeSearch)) {
  throw new Error("YOUTUBE_SAFE_SEARCH must be none, moderate, or strict.");
}

try {
  new Intl.DateTimeFormat("en-US", { timeZone: usageTimeZone }).format();
} catch {
  throw new Error("USAGE_TIME_ZONE must be a valid IANA time zone.");
}

if (isProduction) {
  if (
    sessionSecret === DEVELOPMENT_SESSION_SECRET ||
    sessionSecret.length < 32
  ) {
    throw new Error(
      "Production requires a unique SESSION_SECRET of at least 32 characters.",
    );
  }

  if (!appOrigin || !appOrigin.startsWith("https://")) {
    throw new Error("Production requires an https APP_ORIGIN.");
  }
}

module.exports = {
  env,
  isProduction,
  port: integerFromEnvironment("PORT", 3002, { min: 1, max: 65535 }),
  host: process.env.HOST || "127.0.0.1",
  databasePath: fromRoot(process.env.DATABASE_PATH || "./data/kidview.sqlite"),
  sessionSecret,
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "kidview.sid",
  appOrigin,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY || ""),
  seedParentEmail: process.env.SEED_PARENT_EMAIL || "parent@example.com",
  seedParentPassword: process.env.SEED_PARENT_PASSWORD || DEFAULT_SEED_PASSWORD,
  defaultSeedPassword: DEFAULT_SEED_PASSWORD,
  videoSource,
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  youtubeMaxSearchResults: integerFromEnvironment(
    "YOUTUBE_MAX_SEARCH_RESULTS",
    10,
    {
      min: 1,
      max: 50,
    },
  ),
  youtubeMaxCandidatesPerSearch: integerFromEnvironment(
    "YOUTUBE_MAX_CANDIDATES_PER_SEARCH",
    40,
    { min: 1, max: 40 },
  ),
  youtubeRequestTimeoutMs: integerFromEnvironment(
    "YOUTUBE_REQUEST_TIMEOUT_MS",
    10000,
    {
      min: 1000,
      max: 60000,
    },
  ),
  youtubeSafeSearch,
  youtubeRegionCode: process.env.YOUTUBE_REGION_CODE || "US",
  youtubeRelevanceLanguage: process.env.YOUTUBE_RELEVANCE_LANGUAGE || "en",
  usageTimeZone,
  rootDir,
};
