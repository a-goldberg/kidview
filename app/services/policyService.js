const db = require('../db/database');

const ALLOW_LIMITED_POLICIES = new Set(['block', 'review', 'allow', 'limited_frequency']);

const DEFAULT_POLICY = Object.freeze({
  maxResults: 3,
  allowLimitedPolicy: 'block',
  allowLimitedMinConfidence: 0.7,
  dailySearchLimit: null,
  dailyVideoWatchLimit: null
});

// These are product-level format constraints, not ordinary household knobs.
// Keep them named so policy evaluation and future admin copy use one vocabulary.
const FORMAT_GUARDRAILS = Object.freeze({
  shorts: 'block',
  live: 'block',
  upcoming: 'block',
  nonEmbeddable: 'block'
});

function normalizePolicyRow(row) {
  if (!row) {
    return { ...DEFAULT_POLICY };
  }

  const maxResults = Number(row.max_results);
  const minConfidence = Number(row.allow_limited_min_confidence);

  return {
    householdId: row.household_id,
    childProfileId: row.child_profile_id,
    policyProfileId: row.policy_profile_id,
    maxResults:
      Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 3
        ? maxResults
        : DEFAULT_POLICY.maxResults,
    allowLimitedPolicy: ALLOW_LIMITED_POLICIES.has(row.allow_limited_policy)
      ? row.allow_limited_policy
      : DEFAULT_POLICY.allowLimitedPolicy,
    allowLimitedMinConfidence:
      Number.isFinite(minConfidence) && minConfidence >= 0 && minConfidence <= 1
        ? minConfidence
        : DEFAULT_POLICY.allowLimitedMinConfidence,
    dailySearchLimit:
      row.daily_search_limit === null ? null : Number(row.daily_search_limit),
    dailyVideoWatchLimit:
      row.daily_video_watch_limit === null ? null : Number(row.daily_video_watch_limit)
  };
}

function getChildPolicy({ householdId, childProfileId }) {
  if (!householdId || !childProfileId) {
    return { ...DEFAULT_POLICY };
  }

  const row = db
    .prepare(
      `SELECT
        child_profiles.household_id,
        child_profiles.id AS child_profile_id,
        child_profiles.policy_profile_id,
        child_profiles.allow_limited_policy,
        child_profiles.allow_limited_min_confidence,
        child_profiles.daily_search_limit,
        child_profiles.daily_video_watch_limit,
        policy_profiles.max_results
       FROM child_profiles
       LEFT JOIN policy_profiles
        ON policy_profiles.id = child_profiles.policy_profile_id
        AND policy_profiles.household_id = child_profiles.household_id
       WHERE child_profiles.household_id = ?
        AND child_profiles.id = ?`
    )
    .get(householdId, childProfileId);

  return normalizePolicyRow(row);
}

function listPolicyProfiles(householdId) {
  return db
    .prepare(
      `SELECT id, household_id, name, description, max_results, created_at, updated_at
       FROM policy_profiles
       WHERE household_id = ?
       ORDER BY name, id`
    )
    .all(householdId);
}

function parseMaxResults(value) {
  const maxResults = Number(value);

  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 3) {
    throw new RangeError('maxResults must be an integer from 1 to 3.');
  }

  return maxResults;
}

function parseConfidence(value) {
  const confidence = Number(value);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError('allowLimitedMinConfidence must be from 0 to 1.');
  }

  return confidence;
}

function parseNullableLimit(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`${fieldName} must be unlimited or a positive integer.`);
  }

  return limit;
}

function updatePolicyProfile({ householdId, policyProfileId, maxResults }) {
  const result = db
    .prepare(
      `UPDATE policy_profiles
       SET max_results = ?, updated_at = CURRENT_TIMESTAMP
       WHERE household_id = ? AND id = ?`
    )
    .run(parseMaxResults(maxResults), householdId, policyProfileId);

  if (!result.changes) {
    return null;
  }

  return db
    .prepare(
      `SELECT id, household_id, name, description, max_results, created_at, updated_at
       FROM policy_profiles
       WHERE household_id = ? AND id = ?`
    )
    .get(householdId, policyProfileId);
}

function updateChildPolicy({
  householdId,
  childProfileId,
  allowLimitedPolicy,
  allowLimitedMinConfidence,
  dailySearchLimit,
  dailyVideoWatchLimit
}) {
  if (!ALLOW_LIMITED_POLICIES.has(allowLimitedPolicy)) {
    throw new RangeError('allowLimitedPolicy is not supported.');
  }

  const result = db
    .prepare(
      `UPDATE child_profiles
       SET
        allow_limited_policy = ?,
        allow_limited_min_confidence = ?,
        daily_search_limit = ?,
        daily_video_watch_limit = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE household_id = ? AND id = ?`
    )
    .run(
      allowLimitedPolicy,
      parseConfidence(allowLimitedMinConfidence),
      parseNullableLimit(dailySearchLimit, 'dailySearchLimit'),
      parseNullableLimit(dailyVideoWatchLimit, 'dailyVideoWatchLimit'),
      householdId,
      childProfileId
    );

  if (!result.changes) {
    return null;
  }

  return getChildPolicy({ householdId, childProfileId });
}

function shouldQueueForReview({ decision, policy, hasDurableVideoDecision = false }) {
  if (hasDurableVideoDecision) {
    return false;
  }

  if (decision === 'allow_limited') {
    return policy.allowLimitedPolicy === 'review';
  }

  return decision === 'review' || decision === 'unknown';
}

module.exports = {
  DEFAULT_POLICY,
  FORMAT_GUARDRAILS,
  getChildPolicy,
  listPolicyProfiles,
  shouldQueueForReview,
  updateChildPolicy,
  updatePolicyProfile
};
