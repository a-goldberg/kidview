const express = require('express');
const { search } = require('../services/searchService');
const { getFirstChildProfile } = require('../services/householdService');
const { getChildSafeVideo } = require('../services/moderationService');

const router = express.Router();

router.get('/search', (req, res) => {
  const childProfile = getFirstChildProfile();

  res.render('child/search', {
    title: 'KidView Search',
    childProfile
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
    : { query, candidatesConsidered: 0, results: [] };

  res.render('child/results', {
    title: 'KidView Results',
    childProfile,
    query,
    candidatesConsidered: searchResponse.candidatesConsidered,
    results: searchResponse.results
  });
});

router.get('/videos/:videoId', (req, res) => {
  const childProfile = getFirstChildProfile();
  const video = getChildSafeVideo({
    householdId: childProfile && childProfile.householdId,
    videoId: Number(req.params.videoId)
  });

  if (!video) {
    return res.status(404).render('child/video-unavailable', {
      title: 'Video unavailable',
      childProfile
    });
  }

  return res.render('child/video', {
    title: video.title,
    childProfile,
    video
  });
});

module.exports = router;
