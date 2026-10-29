const db = require('../db/database');
const { accountInput, passwordHash } = require('./parentAccountService');

// Operator-only provisioning. Never clone a household or derive fixtures from
// production rows. A separate source namespace avoids changing the real catalog.
function provisionDemo({ email, password, disable = false }) {
  const input = accountInput({ email, displayName: 'Demo visitor', role: 'parent' });
  const hash = disable ? null : passwordHash(password);
  return db.transaction(() => {
    const existing = db.prepare(`SELECT p.id, p.household_id, h.is_demo FROM parent_users p
      JOIN households h ON h.id = p.household_id WHERE lower(p.email) = ?`).get(input.email);
    if (existing && !existing.is_demo) throw new RangeError('That email address is unavailable.');
    if (disable) {
      if (!existing) throw new RangeError('Demo account not found.');
      db.prepare(`UPDATE parent_users SET is_active = 0, session_version = session_version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
      return existing.household_id;
    }
    let household = db.prepare('SELECT id FROM households WHERE is_demo = 1').get();
    if (!household) household = { id: Number(db.prepare("INSERT INTO households (name, is_demo) VALUES ('Public demo household', 1)").run().lastInsertRowid) };
    let parentId = existing && existing.id;
    if (parentId) {
      db.prepare(`UPDATE parent_users SET password_hash = ?, role = 'parent', is_active = 1,
        session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND household_id = ?`)
        .run(hash, parentId, household.id);
    } else {
      parentId = Number(db.prepare(`INSERT INTO parent_users (household_id, email, password_hash, display_name, role)
        VALUES (?, ?, ?, 'Demo visitor', 'parent')`).run(household.id, input.email, hash).lastInsertRowid);
    }
    // Provision fixtures once. Re-running rotates credentials without duplicating
    // or resetting any rows; the web application never writes this household.
    if (db.prepare('SELECT id FROM child_profiles WHERE household_id = ?').get(household.id)) return household.id;
    const policyId = db.prepare(`INSERT INTO policy_profiles (household_id, name, description, max_results)
      VALUES (?, 'Sample learning policy', 'Synthetic demo policy.', 3)`).run(household.id).lastInsertRowid;
    const childId = db.prepare(`INSERT INTO child_profiles (household_id, policy_profile_id, display_name, birth_year)
      VALUES (?, ?, 'Sample child', 2018)`).run(household.id, policyId).lastInsertRowid;
    const channelId = db.prepare(`INSERT INTO channels (source, external_id, title)
      VALUES ('demo', 'synthetic-learning-channel', 'Sample learning channel')`).run().lastInsertRowid;
    const fixtures = [
      { key: 'paper-bridges', title: 'Sample: building paper bridges', decision: 'allow' },
      { key: 'kitchen-science', title: 'Sample: kitchen science with a grown-up', decision: 'review' },
      { key: 'unsafe-stunt', title: 'Sample: a stunt that needs safer choices', decision: 'block' }
    ];
    const videoIds = fixtures.map(fixture => Number(db.prepare(`INSERT INTO videos
      (channel_id, source, external_id, title, description, duration_seconds, primary_category,
       icon_key, confidence_score, child_explanation, parent_explanation)
      VALUES (?, 'demo', ?, ?, 'Synthetic demonstration content. No real video is attached.',
        420, 'Science', 'science', 0.95, 'Explore a sample learning idea.', 'Synthetic demonstration decision.')`)
      .run(channelId, fixture.key, fixture.title).lastInsertRowid));
    const searchId = db.prepare(`INSERT INTO search_events
      (household_id, child_profile_id, query, original_query, shown_video_ids_json, result_count,
       source_mode, source_candidate_count, shown_to_child_count, allowed_count, sent_to_review_count, blocked_count)
      VALUES (?, ?, 'sample science', 'sample science', ?, 1, 'demo', 3, 1, 1, 1, 1)`)
      .run(household.id, childId, JSON.stringify([videoIds[0]])).lastInsertRowid;
    fixtures.forEach((fixture, index) => {
      const videoId = videoIds[index];
      db.prepare(`INSERT INTO moderation_reviews
        (household_id, video_id, status, decision, parent_facing_reason, parent_explanation, confidence_score)
        VALUES (?, ?, ?, ?, 'Synthetic sample decision.', 'Synthetic sample explanation.', 0.95)`)
        .run(household.id, videoId, fixture.decision, fixture.decision);
      if (fixture.decision === 'review') {
        db.prepare(`INSERT INTO household_review_items (household_id, child_profile_id, video_id, status, reason_code)
          VALUES (?, ?, ?, 'pending', 'review')`).run(household.id, childId, videoId);
      } else {
        db.prepare(`INSERT INTO household_video_decisions
          (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
          VALUES (?, ?, ?, 'Synthetic sample parent decision.', ?)`)
          .run(household.id, videoId, fixture.decision, parentId);
      }
      db.prepare(`INSERT INTO search_event_candidates
        (search_event_id, household_id, child_profile_id, video_id, channel_id, source_rank,
         title, channel_title, final_decision, shown_to_child, visibility_reason,
         review_queue_state, review_queue_reason_code, moderation_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Sample learning channel', ?, ?, ?, ?, ?, 'demo')`)
        .run(searchId, household.id, childId, videoId, channelId, index + 1, fixture.title,
          fixture.decision, index === 0 ? 1 : 0, index === 0 ? 'shown' : fixture.decision,
          fixture.decision === 'review' ? 'created_pending' : null,
          fixture.decision === 'review' ? 'review' : null);
    });
    return household.id;
  })();
}

module.exports = { provisionDemo };
