# KidView

KidView is a small Node.js, Express, and EJS web app for a household-controlled child video discovery gateway.

This first milestone is intentionally boring: it creates a local scaffold, SQLite schema, seed data, parent login, a parent dashboard placeholder, and a child search flow with capped mock results.

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
- Child search cards use category icons, not native YouTube thumbnails.
- The schema has explicit flags for Shorts and livestreams.
- Blocked-video reasons are stored only for parent-facing decisions and reviews.
- Transcript text is not stored by default.

## Useful Scripts

- `npm run dev` starts the app with Node's watch mode.
- `npm start` starts the app normally.
- `npm run db:migrate` applies plain SQL migrations.
- `npm run db:seed` creates one demo household, parent, and child.
- `npm run db:reset` removes the local SQLite database, reruns migrations, and reseeds.
