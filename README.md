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

Fresh YouTube candidates will usually need parent review or household decisions before they appear to children. In development mode, the server logs how many YouTube candidates were returned and how many survived policy/moderation.

Useful searches to try with the YouTube source:

- `basic fractions for kids`
- `sea otters science`
- `how clouds make rain`
- `beginner animation for kids`

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
