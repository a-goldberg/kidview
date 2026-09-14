const express = require("express")
const {
  getSavedSearch,
  markNotWhatIMeant,
  recordClickedVideo,
  search,
} = require("../services/searchService")
const { getChildSafeVideo } = require("../services/moderationService")
const { getChildPolicy } = require("../services/policyService")
const {
  recordPlaybackProgress,
  startPlayback,
} = require("../services/usageService")
const {
  getActiveChildProfile,
  getChildProfileForHousehold,
  listChildProfilesForHousehold,
  setActiveChildProfile,
} = require("../services/childProfileSessionService")

const router = express.Router()
// Express runs param checks before route handlers, including playback routes.
for (const parameter of ["videoId", "childProfileId", "searchEventId"]) {
  router.param(parameter, (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      return res.status(404).render("not-found", { title: "Not found" })
    }
    next()
  })
}
const SEARCH_SUGGESTIONS_LIST = [
  "science experiments",
  "otters",
  "how to simplify fractions",
  "DIY stop motion animation",
  "volcanoes",
  "best queso recipe",
  "how to make slime",
  "how to draw a cartoon dog",
  "make a paper airplane",
  "why do farts smell",
  "why is the sky blue",
  "what is a rainbow",
  "what do penguins eat",
  "harry potter cast",
  "do ears have bones",
  "why are plants green",
  "what is dirt made of",
  "are black holes real",
  "how big is texas",
  "do worms poop",
  "how to pierce my brother's ear",
  "how to sell my mom's car",
  "how to drive a bulldozer",
  "what is the fastest animal",
  "what does the sun taste like",
  "why do old people smell",
  "why do dogs have tongues",
  "what do germs look like",
  "view from a hot air balloon",
  "living in antarctica",
  "how to build a snowmobile",
  "the gods must be crazy",
  "songbirds of eastern nebraska",
  "new years fireworks in sydney",
  "how does a microwave work",
  "how to find fossils",
  "dinosaur poop",
  "lego whale instructions",
  "world's biggest sand castle",
  "do i have too many squishies?",
  "boring minecraft videos",
  "how fast is too fast?",
  "how to fix the window that i broke",
  "how to make a paper boat",
  "how to build a robot mom who will actually love me",
  "how to hatch a turtle",
  "how to draw a tardigrade",
  "how pencils are made",
  "ancient egypt",
  "hammerhead sharks",
  "can i live in a balloon?",
  "pythagorean theorem for kids",
  "multiplying fractions",
  "pinhole camera",
  "how to make paper flowers",
  "learn to do a handstand",
  "helicopters",
  "remote control lizard",
  "RC car stunts",
  "unboxing a real tyrannosaurus rex",
  "eating hot peppers",
  "ear bones",
  "how do scissors work",
  "cute makeup tricks for wrinkled knees",
  "hobbies for teens",
  "tree frogs as pets",
  "can honey badgers even?",
  "how to run from a hippo",
  "bear grylls poop water",
  "how squishies are made",
  "yummy salad recipe",
  "best popcorn recipe",
  "middle school teacher pranks",
  "exercise for kids",
  "softball pitching tutorial",
  "how to juggle a soccer ball",
  "how to play hacky sack",
  "how to disappear completely",
]

function getSearchSuggestions() {
  return [...SEARCH_SUGGESTIONS_LIST]
    .sort(() => 0.5 - Math.random())
    .slice(0, 3)
}

function resultsUrl(query, searchEventId) {
  return searchEventId
    ? `/child/results?searchEventId=${searchEventId}`
    : `/child/search?q=${encodeURIComponent(query)}`
}

function requireParentForProfileSelection(req, res, next) {
  if (!req.session.parentUser) {
    return res.redirect("/auth/login?returnTo=%2Fchild%2Fprofile")
  }

  return next()
}

function requireActiveChild(req, res, next) {
  const childProfile = getActiveChildProfile(req)

  if (!childProfile) {
    if (req.method === "GET" && req.path === "/search") {
      return res.render("child/profile-required", {
        title: "Choose a Child Profile",
      })
    }

    return res.redirect("/child/search")
  }

  req.activeChildProfile = childProfile
  return next()
}

router.get("/profile", requireParentForProfileSelection, (req, res) => {
  const childProfiles = listChildProfilesForHousehold(
    req.session.parentUser.householdId,
  )

  res.render("child/profile-select", {
    title: "Choose a Child Profile",
    childProfiles,
  })
})

router.post(
  "/profile/:childProfileId/activate",
  requireParentForProfileSelection,
  (req, res, next) => {
    const parentUser = req.session.parentUser
    const childProfile = getChildProfileForHousehold({
      householdId: parentUser.householdId,
      childProfileId: Number(req.params.childProfileId),
    })

    if (!childProfile) {
      return res.status(404).render("not-found", {
        title: "Child profile not found",
      })
    }

    const sessionCookieName = res.locals.sessionCookieName

    return req.session.destroy((error) => {
      if (error) {
        return next(error)
      }

      res.clearCookie(sessionCookieName)
      setActiveChildProfile(res, {
        householdId: parentUser.householdId,
        childProfileId: childProfile.id,
      })
      return res.redirect("/child/search")
    })
  },
)

router.get("/search", requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile

  res.render("child/search", {
    title: "KidView Search",
    childProfile,
    query: String(req.query.q || ""),
    suggestions: getSearchSuggestions(),
    wasNotWhatIMeant: req.query.tryAgain === "1",
  })
})

router.post("/search", requireActiveChild, async (req, res, next) => {
  const childProfile = req.activeChildProfile
  const query = String(req.body.q || "").trim()

  try {
    const searchResponse = query
      ? await search({
          query,
          householdId: childProfile && childProfile.householdId,
          childProfileId: childProfile && childProfile.id,
        })
      : { query, searchEventId: null, candidatesConsidered: 0, results: [] }

    if (searchResponse.limitReached) {
      return res.status(429).render("child/results", {
        title: "KidView Results",
        childProfile,
        query,
        searchEventId: null,
        candidatesConsidered: 0,
        sourceError:
          "Today's search limit has been reached. Please try again tomorrow.",
        suggestions: getSearchSuggestions(),
        results: [],
      })
    }

    if (!searchResponse.searchEventId) return res.redirect(303, "/child/search")
    return res.redirect(303, resultsUrl(query, searchResponse.searchEventId))
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).render("child/results", {
        title: "KidView Results",
        childProfile,
        query,
        searchEventId: null,
        candidatesConsidered: 0,
        sourceError: error.message,
        suggestions: getSearchSuggestions(),
        results: [],
      })
    }
    if (error && error.userMessage) {
      console.error("Child search source error:", error)

      return res.status(503).render("child/results", {
        title: "KidView Results",
        childProfile,
        query,
        searchEventId: null,
        candidatesConsidered: 0,
        sourceError: error.userMessage,
        suggestions: getSearchSuggestions(),
        results: [],
      })
    }

    next(error)
  }
})

// Legacy query links open the search form; only an explicit POST starts a search.
router.get("/results", requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile
  if (!req.query.searchEventId) {
    return res.redirect(
      `/child/search?q=${encodeURIComponent(String(req.query.q || ""))}`,
    )
  }
  const saved = getSavedSearch({
    searchEventId: Number(req.query.searchEventId),
    householdId: childProfile.householdId,
    childProfileId: childProfile.id,
  })
  if (!saved)
    return res.status(404).render("not-found", { title: "Search not found" })
  return res.render("child/results", {
    title: "KidView Results",
    childProfile,
    ...saved,
    sourceError: null,
    suggestions: getSearchSuggestions(),
    results: saved.results.map((result) => ({
      ...result,
      watchUrl: `${result.watchUrl}?q=${encodeURIComponent(saved.query)}&searchEventId=${saved.searchEventId}`,
    })),
  })
})

router.get("/videos/:videoId", requireActiveChild, (req, res) => {
  const childProfile = req.activeChildProfile
  const query = String(req.query.q || "").trim()
  const searchEventId = Number(req.query.searchEventId || 0)
  const videoId = Number(req.params.videoId)
  const video = getChildSafeVideo({
    householdId: childProfile && childProfile.householdId,
    childProfileId: childProfile && childProfile.id,
    videoId,
  })

  if (!video) {
    return res.status(404).render("child/video-unavailable", {
      title: "Video unavailable",
      childProfile,
      resultsUrl:
        query || searchEventId ? resultsUrl(query, searchEventId) : null,
    })
  }

  return res.render("child/video", {
    title: video.title,
    childProfile,
    video,
    searchEventId:
      Number.isSafeInteger(searchEventId) && searchEventId > 0
        ? searchEventId
        : null,
    resultsUrl:
      query || searchEventId ? resultsUrl(query, searchEventId) : null,
  })
})

router.post(
  "/search-events/:searchEventId/not-what-i-meant",
  requireActiveChild,
  (req, res) => {
    const childProfile = req.activeChildProfile
    const query = String(req.body.query || "").trim()

    if (childProfile) {
      markNotWhatIMeant({
        searchEventId: Number(req.params.searchEventId),
        householdId: childProfile.householdId,
        childProfileId: childProfile.id,
      })
    }

    res.redirect(`/child/search?tryAgain=1&q=${encodeURIComponent(query)}`)
  },
)

function jsonError(res, status, code, message, extra = {}) {
  return res.status(status).json({ ok: false, code, message, ...extra })
}

// The child cookie establishes both household and child identity.  The safe-video
// lookup is repeated immediately before every playback start, not just when the
// result card was originally rendered.
router.post(
  "/videos/:videoId/playback/start",
  requireActiveChild,
  (req, res) => {
    const childProfile = req.activeChildProfile
    const videoId = Number(req.params.videoId)
    const video = getChildSafeVideo({
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
      videoId,
    })

    if (!video) {
      return jsonError(
        res,
        403,
        "video_unavailable",
        "This video is no longer available.",
      )
    }

    const policy = getChildPolicy({
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
    })
    const result = startPlayback({
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
      videoId: video.videoId,
      policy,
      durationSeconds: video.durationSeconds,
    })

    if (!result.allowed) {
      return jsonError(
        res,
        429,
        "daily_watch_limit_reached",
        "Today's video limit has been reached. Please try again tomorrow.",
        {
          watchLimit: result.usage.watches,
        },
      )
    }

    recordClickedVideo({
      searchEventId: Number(req.body && req.body.searchEventId),
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
      videoId: video.videoId,
    })

    return res.json({
      ok: true,
      playback: {
        id: result.playback.id,
        videoId: video.videoId,
        startedAt: result.playback.started_at,
        resumed: result.resumed,
        durationSeconds: result.durationSeconds,
        watchLimit: result.usage.watches,
      },
    })
  },
)

router.post(
  "/videos/:videoId/playback/progress",
  requireActiveChild,
  (req, res) => {
    const childProfile = req.activeChildProfile
    const videoId = Number(req.params.videoId)
    const body = req.body || {}
    const playbackId = Number(body.playbackId)
    const video = getChildSafeVideo({
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
      videoId,
    })

    if (!video) {
      return jsonError(
        res,
        403,
        "video_unavailable",
        "This video is no longer available.",
      )
    }

    if (!Number.isInteger(playbackId) || playbackId < 1) {
      return jsonError(
        res,
        400,
        "invalid_playback",
        "A valid playback session is required.",
      )
    }

    const result = recordPlaybackProgress({
      householdId: childProfile.householdId,
      childProfileId: childProfile.id,
      videoId: video.videoId,
      playbackId,
      currentTimeSeconds: body.currentTimeSeconds,
      durationSeconds: video.durationSeconds,
    })

    if (result.error === "invalid_progress") {
      return jsonError(
        res,
        400,
        "invalid_progress",
        "Playback progress must be a non-negative number.",
      )
    }

    if (result.error === "playback_not_found") {
      return jsonError(
        res,
        404,
        "playback_not_found",
        "Playback session not found.",
      )
    }

    const playback = result.playback
    return res.json({
      ok: true,
      playback: {
        id: playback.id,
        videoId: video.videoId,
        startedAt: playback.started_at,
        lastProgressAt: playback.last_progress_at,
        maxProgressSeconds: playback.max_progress_seconds,
        completedAt: playback.completed_at,
      },
    })
  },
)

module.exports = router
