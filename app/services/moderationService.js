const db = require("../db/database")
const {
  FORMAT_GUARDRAILS,
  getChildPolicy,
  shouldQueueForReview,
} = require("./policyService")
const { MODERATION_CANDIDATE_SELECT } = require("./moderationCandidateService")
const {
  MODERATION_CACHE_VERSION,
  ageInDays,
  liveStatusFor,
  moderationInputFingerprint,
  scoreCandidate,
  viewsPerDay,
} = require("./moderationScoringService")

const ICON_PATHS = {
  animals: "/icons/animals2.png",
  art: "/icons/art.svg",
  animation: "/icons/animation2.png",
  documentary: "/icons/documentary2.png",
  education: "/icons/education.svg",
  family: "/icons/family.svg",
  general: "/icons/general.svg",
  making: "/icons/making2.png",
  music: "/icons/music2.png",
  science: "/icons/science.svg",
  sports: "/icons/sports.svg",
  travel: "/icons/travel2.png",
  vehicles: "/icons/vehicles2.png",
}

const RULE_MODEL_NAME = "rule-based-v1"
const RULE_PROMPT_VERSION = "rules-v1"

function getDecisionMaps(householdId, candidates) {
  const videoIds = candidates.map((candidate) => candidate.videoId)
  const channelIds = [
    ...new Set(candidates.map((candidate) => candidate.channelId)),
  ]

  const videoDecisions = new Map()
  const channelDecisions = new Map()
  const reviews = new Map()

  if (videoIds.length) {
    const placeholders = videoIds.map(() => "?").join(",")

    db.prepare(
      `SELECT video_id, decision, parent_facing_reason
       FROM household_video_decisions
       WHERE household_id = ? AND video_id IN (${placeholders})`,
    )
      .all(householdId, ...videoIds)
      .forEach((row) => {
        videoDecisions.set(row.video_id, row)
      })

    db.prepare(
      `SELECT
        video_id,
        status,
        decision,
        parent_facing_reason,
        parent_explanation,
        confidence_score,
        primary_category,
        content_tags_json,
        risk_tags_json,
        quality_tags_json,
        child_explanation,
        cache_version,
        input_fingerprint
       FROM moderation_reviews
       WHERE household_id = ? AND video_id IN (${placeholders})`,
    )
      .all(householdId, ...videoIds)
      .forEach((row) => {
        reviews.set(row.video_id, row)
      })
  }

  if (channelIds.length) {
    const placeholders = channelIds.map(() => "?").join(",")

    db.prepare(
      `SELECT channel_id, decision, parent_facing_reason
       FROM household_channel_decisions
       WHERE household_id = ? AND channel_id IN (${placeholders})`,
    )
      .all(householdId, ...channelIds)
      .forEach((row) => {
        channelDecisions.set(row.channel_id, row)
      })
  }

  return {
    videoDecisions,
    channelDecisions,
    reviews,
  }
}

function parseLabels(labelsJson) {
  try {
    const labels = JSON.parse(labelsJson || "[]")
    return Array.isArray(labels) ? labels : []
  } catch (error) {
    return []
  }
}

function formatHardFilter(candidate) {
  if (candidate.isShort && FORMAT_GUARDRAILS.shorts === "block") {
    return {
      decision: "block",
      reason: "Filtered because Shorts are not allowed for child search.",
      riskTags: ["short"],
    }
  }

  const liveStatus = liveStatusFor(candidate)

  if (
    (liveStatus === "live" && FORMAT_GUARDRAILS.live === "block") ||
    (liveStatus === "upcoming" && FORMAT_GUARDRAILS.upcoming === "block")
  ) {
    return {
      decision: "block",
      reason: `Filtered because ${liveStatus === "live" ? "live" : "upcoming"} streams cannot be assessed before child viewing.`,
      riskTags: [liveStatus],
      skipReviewQueue: true,
    }
  }

  return null
}

function decisionFromParentVideo(decision) {
  const decisionMap = {
    allow: "allow",
    allow_limited: "allow_limited",
    review_required: "review",
    block: "block",
  }

  return decisionMap[decision] || "unknown"
}

function decisionFromStoredReview(review) {
  const decision = review.decision || review.status || "unknown"
  return decision === "pending" ? "review" : decision
}

function resultFromStoredReview(candidate, review) {
  return {
    decision: decisionFromStoredReview(review),
    confidenceScore:
      review.confidence_score || candidate.confidenceScore || 0.5,
    primaryCategory:
      review.primary_category || candidate.primaryCategory || "General",
    contentTags: parseLabels(review.content_tags_json),
    riskTags: parseLabels(review.risk_tags_json),
    qualityTags: parseLabels(review.quality_tags_json),
    childExplanation: review.child_explanation || candidate.childExplanation,
    parentExplanation:
      review.parent_explanation ||
      review.parent_facing_reason ||
      candidate.parentExplanation ||
      "",
    source: "stored_moderation_review",
  }
}

function storedReviewMatchesCandidate(candidate, review) {
  return (
    review.cache_version === MODERATION_CACHE_VERSION &&
    review.input_fingerprint === moderationInputFingerprint(candidate)
  )
}

function writeModerationReview({
  householdId,
  candidate,
  result,
  channelDecision = null,
  persist = true,
}) {
  if (!persist) {
    return
  }

  db.prepare(
    `INSERT INTO moderation_reviews (
      household_id,
      video_id,
      status,
      decision,
      parent_facing_reason,
      confidence_score,
      primary_category,
      content_tags_json,
      risk_tags_json,
      quality_tags_json,
      child_explanation,
      parent_explanation,
      model_name,
      prompt_version,
      transcript_used,
      cache_version,
      input_fingerprint
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(household_id, video_id) DO UPDATE SET
      status = excluded.status,
      decision = excluded.decision,
      parent_facing_reason = excluded.parent_facing_reason,
      confidence_score = excluded.confidence_score,
      primary_category = excluded.primary_category,
      content_tags_json = excluded.content_tags_json,
      risk_tags_json = excluded.risk_tags_json,
      quality_tags_json = excluded.quality_tags_json,
      child_explanation = excluded.child_explanation,
      parent_explanation = excluded.parent_explanation,
      model_name = excluded.model_name,
      prompt_version = excluded.prompt_version,
      transcript_used = excluded.transcript_used,
      cache_version = excluded.cache_version,
      input_fingerprint = excluded.input_fingerprint`,
  ).run(
    householdId,
    candidate.videoId,
    result.decision,
    result.decision,
    result.parentExplanation,
    result.confidenceScore,
    result.primaryCategory,
    JSON.stringify(result.contentTags || []),
    JSON.stringify(result.riskTags || []),
    JSON.stringify(result.qualityTags || []),
    result.childExplanation,
    result.parentExplanation,
    RULE_MODEL_NAME,
    RULE_PROMPT_VERSION,
    MODERATION_CACHE_VERSION,
    moderationInputFingerprint(candidate, channelDecision),
  )
}

function resolvePendingReviewItem({
  householdId,
  candidate,
  reasonCode,
  persist = true,
}) {
  if (!persist) {
    return { state: "none", reasonCode: `preview:${reasonCode}` }
  }

  const result = db
    .prepare(
      `UPDATE household_review_items
     SET
      status = 'expired',
      reason_code = ?,
      resolved_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
     WHERE household_id = ?
      AND video_id = ?
      AND status = 'pending'`,
    )
    .run(reasonCode, householdId, candidate.videoId)

  return {
    state: result.changes ? "resolved" : "none",
    reasonCode,
  }
}

function ensurePendingReviewItem({
  householdId,
  childProfileId,
  candidate,
  result,
  policy,
  persist = true,
}) {
  if (!persist) {
    return { state: "none", reasonCode: `preview:${result.decision}` }
  }

  if (result.decision === "allow") {
    return resolvePendingReviewItem({
      householdId,
      candidate,
      reasonCode: "auto_allowed_by_moderation",
    })
  }

  if (!shouldQueueForReview({ decision: result.decision, policy })) {
    return resolvePendingReviewItem({
      householdId,
      candidate,
      reasonCode:
        result.decision === "allow_limited"
          ? `profile_policy:${policy.allowLimitedPolicy}`
          : `not_review_queue:${result.decision || "unknown"}`,
    })
  }

  const existingPending = db
    .prepare(
      `SELECT id
     FROM household_review_items
     WHERE household_id = ?
      AND video_id = ?
      AND status = 'pending'`,
    )
    .get(householdId, candidate.videoId)

  db.prepare(
    `INSERT INTO household_review_items (
      household_id,
      child_profile_id,
      video_id,
      status,
      reason_code
    )
    VALUES (?, ?, ?, 'pending', ?)
    ON CONFLICT(household_id, video_id) WHERE status = 'pending' DO UPDATE SET
      child_profile_id = COALESCE(excluded.child_profile_id, household_review_items.child_profile_id),
      reason_code = excluded.reason_code,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(householdId, childProfileId || null, candidate.videoId, result.decision)

  return {
    state: existingPending ? "matched_pending" : "created_pending",
    reasonCode: result.decision,
  }
}

function resolveDecision({
  householdId,
  childProfileId,
  candidate,
  maps,
  policy,
  persist = true,
}) {
  const channelDecision = maps.channelDecisions.get(candidate.channelId)
  const videoDecision = maps.videoDecisions.get(candidate.videoId)
  const storedReview = maps.reviews.get(candidate.videoId)
  const hardBlocked = formatHardFilter(candidate)

  if (hardBlocked) {
    const result = {
      ...hardBlocked,
      confidenceScore: 0.99,
      primaryCategory: candidate.primaryCategory || "General",
      contentTags: parseLabels(candidate.labelsJson),
      qualityTags: [],
      childExplanation: "",
      parentExplanation: hardBlocked.reason,
    }
    writeModerationReview({
      householdId,
      candidate,
      result,
      channelDecision,
      persist,
    })
    const reviewQueue = resolvePendingReviewItem({
      householdId,
      candidate,
      reasonCode: `hard_block:${hardBlocked.riskTags[0] || "blocked"}`,
      persist,
    })
    return {
      ...result,
      parentDecisionSource: null,
      parentDecisionAffected: false,
      reviewQueue,
      source: "hard_filter",
    }
  }

  if (videoDecision) {
    let overriddenDecisionSource = null

    if (
      channelDecision &&
      ["blocked", "review_first"].includes(channelDecision.decision)
    ) {
      overriddenDecisionSource = `channel:${channelDecision.decision}`
    } else if (storedReview) {
      const storedDecision = decisionFromStoredReview(storedReview)

      if (["block", "review", "unknown"].includes(storedDecision)) {
        overriddenDecisionSource = `moderation:${storedDecision}`
      }
    }

    const reviewQueue = resolvePendingReviewItem({
      householdId,
      candidate,
      reasonCode: `durable_video_decision:${videoDecision.decision}`,
      persist,
    })
    return {
      decision: decisionFromParentVideo(videoDecision.decision),
      confidenceScore: 0.99,
      primaryCategory: candidate.primaryCategory || "General",
      contentTags: parseLabels(candidate.labelsJson),
      riskTags: [],
      qualityTags: ["parent-video-decision"],
      childExplanation: candidate.childExplanation,
      parentExplanation:
        videoDecision.parent_facing_reason || candidate.parentExplanation || "",
      parentDecisionSource: "video",
      parentDecisionAffected: true,
      overriddenDecisionSource,
      reviewQueue,
      source: "parent_video_decision",
    }
  }

  if (channelDecision && channelDecision.decision === "blocked") {
    const result = {
      decision: "block",
      reason:
        channelDecision.parent_facing_reason ||
        "Blocked because this household blocked the channel.",
      confidenceScore: 0.99,
      primaryCategory: candidate.primaryCategory || "General",
      contentTags: parseLabels(candidate.labelsJson),
      riskTags: ["blocked-channel"],
      qualityTags: [],
      childExplanation: "",
      parentExplanation:
        channelDecision.parent_facing_reason ||
        "Blocked because this household blocked the channel.",
    }
    writeModerationReview({
      householdId,
      candidate,
      result,
      channelDecision,
      persist,
    })
    const reviewQueue = resolvePendingReviewItem({
      householdId,
      candidate,
      reasonCode: "durable_channel_decision:blocked",
      persist,
    })
    return {
      ...result,
      parentDecisionSource: "channel",
      parentDecisionAffected: true,
      reviewQueue,
      source: "hard_filter",
    }
  }

  if (channelDecision && channelDecision.decision === "review_first") {
    const result = {
      decision: "review",
      confidenceScore: 0.95,
      primaryCategory: candidate.primaryCategory || "General",
      contentTags: parseLabels(candidate.labelsJson),
      riskTags: ["channel-review-first"],
      qualityTags: [],
      childExplanation: "",
      parentExplanation:
        channelDecision.parent_facing_reason ||
        "Household requires review before this channel appears.",
    }
    writeModerationReview({
      householdId,
      candidate,
      result,
      channelDecision,
      persist,
    })
    const reviewQueue = ensurePendingReviewItem({
      householdId,
      childProfileId,
      candidate,
      result,
      policy,
      persist,
    })
    return {
      ...result,
      parentDecisionSource: "channel",
      parentDecisionAffected: true,
      reviewQueue,
      source: "parent_channel_decision",
    }
  }

  if (
    storedReview &&
    !channelDecision &&
    storedReviewMatchesCandidate(candidate, storedReview)
  ) {
    const result = resultFromStoredReview(candidate, storedReview)
    const reviewQueue = ensurePendingReviewItem({
      householdId,
      childProfileId,
      candidate,
      result,
      policy,
      persist,
    })
    return {
      ...result,
      parentDecisionSource: null,
      parentDecisionAffected: false,
      reviewQueue,
    }
  }

  const automated = scoreCandidate(candidate, channelDecision)
  writeModerationReview({
    householdId,
    candidate,
    result: automated,
    channelDecision,
    persist,
  })
  const reviewQueue = ensurePendingReviewItem({
    householdId,
    childProfileId,
    candidate,
    result: automated,
    policy,
    persist,
  })

  return {
    ...automated,
    parentDecisionSource:
      channelDecision && channelDecision.decision === "approved"
        ? "channel"
        : null,
    parentDecisionAffected: Boolean(
      channelDecision && channelDecision.decision === "approved",
    ),
    reviewQueue,
    source: "rule_based",
  }
}

function normalizeCandidate(candidate, decisionResult) {
  const iconKey = candidate.iconKey || "general"

  return {
    videoId: candidate.videoId,
    externalId: candidate.externalId,
    title: candidate.title,
    channelTitle: candidate.channelTitle,
    durationSeconds: candidate.durationSeconds,
    primaryCategory:
      decisionResult.primaryCategory || candidate.primaryCategory,
    iconKey,
    iconPath: ICON_PATHS[iconKey] || ICON_PATHS.general,
    labels: [
      ...parseLabels(candidate.labelsJson),
      ...(decisionResult.contentTags || []),
      ...(decisionResult.qualityTags || []),
    ],
    decision: decisionResult.decision,
    confidenceScore: decisionResult.confidenceScore,
    childExplanation:
      decisionResult.childExplanation || candidate.childExplanation,
    parentExplanation:
      decisionResult.parentExplanation || candidate.parentExplanation || "",
    watchUrl: `/child/videos/${candidate.videoId}`,
  }
}

function updateDiagnostics(diagnostics, decisionResult) {
  if (decisionResult.source === "hard_filter") {
    diagnostics.hardRejected += 1
  }

  if (decisionResult.decision === "allow") {
    diagnostics.allowed += 1
    diagnostics.autoAllowed += decisionResult.source === "rule_based" ? 1 : 0
  } else if (decisionResult.decision === "allow_limited") {
    diagnostics.allowLimited += 1
  } else if (decisionResult.decision === "review") {
    diagnostics.review += 1
  } else if (decisionResult.decision === "block") {
    diagnostics.blocked += 1
    diagnostics.blockedOrUnknown += 1
  } else if (decisionResult.decision === "unknown") {
    diagnostics.unknown += 1
    diagnostics.blockedOrUnknown += 1
  }

  if (
    decisionResult.reviewQueue &&
    ["created_pending", "matched_pending"].includes(
      decisionResult.reviewQueue.state,
    )
  ) {
    diagnostics.sentToReview += 1
  }
}

function visibilityReasonFor({ decision, shownToChild, visibilityReasonCode }) {
  if (shownToChild) {
    if (visibilityReasonCode === "shown_parent_video_override") {
      return "Shown because a parent allowed this specific video, overriding the broader channel or moderation decision."
    }

    if (visibilityReasonCode === "shown_allow_limited_profile_policy") {
      return "Shown because this child profile allows limited-access videos under the current profile policy."
    }

    return "Shown because moderation resolved this candidate as allowed within the child result limit."
  }

  if (visibilityReasonCode === "hidden_allow_limited_profile_policy") {
    return "Hidden because this child profile does not make limited-access videos child-visible."
  }

  const reasons = {
    allow: "Hidden because the child result limit had already been reached.",
    allow_limited:
      "Hidden because the child profile policy did not select this limited-access video.",
    review:
      "Hidden because this candidate requires parent review before child display.",
    block: "Hidden because this candidate is blocked for child search.",
    unknown:
      "Hidden because KidView did not have enough confidence to show it.",
  }

  return (
    reasons[decision] || "Hidden because it was not eligible for child display."
  )
}

function visibilityReasonCodeFor({
  decision,
  shownToChild,
  allowLimitedPolicy,
  overriddenDecisionSource,
}) {
  if (shownToChild && overriddenDecisionSource) {
    return "shown_parent_video_override"
  }

  if (shownToChild && decision === "allow_limited") {
    return "shown_allow_limited_profile_policy"
  }

  if (!shownToChild && decision === "allow_limited") {
    return "hidden_allow_limited_profile_policy"
  }

  if (shownToChild) {
    return "shown_allow"
  }

  const codes = {
    allow: "hidden_result_limit",
    review: "hidden_review_required",
    block: "hidden_blocked",
    unknown: "hidden_unknown",
  }

  return (
    codes[decision] ||
    `hidden_not_child_visible:${allowLimitedPolicy || "default"}`
  )
}

function auditCandidateFor(
  candidate,
  decisionResult,
  shownToChild,
  allowLimitedPolicy,
) {
  const visibilityReasonCode = visibilityReasonCodeFor({
    decision: decisionResult.decision,
    shownToChild,
    allowLimitedPolicy,
    overriddenDecisionSource: decisionResult.overriddenDecisionSource,
  })

  return {
    videoId: candidate.videoId || null,
    channelId: candidate.channelId || null,
    sourceRank: candidate.sourceRank || null,
    title: candidate.title,
    channelTitle: candidate.channelTitle || null,
    finalDecision: decisionResult.decision || "unknown",
    shownToChild,
    visibilityReasonCode,
    visibilityReason: visibilityReasonFor({
      decision: decisionResult.decision,
      shownToChild,
      visibilityReasonCode,
    }),
    hardBlockReason:
      decisionResult.source === "hard_filter"
        ? decisionResult.parentExplanation || decisionResult.reason || null
        : null,
    contentTags: decisionResult.contentTags || [],
    riskTags: decisionResult.riskTags || [],
    qualityTags: decisionResult.qualityTags || [],
    moderationSource: decisionResult.source || null,
    parentDecisionSource: decisionResult.parentDecisionSource || null,
    parentDecisionAffected: Boolean(decisionResult.parentDecisionAffected),
    reviewQueueState:
      decisionResult.reviewQueue && decisionResult.reviewQueue.state,
    reviewQueueReasonCode:
      decisionResult.reviewQueue && decisionResult.reviewQueue.reasonCode,
  }
}

function selectChildVisibleEntries(
  normalized,
  allowLimitedPolicy,
  allowLimitedMinConfidence,
  limit,
) {
  if (allowLimitedPolicy === "allow") {
    return normalized
      .filter(
        (entry) =>
          entry.result.decision === "allow" ||
          entry.result.decision === "allow_limited",
      )
      .slice(0, limit)
  }

  const allowed = normalized.filter(
    (entry) => entry.result.decision === "allow",
  )

  if (allowLimitedPolicy !== "limited_frequency") {
    return allowed.slice(0, limit)
  }

  const selected = allowed.slice(0, limit)

  if (selected.length >= limit) {
    return selected
  }

  const limited = normalized.find(
    (entry) =>
      entry.result.decision === "allow_limited" &&
      Number(entry.result.confidenceScore || 0) > allowLimitedMinConfidence,
  )

  if (limited) {
    selected.push(limited)
  }

  return selected
}

function executeModeration({
  householdId,
  childProfileId,
  candidates,
  limit = 3,
  policy,
  persist = true,
}) {
  const diagnostics = {
    hardRejected: 0,
    autoAllowed: 0,
    sentToReview: 0,
    blockedOrUnknown: 0,
    allowed: 0,
    allowLimited: 0,
    review: 0,
    blocked: 0,
    unknown: 0,
  }

  if (!householdId || !candidates.length) {
    return {
      results: [],
      diagnostics,
      auditCandidates: [],
    }
  }

  const profilePolicy =
    policy || getChildPolicy({ householdId, childProfileId })
  const maps = getDecisionMaps(householdId, candidates)
  const normalized = candidates.map((candidate) => {
    const decisionResult = resolveDecision({
      householdId,
      childProfileId,
      candidate,
      maps,
      policy: profilePolicy,
      persist,
    })
    updateDiagnostics(diagnostics, decisionResult)
    return {
      candidate,
      decisionResult,
      result: normalizeCandidate(candidate, decisionResult),
    }
  })
  // Hard filters and parent block/review-first decisions are resolved before this
  // point. This policy only controls candidates that survived as allow_limited.
  const selectedEntries = selectChildVisibleEntries(
    normalized,
    profilePolicy.allowLimitedPolicy,
    profilePolicy.allowLimitedMinConfidence,
    limit,
  )
  const results = selectedEntries.map((entry) => entry.result)
  const shownVideoIds = new Set(results.map((result) => result.videoId))

  return {
    results,
    diagnostics,
    allowLimitedPolicy: profilePolicy.allowLimitedPolicy,
    policy: profilePolicy,
    auditCandidates: normalized.map((entry) =>
      auditCandidateFor(
        entry.candidate,
        entry.decisionResult,
        shownVideoIds.has(entry.candidate.videoId),
        profilePolicy.allowLimitedPolicy,
      ),
    ),
  }
}

function moderateCandidatesWithDiagnostics(options) {
  if (options.persist === false) {
    return executeModeration(options)
  }

  // Review rows and their matching queue state describe one moderation result.
  return db.transaction(() => executeModeration(options))()
}

function moderateCandidates({
  householdId,
  childProfileId,
  candidates,
  limit = 3,
}) {
  return moderateCandidatesWithDiagnostics({
    householdId,
    childProfileId,
    candidates,
    limit,
  }).results
}

function remoderateChannelVideos({ householdId, channelId }) {
  const candidates = db
    .prepare(`${MODERATION_CANDIDATE_SELECT} WHERE channels.id = ?`)
    .all(channelId)

  moderateCandidatesWithDiagnostics({
    householdId,
    candidates,
    limit: candidates.length || 1,
  })

  return candidates.length
}

function getChildSafeVideo({ householdId, childProfileId, videoId }) {
  const candidate = db
    .prepare(`${MODERATION_CANDIDATE_SELECT} WHERE videos.id = ?`)
    .get(videoId)

  if (!candidate) {
    return null
  }

  const [result] = moderateCandidatesWithDiagnostics({
    householdId,
    childProfileId,
    candidates: [candidate],
    limit: 1,
    persist: false,
  }).results

  return result || null
}

module.exports = {
  ageInDays,
  getChildSafeVideo,
  moderateCandidates,
  moderateCandidatesWithDiagnostics,
  remoderateChannelVideos,
  viewsPerDay,
}
