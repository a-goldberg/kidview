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

const CONTENT_POSTURES = Object.freeze({
  block: {
    key: 'restricted',
    label: 'More restricted',
    description: 'Limited-access videos stay hidden.'
  },
  review: {
    key: 'parent_reviewed',
    label: 'Parent-reviewed',
    description: 'Limited-access videos wait for parent approval.'
  },
  limited_frequency: {
    key: 'balanced',
    label: 'Balanced',
    description: 'At most one strong limited-access result can appear.'
  },
  allow: {
    key: 'broader',
    label: 'Broader access',
    description: 'Limited-access videos can appear with allowed results.'
  }
});

function parseRequiredText(value, fieldName, maxLength) {
  const text = String(value || '').trim();

  if (!text) {
    throw new RangeError(`${fieldName} is required.`);
  }

  if (text.length > maxLength) {
    throw new RangeError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

function parseOptionalText(value, fieldName, maxLength) {
  const text = String(value || '').trim();

  if (text.length > maxLength) {
    throw new RangeError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return text || null;
}

function parseBirthYear(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const birthYear = Number(value);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    throw new RangeError(`birthYear must be from 1900 to ${currentYear}.`);
  }

  return birthYear;
}

function parseAllowLimitedPolicy(value) {
  if (!ALLOW_LIMITED_POLICIES.has(value)) {
    throw new RangeError('allowLimitedPolicy is not supported.');
  }

  return value;
}

function contentPostureFor(allowLimitedPolicy) {
  return CONTENT_POSTURES[allowLimitedPolicy] || CONTENT_POSTURES.block;
}

function policyProfileForHousehold(householdId, policyProfileId) {
  return db
    .prepare(
      `SELECT id, household_id, name, description, max_results, created_at, updated_at
       FROM policy_profiles
       WHERE household_id = ? AND id = ?`
    )
    .get(householdId, policyProfileId);
}

function requirePolicyProfile(householdId, policyProfileId) {
  const policyProfile = policyProfileForHousehold(householdId, Number(policyProfileId));

  if (!policyProfile) {
    throw new RangeError('Choose a policy profile from this household.');
  }

  return policyProfile;
}

function assertUniquePolicyName({ householdId, policyProfileId = null, name }) {
  const matchingProfile = db
    .prepare(
      `SELECT id
       FROM policy_profiles
       WHERE household_id = ?
        AND LOWER(name) = LOWER(?)
        AND (? IS NULL OR id != ?)`
    )
    .get(householdId, name, policyProfileId, policyProfileId);

  if (matchingProfile) {
    throw new RangeError('Policy profile names must be unique within a household.');
  }
}

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

function getPolicyManagement(householdId) {
  const household = db
    .prepare('SELECT id, name FROM households WHERE id = ?')
    .get(householdId);

  if (!household) {
    return null;
  }

  const policies = db
    .prepare(
      `SELECT
        policy_profiles.id,
        policy_profiles.household_id,
        policy_profiles.name,
        policy_profiles.description,
        policy_profiles.max_results,
        policy_profiles.created_at,
        policy_profiles.updated_at,
        COUNT(child_profiles.id) AS child_count,
        GROUP_CONCAT(child_profiles.display_name, ', ') AS child_names
       FROM policy_profiles
       LEFT JOIN child_profiles
        ON child_profiles.policy_profile_id = policy_profiles.id
        AND child_profiles.household_id = policy_profiles.household_id
       WHERE policy_profiles.household_id = ?
       GROUP BY policy_profiles.id
       ORDER BY policy_profiles.name, policy_profiles.id`
    )
    .all(householdId);
  const children = db
    .prepare(
      `SELECT
        child_profiles.id,
        child_profiles.household_id,
        child_profiles.policy_profile_id,
        child_profiles.display_name,
        child_profiles.birth_year,
        child_profiles.allow_limited_policy,
        child_profiles.allow_limited_min_confidence,
        child_profiles.daily_search_limit,
        child_profiles.daily_video_watch_limit,
        policy_profiles.name AS policy_profile_name,
        policy_profiles.max_results
       FROM child_profiles
       LEFT JOIN policy_profiles
        ON policy_profiles.id = child_profiles.policy_profile_id
        AND policy_profiles.household_id = child_profiles.household_id
       WHERE child_profiles.household_id = ?
       ORDER BY child_profiles.display_name, child_profiles.id`
    )
    .all(householdId)
    .map((child) => ({
      ...child,
      contentPosture: contentPostureFor(child.allow_limited_policy)
    }));

  return {
    household,
    policies,
    children,
    formatGuardrails: FORMAT_GUARDRAILS
  };
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

function createPolicyProfile({ householdId, name, description, maxResults }) {
  const normalizedName = parseRequiredText(name, 'Policy profile name', 80);
  const normalizedDescription = parseOptionalText(description, 'Policy description', 300);
  const normalizedMaxResults = parseMaxResults(maxResults);

  assertUniquePolicyName({ householdId, name: normalizedName });

  const result = db
    .prepare(
      `INSERT INTO policy_profiles (household_id, name, description, max_results)
       VALUES (?, ?, ?, ?)`
    )
    .run(householdId, normalizedName, normalizedDescription, normalizedMaxResults);

  return policyProfileForHousehold(householdId, result.lastInsertRowid);
}

function updatePolicyProfile({
  householdId,
  policyProfileId,
  name,
  description,
  maxResults
}) {
  const currentPolicy = policyProfileForHousehold(householdId, policyProfileId);

  if (!currentPolicy) {
    return null;
  }

  const normalizedName = parseRequiredText(
    name === undefined ? currentPolicy.name : name,
    'Policy profile name',
    80
  );
  const normalizedDescription = parseOptionalText(
    description === undefined ? currentPolicy.description : description,
    'Policy description',
    300
  );
  const normalizedMaxResults = parseMaxResults(maxResults);

  assertUniquePolicyName({
    householdId,
    policyProfileId: Number(policyProfileId),
    name: normalizedName
  });

  const result = db
    .prepare(
      `UPDATE policy_profiles
       SET
        name = ?,
        description = ?,
        max_results = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE household_id = ? AND id = ?`
    )
    .run(
      normalizedName,
      normalizedDescription,
      normalizedMaxResults,
      householdId,
      policyProfileId
    );

  if (!result.changes) {
    return null;
  }

  return policyProfileForHousehold(householdId, policyProfileId);
}

function deletePolicyProfile({ householdId, policyProfileId }) {
  const policyProfile = policyProfileForHousehold(householdId, policyProfileId);

  if (!policyProfile) {
    return null;
  }

  const assignedChild = db
    .prepare(
      `SELECT display_name
       FROM child_profiles
       WHERE household_id = ? AND policy_profile_id = ?
       ORDER BY display_name, id
       LIMIT 1`
    )
    .get(householdId, policyProfileId);

  // Do not let a policy deletion silently switch assigned children to the
  // default cap. Parents must choose a replacement policy first.
  if (assignedChild) {
    throw new RangeError(
      `Reassign ${assignedChild.display_name} before deleting this result policy.`
    );
  }

  const result = db
    .prepare('DELETE FROM policy_profiles WHERE household_id = ? AND id = ?')
    .run(householdId, policyProfileId);

  return result.changes > 0;
}

function createChildProfile({
  householdId,
  policyProfileId,
  displayName,
  birthYear,
  allowLimitedPolicy,
  allowLimitedMinConfidence,
  dailySearchLimit,
  dailyVideoWatchLimit
}) {
  const policyProfile = requirePolicyProfile(householdId, policyProfileId);
  const normalizedDisplayName = parseRequiredText(displayName, 'Child profile name', 80);
  const normalizedAllowLimitedPolicy = parseAllowLimitedPolicy(allowLimitedPolicy);
  const result = db
    .prepare(
      `INSERT INTO child_profiles (
        household_id,
        policy_profile_id,
        display_name,
        birth_year,
        allow_limited_policy,
        allow_limited_min_confidence,
        daily_search_limit,
        daily_video_watch_limit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      householdId,
      policyProfile.id,
      normalizedDisplayName,
      parseBirthYear(birthYear),
      normalizedAllowLimitedPolicy,
      parseConfidence(allowLimitedMinConfidence),
      parseNullableLimit(dailySearchLimit, 'dailySearchLimit'),
      parseNullableLimit(dailyVideoWatchLimit, 'dailyVideoWatchLimit')
    );

  return db
    .prepare('SELECT * FROM child_profiles WHERE household_id = ? AND id = ?')
    .get(householdId, result.lastInsertRowid);
}

function updateChildProfile({
  householdId,
  childProfileId,
  policyProfileId,
  displayName,
  birthYear,
  allowLimitedPolicy,
  allowLimitedMinConfidence,
  dailySearchLimit,
  dailyVideoWatchLimit
}) {
  const policyProfile = requirePolicyProfile(householdId, policyProfileId);
  const normalizedDisplayName = parseRequiredText(displayName, 'Child profile name', 80);
  const normalizedAllowLimitedPolicy = parseAllowLimitedPolicy(allowLimitedPolicy);
  const result = db
    .prepare(
      `UPDATE child_profiles
       SET
        policy_profile_id = ?,
        display_name = ?,
        birth_year = ?,
        allow_limited_policy = ?,
        allow_limited_min_confidence = ?,
        daily_search_limit = ?,
        daily_video_watch_limit = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE household_id = ? AND id = ?`
    )
    .run(
      policyProfile.id,
      normalizedDisplayName,
      parseBirthYear(birthYear),
      normalizedAllowLimitedPolicy,
      parseConfidence(allowLimitedMinConfidence),
      parseNullableLimit(dailySearchLimit, 'dailySearchLimit'),
      parseNullableLimit(dailyVideoWatchLimit, 'dailyVideoWatchLimit'),
      householdId,
      childProfileId
    );

  if (!result.changes) {
    return null;
  }

  return db
    .prepare('SELECT * FROM child_profiles WHERE household_id = ? AND id = ?')
    .get(householdId, childProfileId);
}

function deleteChildProfile({ householdId, childProfileId }) {
  return db.transaction(() => {
    const childProfile = db
      .prepare('SELECT id FROM child_profiles WHERE household_id = ? AND id = ?')
      .get(householdId, childProfileId);

    if (!childProfile) {
      return false;
    }

    const childCount = db
      .prepare('SELECT COUNT(*) AS count FROM child_profiles WHERE household_id = ?')
      .get(householdId).count;

    // Historical searches and review items keep their record but lose the
    // deleted profile reference through the schema's ON DELETE SET NULL rules.
    // A household must retain a profile so child search never has an empty setup.
    if (childCount <= 1) {
      throw new RangeError('Create another child profile before deleting the last one.');
    }

    const result = db
      .prepare('DELETE FROM child_profiles WHERE household_id = ? AND id = ?')
      .run(householdId, childProfileId);

    return result.changes > 0;
  })();
}

function updateChildPolicy({
  householdId,
  childProfileId,
  allowLimitedPolicy,
  allowLimitedMinConfidence,
  dailySearchLimit,
  dailyVideoWatchLimit
}) {
  const normalizedAllowLimitedPolicy = parseAllowLimitedPolicy(allowLimitedPolicy);

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
      normalizedAllowLimitedPolicy,
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
  CONTENT_POSTURES,
  DEFAULT_POLICY,
  FORMAT_GUARDRAILS,
  contentPostureFor,
  createChildProfile,
  createPolicyProfile,
  deleteChildProfile,
  deletePolicyProfile,
  getChildPolicy,
  getPolicyManagement,
  listPolicyProfiles,
  shouldQueueForReview,
  updateChildProfile,
  updateChildPolicy,
  updatePolicyProfile
};
