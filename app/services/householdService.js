const db = require('../db/database');

function getFirstChildProfile() {
  return db
    .prepare(
      `SELECT
        child_profiles.id,
        child_profiles.household_id AS householdId,
        child_profiles.display_name AS displayName,
        policy_profiles.max_results AS maxResults
       FROM child_profiles
       LEFT JOIN policy_profiles ON policy_profiles.id = child_profiles.policy_profile_id
       ORDER BY child_profiles.id
       LIMIT 1`
    )
    .get();
}

function getParentDashboard(householdId) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  const children = db
    .prepare('SELECT * FROM child_profiles WHERE household_id = ? ORDER BY display_name')
    .all(householdId);
  const recentSearches = db
    .prepare(
      `SELECT query, result_count, created_at
       FROM search_events
       WHERE household_id = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(householdId);

  return {
    household,
    children,
    recentSearches
  };
}

module.exports = {
  getFirstChildProfile,
  getParentDashboard
};
