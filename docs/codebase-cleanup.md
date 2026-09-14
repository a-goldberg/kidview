# Codebase cleanup (September 13, 2026)

The cleanup preserves the Express/EJS/SQLite architecture and existing moderation scoring rules.  It addresses the code audit without adding product features.

## Completed

1. Versioned and fingerprinted automated moderation cache, preserving separate parent decisions.
2. Production configuration checks, explicit HTTPS origin and proxy trust, and safe demo seeding without password logging.
3. One complete candidate projection for source search, saved results, playback, and channel rechecks.
4. Same-origin checks on unsafe requests, including login.  Search creation uses POST and redirects to read-only saved results.
5. Separate login throttling and a documented, explicit production PM2 profile.
6. Patched transitive `qs` through a package override and synchronized lockfile metadata.
7. Provider request timeouts, response validation, page bounds, repeated-token detection, and candidate deduplication.
8. Validated decision inputs and accurate saved responses.  `review_required` no longer marks a review approved.
9. Atomic household moderation/queue/audit writes and atomic channel decisions/rechecks.
10. Child-scoped feedback and click attribution restricted to originally shown videos.
11. Migration 013 removes unused policy and clarification columns, preserving meaningful legacy clarification values in audit JSON.
12. Shared queue eligibility SQL and SQL aggregation of historical shown-video counts.
13. Removed inactive AI-category scaffolding, unused provider counts, misleading debug output, and unused icon CSS.  Editable and alternate artwork moved outside the static web root without being deleted.
14. Pure scoring extracted into its own module, and source presentation helpers shared with seed fixtures.
15. Added configuration, HTTP, migration, rollback, saved-result, pagination, and cache regression coverage.  Updated setup and audit documentation.

## Validation

- All 64 automated tests pass with disposable databases.
- The dependency audit reports zero known vulnerabilities.
- Compared 360 scoring cases against the pre-cleanup implementation: decisions, scores, tags, and explanations were unchanged.
- Upgraded a disposable backup of the existing local database through migrations 012 and 013.  All rows were preserved: 1,064 videos, 1,055 moderation reviews, 152 searches, 2,077 search candidates, 301 review items, two daily usage records, and three playback records.  SQLite integrity and foreign-key checks passed.
- Diff checks pass.

## Intentionally retained or not verified

- Historical moderation status/decision and explanation columns, preliminary source confidence fields, and `videos.transcript_stored` remain.  Some older records can contain distinct information; dropping these needs a separate data-consolidation decision.  The active decision path and shared query helpers make precedence explicit.
- Historical migrations, cached source records, resolved reviews, and search audit snapshots remain.  They still serve upgrade, parent-decision, or historical purposes.
- Metadata cache invalidation uses data already retrieved by the app.  It does not add a background re-fetch or extra YouTube request before playback.
- The public HTTPS proxy and real YouTube playback have not been tested as part of this cleanup.  HTTP tests simulate forwarded HTTPS and test server behavior.  Verify the actual proxy, secure cookies, and player when deploying.
- The patched `qs` override should be revisited once the upstream Express chain includes the patched release directly.
