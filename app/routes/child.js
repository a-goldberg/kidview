const express = require('express');
const { markNotWhatIMeant, recordClickedVideo, search } = require('../services/searchService');
const { getChildSafeVideo } = require('../services/moderationService');
const {
  getActiveChildProfile,
  getChildProfileForHousehold,
  listChildProfilesForHousehold,
  setActiveChildProfile
} = require('../services/childProfileSessionService');

const router = express.Router();
const SEARCH_SUGGESTIONS = ['science', 'otters', 'fractions', 'animation'];

function resultsUrl(query) {
  return `/child/results?q=${encodeURIComponent(query)}`;
}

function requireParentForProfileSelection(req, res, next) {
  if (!req.session.parentUser) {
    return res.redirect('/auth/login?returnTo=%2Fchild%2Fprofile');
  }

  return next();
}

function requireActiveChild(req, res, next) {
  const childProfile = getActiveChildProfile(req);

  if (!childProfile) {
    if (req.method === 'GET' && req.path === '/search') {
      return res.render('child/profile-required', {
        title: 'Choose a Child Profile'
      });
    }

    return res.redirect('/child/search');
  }

  req.activeChildProfile = childProfile;
  return next();
}

router.get('/profile', requireParentForProfileSelection, (req, res) => {
  const childProfiles = listChildProfilesForHousehold(
    req.session.parentUser.householdId
  );

  res.render('child/profile-select', {
    title: 'Choose a Child Profile',
    childProfiles
  });
});

router.post('/profile/:childProfileId/activate', requireParentForProfileSelection, (req, res, next) => {
  const parentUser = req.session.parentUser;
  const childProfile = getChildProfileForHousehold({
    householdId: parentUser.householdId,
    childProfileId: Number(req.params.childProfileId)
  });

  if (!childProfile) {
    return res.status(404).render('not-found', {
      title: 'Child profile not found'
    });
  }

  const sessionCookieName = res.locals.sessionCookieName;

  return req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie(sessionCookieName);
    setActiveChildProfile(res, {
      householdId: parentUser.householdId,
      childProfileId: childProfile.id
    });
    return res.redirect('/child/search');
  });
});

router.get('/search', requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile;

  res.render('child/search', {
    title: 'KidView Search',
    childProfile,
    query: String(req.query.q || ''),
    suggestions: SEARCH_SUGGESTIONS,
    wasNotWhatIMeant: req.query.tryAgain === '1'
  });
});

router.get('/results', requireActiveChild, async (req, res, next) => {
  const childProfile = req.activeChildProfile;
  const query = String(req.query.q || '').trim();

  try {
    const searchResponse = query
      ? await search({
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
  } catch (error) {
    next(error);
  }
});

router.get('/videos/:videoId', requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile;
  const query = String(req.query.q || '').trim();
  const searchEventId = Number(req.query.searchEventId || 0);
  const videoId = Number(req.params.videoId);
  const video = getChildSafeVideo({
    householdId: childProfile && childProfile.householdId,
    childProfileId: childProfile && childProfile.id,
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

router.post('/search-events/:searchEventId/not-what-i-meant', requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile;
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
