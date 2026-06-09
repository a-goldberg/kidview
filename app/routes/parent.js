const express = require('express');
const {
  getDecisionHistory,
  getParentDashboard,
  getReviewQueue
} = require('../services/householdService');
const {
  bulkUpsertVideoDecisions,
  deleteReviewChannels,
  deleteReviewVideos,
  upsertChannelDecision,
  upsertVideoDecision
} = require('../services/decisionService');

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

router.get('/', requireParent, (req, res) => {
  const dashboard = getParentDashboard(req.session.parentUser.householdId);

  res.render('parent/dashboard', {
    title: 'Parent Dashboard',
    dashboard
  });
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
    removeCard: true,
    message: 'Video decision saved.'
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
      reason: 'Bulk approved from parent review queue.'
    });
    message = `Approved ${count} video${count === 1 ? '' : 's'}.`;
  } else if (action === 'block_all') {
    count = bulkUpsertVideoDecisions({
      householdId: req.session.parentUser.householdId,
      parentUserId: req.session.parentUser.id,
      videoIds,
      decision: 'block',
      reason: 'Bulk blocked from parent review queue.'
    });
    message = `Blocked ${count} video${count === 1 ? '' : 's'}.`;
  } else if (action === 'delete_all') {
    count = deleteReviewVideos({
      householdId: req.session.parentUser.householdId,
      videoIds
    });
    message = `Deleted ${count} review video${count === 1 ? '' : 's'}.`;
  } else if (action === 'delete_channels') {
    const result = deleteReviewChannels({
      householdId: req.session.parentUser.householdId,
      channelIds: reviewQueue.channels
        .filter((channel) => !channel.decision)
        .map((channel) => channel.id)
    });
    message = `Deleted ${result.channelsDeleted} unreviewed channel${result.channelsDeleted === 1 ? '' : 's'} and ${result.videosDeleted} related review video${result.videosDeleted === 1 ? '' : 's'}.`;
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
      message: 'Video decision updated.'
    }
  );
});

router.post('/reviews/channels/:channelId/decision', requireParent, (req, res) => {
  upsertChannelDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    channelId: Number(req.params.channelId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  sendDecisionResponse(req, res, '/parent/reviews', {
    decision: req.body.decision,
    removeCard: false,
    message: 'Channel decision saved.'
  });
});

router.post('/decisions/channels/:channelId', requireParent, (req, res) => {
  upsertChannelDecision({
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
      message: 'Channel decision updated.'
    }
  );
});

module.exports = router;
