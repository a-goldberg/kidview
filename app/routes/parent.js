const express = require('express');
const { getParentDashboard, getReviewQueue } = require('../services/householdService');
const { upsertChannelDecision, upsertVideoDecision } = require('../services/decisionService');

const router = express.Router();

function requireParent(req, res, next) {
  if (!req.session.parentUser) {
    return res.redirect('/auth/login');
  }

  return next();
}

router.get('/', requireParent, (req, res) => {
  const dashboard = getParentDashboard(req.session.parentUser.householdId);

  res.render('parent/dashboard', {
    title: 'Parent Dashboard',
    dashboard
  });
});

router.get('/reviews', requireParent, (req, res) => {
  const reviewQueue = getReviewQueue(req.session.parentUser.householdId);

  res.render('parent/reviews', {
    title: 'Review Videos',
    reviewQueue
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

  res.redirect('/parent/reviews');
});

router.post('/reviews/channels/:channelId/decision', requireParent, (req, res) => {
  upsertChannelDecision({
    householdId: req.session.parentUser.householdId,
    parentUserId: req.session.parentUser.id,
    channelId: Number(req.params.channelId),
    decision: req.body.decision,
    reason: req.body.reason
  });

  res.redirect('/parent/reviews');
});

module.exports = router;
