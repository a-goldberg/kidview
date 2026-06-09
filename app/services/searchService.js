const db = require('../db/database');
const config = require('../config');
const mockVideoSourceService = require('./mockVideoSourceService');
const moderationService = require('./moderationService');
const youtubeSourceService = require('./youtubeSourceService');

const CATEGORY_RULES = [
  {
    pattern: /animal|biology|blue|cat|nature|ocean|otter|rainforest|sea/i,
    primaryCategory: 'Animals',
    iconKey: 'animals'
  },
  {
    pattern: /animation|art|build|craft|draw|pixar|slime|toy|treehouse/i,
    primaryCategory: 'Art',
    iconKey: 'art'
  },
  {
    pattern: /fraction|history|math|physics|science|water|weapon/i,
    primaryCategory: 'Science',
    iconKey: 'science'
  }
];

function classifyCandidate(candidate) {
  const haystack = [
    candidate.title,
    candidate.description,
    candidate.channelTitle,
    candidate.primaryCategoryHint
  ]
    .filter(Boolean)
    .join(' ');
  const matchedRule = CATEGORY_RULES.find((rule) => rule.pattern.test(haystack));
  const labels = [];

  if (candidate.isShort) labels.push('short');
  if (candidate.isLivestream) labels.push('livestream');
  if (!candidate.embeddable) labels.push('not-embeddable');
  if (/math|fraction|science|nature|history|animation|biology/i.test(haystack)) labels.push('learning');
  if (/dangerous|stunt|weapon|flamethrower|poison|toxin/i.test(haystack)) labels.push('needs-care');
  if (/toy|slime|surprise|mystery|won't believe|do not try/i.test(haystack)) labels.push('high-stimulation');

  return {
    primaryCategory: matchedRule ? matchedRule.primaryCategory : 'General',
    iconKey: matchedRule ? matchedRule.iconKey : 'general',
    labels
  };
}

function confidenceFor(candidate) {
  if (candidate.isShort || candidate.isLivestream || !candidate.embeddable) return 0.35;
  if (candidate.primaryCategoryHint) return 0.7;
  return 0.6;
}

function childExplanationFor(candidate, classification) {
  if (classification.primaryCategory === 'Animals') {
    return 'A KidView candidate about nature, animals, or the world around us.';
  }

  if (classification.primaryCategory === 'Science') {
    return 'A KidView candidate that explains an idea in a simple way.';
  }

  if (classification.primaryCategory === 'Art') {
    return 'A KidView candidate about making, building, or animation.';
  }

  return 'A KidView candidate waiting for household review.';
}

function upsertSourceCandidates(candidates) {
  if (!candidates.length) {
    return [];
  }

  const insertChannel = db.prepare(
    `INSERT INTO channels (source, external_id, title)
     VALUES (?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
      title = excluded.title,
      updated_at = CURRENT_TIMESTAMP
     RETURNING id`
  );
  const insertVideo = db.prepare(
    `INSERT INTO videos (
      channel_id,
      source,
      external_id,
      title,
      description,
      duration_seconds,
      primary_category,
      icon_key,
      labels_json,
      confidence_score,
      child_explanation,
      parent_explanation,
      is_short,
      is_livestream
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      title = excluded.title,
      description = excluded.description,
      duration_seconds = excluded.duration_seconds,
      primary_category = excluded.primary_category,
      icon_key = excluded.icon_key,
      labels_json = excluded.labels_json,
      confidence_score = excluded.confidence_score,
      child_explanation = excluded.child_explanation,
      parent_explanation = excluded.parent_explanation,
      is_short = excluded.is_short,
      is_livestream = excluded.is_livestream,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id`
  );
  const selectCandidate = db.prepare(
    `SELECT
      videos.id AS videoId,
      videos.title,
      videos.description,
      videos.duration_seconds AS durationSeconds,
      videos.primary_category AS primaryCategory,
      videos.icon_key AS iconKey,
      videos.labels_json AS labelsJson,
      videos.confidence_score AS confidenceScore,
      videos.child_explanation AS childExplanation,
      videos.parent_explanation AS parentExplanation,
      videos.is_short AS isShort,
      videos.is_livestream AS isLivestream,
      channels.id AS channelId,
      channels.title AS channelTitle
     FROM videos
     JOIN channels ON channels.id = videos.channel_id
     WHERE videos.id = ?`
  );

  return db.transaction(() =>
    candidates
      .filter((candidate) => candidate.embeddable)
      .map((candidate) => {
        const channel = insertChannel.get(
          candidate.source,
          candidate.channelExternalId,
          candidate.channelTitle
        );
        const classification = classifyCandidate(candidate);
        const video = insertVideo.get(
          channel.id,
          candidate.source,
          candidate.externalVideoId,
          candidate.title,
          candidate.description || '',
          candidate.durationSeconds || 0,
          classification.primaryCategory,
          classification.iconKey,
          JSON.stringify(classification.labels),
          confidenceFor(candidate),
          childExplanationFor(candidate, classification),
          'No household decision has been made yet.',
          candidate.isShort ? 1 : 0,
          candidate.isLivestream ? 1 : 0
        );

        return selectCandidate.get(video.id);
      })
  )();
}

async function getSourceCandidates(query) {
  if (config.videoSource === 'youtube') {
    const youtubeCandidates = await youtubeSourceService.searchCandidates(query);
    return {
      sourceName: 'youtube',
      sourceCount: youtubeCandidates.length,
      candidates: upsertSourceCandidates(youtubeCandidates)
    };
  }

  const candidates = mockVideoSourceService.searchCandidates(query);
  return {
    sourceName: 'mock',
    sourceCount: candidates.length,
    candidates
  };
}

async function search({ query, householdId, childProfileId }) {
  const safeQuery = String(query || '').trim();

  if (!safeQuery || !householdId) {
    return {
      query: safeQuery,
      candidatesConsidered: 0,
      results: []
    };
  }

  const sourceResponse = await getSourceCandidates(safeQuery);
  const candidates = sourceResponse.candidates;
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
    `${sourceResponse.sourceName}_discovery`,
    JSON.stringify([]),
    null,
    JSON.stringify(results.map((result) => result.videoId)),
    results.length
  );

  if (!config.isProduction && sourceResponse.sourceName === 'youtube') {
    console.log(
      `YouTube source returned ${sourceResponse.sourceCount} candidate(s); ${results.length} survived KidView policy/moderation.`
    );
  }

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
