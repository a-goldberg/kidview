const test = require("node:test");
const assert = require("node:assert/strict");
const youtube = require("../app/services/youtubeSourceService");
const config = require("../app/config");
const { searchVideos } = require("./search");
const { compareVideo } = require("./compare");
const { baselineFor } = require("./baseline");

function candidate(id, changes = {}) {
  return {
    externalVideoId: id,
    title: "Science lesson for kids",
    description: "Learn science facts in this easy lesson for kids.",
    channelTitle: "NASA official science",
    youtubeCategoryTitle: "Education",
    durationSeconds: 300,
    publishedAt: "2024-01-01T00:00:00Z",
    viewCount: 1000000,
    madeForKids: true,
    embeddable: true,
    isShort: false,
    liveStatus: "none",
    ...changes,
  };
}

test("comparison search keeps the first three hits regardless of KidView decisions", async () => {
  const original = youtube.searchCandidatePage;
  let receivedOptions;
  youtube.searchCandidatePage = async (_query, options) => {
    receivedOptions = options;
    return { candidates: [
      candidate("short", { isShort: true }),
      candidate("live", { liveStatus: "live" }),
      candidate("risky", { title: "Science lesson with weapons for kids" }),
    ], nextPageToken: "next" };
  };
  try {
    const results = await searchVideos("science");
    assert.deepEqual(results.map((item) => item.externalVideoId), ["short", "live", "risky"]);
    assert.equal(results[0].category, "Education");
    assert.deepEqual(receivedOptions, { maxResults: 3, embeddableOnly: false, includeSearchOnly: true });
  } finally {
    youtube.searchCandidatePage = original;
  }
});

test("demo adapter keeps search order and missing details while retaining configured SafeSearch", async () => {
  const originalFetch = global.fetch;
  const originalKey = config.youtubeApiKey;
  const searchUrls = [];
  config.youtubeApiKey = "test-key";
  global.fetch = async (url) => {
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith("/search")) {
      searchUrls.push(endpoint);
      return { ok: true, json: async () => ({ items: [
        { id: { videoId: "aaaaaaaaaaa" }, snippet: { title: "First", channelTitle: "A" } },
        { id: { videoId: "bbbbbbbbbbb" }, snippet: { title: "Second", channelTitle: "B" } },
        { id: { videoId: "ccccccccccc" }, snippet: { title: "Third", channelTitle: "C" } },
      ] }) };
    }
    if (endpoint.pathname.endsWith("/videos")) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
  try {
    const results = await searchVideos("example");
    assert.deepEqual(results.map((item) => item.title), ["First", "Second", "Third"]);
    assert.equal(results.every((item) => item.metadataIncomplete), true);
    assert.equal(searchUrls[0].searchParams.get("safeSearch"), config.youtubeSafeSearch);
    assert.equal(searchUrls[0].searchParams.has("videoEmbeddable"), false);
    await youtube.searchCandidatePage("example", { maxResults: 3 });
    assert.equal(searchUrls[1].searchParams.get("safeSearch"), config.youtubeSafeSearch);
    assert.equal(searchUrls[1].searchParams.get("videoEmbeddable"), "true");
  } finally {
    global.fetch = originalFetch;
    config.youtubeApiKey = originalKey;
  }
});

test("KidView baseline distinguishes format blocks, rule review, and default visibility", () => {
  assert.equal(baselineFor(candidate("short", { isShort: true })).decision, "block");
  assert.equal(baselineFor(candidate("live", { liveStatus: "live" })).wouldShow, false);
  assert.equal(baselineFor(candidate("noembed", { embeddable: false })).source, "source_filter");
  const review = baselineFor(candidate("review", {
    title: "A tour", description: "Travel through towns", channelTitle: "Local",
    youtubeCategoryTitle: "Travel & Events", viewCount: 10000, madeForKids: false,
  }));
  assert.equal(review.decision, "review");
  assert.equal(review.wouldShow, false);
  const limited = baselineFor(candidate("limited", {
    title: "A tour", description: "Travel through towns", channelTitle: "Local",
    youtubeCategoryTitle: "Education", viewCount: 100000, madeForKids: false,
  }));
  assert.equal(limited.decision, "allow_limited");
  assert.equal(limited.wouldShow, false);
  assert.equal(baselineFor(candidate("allowed")).wouldShow, true);
  assert.equal(baselineFor(candidate("partial", { metadataIncomplete: true })).decision, "unknown");
});

test("all models receive identical metadata and report usage from OpenRouter", async () => {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          synopsis: "A science lesson.", ageRange: "8-12", under13: "suitable", reason: "The metadata describes a child lesson.",
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.00012 },
      }),
    };
  };
  try {
    const results = await compareVideo(candidate("one", { category: "Education" }), "test-key");
    assert.equal(results.length, 3);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((request) => request.messages), [requests[0].messages, requests[0].messages, requests[0].messages]);
    assert.deepEqual(results.map((result) => result.cost), [0.00012, 0.00012, 0.00012]);
    assert.equal(results[0].assessment.under13, "suitable");
  } finally {
    global.fetch = original;
  }
});
