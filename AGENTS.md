# KidView Agent Instructions

KidView is a small, maintainable Node/Express/EJS app. Keep the codebase boring and readable.

## Preferred stack

- Node.js
- Express
- EJS
- Vanilla JavaScript
- Plain CSS
- SQLite with better-sqlite3
- Plain SQL migrations

## Avoid unless explicitly requested

- React
- Next.js
- TypeScript
- Docker
- Redis
- GraphQL
- Microservices
- Complex client-side state management
- Unnecessary build tooling

## Product rules

- The core data object is household, not user.
- All family-specific decisions must be scoped to household_id.
- Child profiles are not full login accounts.
- Child search results show at most three videos.
- Do not show native YouTube thumbnails in child UI.
- Do not allow Shorts.
- Do not allow livestreams.
- Do not show detailed blocked-content reasons to children.
- Parent decisions override model decisions.
- Do not store full transcripts by default.

## Development style

- Prefer clear file organization over clever abstractions.
- Keep route handlers thin; move logic into services.
- Comment non-obvious logic.
- Validate external API/model responses with zod where practical.
- Add setup notes to README whenever environment or run steps change.
