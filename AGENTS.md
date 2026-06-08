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

## Additional Development Workflow Specifications

Before making the first changes in a new chat, inspect the repo and summarize the current structure. Then propose the smallest safe implementation plan. Wait for approval before editing more than 5 files.

When large changes are called for in response to a user request, aim to implement in small commits. After each logical phase, stop and summarize what changed, how to test it, and any risks or assumptions.

Following any signficant code changes involving creation of new routes, pages, components, etc., review the current working branch as a senior Node/Express developer. Focus on security, simplicity, maintainability, and whether the codebase is understandable for a technical non-developer. Identify specific improvements and explain why they matter.

When reviewing the project (e.g., after large code changes or branch merges), find places where this codebase violates its own conventions. Look for duplicate CSS patterns, inconsistent route naming, unused dependencies, hard-coded project data, and anything that would make future project additions harder.
