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
})();

console.log('Seeded Demo Household.');
console.log(`Parent login: ${config.seedParentEmail}`);
console.log(`Parent password: ${config.seedParentPassword}`);
