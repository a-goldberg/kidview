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
- Comment all non-obvious logic, at least basic explanations of files, routes, functions, etc.
- Validate external API/model responses with zod where practical.
- Add setup notes to README whenever environment or run steps change.
- Don't add complexity just for the sake of "impressive" or cutting-edge programming. Where possible, avoid new frameworks, narrow-use libraries, microservices, containerization, slick UI animations that lack purpose, etc.

## Additional Development Workflow Specifications

Before making the first changes in a new chat, inspect the repo and summarize the current structure. Then propose the smallest safe implementation plan. Wait for approval before editing more than 5 files.

When large changes are called for in response to a user request, aim to implement in small commits. After each logical phase, stop and summarize what changed, how to test it, and any risks or assumptions.

Following any signficant code changes involving creation of new routes, pages, components, etc., review the current working branch as a senior Node/Express developer. Focus on security, simplicity, maintainability, and whether the codebase is understandable for a technical non-developer. Identify specific improvements and explain why they matter.

When reviewing the project (e.g., after large code changes or branch merges), find places where this codebase violates its own conventions. Look for duplicate CSS patterns, inconsistent route naming, unused dependencies, hard-coded project data, and anything that would make future project additions harder.

## User Interaction Preferences

Don't assume. If the user does not provide enough detail to confidently execute their request, then do not proceed. Finish processing and preparing a plan for responding, but ask the user for clarification before finalizing and executing that plan. Display a list of the ambiguous points or missing information, and then step through each one with interactive prompts, giving the user a chance to fill in the gaps. Only change code when you are confident in the user's intent and expected outcome.

## Feature & Bug Deferment

Often, the user might ask about the viability or feasibility of a new feature or change to the existing application logic. Unless the appropriate answer is short a straightforward, your response to such a query should be analytical, accurate, and reasonably objective, offering honest pros and cons, contextual debate, and considerations/perspectives the user may have missed. This isn't a "devil's advocate" situation or negativity/critique for the sake of it. Rather, you should help the user to select an approach that prioritizes security, simplicity, feasibility, long-term maintainability, and adherence to the stated goals & principles of the project thus far.

In the case where the user appears to agree or decide that some action should be taken, but does not instruct you to implement related changes at this time, consider the new feature, fix, or "thought experiment" as a new roadmap item. This includes phrases like, "Let's table this for now," "let's come back to this," "focus on the current task for now," "I'll want to work on that in the future," etc. If possible, track these plans, ideas, or intent as new issues in Gitgub with appropriate title & description, recording any relevant context, possible approaches, desired outcome, or anything else from the conversation that will help with reaching a conclusion or implementing the intended changes once the issue is picked back up in the future.

If for some reason, you cannot access the GitHub project or create GitHub issues, then just track these future plans in a new MD file (e.g., in the docs folder) created for this purpose. If there's any question about the user's intent, just ask directly if we should add that to the future roadmap.
