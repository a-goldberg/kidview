const db = require("../db/database")
const {
  FORMAT_GUARDRAILS,
  getChildPolicy,
  shouldQueueForReview,
} = require("./policyService")

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

const SEVERE_RISK_PATTERN =
  /suicide|self[- ]?harm|p[0o]{1}rn|pr[o0]{1}n|pstars|prnstars|x{3,}|bbw|boot(y|ie)|butt(?!er)|\bass\b|\banal\b|brazzers|\btit(s|ties)?\b|\bsexx?(y|ual)?|nak[ei]d|boobies|\bdicks?\b|\brape(\b|s)|\bslut|gore|murder|kill|weapon|gun|knife|flamethrower|poison|toxin|skyscraper|rooftop/i
const RISK_PATTERN =
  /scary|secret|secrets|exposed|drama|breakup|rumor|prank|challenge|mystery box|unboxing|haul|shopping|spent \$|won't believe|do not try|dangerous|gaming|minecraft|roblox|fortnite|dark fantasy|pvp|boob|breasts|graphic/i
const CLICKBAIT_PATTERN =
  /!!!|😱|🔥|you won't believe|what happened next|watch until the end|shocking|insane/i
const EDUCATIONAL_PATTERN =
  /for kids|explained|how .* works|why .*|science|facts|tutorial|lesson|learn|beginner|history|math|fraction|biology|nature|paper airplane|behind the scenes/i
const CHILD_INTENT_PATTERN =
  /for kids|beginner|simple|easy|lesson|tutorial|facts/i
const SAFE_CATEGORY_PATTERN =
  /science|math|fraction|nature|animal|otter|rocket|paper airplane|animation|art|craft|behind the scenes|official|studio/i
const OFFICIAL_CHANNEL_PATTERN =
  /official|pbs|smithsonian|museum|national geographic|nasa|studio|pixar|science|academy|library|university|bbc|nasa/i
const UNKNOWN_CREATOR_PATTERN =
  /vlog|funzone|gamer|gaming|clips|squad|hyper|99|z$/i
// YouTube categories are limited positive evidence, never standalone approval.
const YOUTUBE_CATEGORY_SIGNALS = new Map([
  ["Pets & Animals", { tag: "youtube-pets-and-animals", score: 8 }],
  ["Education", { tag: "youtube-education", score: 8 }],
  ["Howto & Style", { tag: "youtube-howto-and-style", score: 5 }],
  ["Science & Technology", { tag: "youtube-science-and-technology", score: 5 }],
  ["Autos & Vehicles", { tag: "youtube-autos-and-vehicles", score: 3 }],
  ["Sports", { tag: "youtube-sports", score: 3 }],
  ["Travel & Events", { tag: "youtube-travel", score: 1 }],
  ["Documentary", { tag: "youtube-documentary", score: 4 }],
  ["Family", { tag: "youtube-family", score: 4 }],
])
function liveStatusFor(candidate) {
  return (
    candidate.liveStatus || (candidate.isLivestream ? "completed_live" : "none")
  )
}

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
        child_explanation
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

function ageInDays(publishedAt, now = new Date()) {
  const published = new Date(publishedAt)

  if (!publishedAt || Number.isNaN(published.getTime())) {
    return null
  }

  return Math.max(
    0,
    Math.floor((now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24)),
  )
}

function viewsPerDay(candidate) {
  const days = ageInDays(candidate.publishedAt)

  if (days === null) {
    return null
  }

  return Number(candidate.viewCount || 0) / Math.max(days, 1)
}

function tagIf(condition, tags, tag) {
  if (condition) {
    tags.push(tag)
  }
}

function confidenceFromScore(score) {
  return Math.max(0.05, Math.min(0.99, score / 100))
}

function hasApprovedChannel(channelDecision) {
  return channelDecision && channelDecision.decision === "approved"
}

function hasUnknownChannel(channelDecision) {
  return !channelDecision
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

function scoreCandidate(candidate, channelDecision) {
  let score = 50
  const text = [candidate.title, candidate.description, candidate.channelTitle]
    .filter(Boolean)
    .join(" ")
  const title = candidate.title || ""
  const contentTags = []
  const riskTags = []
  const qualityTags = []
  const viewCount = Number(candidate.viewCount || 0)
  const unknownChannel = hasUnknownChannel(channelDecision)
  const approvedChannel = hasApprovedChannel(channelDecision)
  const liveStatus = liveStatusFor(candidate)
  const vpd = viewsPerDay(candidate)
  const youtubeCategorySignal = YOUTUBE_CATEGORY_SIGNALS.get(
    String(candidate.youtubeCategoryTitle || ""),
  )

  tagIf(SAFE_CATEGORY_PATTERN.test(text), contentTags, "safe-category")
  tagIf(EDUCATIONAL_PATTERN.test(text), contentTags, "educational")
  tagIf(
    CHILD_INTENT_PATTERN.test(text),
    contentTags,
    "clear-child-friendly-intent",
  )
  tagIf(
    OFFICIAL_CHANNEL_PATTERN.test(candidate.channelTitle || ""),
    qualityTags,
    "official-or-source-backed-channel",
  )
  tagIf(approvedChannel, qualityTags, "household-approved-channel")
  tagIf(
    candidate.durationSeconds >= 120 && candidate.durationSeconds <= 900,
    qualityTags,
    "reasonable-duration",
  )
  tagIf(viewCount >= 100000, qualityTags, "established-view-history")
  tagIf(vpd !== null && vpd >= 500, qualityTags, "healthy-views-per-day")
  tagIf(
    Boolean(youtubeCategorySignal),
    qualityTags,
    youtubeCategorySignal && youtubeCategorySignal.tag,
  )
  tagIf(Boolean(candidate.madeForKids), qualityTags, "youtube-made-for-kids")

  tagIf(RISK_PATTERN.test(text), riskTags, "risky-or-ambiguous-topic")
  tagIf(SEVERE_RISK_PATTERN.test(text), riskTags, "severe-risk-flag")
  tagIf(CLICKBAIT_PATTERN.test(title), riskTags, "clickbait-title")
  tagIf(
    UNKNOWN_CREATOR_PATTERN.test(candidate.channelTitle || ""),
    riskTags,
    "creator-style-channel",
  )
  tagIf(candidate.durationSeconds > 1800, riskTags, "very-long-video")
  tagIf(liveStatus === "completed_live", riskTags, "completed-live-recording")
  tagIf(!candidate.description, riskTags, "missing-description")
  tagIf(!candidate.publishedAt, riskTags, "missing-published-date")
  tagIf(
    viewCount < 1000 && unknownChannel,
    riskTags,
    "very-low-view-unknown-channel",
  )
  tagIf(
    viewCount < 10000 && unknownChannel,
    riskTags,
    "limited-view-unknown-channel",
  )

  if (contentTags.includes("safe-category")) score += 10
  if (contentTags.includes("educational")) score += 12
  if (contentTags.includes("clear-child-friendly-intent")) score += 8
  if (qualityTags.includes("official-or-source-backed-channel")) score += 12
  if (qualityTags.includes("household-approved-channel")) score += 20
  if (qualityTags.includes("reasonable-duration")) score += 6
  if (qualityTags.includes("healthy-views-per-day")) score += 4
  if (youtubeCategorySignal) score += youtubeCategorySignal.score
  if (qualityTags.includes("youtube-made-for-kids")) score += 6

  if (viewCount >= 1000000) score += 10
  else if (viewCount >= 100000) score += 6
  else if (viewCount >= 10000) score += 2
  else if (viewCount >= 1000 && unknownChannel) score -= 5
  else if (viewCount < 1000 && unknownChannel) score -= 15
  else if (viewCount < 1000) score -= 3

  if (riskTags.includes("risky-or-ambiguous-topic")) score -= 18
  if (riskTags.includes("severe-risk-flag")) score -= 40
  if (riskTags.includes("clickbait-title")) score -= 20
  if (riskTags.includes("creator-style-channel")) score -= 8
  if (riskTags.includes("very-long-video")) score -= 8
  if (riskTags.includes("completed-live-recording"))
    score -= approvedChannel ? 4 : 12
  if (riskTags.includes("missing-description")) score -= 8
  if (riskTags.includes("missing-published-date")) score -= 6

  let decision = "unknown"
  let debugScore = {
    title: candidate.title,
    decision: decision,
    score: score,
    reasons: [],
  }
  if (riskTags.includes("severe-risk-flag")) {
    decision = "block"
    debugScore.reasons.push("Severe risk flag")
  } else if (
    approvedChannel &&
    !riskTags.includes("clickbait-title") &&
    !riskTags.includes("risky-or-ambiguous-topic") &&
    (liveStatus !== "completed_live" || score >= 78)
  ) {
    decision = "allow"
  } else if (
    score >= 78 &&
    (riskTags.length === 0 ||
      (approvedChannel &&
        liveStatus === "completed_live" &&
        riskTags.length === 1 &&
        riskTags.includes("completed-live-recording")))
  ) {
    decision = "allow"
    debugScore.reasons.push("Benign live recording")
  } else if (score >= 70 && !riskTags.includes("clickbait-title")) {
    decision = "allow_limited"
    debugScore.reasons.push("Clickbait title")
  } else if (score >= 45) {
    decision = "review"
    debugScore.reasons.push("45 < score < 70")
  }

  if (
    riskTags.includes("very-low-view-unknown-channel") &&
    decision === "allow_limited"
  ) {
    decision = "review"
    debugScore.reasons.push("Very low view count from unknown channel")
  }

  if (liveStatus === "completed_live" && decision === "allow_limited") {
    decision = "review"
    debugScore.reasons.push("Completed live recording")
  }

  const parentExplanationParts = []

  if (decision === "allow") {
    parentExplanationParts.push(
      "Rule-based moderation found clear educational or source-backed signals.",
    )
  } else if (decision === "allow_limited") {
    parentExplanationParts.push(
      "Rule-based moderation found mostly safe signals, but parent review may still be useful.",
    )
  } else if (decision === "review") {
    parentExplanationParts.push(
      "Rule-based moderation found mixed or incomplete signals, so this was sent for review.",
    )
  } else if (decision === "block") {
    parentExplanationParts.push(
      "Rule-based moderation found a severe risk flag.",
    )
  } else {
    parentExplanationParts.push(
      "Rule-based moderation did not find enough context for an automated allow.",
    )
  }

  if (riskTags.includes("limited-view-unknown-channel")) {
    parentExplanationParts.push(
      "This video has limited view history from an unknown channel.",
    )
  }

  if (riskTags.includes("very-low-view-unknown-channel")) {
    parentExplanationParts.push(
      "Very low view count from an unknown channel increases review need.",
    )
  }

  if (riskTags.includes("completed-live-recording")) {
    parentExplanationParts.push(
      "This is a completed livestream recording, so it needs stronger trusted-channel and quality signals before child display.",
    )
  }

  if (vpd !== null) {
    parentExplanationParts.push(`Views per day estimate: ${Math.round(vpd)}.`)
  }

  return {
    decision,
    confidenceScore: confidenceFromScore(score),
    primaryCategory: candidate.primaryCategory || "General",
    contentTags,
    riskTags,
    qualityTags,
    childExplanation: childExplanationFor(candidate),
    parentExplanation: parentExplanationParts.join(" "),
    score,
    debugScore,
  }
}

function childExplanationFor(candidate) {
  if (candidate.primaryCategory === "Animals") {
    return "Enjoy a calm video about animals or nature."
  }

  if (candidate.primaryCategory === "Science") {
    return "Let's learn some science together!"
  }

  if (candidate.primaryCategory === "Art") {
    return "How about this video about making, building, or DIY?"
  }
  return ""
  // return "A KidView-approved video.";
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

function writeModerationReview({
  householdId,
  candidate,
  result,
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
      transcript_used
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
      transcript_used = excluded.transcript_used`,
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
    writeModerationReview({ householdId, candidate, result, persist })
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
    writeModerationReview({ householdId, candidate, result, persist })
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
    writeModerationReview({ householdId, candidate, result, persist })
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

  if (storedReview && !channelDecision) {
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
  writeModerationReview({ householdId, candidate, result: automated, persist })
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

function moderateCandidatesWithDiagnostics({
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

function selectModerationCandidate() {
  return `SELECT
    videos.id AS videoId,
    videos.external_id AS externalId,
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
    channels.id AS channelId,
    channels.title AS channelTitle
   FROM videos
   JOIN channels ON channels.id = videos.channel_id`
}

function remoderateChannelVideos({ householdId, channelId }) {
  const candidates = db
    .prepare(`${selectModerationCandidate()} WHERE channels.id = ?`)
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
    .prepare(`${selectModerationCandidate()} WHERE videos.id = ?`)
    .get(videoId)

  if (!candidate) {
    return null
  }

  const [result] = moderateCandidates({
    householdId,
    childProfileId,
    candidates: [candidate],
    limit: 1,
  })

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
