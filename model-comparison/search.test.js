const test = require("node:test");
const assert = require("node:assert/strict");
const youtube = require("../app/services/youtubeSourceService");
const { searchVideos } = require("./search");
const { compareVideo } = require("./compare");

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

test("comparison search filters formats and risky metadata before choosing three", async () => {
  const original = youtube.searchCandidatePage;
  let calls = 0;
  youtube.searchCandidatePage = async () => {
    calls += 1;
    if (calls === 1) return {
      candidates: [
        candidate("short", { isShort: true }),
        candidate("live", { liveStatus: "live" }),
        candidate("risky", { title: "Science lesson with weapons for kids" }),
        candidate("one"),
      ],
      nextPageToken: "next",
    };
    return { candidates: [candidate("two"), candidate("three"), candidate("four")], nextPageToken: null };
  };
  try {
    const results = await searchVideos("science");
    assert.deepEqual(results.map((item) => item.externalVideoId), ["one", "two", "three"]);
    assert.equal(results[0].category, "Education");
    assert.equal(calls, 2);
  } finally {
    youtube.searchCandidatePage = original;
  }
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
