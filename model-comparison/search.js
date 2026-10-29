// A deliberately read-only counterpart to KidView's normal, audited search.
const youtube = require("../app/services/youtubeSourceService");
const { classifyCandidateCategory } = require("../app/services/categoryClassificationService");

async function searchVideos(query) {
  // Ask for exactly three YouTube hits, before any KidView safety filters. The
  // normal child search still uses the adapter's unchanged default options.
  const page = await youtube.searchCandidatePage(query, {
    maxResults: 3,
    embeddableOnly: false,
    includeSearchOnly: true,
  });
  return page.candidates.map((candidate) => ({
    ...candidate,
    category: classifyCandidateCategory(candidate).primaryCategory,
  }));
}

module.exports = { searchVideos };
