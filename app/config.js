const path = require('path');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

function fromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3002),
  host: process.env.HOST || '127.0.0.1',
  databasePath: fromRoot(process.env.DATABASE_PATH || './data/kidview.sqlite'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'kidview.sid',
  seedParentEmail: process.env.SEED_PARENT_EMAIL || 'parent@example.com',
  seedParentPassword: process.env.SEED_PARENT_PASSWORD || 'password123',
  videoSource: (process.env.VIDEO_SOURCE || 'mock').toLowerCase(),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  youtubeMaxSearchResults: Number(process.env.YOUTUBE_MAX_SEARCH_RESULTS || 10),
  youtubeMaxCandidatesPerSearch: Math.min(
    40,
    Math.max(1, Number(process.env.YOUTUBE_MAX_CANDIDATES_PER_SEARCH || 40))
  ),
  youtubeSafeSearch: process.env.YOUTUBE_SAFE_SEARCH || 'moderate',
  youtubeRegionCode: process.env.YOUTUBE_REGION_CODE || 'US',
  youtubeRelevanceLanguage: process.env.YOUTUBE_RELEVANCE_LANGUAGE || 'en',
  rootDir
};
