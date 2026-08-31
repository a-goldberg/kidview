const express = require('express');
const {
  getDecisionHistory,
  getParentDashboard,
  getReviewQueue,
  getSearchAuditDetail,
  getSearchAuditList
} = require('../services/householdService');
const {
  bulkUpsertVideoDecisions,
  clearReviewChannels,
  clearReviewVideos,
  ignoreReviewVideo,
  upsertChannelDecision,
  upsertVideoDecision
} = require('../services/decisionService');
const { displayLabel } = require('../services/displayLabels');
const { getActiveChildProfile } = require('../services/childProfileSessionService');
const {
  createChildProfile,
  createPolicyProfile,
  deleteChildProfile,
  deletePolicyProfile,
  getPolicyManagement,
  updateChildProfile,
  updatePolicyProfile
} = require('../services/policyService');

const router = express.Router();

function requireParent(req, res, next) {
  if (!req.session.parentUser) {
    return res.redirect('/auth/login');
  }

  return next();
}

function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json');
}

function sendDecisionResponse(req, res, fallbackPath, payload = {}) {
  if (wantsJson(req)) {
    return res.json({
      ok: true,
      ...payload
    });
  }

  return res.redirect(fallbackPath);
}

const POLICY_SAVED_MESSAGES = Object.freeze({
  child_created: 'Child profile created.',
  child_updated: 'Child profile updated.',
  child_deleted: 'Child profile deleted.',
  policy_created: 'Policy profile created.',
  policy_updated: 'Policy profile updated.',
  policy_deleted: 'Result policy deleted.'
});

function confidenceFromPercent(value) {
  if (value === null || value === undefined || value === '') {
    return 0.7;
  }

  return Number(value) / 100;
}

function childProfileInput(req) {
  return {
    householdId: req.session.parentUser.householdId,
    policyProfileId: Number(req.body.policyProfileId),
    displayName: req.body.displayName,
    birthYear: req.body.birthYear,
    allowLimitedPolicy: req.body.allowLimitedPolicy,
    allowLimitedMinConfidence: confidenceFromPercent(
      req.body.allowLimitedMinConfidencePercent
    ),
    dailySearchLimit: req.body.dailySearchLimit,
    dailyVideoWatchLimit: req.body.dailyVideoWatchLimit
  };
}

function policyProfileInput(req) {
  return {
    householdId: req.session.parentUser.householdId,
    name: req.body.name,
    description: req.body.description,
    maxResults: req.body.maxResults
  };
}

function renderPolicyManagement(req, res, { status = 200, errorMessage = null } = {}) {
  const management = getPolicyManagement(req.session.parentUser.householdId);

  return res.status(status).render('parent/profiles', {
    title: 'Profiles & Policies',
    management,
    errorMessage,
    savedMessage: POLICY_SAVED_MESSAGES[req.query.saved] || null
  });
}

function handlePolicyManagementError(req, res, next, error) {
  if (error instanceof RangeError) {
    return renderPolicyManagement(req, res, {
      status: 400,
      errorMessage: error.message
    });
  }

  return next(error);
}

router.get('/', requireParent, (req, res) => {
  const householdId = req.session.parentUser.householdId;
  const dashboard = getParentDashboard(householdId);
  const selectedProfile = getActiveChildProfile(req);

  // A stale selection from another household must never appear as this
  // parent's active child, even though the child cookie is independently signed.
  const activeChildProfile = selectedProfile && selectedProfile.householdId === householdId
    ? selectedProfile
    : null;

  res.render('parent/dashboard', {
    title: 'Parent Dashboard',
    dashboard,
    activeChildProfile
  });
});

router.get('/profiles', requireParent, (req, res) => {
  renderPolicyManagement(req, res);
});

router.post('/profiles/policies', requireParent, (req, res, next) => {
  try {
    createPolicyProfile(policyProfileInput(req));
    return res.redirect('/parent/profiles?saved=policy_created#policies');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.post('/profiles/policies/:policyProfileId', requireParent, (req, res, next) => {
  try {
    const policyProfile = updatePolicyProfile({
      ...policyProfileInput(req),
      policyProfileId: Number(req.params.policyProfileId)
    });

    if (!policyProfile) {
      return res.status(404).render('not-found', { title: 'Policy profile not found' });
    }

    return res.redirect('/parent/profiles?saved=policy_updated#policies');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.post('/profiles/policies/:policyProfileId/delete', requireParent, (req, res, next) => {
  try {
    const deleted = deletePolicyProfile({
      householdId: req.session.parentUser.householdId,
      policyProfileId: Number(req.params.policyProfileId)
    });

    if (!deleted) {
      return res.status(404).render('not-found', { title: 'Result policy not found' });
    }

    return res.redirect('/parent/profiles?saved=policy_deleted#policies');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.post('/profiles/children', requireParent, (req, res, next) => {
  try {
    createChildProfile(childProfileInput(req));
    return res.redirect('/parent/profiles?saved=child_created#children');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.post('/profiles/children/:childProfileId', requireParent, (req, res, next) => {
  try {
    const childProfile = updateChildProfile({
      ...childProfileInput(req),
      childProfileId: Number(req.params.childProfileId)
    });

    if (!childProfile) {
      return res.status(404).render('not-found', { title: 'Child profile not found' });
    }

    return res.redirect('/parent/profiles?saved=child_updated#children');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.post('/profiles/children/:childProfileId/delete', requireParent, (req, res, next) => {
  try {
    const deleted = deleteChildProfile({
      householdId: req.session.parentUser.householdId,
      childProfileId: Number(req.params.childProfileId)
    });

    if (!deleted) {
      return res.status(404).render('not-found', { title: 'Child profile not found' });
    }

    return res.redirect('/parent/profiles?saved=child_deleted#children');
  } catch (error) {
    return handlePolicyManagementError(req, res, next, error);
  }
});

router.get('/reviews', requireParent, (req, res) => {
  const reviewQueue = getReviewQueue(req.session.parentUser.householdId, req.query);

  res.render('parent/reviews', {
    title: 'Review Videos',
    reviewQueue
  });
});

router.get('/decisions', requireParent, (req, res) => {
  const history = getDecisionHistory(req.session.parentUser.householdId, req.query);

  res.render('parent/decisions', {
    title: 'Decision History',
    history
  });
});

router.get('/searches', requireParent, (req, res) => {
  const audit = getSearchAuditList(req.session.parentUser.householdId, req.query);

  res.render('parent/searches', {
    title: 'Search Audit',
    audit
  });
});

router.get('/searches/:searchEventId', requireParent, (req, res, next) => {
  const audit = getSearchAuditDetail(
    req.session.parentUser.householdId,
    Number(req.params.searchEventId)
  );

  if (!audit) {
    return next();
  }

  return res.render('parent/search-detail', {
    title: 'Search Details',
    audit
  });
});

router.post('/reviews/videos/:videoId/decision', requireParent, (req, res) => {
  upsertVideoDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    videoId: Number(req.params.videoId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  sendDecisionResponse(req, res, '/parent/reviews', {
    decision: req.body.decision,
    decisionLabel: displayLabel('finalDecision', req.body.decision),
    removeCard: true,
    message: 'Video decision saved.'
  });
});

router.post('/reviews/videos/:videoId/ignore', requireParent, (req, res) => {
  const ignoredCount = ignoreReviewVideo({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    videoId: Number(req.params.videoId)
  });

  sendDecisionResponse(req, res, '/parent/reviews', {
    removeCard: ignoredCount > 0,
    message: ignoredCount > 0
      ? 'Video ignored and removed from this review queue.'
      : 'No pending review item was found for this video.'
  });
});

router.post('/reviews/bulk', requireParent, (req, res) => {
  const reviewQueue = getReviewQueue(req.session.parentUser.householdId, req.body);
  const videoIds = reviewQueue.videos.map((video) => video.id);
  const action = String(req.body.action || '');
  let count = 0;
  let message = 'No bulk action selected.';

  if (action === 'approve_all') {
    count = bulkUpsertVideoDecisions({
      householdId: req.session.parentUser.householdId,
      parentUserId: req.session.parentUser.id,
      videoIds,
      decision: 'allow',
      reason: ''
    });
    message = `Approved ${count} video${count === 1 ? '' : 's'}.`;
  } else if (action === 'block_all') {
    count = bulkUpsertVideoDecisions({
      householdId: req.session.parentUser.householdId,
      parentUserId: req.session.parentUser.id,
      videoIds,
      decision: 'block',
      reason: ''
    });
    message = `Blocked ${count} video${count === 1 ? '' : 's'}.`;
  } else if (action === 'delete_all') {
    count = clearReviewVideos({
      householdId: req.session.parentUser.householdId,
      parentUserId: req.session.parentUser.id,
      videoIds
    });
    message = `Cleared ${count} review video${count === 1 ? '' : 's'} from this household queue.`;
  } else if (action === 'delete_channels') {
    const result = clearReviewChannels({
      householdId: req.session.parentUser.householdId,
      parentUserId: req.session.parentUser.id,
      channelIds: reviewQueue.channels
        .filter((channel) => !channel.decision)
        .map((channel) => channel.id)
    });
    message = `Cleared pending review videos for ${result.channelsCleared} unreviewed channel${result.channelsCleared === 1 ? '' : 's'} from this household queue. ${result.videosCleared} video${result.videosCleared === 1 ? '' : 's'} cleared.`;
  }

  const query = new URLSearchParams({
    search: req.body.search || '',
    status: req.body.status || 'all',
    sort: req.body.sort || 'status',
    bulkMessage: message
  });

  res.redirect(`/parent/reviews?${query.toString()}`);
});

router.post('/decisions/videos/:videoId', requireParent, (req, res) => {
  upsertVideoDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    videoId: Number(req.params.videoId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  sendDecisionResponse(
    req,
    res,
    `/parent/decisions?kind=${encodeURIComponent(req.body.kind || 'all')}&search=${encodeURIComponent(req.body.search || '')}&sort=${encodeURIComponent(req.body.sort || 'updated_newest')}`,
    {
      decision: req.body.decision,
      decisionLabel: displayLabel('finalDecision', req.body.decision),
      message: 'Video decision updated.'
    }
  );
});

router.post('/reviews/channels/:channelId/decision', requireParent, (req, res) => {
  const remoderatedCount = upsertChannelDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    channelId: Number(req.params.channelId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  sendDecisionResponse(req, res, '/parent/reviews', {
    decision: req.body.decision,
    decisionLabel: displayLabel('channelDecision', req.body.decision),
    removeCard: false,
    message: `Channel decision saved. Re-scored ${remoderatedCount} known video${remoderatedCount === 1 ? '' : 's'}.`
  });
});

router.post('/decisions/channels/:channelId', requireParent, (req, res) => {
  const remoderatedCount = upsertChannelDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    channelId: Number(req.params.channelId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  sendDecisionResponse(
    req,
    res,
    `/parent/decisions?kind=${encodeURIComponent(req.body.kind || 'all')}&search=${encodeURIComponent(req.body.search || '')}&sort=${encodeURIComponent(req.body.sort || 'updated_newest')}`,
    {
      decision: req.body.decision,
      decisionLabel: displayLabel('channelDecision', req.body.decision),
      message: `Channel decision updated. Re-scored ${remoderatedCount} known video${remoderatedCount === 1 ? '' : 's'}.`
    }
  );
});

module.exports = router;
