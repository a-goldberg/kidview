const bcrypt = require('bcrypt');
const db = require('../db/database');

function findParentByEmail(email) {
  return db
    .prepare(
      `SELECT
        parent_users.id,
        parent_users.household_id,
        parent_users.email,
        parent_users.password_hash,
        parent_users.display_name,
        households.name AS household_name
       FROM parent_users
       JOIN households ON households.id = parent_users.household_id
       WHERE lower(parent_users.email) = lower(?)`
    )
    .get(email);
}

async function authenticateParent(email, password) {
  const parent = findParentByEmail(email);

  if (!parent) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, parent.password_hash);

  if (!passwordMatches) {
    return null;
  }

  return {
    id: parent.id,
    householdId: parent.household_id,
    email: parent.email,
    displayName: parent.display_name,
    householdName: parent.household_name
  };
}

module.exports = {
  authenticateParent
};
