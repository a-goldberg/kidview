# Model comparison prototype

## Goal

Give a signed-in KidView parent a small, one-page demo of how three OpenRouter models assess YouTube videos for children 12 and younger using metadata alone.

## Implementation

1. Search YouTube through KidView's existing API client. Apply its video format guardrails, category mapping, and rule-based content score. Show the first three `allow` results. Do not call the normal search handler or write search, moderation, review, or usage records.
2. Hold one search result set in server memory for 30 minutes. Let the parent select a video; never accept arbitrary client-supplied metadata for a model prompt.
3. Send identical metadata and instructions to GPT-4.1 Mini, Gemini 3 Flash Preview, and Claude Haiku 4.5 through OpenRouter. Ask for a short synopsis, likely age range, an explicit under-13 assessment, and a reason. Show each response with elapsed time, token counts, and OpenRouter's reported cost.
4. Keep the key server-side in the existing ignored `.env` file. Limit requests and cap response length. The page requires a parent session.
5. After comparison, show the default rule-based KidView decision and signals above the model responses, then load a privacy-enhanced YouTube embed below them so a parent can judge the assessments against the video.

## Boundaries

This is a metadata comparison, not an automated child-safety decision. Models cannot verify actual video content from title, description, and API fields. The experiment intentionally does not use household video/channel overrides because it does not write or read the household moderation workflow. All selectable results already passed the default rule-based filter, so their baseline decision is always `allow`; the panel mainly provides the score and supporting signals. No transcripts, thumbnails, database migration, or saved comparison history are needed.

## Verify

- Run `npm test`.
- Sign in as a parent, visit `/model-comparison`, search, and check that only three eligible result cards appear.
- Choose a result and compare. Check that all three answers and metrics appear, and that KidView search history and review queue have no new entries.
- Check that the baseline appears above the model responses and the selected video embeds beneath them.
- Confirm a missing OpenRouter key produces a helpful message and that `.env` remains ignored by Git.
