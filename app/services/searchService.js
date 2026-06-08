const db = require('../db/database');
const mockVideoSourceService = require('./mockVideoSourceService');
const moderationService = require('./moderationService');

function search({ query, householdId, childProfileId }) {
  const safeQuery = String(query || '').trim();

  if (!safeQuery || !householdId) {
    return {
      query: safeQuery,
      candidatesConsidered: 0,
      results: []
    };
  }

  const candidates = mockVideoSourceService.searchCandidates(safeQuery);
  const results = moderationService.moderateCandidates({
    householdId,
    candidates,
    limit: 3
  });

  // Search events intentionally store only query metadata, not transcript text.
  const searchEvent = db.prepare(
    `INSERT INTO search_events (
      household_id,
      child_profile_id,
      query,
      original_query,
      clarified_query,
      query_intent,
      clarification_options_json,
      selected_clarification,
      shown_video_ids_json,
      result_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    householdId,
    childProfileId || null,
    safeQuery,
    safeQuery,
    safeQuery,
    'mock_discovery',
    JSON.stringify([]),
    null,
    JSON.stringify(results.map((result) => result.videoId)),
    results.length
  );

  return {
    query: safeQuery,
    searchEventId: searchEvent.lastInsertRowid,
    candidatesConsidered: candidates.length,
    results
  };
}

function markNotWhatIMeant({ searchEventId, householdId }) {
  return db
    .prepare(
      `UPDATE search_events
       SET not_what_i_meant = 1
       WHERE id = ? AND household_id = ?`
    )
    .run(searchEventId, householdId).changes;
}

function recordClickedVideo({ searchEventId, householdId, videoId }) {
  return db
    .prepare(
      `UPDATE search_events
       SET clicked_video_id = ?
       WHERE id = ? AND household_id = ?`
    )
    .run(videoId, searchEventId, householdId).changes;
}

module.exports = {
  markNotWhatIMeant,
  recordClickedVideo,
  search
};
