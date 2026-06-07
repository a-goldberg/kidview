const express = require('express');
const { getParentDashboard } = require('../services/householdService');

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

module.exports = router;
