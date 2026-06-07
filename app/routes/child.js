const express = require('express');
const { search } = require('../services/childSearchService');
const { getFirstChildProfile } = require('../services/householdService');

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
  const results = query
    ? search({
        query,
        householdId: childProfile && childProfile.householdId,
        childProfileId: childProfile && childProfile.id
      })
    : [];

  res.render('child/results', {
    title: 'KidView Results',
    childProfile,
    query,
    results
  });
});

module.exports = router;
