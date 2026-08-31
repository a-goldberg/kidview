const config = require('../config');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
let categoryTitlesPromise = null;

function parseYouTubeDuration(duration) {
  const match = String(duration || '').match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );

  if (!match) {
    return 0;
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match.map((value) =>
    Number(value || 0)
  );

  return (
    years * 365 * 24 * 60 * 60 +
    months * 30 * 24 * 60 * 60 +
    weeks * 7 * 24 * 60 * 60 +
    days * 24 * 60 * 60 +
    hours * 60 * 60 +
    minutes * 60 +
    seconds
  );
}

function requireApiKey() {
  if (!config.youtubeApiKey) {
    throw new Error('VIDEO_SOURCE=youtube requires YOUTUBE_API_KEY in the server environment.');
  }
}

function youtubeErrorHint(message) {
  if (/referer <empty>|referrer <empty>|referer.*blocked|referrer.*blocked/i.test(message)) {
    return ' This usually means the API key is restricted to browser HTTP referrers. KidView calls YouTube from the server, so use a server-side key restriction such as allowed server IPs, or remove HTTP referrer restrictions for local development.';
  }

  return '';
}

async function fetchYouTubeJson(path, params) {
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set('key', config.youtubeApiKey);

  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`YouTube Data API request could not be reached: ${error.message}`);
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body.error && body.error.message ? body.error.message : response.statusText;
    throw new Error(`YouTube Data API request failed: ${message}${youtubeErrorHint(message)}`);
  }

  return body;
}

function liveStatusFor(video) {
  const liveBroadcastContent = video.snippet && video.snippet.liveBroadcastContent;

  if (liveBroadcastContent === 'live') {
    return 'live';
  }

  if (liveBroadcastContent === 'upcoming') {
    return 'upcoming';
  }

  if (video.liveStreamingDetails) {
    return 'completed_live';
  }

  return 'none';
}

function mapYouTubeVideo(video, categoryTitles) {
  const durationSeconds = parseYouTubeDuration(video.contentDetails && video.contentDetails.duration);
  const liveStatus = liveStatusFor(video);
  const statistics = video.statistics || {};

  return {
    source: 'youtube',
    externalVideoId: video.id,
    title: video.snippet.title,
    description: video.snippet.description || '',
    channelExternalId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    youtubeCategoryId: video.snippet.categoryId || null,
    youtubeCategoryTitle: categoryTitles.get(video.snippet.categoryId) || null,
    durationSeconds,
    publishedAt: video.snippet.publishedAt,
    isShort: durationSeconds <= 60,
    isLivestream: liveStatus !== 'none',
    liveStatus,
    embeddable: video.status && video.status.embeddable === true,
    madeForKids: video.status && video.status.madeForKids === true,
    transcriptAvailable: false,
    transcriptSample: null,
    primaryCategoryHint: null,
    viewCount: Number(statistics.viewCount || 0),
    likeCount: Number(statistics.likeCount || 0),
    commentCount: Number(statistics.commentCount || 0)
  };
}

function getCategoryTitles() {
  if (!categoryTitlesPromise) {
    categoryTitlesPromise = fetchYouTubeJson('videoCategories', {
      part: 'snippet',
      regionCode: config.youtubeRegionCode,
    })
      .then((response) =>
        new Map(
          (response.items || [])
            .filter((category) => category.id && category.snippet && category.snippet.title)
            .map((category) => [category.id, category.snippet.title]),
        ),
      )
      .catch((error) => {
        categoryTitlesPromise = null;
        console.warn(`YouTube category lookup failed: ${error.message}`);
        return new Map();
      });
  }

  return categoryTitlesPromise;
}

async function searchCandidatePage(query, { pageToken = null, maxResults } = {}) {
  requireApiKey();

  const searchResponse = await fetchYouTubeJson('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: maxResults || config.youtubeMaxSearchResults,
    pageToken,
    safeSearch: config.youtubeSafeSearch,
    videoEmbeddable: 'true',
    regionCode: config.youtubeRegionCode,
    relevanceLanguage: config.youtubeRelevanceLanguage
  });

  const videoIds = (searchResponse.items || [])
    .map((item) => item.id && item.id.videoId)
    .filter(Boolean);

  if (!videoIds.length) {
    return {
      candidates: [],
      nextPageToken: searchResponse.nextPageToken || null,
    };
  }

  const videosResponse = await fetchYouTubeJson('videos', {
    part: 'snippet,contentDetails,status,liveStreamingDetails,statistics',
    id: videoIds.join(',')
  });
  const categoryTitles = await getCategoryTitles();

  const videosById = new Map(
    (videosResponse.items || [])
    .filter((video) => video.id && video.snippet && video.contentDetails && video.status)
    .map((video) => [video.id, mapYouTubeVideo(video, categoryTitles)])
  );

  return {
    candidates: videoIds.map((videoId) => videosById.get(videoId)).filter(Boolean),
    nextPageToken: searchResponse.nextPageToken || null,
  };
}

async function searchCandidates(query) {
  const page = await searchCandidatePage(query);
  return page.candidates;
}

module.exports = {
  liveStatusFor,
  parseYouTubeDuration,
  getCategoryTitles,
  searchCandidatePage,
  searchCandidates
};
