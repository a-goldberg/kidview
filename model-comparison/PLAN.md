# Model comparison prototype

## Goal

Give a signed-in KidView parent a small, one-page demo of how three OpenRouter models assess YouTube videos for children 12 and younger using metadata alone.

## Implementation

1. Search YouTube through KidView's existing API client, requesting the first three video hits with the configured SafeSearch setting and the embeddable-only request filter off. Do not apply KidView moderation to result selection, call the normal search handler, or write search, moderation, review, or usage records. If YouTube no longer returns details for a hit, show its search snippet with a clear incomplete-metadata baseline.
2. Hold one search result set in server memory for 30 minutes. Let the parent select a video; never accept arbitrary client-supplied metadata for a model prompt.
3. Send identical metadata and instructions to GPT-4.1 Mini, Gemini 3 Flash Preview, and Claude Haiku 4.5 through OpenRouter. Ask for a short synopsis, likely age range, an explicit under-13 assessment, and a reason. Show each response with elapsed time, token counts, and OpenRouter's reported cost.
4. Keep the key server-side in the existing ignored `.env` file. Limit requests and cap response length. The page requires a parent session.
5. After comparison, apply KidView's normal source/format guardrails and rule scorer read-only for the baseline panel. Report its proposed decision, default child visibility, score, and signals above the model responses. Load a privacy-enhanced YouTube embed below them when YouTube allows embedding; otherwise link to the video on YouTube.

## Boundaries

This is a metadata comparison, not an automated child-safety decision. Models cannot verify actual video content from title, description, and API fields. The experiment intentionally does not use household video/channel overrides because it does not write or read the household moderation workflow. The raw results can include Shorts, livestreams, risky material, and videos that cannot be embedded. KidView's real child search still uses its existing filters and parent decisions. No transcripts, thumbnails, database migration, or saved comparison history are needed.

## Verify

- Run `npm test`.
- Sign in as a parent, visit `/model-comparison`, search, and check that the first three YouTube hits appear even when KidView would hide them.
- Choose a result and compare. Check that all three answers and metrics appear, and that KidView search history and review queue have no new entries.
- Check that the baseline appears above the model responses and the selected video embeds beneath them.
- Confirm a missing OpenRouter key produces a helpful message and that `.env` remains ignored by Git.
