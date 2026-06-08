const bcrypt = require('bcrypt');
const db = require('../app/db/database');
const config = require('../app/config');

const existingHousehold = db.prepare('SELECT id FROM households LIMIT 1').get();

if (existingHousehold) {
  console.log('Seed data already exists.');
  process.exit(0);
}

const passwordHash = bcrypt.hashSync(config.seedParentPassword, 12);

db.transaction(() => {
  const household = db
    .prepare('INSERT INTO households (name) VALUES (?)')
    .run('Demo Household');

  const policy = db
    .prepare(
      `INSERT INTO policy_profiles
        (household_id, name, description, max_results, allow_shorts, allow_livestreams)
       VALUES (?, ?, ?, 3, 0, 0)`
    )
    .run(
      household.lastInsertRowid,
      'Default Child Policy',
      'Shows at most three calm, approved discovery results.'
    );

  db.prepare(
    `INSERT INTO parent_users (household_id, email, password_hash, display_name)
     VALUES (?, ?, ?, ?)`
  ).run(household.lastInsertRowid, config.seedParentEmail, passwordHash, 'Demo Parent');

  db.prepare(
    `INSERT INTO child_profiles (household_id, policy_profile_id, display_name, birth_year)
     VALUES (?, ?, ?, ?)`
  ).run(household.lastInsertRowid, policy.lastInsertRowid, 'Demo Child', 2018);

  const parentUser = db.prepare('SELECT id FROM parent_users WHERE email = ?').get(config.seedParentEmail);

  const insertChannel = db.prepare(
    `INSERT INTO channels (source, external_id, title)
     VALUES ('mock', ?, ?)`
  );
  const insertVideo = db.prepare(
    `INSERT INTO videos (
      channel_id,
      source,
      external_id,
      title,
      description,
      duration_seconds,
      primary_category,
      icon_key,
      labels_json,
      confidence_score,
      child_explanation,
      parent_explanation,
      is_short,
      is_livestream
    )
    VALUES (?, 'mock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const channels = {
    curiousNest: insertChannel.run('channel-curious-nest', 'Curious Nest').lastInsertRowid,
    smallScience: insertChannel.run('channel-small-science', 'Small Science Lab').lastInsertRowid,
    tabletopArt: insertChannel.run('channel-tabletop-art', 'Tabletop Art Time').lastInsertRowid,
    loudArcade: insertChannel.run('channel-loud-arcade', 'Loud Arcade Clips').lastInsertRowid,
    liveNow: insertChannel.run('channel-live-now', 'Live Now Learning').lastInsertRowid
  };

  const videos = {
    allowedBirds: insertVideo.run(
      channels.curiousNest,
      'video-allowed-birds',
      'Nature Walk: Backyard Birds',
      'A quiet nature walk with bird calls, colors, and simple observation prompts.',
      480,
      'Animals',
      'animals',
      JSON.stringify(['nature', 'birds', 'calm']),
      0.96,
      'A calm nature video about noticing birds outside.',
      'Seeded as directly allowed for the demo household.',
      0,
      0
    ).lastInsertRowid,
    channelAllowedShadows: insertVideo.run(
      channels.smallScience,
      'video-channel-allowed-shadows',
      'Nature Science: Why Shadows Move',
      'A simple explanation of sunlight, trees, and changing shadows.',
      390,
      'Science',
      'science',
      JSON.stringify(['nature', 'science', 'sunlight']),
      0.91,
      'A simple science video about sunlight and shadows.',
      'Allowed through the Small Science Lab channel decision.',
      0,
      0
    ).lastInsertRowid,
    limitedLeaves: insertVideo.run(
      channels.smallScience,
      'video-limited-leaves',
      'Nature Science: How Leaves Drink',
      'A gentle look at stems, leaves, and water movement.',
      430,
      'Science',
      'science',
      JSON.stringify(['nature', 'plants', 'science']),
      0.88,
      'A gentle plant science video.',
      'Allowed with limits for the demo household.',
      0,
      0
    ).lastInsertRowid,
    blockedThunder: insertVideo.run(
      channels.curiousNest,
      'video-blocked-thunder',
      'Nature Storm Sounds at Night',
      'A dramatic storm sound compilation with sudden loud moments.',
      540,
      'Animals',
      'animals',
      JSON.stringify(['nature', 'storms', 'loud']),
      0.86,
      'A nature video about storms.',
      'Parent-facing reason: too intense for the demo child profile.',
      0,
      0
    ).lastInsertRowid,
    reviewOcean: insertVideo.run(
      channels.curiousNest,
      'video-review-ocean',
      'Nature Mystery: Deep Ocean Creatures',
      'A fascinating ocean animal video that needs a parent review first.',
      620,
      'Animals',
      'animals',
      JSON.stringify(['nature', 'ocean', 'review']),
      0.84,
      'An ocean animal video.',
      'Needs parent review because it mentions predator behavior.',
      0,
      0
    ).lastInsertRowid,
    reviewRequiredRocks: insertVideo.run(
      channels.tabletopArt,
      'video-review-required-rocks',
      'Nature Craft: Paint Story Rocks',
      'A craft activity using rocks, paint, and simple storytelling.',
      510,
      'Art',
      'art',
      JSON.stringify(['nature', 'crafts', 'unknown']),
      0.81,
      'A craft video about painted rocks.',
      'Parent marked this as review-required.',
      0,
      0
    ).lastInsertRowid,
    unknownMoss: insertVideo.run(
      channels.curiousNest,
      'video-unknown-moss',
      'Nature Close-Up: Moss and Tiny Forests',
      'A quiet close-up video that has not received a parent decision yet.',
      450,
      'Science',
      'science',
      JSON.stringify(['nature', 'plants', 'unknown']),
      0.79,
      'A quiet plant observation video.',
      'No household decision has been made yet.',
      0,
      0
    ).lastInsertRowid,
    shortAnts: insertVideo.run(
      channels.curiousNest,
      'video-short-ants',
      'Nature Short: Ants Build Fast',
      'A short-form clip about ants.',
      42,
      'Animals',
      'animals',
      JSON.stringify(['nature', 'shorts']),
      0.78,
      'A quick animal clip.',
      'Filtered because Shorts are not allowed.',
      1,
      0
    ).lastInsertRowid,
    liveSpace: insertVideo.run(
      channels.liveNow,
      'video-live-space',
      'Nature Live: Night Sky Watch',
      'A livestream-style sky watching session.',
      7200,
      'Science',
      'science',
      JSON.stringify(['nature', 'livestream']),
      0.77,
      'A live sky watch.',
      'Filtered because livestreams are not allowed.',
      0,
      1
    ).lastInsertRowid,
    blockedChannel: insertVideo.run(
      channels.loudArcade,
      'video-channel-blocked',
      'Nature Game: Loud Forest Chase',
      'Fast arcade gameplay with loud effects and forest graphics.',
      580,
      'General',
      'general',
      JSON.stringify(['nature', 'games', 'loud']),
      0.76,
      'A game video with forest scenes.',
      'Blocked through the Loud Arcade Clips channel decision.',
      0,
      0
    ).lastInsertRowid
  };

  db.prepare(
    `INSERT INTO household_video_decisions
      (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'allow', ?, ?)`
  ).run(household.lastInsertRowid, videos.allowedBirds, 'Good calm nature fit.', parentUser.id);

  db.prepare(
    `INSERT INTO household_video_decisions
      (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'allow_limited', ?, ?)`
  ).run(
    household.lastInsertRowid,
    videos.limitedLeaves,
    'Allow, but keep it in the shorter child search list.',
    parentUser.id
  );

  db.prepare(
    `INSERT INTO household_video_decisions
      (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'review_required', ?, ?)`
  ).run(
    household.lastInsertRowid,
    videos.reviewRequiredRocks,
    'Needs an adult preview before it can appear.',
    parentUser.id
  );

  db.prepare(
    `INSERT INTO household_video_decisions
      (household_id, video_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'block', ?, ?)`
  ).run(household.lastInsertRowid, videos.blockedThunder, 'Too intense for bedtime searching.', parentUser.id);

  db.prepare(
    `INSERT INTO household_channel_decisions
      (household_id, channel_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'approved', ?, ?)`
  ).run(household.lastInsertRowid, channels.smallScience, 'Trusted calm science channel.', parentUser.id);

  db.prepare(
    `INSERT INTO household_channel_decisions
      (household_id, channel_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'review_first', ?, ?)`
  ).run(
    household.lastInsertRowid,
    channels.tabletopArt,
    'Craft channel should be reviewed before child display.',
    parentUser.id
  );

  db.prepare(
    `INSERT INTO household_channel_decisions
      (household_id, channel_id, decision, parent_facing_reason, decided_by_parent_user_id)
     VALUES (?, ?, 'blocked', ?, ?)`
  ).run(household.lastInsertRowid, channels.loudArcade, 'Channel tone is too loud for KidView.', parentUser.id);

  db.prepare(
    `INSERT INTO moderation_reviews (household_id, video_id, status, parent_facing_reason)
     VALUES (?, ?, 'review', ?)`
  ).run(household.lastInsertRowid, videos.reviewOcean, 'Review ocean predator language before allowing.');

  db.prepare(
    `INSERT INTO moderation_reviews (household_id, video_id, status, parent_facing_reason)
     VALUES (?, ?, 'unknown', ?)`
  ).run(household.lastInsertRowid, videos.unknownMoss, 'No review signal has been recorded yet.');
})();

console.log('Seeded Demo Household.');
console.log(`Parent login: ${config.seedParentEmail}`);
console.log(`Parent password: ${config.seedParentPassword}`);
