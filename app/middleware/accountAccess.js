const db = require('../db/database');
const { getParentSession } = require('../services/authService');
const { getActiveChildProfile, ACTIVE_CHILD_COOKIE_NAME } = require('../services/childProfileSessionService');

// Revalidate every request. Old pre-migration sessions are intentionally signed out.
function refreshParent(req, res, next) {
  const previous = req.session.parentUser;
  if (!previous) return next();
  const current = getParentSession(previous.id);
  if (!current || current.householdId !== previous.householdId ||
      current.sessionVersion !== previous.sessionVersion) {
    return req.session.destroy(error => {
      if (error) return next(error);
      res.clearCookie(res.locals.sessionCookieName);
      res.clearCookie(ACTIVE_CHILD_COOKIE_NAME);
      return res.redirect('/auth/login');
    });
  }
  req.session.parentUser = current;
  return next();
}

function demoAccess(req, res, next) {
  // Child mode outlives the parent session, so use the signed child's household
  // on child routes. A parent session always takes precedence over a stale cookie.
  // Express paths are case-insensitive and tolerate trailing slashes.
  const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  const parent = req.session.parentUser;
  const child = path.startsWith('/child/') ? getActiveChildProfile(req) : null;
  const isDemo = Boolean(parent ? parent.isDemo : child && child.isDemo);
  res.locals.isDemo = isDemo;
  if (!isDemo) return next();
  if (path.startsWith('/model-comparison')) {
    return res.status(403).send('Model comparison is unavailable in the read-only demo.');
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.method === 'POST' && ['/auth/login', '/auth/logout'].includes(path)) return next();
  if (req.method === 'POST' && /^\/child\/profile\/[1-9]\d*\/activate$/.test(path)) return next();
  if (req.method === 'POST' && path === '/child/search' && child && child.isDemo) {
    const sample = db.prepare(`SELECT id FROM search_events WHERE household_id = ? AND child_profile_id = ? ORDER BY id LIMIT 1`)
      .get(child.householdId, child.id);
    if (sample) return res.redirect(303, `/child/results?searchEventId=${sample.id}`);
  }
  return res.status(403).send('This demo is read-only.  Changes, live searches, and playback tracking are disabled.');
}

module.exports = { refreshParent, demoAccess };
