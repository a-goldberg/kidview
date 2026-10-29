# Model comparison prototype

## Goal

Give a signed-in KidView parent a small, one-page demo of how selected OpenRouter models assess YouTube videos for children 12 and younger using metadata alone.

## Implementation

1. Search YouTube through KidView's existing API client with the configured SafeSearch setting and the embeddable-only request filter off. Skip Shorts and all live recordings, then show the first three remaining hits in YouTube order. Fetch additional pages only within the existing candidate and page limits. Hits without video details are skipped because their format cannot be verified. Do not apply any other KidView moderation to result selection, call the normal search handler, or write search, moderation, review, or usage records.
2. Hold one search result set in server memory for 30 minutes. Let the parent select a video; never accept arbitrary client-supplied metadata for a model prompt.
3. Offer eight OpenRouter models: GPT-4.1 Mini, Gemini 3 Flash Preview, and Claude Haiku 4.5 as defaults, plus GPT-4.1 Nano, Gemini 3.1 Flash Lite, Claude Sonnet 4.5, DeepSeek V3.2, and Mistral Small 3.2.  The additions cover low-cost, higher-capability, and open-model candidates.  Allow one to three selections per comparison, remember the choice in browser-tab session storage across searches, and validate the IDs and limit on the server before calling OpenRouter.  Send identical metadata and instructions to the chosen models. Ask for a short synopsis, likely age range, an explicit under-13 assessment, and a reason. Show each response with elapsed time, token counts, and OpenRouter's reported cost.
4. Keep the key server-side in the existing ignored `.env` file. Limit requests and cap response length. The page requires a parent session.
5. After comparison, apply KidView's normal source/format guardrails and rule scorer read-only for the baseline panel. Report its proposed decision, default child visibility, score, and signals above the model responses. Load a privacy-enhanced YouTube embed below them when YouTube allows embedding; otherwise link to the video on YouTube.

## Boundaries

This is a metadata comparison, not an automated child-safety decision. Models cannot verify actual video content from title, description, and API fields. The experiment intentionally does not use household video/channel overrides because it does not write or read the household moderation workflow. Results can include risky material and videos that cannot be embedded, but not Shorts or live recordings. KidView's real child search still uses its existing filters and parent decisions. No transcripts, thumbnails, database migration, or saved comparison history are needed.

## Verify

- Run `npm test`.
- Sign in as a parent, visit `/model-comparison`, search, and check that the first three non-Short, non-live YouTube hits appear even when KidView would otherwise hide them.
- Choose a result and compare. Check that the default three answers and metrics appear, then choose a different one-to-three-model set and confirm only those models run.  Search again in the same tab and check that the choice remains.  Check that KidView search history and review queue have no new entries.
- Check that the baseline appears above the model responses and the selected video embeds beneath them.
- Confirm a missing OpenRouter key produces a helpful message and that `.env` remains ignored by Git.
