const DEFAULT_LOCALE = "en";

const EN_LABELS = {
  sourceMode: {
    mock: "Mock source",
    youtube: "YouTube",
    unknown: "Unknown source",
  },
  finalDecision: {
    allow: "Allowed",
    allow_limited: "Allowed with limits",
    review: "Needs parent review",
    review_required: "Needs parent review",
    block: "Blocked",
    blocked: "Blocked",
    unknown: "Unknown",
  },
  moderationSource: {
    source_filter: "Source safety filter",
    hard_filter: "Hard safety rule",
    parent_video_decision: "Parent video decision",
    parent_channel_decision: "Parent channel decision",
    stored_moderation_review: "Previous moderation result",
    rule_based: "Rule-based moderation",
    unknown: "Unknown source",
  },
  parentDecisionSource: {
    video: "Video decision",
    channel: "Channel decision",
    household: "Household decision",
    unknown: "Household decision",
  },
  reviewQueueState: {
    created_pending: "New review item",
    matched_pending: "Already in review queue",
    matched_dismissed: "Previously cleared from queue",
    resolved_existing: "Existing review item resolved",
    expired_existing: "Old review item expired",
    none: "Not in review queue",
  },
  reviewQueueReasonCode: {
    allow_limited: "Allowed with limits; parent review available",
    review: "Needs parent review",
    unknown: "Not enough confidence to show",
    "not_review_queue:allow": "Allowed; not sent to review",
    "not_review_queue:block": "Blocked; not sent to review",
    "not_review_queue:unknown": "Not sent to review",
    "not_review_queue:review_required": "Not sent to review",
    "durable_video_decision:allow": "Previously allowed by parent",
    "durable_video_decision:allow_limited": "Previously allowed with limits by parent",
    "durable_video_decision:review_required": "Previously marked for review by parent",
    "durable_video_decision:block": "Previously blocked by parent",
    "durable_channel_decision:blocked": "Channel blocked by parent",
    parent_cleared: "Cleared by parent",
    parent_ignored: "Ignored by parent",
    parent_cleared_channel: "Channel queue cleared by parent",
    queue_noise_cleanup: "Cleaned up from old queue rules",
  },
  visibilityReasonCode: {
    shown_allow: "Shown because it was allowed",
    shown_allow_limited_profile_policy: "Shown by child profile limited-access policy",
    hidden_allow_limited_profile_policy: "Hidden by child profile limited-access policy",
    hidden_result_limit: "Hidden by the three-result limit",
    hidden_review_required: "Hidden until parent review",
    hidden_blocked: "Hidden because it was blocked",
    hidden_unknown: "Hidden because confidence was too low",
    "source_filter:not_embeddable": "Hidden because the video cannot be embedded",
    "hard_block:short": "Blocked because Shorts are not allowed",
    "hard_block:live": "Blocked because live streams are not allowed",
    "hard_block:upcoming": "Blocked because upcoming streams are not allowed",
  },
  contentTag: {
    "safe-category": "Generally safe topic",
    educational: "Educational signals",
    "clear-child-friendly-intent": "Clear child-friendly intent",
    learning: "Learning topic",
    "needs-care": "Needs extra care",
    "high-stimulation": "High stimulation",
  },
  qualityTag: {
    "official-or-source-backed-channel": "Source-backed channel",
    "household-approved-channel": "Parent-approved channel",
    "reasonable-duration": "Reasonable length",
    "established-view-history": "Established view history",
    "healthy-views-per-day": "Healthy viewing trend",
    "parent-video-decision": "Parent video decision",
  },
  riskTag: {
    short: "Short",
    live: "Live stream",
    upcoming: "Upcoming live stream",
    "blocked-channel": "Blocked channel",
    "not-embeddable": "Not embeddable",
    "channel-review-first": "Channel requires review first",
    "risky-or-ambiguous-topic": "Risky or ambiguous topic",
    "severe-risk-flag": "Severe risk signal",
    "clickbait-title": "Clickbait-style title",
    "creator-style-channel": "Creator-style channel",
    "very-long-video": "Very long video",
    "completed-live-recording": "Completed live recording",
    "missing-description": "Missing description",
    "missing-published-date": "Missing publish date",
    "very-low-view-unknown-channel": "Very low views from unknown channel",
    "limited-view-unknown-channel": "Limited views from unknown channel",
  },
  channelDecision: {
    approved: "Approved channel",
    review_first: "Review this channel first",
    blocked: "Blocked channel",
    none: "No channel decision",
  },
  liveStatus: {
    none: "Not live",
    live: "Live now",
    upcoming: "Upcoming live",
    completed_live: "Completed live",
  },
  allowLimitedPolicy: {
    block: "Block limited videos",
    review: "Send limited videos to review",
    allow: "Show limited videos",
    limited_frequency: "Show limited videos occasionally",
  },
};

const LABELS = {
  en: EN_LABELS,
};

function fallbackLabel(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  return raw
    .replace(/[:_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

function labelsFor(locale) {
  return LABELS[locale] || LABELS[DEFAULT_LOCALE];
}

// Parent views should display friendly labels while storage keeps stable codes
// for debugging, querying, and future localization.
function displayLabel(category, value, locale = DEFAULT_LOCALE) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const categoryLabels = labelsFor(locale)[category] || {};

  if (categoryLabels[raw]) {
    return categoryLabels[raw];
  }

  if (raw.startsWith("durable_video_decision:")) {
    const decision = raw.split(":")[1];
    return `Previously ${displayLabel("finalDecision", decision, locale).toLowerCase()} by parent`;
  }

  if (raw.startsWith("durable_channel_decision:")) {
    const decision = raw.split(":")[1];
    return `Channel ${displayLabel("finalDecision", decision, locale).toLowerCase()} by parent`;
  }

  if (raw.startsWith("not_review_queue:")) {
    const decision = raw.split(":")[1];
    return `${displayLabel("finalDecision", decision, locale)}; not sent to review`;
  }

  return fallbackLabel(raw);
}

function displayList(category, values = [], locale = DEFAULT_LOCALE) {
  return values.map((value) => displayLabel(category, value, locale));
}

module.exports = {
  DEFAULT_LOCALE,
  displayLabel,
  displayList,
};
