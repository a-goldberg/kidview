const db = require("../db/database");
const config = require("../config");
const mockVideoSourceService = require("./mockVideoSourceService");
const moderationService = require("./moderationService");
const {
  classifyCandidateCategory,
} = require("./categoryClassificationService");
const { getChildPolicy } = require("./policyService");
const youtubeSourceService = require("./youtubeSourceService");

function classifyCandidate(candidate) {
  const text = [candidate.title, candidate.description, candidate.channelTitle]
    .filter(Boolean)
    .join(" ");
  const labels = [];
  const liveStatus =
    candidate.liveStatus ||
    (candidate.isLivestream ? "completed_live" : "none");

  if (candidate.isShort) labels.push("short");
  if (liveStatus === "live") labels.push("live");
  if (liveStatus === "upcoming") labels.push("upcoming-live");
  if (liveStatus === "completed_live") labels.push("completed-live");
  if (!candidate.embeddable) labels.push("not-embeddable");
  if (/math|fraction|science|nature|history|animation|biology/i.test(text))
    labels.push("learning");
  if (/dangerous|stunt|weapon|flamethrower|poison|toxin/i.test(text))
    labels.push("needs-care");
  if (/toy|slime|surprise|mystery|won't believe|do not try/i.test(text))
    labels.push("high-stimulation");

  return {
    ...classifyCandidateCategory(candidate),
    labels,
  };
}

function confidenceFor(candidate) {
  const liveStatus =
    candidate.liveStatus ||
    (candidate.isLivestream ? "completed_live" : "none");

  if (
    candidate.isShort ||
    liveStatus === "live" ||
    liveStatus === "upcoming" ||
    !candidate.embeddable
  )
    return 0.35;
  if (liveStatus === "completed_live") return 0.5;
  if (candidate.primaryCategoryHint) return 0.7;
  return 0.6;
}

function childExplanationFor(candidate, classification) {
  if (classification.iconKey === "animals") {
    return "A KidView candidate about nature, animals, or the world around us.";
  }

  if (["education", "science"].includes(classification.iconKey)) {
    return "A KidView candidate that explains an idea in a simple way.";
  }

  if (["animation", "art", "making"].includes(classification.iconKey)) {
    return "A KidView candidate about making, building, or animation.";
  }

  return "A KidView-approved video.";
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
     RETURNING id`,
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
      is_livestream,
      live_status,
      published_at,
      view_count,
      youtube_category_id,
      youtube_category_title,
      made_for_kids
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      live_status = excluded.live_status,
      published_at = excluded.published_at,
      view_count = excluded.view_count,
      youtube_category_id = excluded.youtube_category_id,
      youtube_category_title = excluded.youtube_category_title,
      made_for_kids = excluded.made_for_kids,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id`,
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
      videos.live_status AS liveStatus,
      videos.published_at AS publishedAt,
      videos.view_count AS viewCount,
      videos.youtube_category_id AS youtubeCategoryId,
      videos.youtube_category_title AS youtubeCategoryTitle,
      videos.made_for_kids AS madeForKids,
      channels.id AS channelId,
      channels.title AS channelTitle
     FROM videos
     JOIN channels ON channels.id = videos.channel_id
     WHERE videos.id = ?`,
  );

  return db.transaction(() =>
    candidates
      .filter((candidate) => candidate.embeddable)
      .map((candidate) => {
        const liveStatus =
          candidate.liveStatus ||
          (candidate.isLivestream ? "completed_live" : "none");
        const channel = insertChannel.get(
          candidate.source,
          candidate.channelExternalId,
          candidate.channelTitle,
        );
        const classification = classifyCandidate(candidate);
        const video = insertVideo.get(
          channel.id,
          candidate.source,
          candidate.externalVideoId,
          candidate.title,
          candidate.description || "",
          candidate.durationSeconds || 0,
          classification.primaryCategory,
          classification.iconKey,
          JSON.stringify(classification.labels),
          confidenceFor(candidate),
          childExplanationFor(candidate, classification),
          "No household decision has been made yet.",
          candidate.isShort ? 1 : 0,
          liveStatus === "none" ? 0 : 1,
          liveStatus,
          candidate.publishedAt || null,
          Number(candidate.viewCount || 0),
          candidate.youtubeCategoryId || null,
          candidate.youtubeCategoryTitle || null,
          candidate.madeForKids ? 1 : 0,
        );

        return {
          ...selectCandidate.get(video.id),
          sourceRank: candidate.sourceRank || null,
        };
      }),
  )();
}

function sourceRejectedAuditCandidate(candidate) {
  return {
    videoId: null,
    channelId: null,
    sourceRank: candidate.sourceRank || null,
    title: candidate.title || "Untitled video",
    channelTitle: candidate.channelTitle || null,
    finalDecision: "block",
    shownToChild: false,
    visibilityReasonCode: "source_filter:not_embeddable",
    visibilityReason:
      "Hidden because the source candidate could not be safely embedded in KidView.",
    hardBlockReason:
      "Filtered because non-embeddable videos are not allowed for child search.",
    contentTags: [],
    riskTags: ["not-embeddable"],
    qualityTags: [],
    moderationSource: "source_filter",
    parentDecisionSource: null,
    parentDecisionAffected: false,
    reviewQueueState: "none",
    reviewQueueReasonCode: "source_filter:not_embeddable",
  };
}

async function getYouTubeSourceCandidates({
  query,
  householdId,
  childProfileId,
  policy,
}) {
  const youtubeCandidates = [];
  const sourceRejectedCandidates = [];
  const persistedCandidates = [];
  let nextPageToken = null;
  let pagesFetched = 0;
  let previewResults = [];

  do {
    const remaining =
      config.youtubeMaxCandidatesPerSearch - youtubeCandidates.length;
    const page = await youtubeSourceService.searchCandidatePage(query, {
      pageToken: nextPageToken,
      maxResults: Math.min(config.youtubeMaxSearchResults, remaining),
    });
    const pageCandidates = (page.candidates || []).map((candidate, index) => ({
      ...candidate,
      sourceRank: youtubeCandidates.length + index + 1,
    }));

    youtubeCandidates.push(...pageCandidates);
    sourceRejectedCandidates.push(
      ...pageCandidates
        .filter((candidate) => !candidate.embeddable)
        .map(sourceRejectedAuditCandidate),
    );
    persistedCandidates.push(...upsertSourceCandidates(pageCandidates));
    pagesFetched += 1;
    nextPageToken = page.nextPageToken || null;

    // Preview uses the same policy and decisions, but does not create review rows
    // while deciding whether another YouTube page is needed.
    previewResults = moderationService.moderateCandidatesWithDiagnostics({
      householdId,
      childProfileId,
      candidates: persistedCandidates,
      limit: policy.maxResults,
      policy,
      persist: false,
    }).results;
  } while (
    previewResults.length < policy.maxResults &&
    nextPageToken &&
    youtubeCandidates.length < config.youtubeMaxCandidatesPerSearch
  );

  return {
    sourceName: "youtube",
    sourceCount: youtubeCandidates.length,
    sourceHardRejected: sourceRejectedCandidates.length,
    sourceRejectedCandidates,
    candidates: persistedCandidates,
    pagesFetched,
  };
}

async function getSourceCandidates({
  query,
  householdId,
  childProfileId,
  policy,
}) {
  if (config.videoSource === "youtube") {
    return getYouTubeSourceCandidates({
      query,
      householdId,
      childProfileId,
      policy,
    });
  }

  const candidates = mockVideoSourceService
    .searchCandidates(query)
    .map((candidate, index) => ({
      ...candidate,
      sourceRank: index + 1,
    }));

  return {
    sourceName: "mock",
    sourceCount: candidates.length,
    sourceHardRejected: 0,
    sourceRejectedCandidates: [],
    candidates,
    pagesFetched: 1,
  };
}

function writeSearchAudit({
  householdId,
  childProfileId,
  query,
  sourceResponse,
  moderation,
  results,
}) {
  const diagnostics = moderation.diagnostics;
  const shownVideoIds = results.map((result) => result.videoId);
  const auditCandidates = [
    ...(sourceResponse.sourceRejectedCandidates || []),
    ...(moderation.auditCandidates || []),
  ];
  const hardBlockedCount =
    sourceResponse.sourceHardRejected + diagnostics.hardRejected;
  const auditSummary = {
    sourceMode: sourceResponse.sourceName,
    sourceCandidates: sourceResponse.sourceCount,
    persistedCandidates: sourceResponse.candidates.length,
    sourceHardRejected: sourceResponse.sourceHardRejected,
    moderationHardRejected: diagnostics.hardRejected,
    allowLimitedPolicy: moderation.allowLimitedPolicy || null,
    sourcePagesFetched: sourceResponse.pagesFetched || 1,
  };

  const insertSearchEvent = db.prepare(
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
      result_count,
      source_mode,
      source_candidate_count,
      hard_blocked_count,
      sent_to_review_count,
      allowed_count,
      allow_limited_count,
      unknown_count,
      blocked_count,
      shown_to_child_count,
      audit_summary_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCandidate = db.prepare(
    `INSERT INTO search_event_candidates (
      search_event_id,
      household_id,
      child_profile_id,
      video_id,
      channel_id,
      source_rank,
      title,
      channel_title,
      final_decision,
      shown_to_child,
      visibility_reason_code,
      visibility_reason,
      hard_block_reason,
      content_tags_json,
      risk_tags_json,
      quality_tags_json,
      moderation_source,
      parent_decision_source,
      parent_decision_affected,
      review_queue_state,
      review_queue_reason_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const attachReviewItem = db.prepare(
    `UPDATE household_review_items
     SET
      search_event_id = COALESCE(search_event_id, ?),
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND video_id = ?
      AND status = 'pending'`,
  );

  return db.transaction(() => {
    const searchEvent = insertSearchEvent.run(
      householdId,
      childProfileId || null,
      query,
      query,
      query,
      `${sourceResponse.sourceName}_discovery`,
      JSON.stringify([]),
      null,
      JSON.stringify(shownVideoIds),
      results.length,
      sourceResponse.sourceName,
      sourceResponse.sourceCount,
      hardBlockedCount,
      diagnostics.sentToReview,
      diagnostics.allowed,
      diagnostics.allowLimited,
      diagnostics.unknown,
      diagnostics.blocked,
      results.length,
      JSON.stringify(auditSummary),
    );

    auditCandidates.forEach((candidate) => {
      insertCandidate.run(
        searchEvent.lastInsertRowid,
        householdId,
        childProfileId || null,
        candidate.videoId || null,
        candidate.channelId || null,
        candidate.sourceRank || null,
        candidate.title || "Untitled video",
        candidate.channelTitle || null,
        candidate.finalDecision,
        candidate.shownToChild ? 1 : 0,
        candidate.visibilityReasonCode || null,
        candidate.visibilityReason,
        candidate.hardBlockReason || null,
        JSON.stringify(candidate.contentTags || []),
        JSON.stringify(candidate.riskTags || []),
        JSON.stringify(candidate.qualityTags || []),
        candidate.moderationSource || null,
        candidate.parentDecisionSource || null,
        candidate.parentDecisionAffected ? 1 : 0,
        candidate.reviewQueueState || null,
        candidate.reviewQueueReasonCode || null,
      );

      if (
        candidate.videoId &&
        (candidate.reviewQueueState === "created_pending" ||
          candidate.reviewQueueState === "matched_pending")
      ) {
        attachReviewItem.run(
          searchEvent.lastInsertRowid,
          householdId,
          candidate.videoId,
        );
      }
    });

    return searchEvent;
  })();
}

async function search({ query, householdId, childProfileId }) {
  const safeQuery = String(query || "").trim();

  if (!safeQuery || !householdId) {
    return {
      query: safeQuery,
      candidatesConsidered: 0,
      results: [],
    };
  }

  const policy = getChildPolicy({ householdId, childProfileId });
  const sourceResponse = await getSourceCandidates({
    query: safeQuery,
    householdId,
    childProfileId,
    policy,
  });
  const candidates = sourceResponse.candidates;
  const moderation = moderationService.moderateCandidatesWithDiagnostics({
    householdId,
    childProfileId,
    candidates,
    limit: policy.maxResults,
    policy,
  });
  const results = moderation.results;

  // Search audit intentionally stores compact metadata, not raw API payloads or transcript text.
  const searchEvent = writeSearchAudit({
    householdId,
    childProfileId,
    query: safeQuery,
    sourceResponse,
    moderation,
    results,
  });

  if (!config.isProduction && sourceResponse.sourceName === "youtube") {
    const hardRejected =
      sourceResponse.sourceHardRejected + moderation.diagnostics.hardRejected;
    console.log(
      [
        `YouTube source returned ${sourceResponse.sourceCount} candidate(s).`,
        `Pages fetched: ${sourceResponse.pagesFetched}.`,
        `Hard rejected: ${hardRejected}.`,
        `Auto-allowed: ${moderation.diagnostics.autoAllowed}.`,
        `Sent to review: ${moderation.diagnostics.sentToReview}.`,
        `Blocked/unknown: ${moderation.diagnostics.blockedOrUnknown}.`,
        `Shown to child: ${results.length}.`,
      ].join(" "),
    );
  }

  return {
    query: safeQuery,
    searchEventId: searchEvent.lastInsertRowid,
    candidatesConsidered: candidates.length,
    results,
  };
}

function markNotWhatIMeant({ searchEventId, householdId }) {
  return db
    .prepare(
      `UPDATE search_events
       SET not_what_i_meant = 1
       WHERE id = ? AND household_id = ?`,
    )
    .run(searchEventId, householdId).changes;
}

function recordClickedVideo({ searchEventId, householdId, videoId }) {
  return db
    .prepare(
      `UPDATE search_events
       SET clicked_video_id = ?
       WHERE id = ? AND household_id = ?`,
    )
    .run(videoId, searchEventId, householdId).changes;
}

module.exports = {
  markNotWhatIMeant,
  recordClickedVideo,
  search,
};
