// A deliberately read-only counterpart to KidView's normal, audited search.
const config = require("../app/config");
const youtube = require("../app/services/youtubeSourceService");
const { classifyCandidateCategory } = require("../app/services/categoryClassificationService");

async function searchVideos(query) {
  const videos = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  const pageSize = config.youtubeMaxSearchResults;
  const maxPages = Math.ceil(config.youtubeMaxCandidatesPerSearch / pageSize);
  let pageToken = null;
  let candidatesSeen = 0;

  // Keep YouTube's order, fetching another bounded page when Shorts or live
  // videos occupy result slots. Other KidView decisions do not filter this list.
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    if (seenTokens.has(pageToken)) break;
    seenTokens.add(pageToken);
    const page = await youtube.searchCandidatePage(query, {
      pageToken,
      maxResults: Math.min(pageSize, config.youtubeMaxCandidatesPerSearch - candidatesSeen),
      embeddableOnly: false,
      includeSearchOnly: true,
    });

    for (const candidate of page.candidates) {
      if (seenIds.has(candidate.externalVideoId)) continue;
      seenIds.add(candidate.externalVideoId);
      candidatesSeen += 1;
      // Missing details cannot establish whether a hit is a Short. Completed
      // live recordings are excluded too, even though KidView may score them.
      if (candidate.metadataIncomplete || candidate.isShort || candidate.liveStatus !== "none") continue;
      videos.push({
        ...candidate,
        category: classifyCandidateCategory(candidate).primaryCategory,
      });
      if (videos.length === 3) return videos;
    }

    if (!page.nextPageToken || candidatesSeen >= config.youtubeMaxCandidatesPerSearch) break;
    pageToken = page.nextPageToken;
  }

  return videos;
}

module.exports = { searchVideos };
