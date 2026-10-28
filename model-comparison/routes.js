const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { searchVideos } = require("./search");
const { compareVideo } = require("./compare");

const router = express.Router();
const recentSearches = new Map();
const SEARCH_TTL_MS = 30 * 60 * 1000;
const view = path.join(__dirname, "page.ejs");

// This experiment spends API quota, so only signed-in parents can use it.
router.use((req, res, next) => {
  if (!req.session.parentUser) return res.redirect("/auth/login");
  next();
});
router.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
router.use("/search", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }));
router.use("/compare", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }));

function currentVideos(req) {
  const entry = recentSearches.get(req.sessionID);
  if (!entry) return [];
  if (Date.now() - entry.createdAt > SEARCH_TTL_MS) {
    recentSearches.delete(req.sessionID);
    return [];
  }
  return entry.videos;
}

function renderPage(res, { query = "", videos = [], selectedId = "", comparisons = [], error = "" } = {}) {
  res.render(view, { title: "Model comparison", query, videos, selectedId, comparisons, error });
}

router.get("/", (req, res) => renderPage(res));

router.post("/search", async (req, res, next) => {
  const query = typeof req.body.q === "string" ? req.body.q.trim() : "";
  if (!query || query.length > 200) {
    return res.status(400).render(view, { title: "Model comparison", query, videos: [], selectedId: "", comparisons: [], error: "Enter a search of 1 to 200 characters." });
  }
  try {
    recentSearches.delete(req.sessionID);
    for (const [sessionId, entry] of recentSearches) {
      if (Date.now() - entry.createdAt > SEARCH_TTL_MS) recentSearches.delete(sessionId);
    }
    const videos = await searchVideos(query);
    recentSearches.set(req.sessionID, { query, videos, createdAt: Date.now() });
    return renderPage(res, { query, videos });
  } catch (error) {
    if (error.code === "youtube_data_api_error") {
      return renderPage(res, { query, error: error.userMessage });
    }
    return next(error);
  }
});

router.post("/compare", async (req, res) => {
  const entry = recentSearches.get(req.sessionID);
  const videos = currentVideos(req);
  const query = videos.length ? entry.query : "";
  const selectedId = typeof req.body.videoId === "string" ? req.body.videoId : "";
  const video = videos.find((item) => item.externalVideoId === selectedId);
  if (!video) return renderPage(res, { query, videos, error: "Search again, then choose one of the three videos." });
  try {
    const comparisons = await compareVideo(video, process.env.OPENROUTER_API_KEY);
    return renderPage(res, { query, videos, selectedId, comparisons });
  } catch (error) {
    return renderPage(res, { query, videos, selectedId, error: error.message });
  }
});

module.exports = router;
