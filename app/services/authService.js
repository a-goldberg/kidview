const bcrypt = require('bcrypt');
const db = require('../db/database');

// Only safe account fields belong in sessions and views.
function getParentSession(id) {
  return db.prepare(`SELECT p.id, p.household_id AS householdId, p.email,
    p.display_name AS displayName, p.role, p.session_version AS sessionVersion,
    h.name AS householdName, h.is_demo AS isDemo
    FROM parent_users p JOIN households h ON h.id = p.household_id
    WHERE p.id = ? AND p.is_active = 1`).get(id) || null;
}

async function authenticateParent(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string' ||
      email.length > 254 || Buffer.byteLength(password, 'utf8') > 72) return null;
  const parent = db.prepare(`SELECT id, password_hash FROM parent_users
    WHERE lower(email) = lower(?) AND is_active = 1`).get(email);
  if (!parent || !(await bcrypt.compare(password, parent.password_hash))) return null;
  // Re-read after hashing: a concurrent disable/reset must not create a session.
  const current = db.prepare('SELECT password_hash FROM parent_users WHERE id = ? AND is_active = 1').get(parent.id);
  if (!current || current.password_hash !== parent.password_hash) return null;
  return getParentSession(parent.id);
}

module.exports = { authenticateParent, getParentSession };
