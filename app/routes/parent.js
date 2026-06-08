const express = require('express');
const {
  getDecisionHistory,
  getParentDashboard,
  getReviewQueue
} = require('../services/householdService');
const { upsertChannelDecision, upsertVideoDecision } = require('../services/decisionService');

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
    `/parent/decisions?kind=${encodeURIComponent(req.body.kind || 'all')}&search=${encodeURIComponent(req.body.search || '')}`,
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
    `/parent/decisions?kind=${encodeURIComponent(req.body.kind || 'all')}&search=${encodeURIComponent(req.body.search || '')}`,
    {
      decision: req.body.decision,
      message: 'Channel decision updated.'
    }
  );
});

module.exports = router;
