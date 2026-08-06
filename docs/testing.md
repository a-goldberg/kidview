# Testing KidView

KidView has two complementary testing layers:

- **Automated regression tests** use Node's built-in `node:test` runner and a disposable SQLite database.
- **Manual fixture checks** give a parent-readable matrix for spot-checking behavior in the browser or with local scripts.

The goal is not to test every line of code. The goal is to protect the household safety rules, parent override behavior, review queue rules, and search audit trail from accidental regressions.

## Running Automated Tests

```sh
npm test
```

To run only the first regression suite:

```sh
npm run test:regression
```

The regression test creates a temporary database under the system temp directory, runs all migrations, seeds the demo household, and then exercises service-level behavior. It does not use the local development database in `data/kidview.sqlite`.

## Test Architecture

`test/regression.test.js` intentionally stays close to the product pipeline:

1. Set `DATABASE_PATH` and `VIDEO_SOURCE` before app modules are required.
2. Run `scripts/migrate.js` and `scripts/seed.js` against the temp DB.
3. Use `searchService.search()` for child-search behavior.
4. Inspect `search_events` and `search_event_candidates` to confirm the audit trail matches what the child actually saw.
5. Add a small number of test-only DB rows for edge cases that the seed data does not naturally cover.

This keeps tests useful without adding a new framework, a browser dependency, or a mock-heavy architecture.

## Regression Matrix

| Behavior | Fixture/search | Expected result |
| --- | --- | --- |
| Allowed result appears | Search `otters` | Sea otter result appears and total child results are at most 3. |
| More than 3 allowed results are capped | Test inserts five `capmatrix` videos with parent allow decisions | Search `capmatrix` shows exactly 3 results. |
| Policy result cap is enforced | Set assigned policy profile to 1 result; search `capmatrix` | Exactly 1 result appears, then the test restores the cap to 3. |
| Policy defaults and usage-limit persistence | Read and update the child policy | Daily limits default to unlimited and accept positive integer configuration values. |
| Policy writes are household-scoped | Attempt child/profile updates with the wrong household | No row changes and the service returns no updated record. |
| Parent video allow overrides moderation | Update seeded Rick Astley video decision to `allow`; search `Rick Astley` | Video appears despite normal moderation signals. |
| Parent video block hides result | Update Be Smart blue/nature video decision to `block`; search `blue rare nature` | Video is hidden. |
| Approved channel boosts result | Search `otters` | Deep Blue Science result is allowed and tagged with `household-approved-channel`. |
| Blocked channel hard-blocks result | Search `parkour` | Candidate is blocked by `hard_filter` and hidden. |
| Exact video allow overrides blocked channel | Allow the Parkour video specifically; search `parkour` | Video appears with `shown_parent_video_override` audit reason. |
| Review-first channel sends to review | Search `teen drama` | Candidate final decision is `review` and review queue reason is `review`. |
| Shorts blocked | Search `strict schedule` | Short candidate is blocked and hidden. |
| Live stream blocked | Search `lofi hip hop radio` | Live candidate is blocked and hidden. |
| Upcoming stream blocked | Test inserts an upcoming livestream; search `upcoming regression` | Upcoming candidate is blocked and hidden. |
| Format guardrails beat exact video allow | Allow the seeded Short specifically; search `strict schedule` | Short remains blocked and audited by `hard_filter`. |
| Completed-live needs strong signals | Search `ambient drone`; then insert a strong trusted completed-live science video | Weak recording is hidden; strong trusted recording can appear. |
| `allow_limited` follows profile visibility policy | Search `fractions` with profile policy `block`, then `limited_frequency` | Hidden by default; visible when profile policy permits one limited result. |
| `allow_limited` follows profile review routing | Exercise `block`, `review`, `allow`, and `limited_frequency` against an automated limited result | Only `review` creates a pending review item; child visibility follows each mode. |
| Zero-result searches appear in audit | Search `clickbait` | Search event exists with `shown_to_child_count = 0`. |
| Non-embeddable source candidate audited | Stub YouTube source with a non-embeddable candidate | Audit row is written with no normal persisted video row. |

## Manual Smoke Searches

After running the app locally, these searches should stay useful for parent-facing review:

| Search | Useful checks |
| --- | --- |
| `science` | Mix of allowed, limited, blocked, and reviewed science-like candidates. |
| `animation` | Child-safe creative results and unknown/new creator behavior. |
| `drama` | Review-first and risky/ambiguous content paths. |
| `otters` | Approved-channel boost and normal child-visible result. |
| `fractions` | `allow_limited` behavior and profile policy checks. |
| `clickbait` | Zero child-visible result audit trail. |

## What These Tests Do Not Cover Yet

- Full browser flows and visual regressions.
- Parent login/session behavior.
- Cross-household access-control probes.
- Real YouTube API responses.
- Future LLM/contextual moderation.
- Enforcement of configured daily search and watch limits.

Those are good candidates for later test layers. For now, keep this suite fast, local, and boring enough to run before most changes.
