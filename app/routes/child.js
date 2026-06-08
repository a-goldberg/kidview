const express = require('express');
const { markNotWhatIMeant, recordClickedVideo, search } = require('../services/searchService');
const { getFirstChildProfile } = require('../services/householdService');
const { getChildSafeVideo } = require('../services/moderationService');

const router = express.Router();
const SEARCH_SUGGESTIONS = ['science', 'otters', 'fractions', 'animation'];

function resultsUrl(query) {
  return `/child/results?q=${encodeURIComponent(query)}`;
}

router.get('/search', (req, res) => {
  const childProfile = getFirstChildProfile();

  res.render('child/search', {
    title: 'KidView Search',
    childProfile,
    query: String(req.query.q || ''),
    suggestions: SEARCH_SUGGESTIONS,
    wasNotWhatIMeant: req.query.tryAgain === '1'
  });
});

router.get('/results', (req, res) => {
  const childProfile = getFirstChildProfile();
  const query = String(req.query.q || '').trim();
  const searchResponse = query
    ? search({
        query,
        householdId: childProfile && childProfile.householdId,
        childProfileId: childProfile && childProfile.id
      })
    : { query, searchEventId: null, candidatesConsidered: 0, results: [] };

  res.render('child/results', {
    title: 'KidView Results',
    childProfile,
    query,
    searchEventId: searchResponse.searchEventId,
    candidatesConsidered: searchResponse.candidatesConsidered,
    suggestions: SEARCH_SUGGESTIONS,
    results: searchResponse.results.map((result) => ({
      ...result,
      watchUrl: `${result.watchUrl}?q=${encodeURIComponent(query)}&searchEventId=${encodeURIComponent(
        searchResponse.searchEventId || ''
      )}`
    }))
  });
});

router.get('/videos/:videoId', (req, res) => {
  const childProfile = getFirstChildProfile();
  const query = String(req.query.q || '').trim();
  const searchEventId = Number(req.query.searchEventId || 0);
  const videoId = Number(req.params.videoId);
  const video = getChildSafeVideo({
    householdId: childProfile && childProfile.householdId,
    videoId
  });

  if (!video) {
    return res.status(404).render('child/video-unavailable', {
      title: 'Video unavailable',
      childProfile,
      resultsUrl: query ? resultsUrl(query) : null
    });
  }

  if (searchEventId && childProfile) {
    recordClickedVideo({
      searchEventId,
      householdId: childProfile.householdId,
      videoId
    });
  }

  return res.render('child/video', {
    title: video.title,
    childProfile,
    video,
    resultsUrl: query ? resultsUrl(query) : null
  });
});

router.post('/search-events/:searchEventId/not-what-i-meant', (req, res) => {
  const childProfile = getFirstChildProfile();
  const query = String(req.body.query || '').trim();

  if (childProfile) {
    markNotWhatIMeant({
      searchEventId: Number(req.params.searchEventId),
      householdId: childProfile.householdId
    });
  }

  res.redirect(`/child/search?tryAgain=1&q=${encodeURIComponent(query)}`);
});

module.exports = router;
