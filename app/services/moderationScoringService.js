const crypto = require("node:crypto")

const MODERATION_CACHE_VERSION = "rule-based-v1:rules-v1"

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
const UNKNOWN_CREATOR_PATTERN = /vlog|funzone|gamer|gaming|clips|squad|hyper|99|z$/i
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
  return candidate.liveStatus || (candidate.isLivestream ? "completed_live" : "none")
}

function ageInDays(publishedAt, now = new Date()) {
  const published = new Date(publishedAt)
  if (!publishedAt || Number.isNaN(published.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - published.getTime()) / 86400000))
}

function viewsPerDay(candidate) {
  const days = ageInDays(candidate.publishedAt)
  return days === null ? null : Number(candidate.viewCount || 0) / Math.max(days, 1)
}

function moderationInputFingerprint(candidate, channelDecision = null) {
  const input = {
    title: candidate.title || "",
    description: candidate.description || "",
    channelTitle: candidate.channelTitle || "",
    durationSeconds: Number(candidate.durationSeconds || 0),
    primaryCategory: candidate.primaryCategory || "General",
    isShort: Boolean(candidate.isShort),
    liveStatus: liveStatusFor(candidate),
    publishedAt: candidate.publishedAt || null,
    viewCount: Number(candidate.viewCount || 0),
    youtubeCategoryTitle: candidate.youtubeCategoryTitle || null,
    madeForKids: Boolean(candidate.madeForKids),
    channelDecision: channelDecision ? channelDecision.decision : null,
  }
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

function tagIf(condition, tags, tag) {
  if (condition) tags.push(tag)
}

function childExplanationFor(candidate) {
  if (candidate.primaryCategory === "Animals") return "Enjoy a calm video about animals or nature."
  if (candidate.primaryCategory === "Science") return "Let's learn some science together!"
  if (candidate.primaryCategory === "Art") return "How about this video about making, building, or DIY?"
  return ""
}

function scoreCandidate(candidate, channelDecision) {
  let score = 50
  const text = [candidate.title, candidate.description, candidate.channelTitle].filter(Boolean).join(" ")
  const contentTags = []
  const riskTags = []
  const qualityTags = []
  const viewCount = Number(candidate.viewCount || 0)
  const unknownChannel = !channelDecision
  const approvedChannel = channelDecision && channelDecision.decision === "approved"
  const liveStatus = liveStatusFor(candidate)
  const vpd = viewsPerDay(candidate)
  const youtubeCategorySignal = YOUTUBE_CATEGORY_SIGNALS.get(String(candidate.youtubeCategoryTitle || ""))

  tagIf(SAFE_CATEGORY_PATTERN.test(text), contentTags, "safe-category")
  tagIf(EDUCATIONAL_PATTERN.test(text), contentTags, "educational")
  tagIf(CHILD_INTENT_PATTERN.test(text), contentTags, "clear-child-friendly-intent")
  tagIf(OFFICIAL_CHANNEL_PATTERN.test(candidate.channelTitle || ""), qualityTags, "official-or-source-backed-channel")
  tagIf(approvedChannel, qualityTags, "household-approved-channel")
  tagIf(candidate.durationSeconds >= 120 && candidate.durationSeconds <= 900, qualityTags, "reasonable-duration")
  tagIf(viewCount >= 100000, qualityTags, "established-view-history")
  tagIf(vpd !== null && vpd >= 500, qualityTags, "healthy-views-per-day")
  tagIf(Boolean(youtubeCategorySignal), qualityTags, youtubeCategorySignal && youtubeCategorySignal.tag)
  tagIf(Boolean(candidate.madeForKids), qualityTags, "youtube-made-for-kids")
  tagIf(RISK_PATTERN.test(text), riskTags, "risky-or-ambiguous-topic")
  tagIf(SEVERE_RISK_PATTERN.test(text), riskTags, "severe-risk-flag")
  tagIf(CLICKBAIT_PATTERN.test(candidate.title || ""), riskTags, "clickbait-title")
  tagIf(UNKNOWN_CREATOR_PATTERN.test(candidate.channelTitle || ""), riskTags, "creator-style-channel")
  tagIf(candidate.durationSeconds > 1800, riskTags, "very-long-video")
  tagIf(liveStatus === "completed_live", riskTags, "completed-live-recording")
  tagIf(!candidate.description, riskTags, "missing-description")
  tagIf(!candidate.publishedAt, riskTags, "missing-published-date")
  tagIf(viewCount < 1000 && unknownChannel, riskTags, "very-low-view-unknown-channel")
  tagIf(viewCount < 10000 && unknownChannel, riskTags, "limited-view-unknown-channel")

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
  if (riskTags.includes("completed-live-recording")) score -= approvedChannel ? 4 : 12
  if (riskTags.includes("missing-description")) score -= 8
  if (riskTags.includes("missing-published-date")) score -= 6

  let decision = "unknown"
  if (riskTags.includes("severe-risk-flag")) decision = "block"
  else if (approvedChannel && !riskTags.includes("clickbait-title") && !riskTags.includes("risky-or-ambiguous-topic") && (liveStatus !== "completed_live" || score >= 78)) decision = "allow"
  else if (score >= 78 && (riskTags.length === 0 || (approvedChannel && liveStatus === "completed_live" && riskTags.length === 1 && riskTags.includes("completed-live-recording")))) decision = "allow"
  else if (score >= 70 && !riskTags.includes("clickbait-title")) decision = "allow_limited"
  else if (score >= 45) decision = "review"
  if (riskTags.includes("very-low-view-unknown-channel") && decision === "allow_limited") decision = "review"
  if (liveStatus === "completed_live" && decision === "allow_limited") decision = "review"

  const explanations = {
    allow: "Rule-based moderation found clear educational or source-backed signals.",
    allow_limited: "Rule-based moderation found mostly safe signals, but parent review may still be useful.",
    review: "Rule-based moderation found mixed or incomplete signals, so this was sent for review.",
    block: "Rule-based moderation found a severe risk flag.",
    unknown: "Rule-based moderation did not find enough context for an automated allow.",
  }
  const parentExplanationParts = [explanations[decision]]
  if (riskTags.includes("limited-view-unknown-channel")) parentExplanationParts.push("This video has limited view history from an unknown channel.")
  if (riskTags.includes("very-low-view-unknown-channel")) parentExplanationParts.push("Very low view count from an unknown channel increases review need.")
  if (riskTags.includes("completed-live-recording")) parentExplanationParts.push("This is a completed livestream recording, so it needs stronger trusted-channel and quality signals before child display.")
  if (vpd !== null) parentExplanationParts.push(`Views per day estimate: ${Math.round(vpd)}.`)

  return {
    decision,
    confidenceScore: Math.max(0.05, Math.min(0.99, score / 100)),
    primaryCategory: candidate.primaryCategory || "General",
    contentTags,
    riskTags,
    qualityTags,
    childExplanation: childExplanationFor(candidate),
    parentExplanation: parentExplanationParts.join(" "),
    score,
  }
}

module.exports = {
  MODERATION_CACHE_VERSION,
  ageInDays,
  liveStatusFor,
  moderationInputFingerprint,
  scoreCandidate,
  viewsPerDay,
}
