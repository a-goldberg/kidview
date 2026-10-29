const express = require('express');
const rateLimit = require('express-rate-limit');
const { listParents, saveParent } = require('../services/parentAccountService');
const router = express.Router();

// Every account route has the same administrator and tenant boundary.
router.use((req, res, next) => {
  const actor = req.session.parentUser;
  if (!actor) return res.redirect('/auth/login');
  if (actor.role !== 'admin' || actor.isDemo) return res.status(403).render('not-found', {
    title: 'Household administrator access required'
  });
  res.set('Cache-Control', 'no-store');
  next();
});

function render(req, res, errorMessage = null) {
  return res.status(errorMessage ? 400 : 200).render('parent/accounts', {
    title: 'Parent accounts', accounts: listParents(req.session.parentUser), errorMessage,
    savedMessage: req.query.saved === '1' ? 'Account saved.  Existing sessions for an edited account have been signed out.' : null
  });
}

router.get('/', (req, res) => render(req, res));
router.use(rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
function save(req, res, next, id = null) {
  try {
    saveParent(req.session.parentUser, req.body, id);
    return res.redirect('/parent/accounts?saved=1');
  } catch (error) {
    if (error instanceof RangeError) return render(req, res, error.message);
    next(error);
  }
}
router.post('/', (req, res, next) => save(req, res, next));
router.post('/:parentId', (req, res, next) => save(req, res, next, Number(req.params.parentId)));
module.exports = router;
