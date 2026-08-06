# KidView

KidView is a small Node.js, Express, and EJS web app for a household-controlled child video discovery gateway.

This early milestone is intentionally boring: it creates a local scaffold, SQLite schema, seed data, parent login, a child-safe search pipeline, and parent review screens.

## Requirements

- Node.js 20 or newer
- npm

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create local config:

   ```sh
   cp .env.example .env
   ```

3. Run database migrations:

   ```sh
   npm run db:migrate
   ```

4. Seed demo data:

   ```sh
   npm run db:seed
   ```

5. Start the app:

   ```sh
   npm run dev
   ```

6. Open:

   - Child search: `http://localhost:3002/child/search`
   - Parent login: `http://localhost:3002/auth/login`
   - Parent reviews: `http://localhost:3002/parent/reviews`

7. Run regression tests:

   ```sh
   npm test
   ```

   See `docs/testing.md` for the current fixture matrix, expected outcomes, and testing architecture notes.

Default seeded parent credentials come from `.env.example`:

- Email: `parent@example.com`
- Password: `password123`

## Project Shape

```txt
app/
  db/
    migrations/
  public/
    css/
    icons/
    js/
  routes/
  services/
  views/
    auth/
    child/
    parent/
    partials/
scripts/
data/
assets/
```

## Product Guardrails In This Milestone

- The primary scope is `households`.
- Parent users belong to a household.
- Child profiles are not login accounts.
- Child search results are capped at three.
- Child search cards use standardized category icons, not native YouTube thumbnails.
- The schema has explicit flags for Shorts and live status.
- Blocked-video reasons are stored only for parent-facing decisions and reviews.
- Transcript text is not stored by default.
- Search uses either mock database candidates or a YouTube Data API source adapter behind the same internal service boundary.
- YouTube responses are normalized into KidView candidate records. Raw YouTube API responses and transcript text are not stored by default.
- Blocked, pending-review, unknown, Short, live, and upcoming stream candidates are not shown to children. `allow_limited` visibility follows the active child profile policy.

## Policy Configuration

KidView keeps household-owned `policy_profiles` and assigns a policy profile to each child. The active server-side policy service lives in `app/services/policyService.js`.

Current configurable values are:

- `policy_profiles.max_results`: one to three results. Three remains the product-wide maximum.
- `child_profiles.allow_limited_policy`: `block`, `review`, `allow`, or `limited_frequency`.
- `child_profiles.allow_limited_min_confidence`: threshold used only by `limited_frequency`.
- `child_profiles.daily_search_limit`: nullable; `NULL` means unlimited.
- `child_profiles.daily_video_watch_limit`: nullable; `NULL` means unlimited.

Daily search and watch limits are configuration-only in this milestone. They are present for the upcoming parent profile controls but are not enforced yet. Accurate watch-limit enforcement will require actual playback/watch events rather than the current single clicked-video field on a search event.

The original schema also contains `policy_profiles.allow_shorts` and `policy_profiles.allow_livestreams`. These are inactive scaffolding and are deliberately not exposed or honored by the policy service. Shorts and live/upcoming streams remain v1 format guardrails. Non-embeddable videos remain a playback constraint rather than a parent-configurable moderation setting.

## Testing The Fixture Review Flow

The seed data loads YouTube-shaped fixture candidates from `app/services/fixtures/youtubeSampleCandidates.js`. These are local test records only; while `VIDEO_SOURCE=mock`, the app does not call the YouTube API.

1. Reset and reseed the local database after schema changes:

   ```sh
   npm run db:reset
   ```

2. Start the app:

   ```sh
   npm run dev
   ```

3. Visit `http://localhost:3002/child/search` and try fixture-backed searches:

   - `science` shows approved educational candidates. Limited educational candidates remain parent-facing.
   - `animation` shows the approved official animation sample and keeps low-confidence candidates hidden.
   - `drama` stays hidden because it requires review.
   - `otters` shows through an approved channel decision.

   Child results should show at most three cards. They use local category icons and link to KidView placeholder video pages.

4. Log in at `http://localhost:3002/auth/login`.

5. Visit `http://localhost:3002/parent/reviews`.

The review page demonstrates `allow`, `allow_limited`, `review_required`, `block`, `review`, `unknown`, Short, live/upcoming, completed-live, and channel decision cases. Parent notes remain parent-facing.

## YouTube Data API Source

By default, KidView uses local mock candidates:

```sh
VIDEO_SOURCE=mock
```

To use the YouTube Data API in production or local testing, set these server-side environment variables and restart the app:

```sh
VIDEO_SOURCE=youtube
YOUTUBE_API_KEY=your-server-side-api-key
YOUTUBE_MAX_SEARCH_RESULTS=10
YOUTUBE_SAFE_SEARCH=moderate
YOUTUBE_REGION_CODE=US
YOUTUBE_RELEVANCE_LANGUAGE=en
```

The API key must stay on the server. It is read by `app/services/youtubeSourceService.js` and is never sent to EJS views, browser JavaScript, or child-facing pages.

Because KidView calls YouTube from Node, the API key should not be restricted by browser HTTP referrers. For production, prefer a server-side restriction such as allowed server IP addresses. For local development, either use an unrestricted development key or add a restriction that works for your local server environment. A key restricted to website referrers can fail with `Requests from referer <empty> are blocked.`

The YouTube adapter calls `search.list`, fetches matching video details with `videos.list`, then maps each item into the same internal candidate shape used by the mock source. KidView still applies the same policy and moderation rules after that:

- no Shorts
- no currently live or upcoming streams
- no non-embeddable videos
- no blocked channels unless a parent has made a more specific allow decision for the exact video
- at most three child-visible results
- blocked, review, and unknown items stay out of the child UI

Fresh YouTube candidates are evaluated by a deterministic `rule-based-v1` moderation layer. It uses title, description, channel title, duration, live status, Short flags, embeddability, publication date, and view count. It does not use OpenAI, transcripts, thumbnails, or raw YouTube response storage.

The rule layer can auto-allow probably-safe educational/source-backed videos, but format guardrails still win:

- Shorts are blocked.
- Live and upcoming streams are blocked because they cannot be assessed before child viewing.
- Completed livestream recordings are not hard-blocked, but they usually require review unless they come from a trusted channel with strong moderation signals.
- Non-embeddable videos are blocked before child display.
- Blocked channels are blocked unless a parent has made a more specific decision for the exact video.
- Parent video decisions override automated and broader channel decisions unless a format guardrail applies.
- Parent channel approvals can allow videos unless live/upcoming hard blocks or severe title/content flags apply.

In development mode, the server logs how many YouTube candidates were returned, hard rejected, auto-allowed, sent to review, blocked/unknown, and shown to the child.

## Rule-Based Moderation Scoring

KidView currently uses `rule-based-v1` in `app/services/moderationService.js`. It is deterministic and intentionally inspectable. It does not call OpenAI, fetch transcripts, use thumbnails, or store raw YouTube responses.

Moderation runs in this order:

1. Format guardrails run first: Shorts and live/upcoming streams are blocked before other decisions. Non-embeddable source candidates are rejected before normal video persistence.
2. Exact parent video decisions apply next. A specific video decision can override an automated result or a broader blocked/review-first channel decision.
3. Channel decisions apply next: `review_first` forces review, `blocked` blocks, and `approved` becomes a strong positive scoring signal.
4. Stored automated moderation reviews are reused when no newer channel decision changes the context.
5. Unknown videos are scored by deterministic rules.

When a parent changes a channel decision, KidView re-scores all known videos for that channel so stale automated reviews can reflect the new household context.

Scoring starts at `50`, then adjusts up or down:

- `+10` safe category terms, such as science, nature, animals, art, rockets, or behind-the-scenes.
- `+12` educational terms, such as explained, tutorial, lesson, facts, beginner, math, or history.
- `+8` clear child-friendly intent, such as for kids, simple, easy, lesson, tutorial, or facts.
- `+12` official/source-backed channel terms, such as official, BBC, NASA, PBS, museum, university, studio, or Pixar.
- `+20` household-approved channel.
- `+6` reasonable duration, currently 2 to 15 minutes.
- View count signal: `+10` at 1,000,000+, `+6` at 100,000+, `+2` at 10,000+.
- Low view count from unknown channels is negative: `-5` at 1,000 to 9,999 views, `-15` below 1,000 views.
- `-18` risky or ambiguous terms, such as scary, secrets, drama, prank, challenge, dangerous, unboxing, shopping, gaming, or Minecraft.
- `-40` severe risk terms, such as self-harm, sexual content, gore, weapons, poison, toxins, rooftops, or skyscrapers.
- `-20` clickbait title patterns.
- `-8` creator-style channel name patterns.
- `-14` very long videos, currently over 30 minutes.
- Completed livestream recordings subtract points and usually stay in review unless trusted-channel signals are strong.
- Missing description or publication date also subtracts points.

The confidence score is the final score divided by `100`, clamped between `0.05` and `0.99`. For example, a final score of `78` becomes confidence `0.78`.

Decision thresholds:

- Severe risk flag: `block`.
- Approved channel with no clickbait and no risky/ambiguous topic: `allow`; completed livestream recordings also need a strong score.
- Score `78+` with no risk tags: `allow`; completed livestream recordings can also allow at this level when the channel is approved and the completed-live tag is the only risk tag.
- Score `70+` without clickbait: `allow_limited`.
- Score `45+`: `review`.
- Anything lower: `unknown`.

Child search results include `allow` decisions plus any `allow_limited` decisions permitted by the child profile. The default `allow_limited_policy` is `block`, so limited-access videos remain hidden unless the profile changes.

When `limited_frequency` is selected for a child profile, KidView allows at most one limited result per search, only after normal `allow` results are considered, and only when the limited candidate is above the profile confidence threshold. The default `allow_limited_min_confidence` is `0.70`.

The four limited-access modes have distinct behavior:

- `block`: hide automated `allow_limited` results and do not add them to the review queue.
- `review`: hide automated `allow_limited` results and add them to the review queue.
- `allow`: treat `allow_limited` results as child-visible candidates without adding them to review.
- `limited_frequency`: allow at most one qualifying limited result after normal allowed results, without adding unselected limited results to review.

`review` and `unknown` moderation outcomes remain parent-facing review items. Hard-blocked items are filtered out of child results and do not create normal parent review queue items. Durable parent video decisions resolve existing review items rather than repeatedly asking the parent to review the same decision.

Search audit detail pages record profile-policy reasons for limited videos, such as `shown_allow_limited_profile_policy` and `hidden_allow_limited_profile_policy`.

Parent-facing pages translate stored moderation and audit codes through `app/services/displayLabels.js`. Keep database values stable and inspectable for debugging, then add or adjust parent-readable labels in that helper. The helper is locale-shaped so future localization can add another locale map without changing the underlying decision or audit schema.

Live status is tracked as `none`, `upcoming`, `live`, or `completed_live`. In v1, `live` and `upcoming` streams are hard-blocked because KidView cannot assess changing real-time content before the child watches it, and approved channels or durable video approvals do not override that block. These hard-blocked streams do not create normal parent review queue items by default. Completed livestream recordings may be reviewed or allowed later, especially when they come from trusted channels and the rest of the score is strong.

## Parent Review Queue Model

KidView keeps global source data separate from household workflow state:

- `videos` and `channels` are source-cache tables shared across households.
- `moderation_reviews` stores the latest moderation result for a household/video pair.
- `household_review_items` stores parent-actionable review queue items for one household.
- Durable parent choices still live in `household_video_decisions` and `household_channel_decisions`.

The parent review page shows pending `review` and `unknown` items, plus automated `allow_limited` items when the child profile policy is `review`. Hard blocks are not normal review queue items: Shorts, non-embeddable videos, live/upcoming streams, blocked channels, and durable household block decisions are filtered or resolved outside the queue. They remain visible in search audit history so a parent can understand the decision and later create a specific video exception where the format guardrails permit one.

Approving or blocking a video resolves the pending review item and writes the durable household video decision. Ignoring a video or clearing the queue marks pending items as `dismissed` for the current household only; it does not delete videos, channels, moderation reviews, search history, or parent decisions. If a child searches for the same dismissed video again later, KidView may create a new pending review item unless a durable household video/channel decision already applies.

For the parent-facing vocabulary behind search audit, review queue, decision, and tag values, see [KidView Audit Vocabulary](docs/audit-vocabulary.md).

## Manual Validation Checklist

For browser-level validation after running the automated regression suite:

1. Run migrations from a clean temporary database:

   ```sh
   DATABASE_PATH=/private/tmp/kidview-clean-check.sqlite npm run db:migrate
   ```

2. Reset and seed the local development database:

   ```sh
   npm run db:reset
   ```

3. Start with fixture data:

   ```sh
   VIDEO_SOURCE=mock npm run dev
   ```

4. Search as a child for `science`, `animation`, `drama`, and `otters`.
5. Confirm child-visible results are capped at three and use local category icons.
6. Confirm hard-blocked items, Shorts, live/upcoming streams, review, and unknown items do not appear to children. Confirm `allow_limited` follows the selected child profile policy.
7. Confirm a zero-result child search appears in `/parent/searches` when the zero-result view is selected.
8. Open the audit detail page and confirm candidates are grouped into shown, review, hidden, hard-blocked, and limited sections.
9. Confirm `/parent/decisions` still allows editing video and channel decisions.
10. Confirm moderation explanations display read-only and do not prefill editable parent notes.
11. Inspect the database enough to confirm raw YouTube API responses, transcripts, and thumbnails are not persisted.

Useful searches to try with the YouTube source:

- `otter facts for kids` should usually auto-allow clear educational results from reputable channels.
- `how rockets work for kids` should usually auto-allow or allow limited when the result is clearly educational.
- `paper airplane tutorial` should usually auto-allow calm tutorial results.
- `Harry Potter behind the scenes official` should favor official/studio-style results, while still reviewing risky or rumor-style titles.
- `mystery box unboxing` should usually go to review.
- `funny shorts` should be blocked when the returned item is a Short.
- `live stream gaming` should be blocked when the returned item is currently live or upcoming.
- `scary Harry Potter secrets` should usually go to review or block depending on the returned metadata.
- `prank challenge` should usually go to review or unknown.

After pulling schema changes for rule-based moderation, run:

```sh
npm run db:migrate
```

Switch back to fixture mode at any time with:

```sh
VIDEO_SOURCE=mock
```

Then restart the app.

## Planned Features

- Parent profile and policy controls: wire the policy service into household-owned policy profile and per-child settings forms.
- Search-audit override actions: let a parent create an exact video decision directly from an audited candidate while preserving format guardrails.
- Safe playback and usage accounting: replace placeholder watch pages with embedded playback and add the watch events needed to enforce future daily limits.

## Useful Scripts

- `npm run dev` starts the app with Node's watch mode.
- `npm start` starts the app normally.
- `npm run pm2:start` starts KidView through PM2 using `ecosystem.config.js`.
- `npm run pm2:restart` restarts the PM2-managed KidView process.
- `npm run pm2:stop` stops the PM2-managed KidView process.
- `npm run pm2:status` shows PM2 status for KidView.
- `npm run pm2:logs` tails KidView PM2 logs.
- `npm run db:migrate` applies plain SQL migrations.
- `npm run db:seed` creates one demo household, parent, and child.
- `npm run db:reset` removes the local SQLite database, reruns migrations, and reseeds.

## PM2

KidView can be managed with PM2 using the checked-in `ecosystem.config.js` file:

```sh
pm2 --version
npm run pm2:start
npm run pm2:restart
npm run pm2:status
npm run pm2:logs
```

The PM2 app is named `kidview`, binds to `127.0.0.1:3002`, and writes local logs under `logs/`. The npm PM2 scripts set `PM2_HOME=.pm2` so PM2 runtime files stay inside the project workspace. PM2 should be installed globally on the machine, or added as a dev dependency later with `npm install --save-dev pm2` when npm network access is available.
