const crypto = require('crypto');
const db = require('../db/database');
const config = require('../config');

const ACTIVE_CHILD_COOKIE_NAME = 'kidview.child';
const ACTIVE_CHILD_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: ACTIVE_CHILD_MAX_AGE_MS,
    path: '/'
  };
}

function signatureFor(encodedPayload) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(encodedPayload)
    .digest('base64url');
}

function createActiveChildToken({ householdId, childProfileId, issuedAt = Date.now() }) {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      version: 1,
      householdId: Number(householdId),
      childProfileId: Number(childProfileId),
      issuedAt: Number(issuedAt)
    })
  ).toString('base64url');

  return `${encodedPayload}.${signatureFor(encodedPayload)}`;
}

function parseActiveChildToken(token) {
  const [encodedPayload, suppliedSignature, extraPart] = String(token || '').split('.');

  if (!encodedPayload || !suppliedSignature || extraPart) {
    return null;
  }

  const expectedSignature = signatureFor(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const householdId = Number(payload.householdId);
    const childProfileId = Number(payload.childProfileId);
    const issuedAt = Number(payload.issuedAt);
    const tokenAge = Date.now() - issuedAt;

    if (
      payload.version !== 1 ||
      !Number.isInteger(householdId) ||
      householdId < 1 ||
      !Number.isInteger(childProfileId) ||
      childProfileId < 1 ||
      !Number.isFinite(issuedAt) ||
      tokenAge < -1000 * 60 * 5 ||
      tokenAge > ACTIVE_CHILD_MAX_AGE_MS
    ) {
      return null;
    }

    return { householdId, childProfileId };
  } catch (error) {
    return null;
  }
}

function cookieValue(cookieHeader, cookieName) {
  const cookies = String(cookieHeader || '').split(';');

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');

    if (separatorIndex < 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name === cookieName) {
      try {
        return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
      } catch (error) {
        return null;
      }
    }
  }

  return null;
}

function getChildProfileForHousehold({ householdId, childProfileId }) {
  return (
    db
      .prepare(
      `SELECT
        child_profiles.id,
        child_profiles.household_id AS householdId,
        child_profiles.display_name AS displayName,
        child_profiles.birth_year AS birthYear,
        policy_profiles.id AS policyProfileId,
        policy_profiles.name AS policyProfileName,
        COALESCE(policy_profiles.max_results, 3) AS maxResults
       FROM child_profiles
       LEFT JOIN policy_profiles
        ON policy_profiles.id = child_profiles.policy_profile_id
        AND policy_profiles.household_id = child_profiles.household_id
       WHERE child_profiles.household_id = ? AND child_profiles.id = ?`
      )
      .get(householdId, childProfileId) || null
  );
}

function listChildProfilesForHousehold(householdId) {
  return db
    .prepare(
      `SELECT
        child_profiles.id,
        child_profiles.household_id AS householdId,
        child_profiles.display_name AS displayName,
        child_profiles.birth_year AS birthYear,
        policy_profiles.id AS policyProfileId,
        policy_profiles.name AS policyProfileName,
        COALESCE(policy_profiles.max_results, 3) AS maxResults
       FROM child_profiles
       LEFT JOIN policy_profiles
        ON policy_profiles.id = child_profiles.policy_profile_id
        AND policy_profiles.household_id = child_profiles.household_id
       WHERE child_profiles.household_id = ?
       ORDER BY child_profiles.display_name, child_profiles.id`
    )
    .all(householdId);
}

function getActiveChildProfile(req) {
  const token = cookieValue(req.headers.cookie, ACTIVE_CHILD_COOKIE_NAME);
  const payload = parseActiveChildToken(token);

  if (!payload) {
    return null;
  }

  return getChildProfileForHousehold(payload);
}

function setActiveChildProfile(res, { householdId, childProfileId }) {
  res.cookie(
    ACTIVE_CHILD_COOKIE_NAME,
    createActiveChildToken({ householdId, childProfileId }),
    cookieOptions()
  );
}

module.exports = {
  ACTIVE_CHILD_COOKIE_NAME,
  ACTIVE_CHILD_MAX_AGE_MS,
  createActiveChildToken,
  getActiveChildProfile,
  getChildProfileForHousehold,
  listChildProfilesForHousehold,
  parseActiveChildToken,
  setActiveChildProfile
};
