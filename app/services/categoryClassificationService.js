const YOUTUBE_CATEGORY_PRESENTATION = new Map([
  ["Autos & Vehicles", { iconKey: "vehicles" }],
  ["Education", { iconKey: "education" }],
  ["Family", { iconKey: "family" }],
  ["Film & Animation", { iconKey: "animation" }],
  ["Howto & Style", { iconKey: "making" }],
  ["Music", { iconKey: "music" }],
  ["Pets & Animals", { iconKey: "animals" }],
  ["Science & Technology", { iconKey: "science" }],
  ["Sports", { iconKey: "sports" }],
  ["Travel & Events", { iconKey: "travel" }],
  ["Documentary", { iconKey: "documentary" }],
]);

function classifyUnknownCategoryWithAi(_candidate) {
  // Future integration point: return a validated { primaryCategory, iconKey }
  // only when YouTube has no useful self-assigned category. It intentionally
  // returns null until a server-side provider, evaluation set, and audit policy
  // are approved.
  return null;
}

function classifyCandidateCategory(candidate) {
  const youtubeCategoryTitle = String(
    candidate.youtubeCategoryTitle || "",
  ).trim();
  const youtubePresentation =
    YOUTUBE_CATEGORY_PRESENTATION.get(youtubeCategoryTitle);

  if (youtubePresentation) {
    return {
      primaryCategory: youtubeCategoryTitle,
      iconKey: youtubePresentation.iconKey,
      source: "youtube_category",
    };
  }
  const aiCategory = classifyUnknownCategoryWithAi(candidate);

  if (aiCategory) {
    return { ...aiCategory, source: "ai_category" };
  }

  return {
    primaryCategory: "General",
    iconKey: "general",
    source: "general_fallback",
  };
}

module.exports = {
  classifyCandidateCategory,
  classifyUnknownCategoryWithAi,
};
