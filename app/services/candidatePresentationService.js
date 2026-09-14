const { classifyCandidateCategory } = require("./categoryClassificationService");

// Source presentation defaults are shared by live retrieval and seed fixtures.
function classifyCandidate(candidate) {
  const text = [candidate.title, candidate.description, candidate.channelTitle]
    .filter(Boolean)
    .join(" ");
  const labels = [];
  const liveStatus =
    candidate.liveStatus ||
    (candidate.isLivestream ? "completed_live" : "none");

  if (candidate.isShort) labels.push("short");
  if (liveStatus === "live") labels.push("live");
  if (liveStatus === "upcoming") labels.push("upcoming-live");
  if (liveStatus === "completed_live") labels.push("completed-live");
  if (!candidate.embeddable) labels.push("not-embeddable");
  if (/math|fraction|science|nature|history|animation|biology/i.test(text))
    labels.push("learning");
  if (/dangerous|stunt|weapon|flamethrower|poison|toxin/i.test(text))
    labels.push("needs-care");
  if (/toy|slime|surprise|mystery|won't believe|do not try/i.test(text))
    labels.push("high-stimulation");

  return {
    ...classifyCandidateCategory(candidate),
    labels,
  };
}

function confidenceFor(candidate) {
  const liveStatus =
    candidate.liveStatus ||
    (candidate.isLivestream ? "completed_live" : "none");

  if (
    candidate.isShort ||
    liveStatus === "live" ||
    liveStatus === "upcoming" ||
    !candidate.embeddable
  )
    return 0.35;
  if (liveStatus === "completed_live") return 0.5;
  if (candidate.primaryCategoryHint) return 0.7;
  return 0.6;
}

function childExplanationFor(candidate, classification) {
  if (classification.iconKey === "animals") {
    return "A KidView candidate about nature, animals, or the world around us.";
  }

  if (["education", "science"].includes(classification.iconKey)) {
    return "A KidView candidate that explains an idea in a simple way.";
  }

  if (["animation", "art", "making"].includes(classification.iconKey)) {
    return "A KidView candidate about making, building, or animation.";
  }

  return "A KidView-approved video.";
}

module.exports = { classifyCandidate, confidenceFor, childExplanationFor };
