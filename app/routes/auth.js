const express = require('express');
const { authenticateParent } = require('../services/authService');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.parentUser) {
    return res.redirect('/parent');
  }

  return res.render('auth/login', {
    title: 'Parent Login',
    error: null,
    email: ''
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const parent = await authenticateParent(email, password);

    if (!parent) {
      return res.status(401).render('auth/login', {
        title: 'Parent Login',
        error: 'Email or password did not match.',
        email
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      req.session.parentUser = parent;
      return req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }

        return res.redirect('/parent');
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res, next) => {
  const cookieName = res.locals.sessionCookieName;

  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie(cookieName);
    return res.redirect('/auth/login');
  });
});

module.exports = router;
