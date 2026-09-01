const db = require('../db/database');
const config = require('../config');

function usageDateForNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.usageTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => ['year', 'month', 'day'].includes(part.type))
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function usageSummary({ householdId, childProfileId, usageDate = usageDateForNow(), policy }) {
  const usage = db
    .prepare(
      `SELECT search_count, video_watch_count
       FROM child_daily_usage
       WHERE household_id = ? AND child_profile_id = ? AND usage_date = ?`
    )
    .get(householdId, childProfileId, usageDate) || { search_count: 0, video_watch_count: 0 };

  function limitSummary(limit, used) {
    return {
      limit: limit === null ? null : Number(limit),
      used: Number(used),
      remaining: limit === null ? null : Math.max(0, Number(limit) - Number(used))
    };
  }

  return {
    usageDate,
    searches: limitSummary(policy.dailySearchLimit, usage.search_count),
    watches: limitSummary(policy.dailyVideoWatchLimit, usage.video_watch_count)
  };
}

// A search is counted when it is admitted, before any source request.  This keeps
// the configured cap authoritative even if simultaneous browser requests arrive.
function consumeDailySearch({ householdId, childProfileId, policy }) {
  const usageDate = usageDateForNow();
  const limit = policy.dailySearchLimit;
  const result = db.transaction(() => {
    if (limit === null) {
      db.prepare(
        `INSERT INTO child_daily_usage (household_id, child_profile_id, usage_date, search_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(household_id, child_profile_id, usage_date)
         DO UPDATE SET search_count = search_count + 1, updated_at = CURRENT_TIMESTAMP`
      ).run(householdId, childProfileId, usageDate);
      return true;
    }

    return db.prepare(
      `INSERT INTO child_daily_usage (household_id, child_profile_id, usage_date, search_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(household_id, child_profile_id, usage_date)
       DO UPDATE SET search_count = search_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE search_count < ?`
    ).run(householdId, childProfileId, usageDate, limit).changes === 1;
  })();

  return { allowed: result, usage: usageSummary({ householdId, childProfileId, usageDate, policy }) };
}

function startPlayback({ householdId, childProfileId, videoId, policy, durationSeconds }) {
  const usageDate = usageDateForNow();
  const result = db.transaction(() => {
    const existing = db.prepare(
      `SELECT * FROM child_video_playbacks
       WHERE household_id = ? AND child_profile_id = ? AND video_id = ? AND usage_date = ?`
    ).get(householdId, childProfileId, videoId, usageDate);

    // Starting the same video again today resumes its existing record and does
    // not let reloads consume additional daily-video allowance.
    if (existing) {
      return { allowed: true, resumed: true, playback: existing };
    }

    const current = db.prepare(
      `SELECT video_watch_count FROM child_daily_usage
       WHERE household_id = ? AND child_profile_id = ? AND usage_date = ?`
    ).get(householdId, childProfileId, usageDate);
    const used = current ? Number(current.video_watch_count) : 0;
    const limit = policy.dailyVideoWatchLimit;

    if (limit !== null && used >= limit) {
      return { allowed: false };
    }

    db.prepare(
      `INSERT INTO child_daily_usage (household_id, child_profile_id, usage_date, video_watch_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(household_id, child_profile_id, usage_date)
       DO UPDATE SET video_watch_count = video_watch_count + 1, updated_at = CURRENT_TIMESTAMP`
    ).run(householdId, childProfileId, usageDate);

    const playback = db.prepare(
      `INSERT INTO child_video_playbacks (household_id, child_profile_id, video_id, usage_date)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    ).get(householdId, childProfileId, videoId, usageDate);

    return { allowed: true, resumed: false, playback };
  })();

  return {
    ...result,
    usage: usageSummary({ householdId, childProfileId, usageDate, policy }),
    durationSeconds: Math.max(0, Number(durationSeconds) || 0)
  };
}

function recordPlaybackProgress({ householdId, childProfileId, videoId, playbackId, currentTimeSeconds, durationSeconds }) {
  const currentTime = Number(currentTimeSeconds);

  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return { error: 'invalid_progress' };
  }

  const boundedProgress = Math.floor(Math.min(currentTime, Math.max(0, Number(durationSeconds) || 0)));
  const completionThreshold = Math.max(1, (Number(durationSeconds) || 0) - 5);
  const playback = db.transaction(() => {
    const existing = db.prepare(
      `SELECT * FROM child_video_playbacks
       WHERE id = ? AND household_id = ? AND child_profile_id = ? AND video_id = ?`
    ).get(playbackId, householdId, childProfileId, videoId);

    if (!existing) {
      return null;
    }

    return db.prepare(
      `UPDATE child_video_playbacks
       SET max_progress_seconds = MAX(max_progress_seconds, ?),
           last_progress_at = CURRENT_TIMESTAMP,
           completed_at = CASE
             WHEN completed_at IS NULL AND MAX(max_progress_seconds, ?) >= ? THEN CURRENT_TIMESTAMP
             ELSE completed_at
           END
       WHERE id = ?
       RETURNING *`
    ).get(boundedProgress, boundedProgress, completionThreshold, existing.id);
  })();

  return playback ? { playback } : { error: 'playback_not_found' };
}

module.exports = {
  consumeDailySearch,
  recordPlaybackProgress,
  startPlayback,
  usageDateForNow,
  usageSummary
};
