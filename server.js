const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStoreFactory = require("better-sqlite3-session-store");

const config = require("./app/config");
const db = require("./app/db/database");
const authRoutes = require("./app/routes/auth");
const childRoutes = require("./app/routes/child");
const parentRoutes = require("./app/routes/parent");
const requireSameOrigin = require("./app/middleware/requireSameOrigin");
const displayLabels = require("./app/services/displayLabels");

const SQLiteStore = SQLiteStoreFactory(session);

function createApp(options = {}) {
  const appConfig = options.config || config;
  const database = options.database || db;
  const app = express();

  app.disable("x-powered-by");
  if (appConfig.trustProxy) app.set("trust proxy", appConfig.trustProxy);

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "app", "views"));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://www.youtube.com"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https://i.ytimg.com"],
          frameSrc: ["https://www.youtube-nocookie.com"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );

  app.use(
    options.generalRateLimiter ||
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 300,
        standardHeaders: "draft-7",
        legacyHeaders: false,
      }),
  );

  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "16kb" }));
  app.use(express.static(path.join(__dirname, "app", "public")));

  app.use(
    session({
      name: appConfig.sessionCookieName,
      secret: appConfig.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store:
        options.sessionStore ||
        new SQLiteStore({
          client: database,
          expired: {
            clear: true,
            intervalMs: 15 * 60 * 1000,
          },
        }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: appConfig.isProduction,
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.use(requireSameOrigin(appConfig.appOrigin));

  app.use((req, res, next) => {
    res.locals.currentParent = req.session.parentUser || null;
    res.locals.sessionCookieName = appConfig.sessionCookieName;
    res.locals.displayLabel = displayLabels.displayLabel;
    res.locals.displayList = displayLabels.displayList;
    res.locals.displayLocale = "en";
    next();
  });

  app.get("/", (req, res) => {
    res.redirect("/child/search");
  });

  app.use("/auth", authRoutes);
  app.use("/child", childRoutes);
  app.use("/parent", parentRoutes);

  app.use((req, res) => {
    res.status(404).render("not-found", {
      title: "Page not found",
    });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render("error", {
      title: "Something went wrong",
    });
  });

  return app;
}

function startServer() {
  const app = createApp();
  return app.listen(config.port, config.host, () => {
    console.log(`KidView running at http://${config.host}:${config.port}`);
  });
}

if (require.main === module) startServer();

module.exports = { createApp, startServer };
