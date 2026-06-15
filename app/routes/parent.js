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
  upsertChannelDecision,
  upsertVideoDecision
} = require('../services/decisionService');
const { displayLabel } = require('../services/displayLabels');

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
