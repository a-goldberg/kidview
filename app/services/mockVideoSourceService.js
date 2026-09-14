const db = require('../db/database');
const { MODERATION_CANDIDATE_SELECT } = require('./moderationCandidateService');

function searchCandidates(query) {
  const safeQuery = `%${String(query || '').trim()}%`;

  return db
    .prepare(
      `${MODERATION_CANDIDATE_SELECT}
       WHERE videos.title LIKE ?
          OR videos.description LIKE ?
          OR videos.primary_category LIKE ?
          OR channels.title LIKE ?
       ORDER BY videos.confidence_score DESC, videos.id ASC
       LIMIT 12`
    )
    .all(safeQuery, safeQuery, safeQuery, safeQuery);
}

module.exports = {
  searchCandidates
};
