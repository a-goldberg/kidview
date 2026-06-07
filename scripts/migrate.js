const fs = require('fs');
const path = require('path');
const db = require('../app/db/database');

const migrationsDir = path.join(__dirname, '..', 'app', 'db', 'migrations');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const applied = new Set(
  db.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename)
);

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const recordMigration = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

  db.transaction(() => {
    db.exec(sql);
    recordMigration.run(file);
  })();

  console.log(`Applied ${file}`);
}

if (files.every((file) => applied.has(file))) {
  console.log('No migrations to apply.');
}
