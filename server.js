const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const SQLiteStoreFactory = require('better-sqlite3-session-store');

const config = require('./app/config');
const db = require('./app/db/database');
const authRoutes = require('./app/routes/auth');
const childRoutes = require('./app/routes/child');
const parentRoutes = require('./app/routes/parent');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'app', 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'app', 'public')));

app.use(
  session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({
      client: db,
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000
      }
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentParent = req.session.parentUser || null;
  res.locals.sessionCookieName = config.sessionCookieName;
  next();
});

app.get('/', (req, res) => {
  res.redirect('/child/search');
});

app.use('/auth', authRoutes);
app.use('/child', childRoutes);
app.use('/parent', parentRoutes);

app.use((req, res) => {
  res.status(404).render('not-found', {
    title: 'Page not found'
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Something went wrong'
  });
});

app.listen(config.port, config.host, () => {
  console.log(`KidView running at http://${config.host}:${config.port}`);
});
