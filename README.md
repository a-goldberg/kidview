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
- The schema has explicit flags for Shorts and livestreams.
- Blocked-video reasons are stored only for parent-facing decisions and reviews.
- Transcript text is not stored by default.
- Search uses either mock database candidates or a YouTube Data API source adapter behind the same internal service boundary.
- YouTube responses are normalized into KidView candidate records. Raw YouTube API responses and transcript text are not stored by default.
- Blocked, pending-review, unknown, Short, and livestream candidates are not shown to children.

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

   - `science` shows currently approved/limited educational candidates.
   - `animation` starts hidden until a parent approves the Pixar sample.
   - `drama` stays hidden because it requires review.
   - `otters` shows through an approved channel decision.

   Child results should show at most three cards. They use local category icons and link to KidView placeholder video pages.

4. Log in at `http://localhost:3002/auth/login`.

5. Visit `http://localhost:3002/parent/reviews`.

The review page demonstrates `allow`, `allow_limited`, `review_required`, `block`, `review`, `unknown`, Short, livestream, and channel decision cases. Parent notes remain parent-facing.

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
- no livestreams
- no non-embeddable videos
- no blocked channels
- at most three child-visible results
- blocked, review, and unknown items stay out of the child UI

Fresh YouTube candidates are evaluated by a deterministic `rule-based-v1` moderation layer. It uses title, description, channel title, duration, livestream/Short flags, embeddability, publication date, and view count. It does not use OpenAI, transcripts, thumbnails, or raw YouTube response storage.

The rule layer can auto-allow probably-safe educational/source-backed videos, but hard blocks still win:

- Shorts are blocked.
- Livestreams and livestream-originated videos are blocked.
- Non-embeddable videos are blocked before child display.
- Blocked channels are blocked.
- Parent video decisions override automated decisions unless a hard block applies.
- Parent channel approvals can allow videos unless severe title/content flags appear.

In development mode, the server logs how many YouTube candidates were returned, hard rejected, auto-allowed, sent to review, blocked/unknown, and shown to the child.

## Rule-Based Moderation Scoring

KidView currently uses `rule-based-v1` in `app/services/moderationService.js`. It is deterministic and intentionally inspectable. It does not call OpenAI, fetch transcripts, use thumbnails, or store raw YouTube responses.

Moderation runs in this order:

1. Hard filters run first: Shorts, livestreams/livestream-originated videos, and blocked channels are blocked before scoring.
2. Parent video decisions override automated decisions unless a hard filter applies.
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
- `-18` risky or ambiguous terms, such as scary, secrets, drama, prank, challenge, unboxing, shopping, gaming, or Minecraft.
- `-40` severe risk terms, such as self-harm, sexual content, gore, weapons, poison, dangerous stunts, rooftops, or skyscrapers.
- `-20` clickbait title patterns.
- `-8` creator-style channel name patterns.
- `-14` very long videos, currently over 30 minutes.
- Missing description or publication date also subtracts points.

The confidence score is the final score divided by `100`, clamped between `0.05` and `0.99`. For example, a final score of `78` becomes confidence `0.78`.

Decision thresholds:

- Severe risk flag: `block`.
- Approved channel with no clickbait and no risky/ambiguous topic: `allow`.
- Score `78+` with no risk tags: `allow`.
- Score `70+` without clickbait: `allow_limited`.
- Score `45+`: `review`.
- Anything lower: `unknown`.

Child search results currently include only `allow` decisions. `allow_limited`, `review`, `block`, and `unknown` stay parent-facing.

Useful searches to try with the YouTube source:

- `otter facts for kids` should usually auto-allow clear educational results from reputable channels.
- `how rockets work for kids` should usually auto-allow or allow limited when the result is clearly educational.
- `paper airplane tutorial` should usually auto-allow calm tutorial results.
- `Harry Potter behind the scenes official` should favor official/studio-style results, while still reviewing risky or rumor-style titles.
- `mystery box unboxing` should usually go to review.
- `funny shorts` should be blocked when the returned item is a Short.
- `live stream gaming` should be blocked when the returned item is live or livestream-originated.
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

- Parent decision history: add a parent-facing page for searching, filtering, and editing prior video and channel decisions. This should make it easy to recover from mistakes such as accidentally blocking a video or approving the wrong channel.
- Review queue continuity: update parent review actions so submitting a decision does not jump the reviewer back to the top of a long queue. Prefer a small vanilla JavaScript progressive enhancement that records the decision without a full page refresh, with a non-JavaScript fallback that preserves scroll position or returns to the reviewed item.

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
