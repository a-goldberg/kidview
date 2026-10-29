// Explain KidView's default, read-only decision for a YouTube candidate.
// Household overrides and review-queue writes are intentionally not involved.
const { scoreCandidate } = require("../app/services/moderationScoringService");
const { formatHardFilter } = require("../app/services/moderationService");

function baselineFor(video) {
  if (video.metadataIncomplete) {
    return {
      decision: "unknown",
      wouldShow: false,
      score: null,
      source: "source_filter",
      reason: "YouTube did not return enough video details to apply KidView's rules reliably.",
      contentTags: [], qualityTags: [], riskTags: [],
    };
  }

  const scored = scoreCandidate({ ...video, primaryCategory: video.category }, null);
  if (!video.embeddable) {
    return {
      ...scored,
      decision: "block",
      wouldShow: false,
      source: "source_filter",
      reason: "KidView excludes videos that YouTube says cannot be embedded.",
      riskTags: [...scored.riskTags, "not-embeddable"],
    };
  }

  const hardFilter = formatHardFilter(video);
  if (hardFilter) {
    return {
      ...scored,
      decision: "block",
      wouldShow: false,
      source: "hard_filter",
      reason: hardFilter.reason,
      riskTags: [...new Set([...scored.riskTags, ...hardFilter.riskTags])],
    };
  }

  const reasons = {
    allow: "The default rules would show this video.",
    allow_limited: "The default child policy hides limited-access results.",
    review: "KidView would send this video to parent review.",
    block: "KidView would block this video.",
    unknown: "KidView would hide this video until it has enough confidence.",
  };
  return {
    ...scored,
    wouldShow: scored.decision === "allow",
    source: "rule_based",
    reason: reasons[scored.decision],
  };
}

module.exports = { baselineFor };
