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
  databasePath: fromRoot(process.env.DATABASE_PATH || './data/kidview.sqlite'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'kidview.sid',
  seedParentEmail: process.env.SEED_PARENT_EMAIL || 'parent@example.com',
  seedParentPassword: process.env.SEED_PARENT_PASSWORD || 'password123',
  rootDir
};
