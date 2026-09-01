const express = require('express');
const { markNotWhatIMeant, recordClickedVideo, search } = require('../services/searchService');
const { getChildSafeVideo } = require('../services/moderationService');
const { getChildPolicy } = require('../services/policyService');
const { recordPlaybackProgress, startPlayback } = require('../services/usageService');
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

    if (searchResponse.limitReached) {
      return res.status(429).render('child/results', {
        title: 'KidView Results',
        childProfile,
        query,
        searchEventId: null,
        candidatesConsidered: 0,
        sourceError: 'Today\'s search limit has been reached. Please try again tomorrow.',
        suggestions: SEARCH_SUGGESTIONS,
        results: []
      });
    }

    res.render('child/results', {
      title: 'KidView Results',
      childProfile,
      query,
      searchEventId: searchResponse.searchEventId,
      candidatesConsidered: searchResponse.candidatesConsidered,
      sourceError: null,
      suggestions: SEARCH_SUGGESTIONS,
      results: searchResponse.results.map((result) => ({
        ...result,
        watchUrl: `${result.watchUrl}?q=${encodeURIComponent(query)}&searchEventId=${encodeURIComponent(
          searchResponse.searchEventId || ''
        )}`
      }))
    });
  } catch (error) {
    if (error && error.userMessage) {
      console.error('Child search source error:', error);

      return res.status(503).render('child/results', {
        title: 'KidView Results',
        childProfile,
        query,
        searchEventId: null,
        candidatesConsidered: 0,
        sourceError: error.userMessage,
        suggestions: SEARCH_SUGGESTIONS,
        results: []
      });
    }

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

function jsonError(res, status, code, message, extra = {}) {
  return res.status(status).json({ ok: false, code, message, ...extra });
}

// The child cookie establishes both household and child identity.  The safe-video
// lookup is repeated immediately before every playback start, not just when the
// result card was originally rendered.
router.post('/videos/:videoId/playback/start', requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile;
  const videoId = Number(req.params.videoId);
  const video = getChildSafeVideo({
    householdId: childProfile.householdId,
    childProfileId: childProfile.id,
    videoId
  });

  if (!video) {
    return jsonError(res, 403, 'video_unavailable', 'This video is no longer available.');
  }

  const policy = getChildPolicy({
    householdId: childProfile.householdId,
    childProfileId: childProfile.id
  });
  const result = startPlayback({
    householdId: childProfile.householdId,
    childProfileId: childProfile.id,
    videoId: video.videoId,
    policy,
    durationSeconds: video.durationSeconds
  });

  if (!result.allowed) {
    return jsonError(res, 429, 'daily_watch_limit_reached', 'Today\'s video limit has been reached. Please try again tomorrow.', {
      watchLimit: result.usage.watches
    });
  }

  return res.json({
    ok: true,
    playback: {
      id: result.playback.id,
      videoId: video.videoId,
      startedAt: result.playback.started_at,
      resumed: result.resumed,
      durationSeconds: result.durationSeconds,
      watchLimit: result.usage.watches
    }
  });
});

router.post('/videos/:videoId/playback/progress', requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile;
  const videoId = Number(req.params.videoId);
  const body = req.body || {};
  const playbackId = Number(body.playbackId);
  const video = getChildSafeVideo({
    householdId: childProfile.householdId,
    childProfileId: childProfile.id,
    videoId
  });

  if (!video) {
    return jsonError(res, 403, 'video_unavailable', 'This video is no longer available.');
  }

  if (!Number.isInteger(playbackId) || playbackId < 1) {
    return jsonError(res, 400, 'invalid_playback', 'A valid playback session is required.');
  }

  const result = recordPlaybackProgress({
    householdId: childProfile.householdId,
    childProfileId: childProfile.id,
    videoId: video.videoId,
    playbackId,
    currentTimeSeconds: body.currentTimeSeconds,
    durationSeconds: video.durationSeconds
  });

  if (result.error === 'invalid_progress') {
    return jsonError(res, 400, 'invalid_progress', 'Playback progress must be a non-negative number.');
  }

  if (result.error === 'playback_not_found') {
    return jsonError(res, 404, 'playback_not_found', 'Playback session not found.');
  }

  const playback = result.playback;
  return res.json({
    ok: true,
    playback: {
      id: playback.id,
      videoId: video.videoId,
      startedAt: playback.started_at,
      lastProgressAt: playback.last_progress_at,
      maxProgressSeconds: playback.max_progress_seconds,
      completedAt: playback.completed_at
    }
  });
});

module.exports = router;
