const bcrypt = require('bcrypt');
const db = require('../db/database');

function invalid(message) { throw new RangeError(message); }

function accountInput(input) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Enter a valid email address.');
  if (!displayName || displayName.length > 80) invalid('Enter a name of up to 80 characters.');
  if (!['admin', 'parent'].includes(input.role)) invalid('Choose a parent or household admin role.');
  return { email, displayName, role: input.role };
}

function passwordHash(password) {
  // bcrypt truncates after 72 bytes, so reject rather than silently truncate.
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    invalid('Use a password of at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  return bcrypt.hashSync(password, 12);
}

function requireAdmin(actor) {
  const admin = db.prepare(`SELECT p.id FROM parent_users p JOIN households h ON h.id = p.household_id
    WHERE p.id = ? AND p.household_id = ? AND p.role = 'admin' AND p.is_active = 1
      AND p.session_version = ? AND h.is_demo = 0`).get(actor.id, actor.householdId, actor.sessionVersion);
  if (!admin) invalid('An active household administrator is required.');
}

function listParents(actor) {
  requireAdmin(actor);
  return db.prepare(`SELECT id, email, display_name, role, is_active, created_at
    FROM parent_users WHERE household_id = ? ORDER BY id`).all(actor.householdId);
}

function saveParent(actor, input, parentId = null) {
  const values = accountInput(input);
  if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1)) invalid('Account not found.');
  requireAdmin(actor);
  const hash = parentId === null || input.password ? passwordHash(input.password) : null;
  return db.transaction(() => {
    requireAdmin(actor);
    const target = parentId === null ? null : db.prepare(
      'SELECT id, role, is_active FROM parent_users WHERE id = ? AND household_id = ?'
    ).get(parentId, actor.householdId);
    if (parentId !== null && !target) invalid('Account not found.');
    const active = parentId === null ? 1 : input.isActive === '1' ? 1 : input.isActive === '0' ? 0 : invalid('Choose an account status.');
    if (target && target.role === 'admin' && target.is_active && (values.role !== 'admin' || !active)) {
      const others = db.prepare(`SELECT COUNT(*) AS count FROM parent_users
        WHERE household_id = ? AND id != ? AND role = 'admin' AND is_active = 1`).get(actor.householdId, parentId).count;
      if (!others) invalid('Keep at least one active household administrator.');
    }
    // A global uniqueness collision never reveals who owns an email.
    if (db.prepare('SELECT id FROM parent_users WHERE lower(email) = ? AND id != ?').get(values.email, parentId || 0)) {
      invalid('That email address is unavailable.');
    }
    if (!target) {
      return db.prepare(`INSERT INTO parent_users (household_id, email, display_name, role, password_hash)
        VALUES (?, ?, ?, ?, ?)`).run(actor.householdId, values.email, values.displayName, values.role, hash).lastInsertRowid;
    }
    // All edits revoke prior sessions, including re-enabling and role changes.
    db.prepare(`UPDATE parent_users SET email = ?, display_name = ?, role = ?, is_active = ?,
      password_hash = COALESCE(?, password_hash), session_version = session_version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?`)
      .run(values.email, values.displayName, values.role, active, hash, parentId, actor.householdId);
    return parentId;
  })();
}

module.exports = { listParents, saveParent, accountInput, passwordHash };
