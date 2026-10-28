// A deliberately read-only counterpart to KidView's normal, audited search.
const config = require("../app/config");
const youtube = require("../app/services/youtubeSourceService");
const { classifyCandidateCategory } = require("../app/services/categoryClassificationService");
const { scoreCandidate } = require("../app/services/moderationScoringService");

async function searchVideos(query) {
  const videos = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  let pageToken = null;
  let candidatesSeen = 0;
  let pagesFetched = 0;
  const pageSize = config.youtubeMaxSearchResults;
  const maxPages = Math.ceil(config.youtubeMaxCandidatesPerSearch / pageSize);

  // Match the normal search's candidate cap and page-size settings. No database
  // or household moderation functions are called from this experiment.
  while (candidatesSeen < config.youtubeMaxCandidatesPerSearch && pagesFetched < maxPages) {
    if (seenTokens.has(pageToken)) break;
    seenTokens.add(pageToken);
    const page = await youtube.searchCandidatePage(query, {
      pageToken,
      maxResults: Math.min(pageSize, config.youtubeMaxCandidatesPerSearch - candidatesSeen),
    });
    pagesFetched += 1;
    candidatesSeen += page.candidates.length;

    for (const candidate of page.candidates) {
      if (seenIds.has(candidate.externalVideoId)) continue;
      seenIds.add(candidate.externalVideoId);
      if (!candidate.embeddable || candidate.isShort || candidate.liveStatus !== "none") continue;

      const category = classifyCandidateCategory(candidate).primaryCategory;
      const decision = scoreCandidate({ ...candidate, primaryCategory: category }, null);
      // KidView's default child policy hides limited, review, and blocked items.
      if (decision.decision !== "allow") continue;
      videos.push({ ...candidate, category });
      if (videos.length === 3) return videos;
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return videos;
}

module.exports = { searchVideos };
