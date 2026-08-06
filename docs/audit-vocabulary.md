# KidView Audit Vocabulary

This glossary lists the values KidView currently stores or displays in parent search audit and review flows. Keep this vocabulary small and parent-readable where possible. Internal storage codes are included here so future UI labels can map them to clearer language.

Parent-facing EJS views should display these values through `app/services/displayLabels.js` instead of printing raw storage codes. The current map is English-only, but it is structured by locale so future localization can add alternate labels without changing stored audit or decision values.

## Search Audit Fields

| Field | Possible values | Meaning |
| --- | --- | --- |
| `source_mode` | `mock` | Search used local seeded/mock candidate data. |
| `source_mode` | `youtube` | Search used the YouTube Data API adapter, then normalized candidates into KidView records. |
| `source_mode` | `unknown` | Display fallback when older or incomplete audit rows do not have a stored source. |
| `final_decision` | `allow` | Eligible for child display, subject to the child result cap of three. |
| `final_decision` | `allow_limited` | Limited-access state whose visibility and review routing follow the child profile policy. |
| `final_decision` | `review` | Needs parent review before child display. |
| `final_decision` | `block` | Blocked by a hard rule, parent decision, channel decision, or severe-risk moderation result. |
| `final_decision` | `unknown` | KidView did not have enough confidence/context to show the video. |
| `shown_to_child` | `0`, `1` | Whether this exact candidate appeared in the child result list for that search. |
| `visibility_reason_code` | `shown_allow` | Candidate was shown because it was allowed within the result cap. |
| `visibility_reason_code` | `shown_parent_video_override` | Candidate was shown because an exact parent video decision overrode a broader channel or moderation decision. |
| `visibility_reason_code` | `shown_allow_limited_profile_policy` | Candidate was shown because child profile policy made `allow_limited` child-visible. |
| `visibility_reason_code` | `hidden_allow_limited_profile_policy` | Candidate was hidden because child profile policy did not make `allow_limited` child-visible. |
| `visibility_reason_code` | `hidden_result_limit` | Candidate was otherwise eligible but hidden by the three-result cap. |
| `visibility_reason_code` | `hidden_review_required` | Candidate requires parent review before child display. |
| `visibility_reason_code` | `hidden_blocked` | Candidate was blocked for child search. |
| `visibility_reason_code` | `hidden_unknown` | Candidate lacked enough confidence/context for child display. |
| `visibility_reason_code` | `hidden_not_child_visible:<policy>` | Fallback for hidden candidates that did not match a more specific visibility code. |
| `visibility_reason_code` | `source_filter:not_embeddable` | Candidate was hidden before persistence because it was not embeddable. |
| `moderation_source` | `source_filter` | Rejected before local video persistence, currently for non-embeddable YouTube candidates. |
| `moderation_source` | `hard_filter` | Blocked by a format guardrail or a household blocked-channel decision. An exact video decision may override the channel decision, but not a format guardrail. |
| `moderation_source` | `parent_video_decision` | A durable household video decision decided the outcome. |
| `moderation_source` | `parent_channel_decision` | A durable household channel decision decided the outcome. |
| `moderation_source` | `stored_moderation_review` | Existing moderation review data was reused. |
| `moderation_source` | `rule_based` | Current rule-based scoring decided the outcome. |
| `parent_decision_source` | `video` | A household video decision affected the result. |
| `parent_decision_source` | `channel` | A household channel decision affected the result. |
| `parent_decision_source` | empty | No parent decision affected the result. |
| `parent_decision_affected` | `0`, `1` | Boolean audit flag for whether a video/channel decision affected the result. |

## Visibility Reasons

These are parent-facing explanation strings stored per audited candidate.

| Decision/state | Current wording |
| --- | --- |
| Shown `allow` candidate | `Shown because moderation resolved this candidate as allowed within the child result limit.` |
| Shown exact video exception | `Shown because a parent allowed this specific video, overriding the broader channel or moderation decision.` |
| Hidden `allow` candidate | `Hidden because the child result limit had already been reached.` |
| Shown `allow_limited` candidate | `Shown because this child profile allows limited-access videos under the current profile policy.` |
| Hidden `allow_limited` candidate | `Hidden because this child profile does not make limited-access videos child-visible.` |
| Hidden `review` candidate | `Hidden because this candidate requires parent review before child display.` |
| Hidden `block` candidate | `Hidden because this candidate is blocked for child search.` |
| Hidden `unknown` candidate | `Hidden because KidView did not have enough confidence to show it.` |
| Fallback hidden state | `Hidden because it was not eligible for child display.` |
| Source-filtered candidate | `Hidden because the source candidate could not be safely embedded in KidView.` |

## Search Audit Groups

| Group key | Parent label | How candidates enter the group |
| --- | --- | --- |
| `shown` | Shown to child | `shown_to_child` is true. |
| `review` | Pending parent review / parent-actionable | Candidate created or matched a pending review item, or the final decision is `review`. |
| `hard_block` | Hidden by hard block | Candidate has a `hard_block_reason`, unless it is grouped as a parent block first. |
| `parent_block` | Hidden by parent block decision | A parent decision affected the result and the final decision is `block`. |
| `unknown` | Hidden because unknown / low confidence / not child-visible | Fallback group for hidden candidates that are not review, hard block, parent block, or limited. |
| `allow_limited` | Hidden because allow_limited | Final decision is `allow_limited` and the item was not child-visible. |

## Child Profile allow_limited Policy

These values live on `child_profiles.allow_limited_policy`. The current default is `block`; parent-facing profile controls have not been wired yet.

| Policy | Meaning |
| --- | --- |
| `block` | Automated `allow_limited` candidates are hidden and are not added to the review queue. This is the default. |
| `review` | Automated `allow_limited` candidates remain hidden and are added to the parent review queue. |
| `allow` | `allow_limited` candidates can be child-visible like `allow` candidates and are not added to review. Format guardrails still apply. |
| `limited_frequency` | At most one `allow_limited` candidate can fill an open result slot after normal `allow` results are considered, and only when its confidence is above `child_profiles.allow_limited_min_confidence`. This mode does not create review items merely because a limited candidate was not selected. |

The default `allow_limited_min_confidence` is `0.70`. This threshold only matters for `limited_frequency`.

## Review Queue State

| `review_queue_state` | Meaning |
| --- | --- |
| `created_pending` | This search created a pending parent review item. |
| `matched_pending` | A pending parent review item already existed and was updated/matched. |
| `resolved` | A pending review item existed but was resolved because the latest decision no longer belongs in the queue. |
| `none` | No review item was created, matched, or resolved. Used explicitly for source-filtered candidates. |
| empty | No queue state was returned for this candidate. Treat like `none` in parent UI. |

## Review Item Status

These values live on `household_review_items.status`.

| Status | Meaning |
| --- | --- |
| `pending` | Parent-actionable item currently shown in the review queue when it still matches queue rules. |
| `dismissed` | Parent cleared the item without creating a durable allow/block decision. |
| `approved` | Parent resolved the item with a video decision that is not `block`. |
| `blocked` | Parent resolved the item with a video `block` decision. |
| `expired` | KidView resolved the item because the latest moderation/decision state means it no longer belongs in the queue. |

## Moderation Review Status

These values live on `moderation_reviews.status` and/or `moderation_reviews.decision`.

| Status/decision | Meaning |
| --- | --- |
| `pending` | Legacy/initial state for review rows that have not been resolved. |
| `allow` | Moderation or parent review considers the item allowed. |
| `allow_limited` | Limited approval state. Visibility and review routing follow the child profile policy. |
| `review` | Needs parent review before child display. |
| `block` | Blocked by moderation or parent review. |
| `unknown` | Not enough confidence/context to show the item. |

## Queue Reason Codes

These codes appear in `search_event_candidates.review_queue_reason_code` and/or `household_review_items.reason_code`.

| Code pattern | Meaning |
| --- | --- |
| `allow_limited` | Candidate is parent-actionable because moderation returned `allow_limited` while the child profile policy was `review`. |
| `review` | Candidate is parent-actionable because moderation returned `review`. |
| `unknown` | Candidate is parent-actionable because moderation returned `unknown`. |
| `auto_allowed_by_moderation` | Pending item was resolved because moderation now allows the video. |
| `not_review_queue:<decision>` | Pending item was resolved because the latest decision is not review-queue eligible. Example: `not_review_queue:block`. |
| `profile_policy:block` | Automated `allow_limited` candidate was hidden and excluded from review by child profile policy. |
| `profile_policy:allow` | Automated `allow_limited` candidate was handled as child-visible by child profile policy. |
| `profile_policy:limited_frequency` | Automated `allow_limited` candidate was handled by the limited-frequency selection policy. |
| `hard_block:<tag>` | Pending item was resolved because a hard block now applies. Example: `hard_block:short`. |
| `durable_video_decision:<decision>` | Pending item was resolved because a household video decision now applies. |
| `durable_channel_decision:blocked` | Pending item was resolved because the household blocked the channel. |
| `source_filter:not_embeddable` | Source candidate was not persisted because it was not embeddable. |
| `parent_decision:<decision>` | Parent action resolved a pending review item through a video decision. |
| `parent_cleared` | Parent manually cleared pending video items from the review queue. |
| `parent_ignored` | Parent ignored one pending video item without making a durable video decision. |
| `parent_cleared_channel` | Parent cleared pending review videos for unreviewed visible channels. |
| `queue_noise_cleanup` | Migration cleanup expired queue items that no longer matched current queue rules. |

## Parent Decision Values

| Table/field | Values | Meaning |
| --- | --- | --- |
| `household_video_decisions.decision` | `allow` | Parent allows this exact video for the household. This overrides automated and broader channel decisions, but not format guardrails. |
| `household_video_decisions.decision` | `allow_limited` | Parent marks the exact video as limited. Child visibility follows the active child profile policy. |
| `household_video_decisions.decision` | `review_required` | Parent keeps/requires review before child display. |
| `household_video_decisions.decision` | `block` | Parent blocks this video for the household. |
| `household_channel_decisions.decision` | `approved` | Channel is trusted as a positive scoring signal. |
| `household_channel_decisions.decision` | `review_first` | Videos from this channel must go to review before child display. |
| `household_channel_decisions.decision` | `blocked` | Videos from this channel are blocked for the household. |

## General Video Labels

These labels are stored on `videos.labels_json` and can appear in child-safe cards, review cards, and decision history.

| Label | Assigned when |
| --- | --- |
| `short` | Candidate is marked as a Short. |
| `live` | Candidate is currently live. |
| `upcoming-live` | Candidate is an upcoming livestream. |
| `completed-live` | Candidate is a completed livestream recording. |
| `not-embeddable` | Candidate cannot be embedded. YouTube source candidates with this trait are not persisted as normal video rows. |
| `learning` | Text includes learning-oriented terms such as math, fraction, science, nature, history, animation, or biology. |
| `needs-care` | Text includes higher-risk terms such as dangerous, stunt, weapon, flamethrower, poison, or toxin. |
| `high-stimulation` | Text includes toy, slime, surprise, mystery, `won't believe`, or `do not try`. |

## Moderation Content Tags

| Tag | Assigned when |
| --- | --- |
| `safe-category` | Text matches a generally safe category pattern such as science, math, nature, animal, rocket, art, craft, behind-the-scenes, official, or studio. |
| `educational` | Text matches educational language such as explained, tutorial, lesson, learn, beginner, history, math, fraction, biology, nature, or paper airplane. |
| `clear-child-friendly-intent` | Text suggests child-friendly intent, such as for kids, beginner, simple, easy, lesson, tutorial, or facts. |

## Moderation Quality Tags

| Tag | Assigned when |
| --- | --- |
| `official-or-source-backed-channel` | Channel title looks source-backed, such as official, PBS, Smithsonian, museum, National Geographic, NASA, studio, Pixar, BBC, academy, library, or university. |
| `household-approved-channel` | Household has an `approved` channel decision for the channel. |
| `reasonable-duration` | Duration is between 2 and 15 minutes. |
| `established-view-history` | View count is at least 100,000. |
| `healthy-views-per-day` | Estimated views per day is at least 500. |
| `parent-video-decision` | A durable household video decision controlled the result. |

## Moderation Risk Tags

| Tag | Assigned when |
| --- | --- |
| `short` | Hard filter blocked a Short. |
| `live` | Hard filter blocked a currently live stream. |
| `upcoming` | Hard filter blocked an upcoming livestream. |
| `blocked-channel` | Hard filter blocked a channel the household blocked. |
| `not-embeddable` | Source filter blocked a non-embeddable candidate before persistence. |
| `channel-review-first` | Household channel decision requires review first. |
| `risky-or-ambiguous-topic` | Text matches risk/ambiguity terms such as scary, secrets, drama, prank, challenge, dangerous, mystery box, gaming, Minecraft, Roblox, Fortnite, or dark fantasy. |
| `severe-risk-flag` | Text matches severe risk terms such as self-harm, sexual content, gore, murder, weapons, poison, toxins, rooftop, or skyscraper. |
| `clickbait-title` | Title matches clickbait patterns such as `!!!`, `you won't believe`, `watch until the end`, shocking, or insane. |
| `creator-style-channel` | Channel name looks like a creator/gaming/vlog channel pattern. |
| `very-long-video` | Duration is over 30 minutes. |
| `completed-live-recording` | Candidate is a completed livestream recording. |
| `missing-description` | Candidate has no description. |
| `missing-published-date` | Candidate has no valid publish date. |
| `very-low-view-unknown-channel` | Unknown channel with fewer than 1,000 views. |
| `limited-view-unknown-channel` | Unknown channel with fewer than 10,000 views. |

## Count Fields

| Field | Meaning |
| --- | --- |
| `source_candidate_count` | Number of candidates returned by the active source adapter. |
| `hard_blocked_count` | Source hard rejections plus moderation hard filters. |
| `sent_to_review_count` | Count of candidates that created or matched a pending review item. Automated `allow_limited` counts only when the child profile policy is `review`. |
| `allowed_count` | Count of candidates with final decision `allow`. This may be higher than shown count if more than three are allowed. |
| `allow_limited_count` | Count of candidates with final decision `allow_limited`. |
| `unknown_count` | Count of candidates with final decision `unknown`. |
| `blocked_count` | Count of candidates with final decision `block`. |
| `shown_to_child_count` | Number of child-visible results shown for the search. Capped at three. |

## Policy Configuration Fields

| Field | Meaning |
| --- | --- |
| `policy_profiles.max_results` | Child-visible result cap for children assigned to the profile. Valid values are 1 through 3. |
| `child_profiles.allow_limited_policy` | Controls visibility and review routing for `allow_limited` candidates. |
| `child_profiles.allow_limited_min_confidence` | Confidence threshold used by `limited_frequency`. |
| `child_profiles.daily_search_limit` | Future daily search limit. `NULL` means unlimited; not enforced in this milestone. |
| `child_profiles.daily_video_watch_limit` | Future daily video watch limit. `NULL` means unlimited; not enforced in this milestone. |

The initial schema fields `policy_profiles.allow_shorts` and `policy_profiles.allow_livestreams` are inactive scaffolding. They are not read by the policy service and should not be exposed as normal parent controls. Shorts and live/upcoming streams remain format guardrails.
