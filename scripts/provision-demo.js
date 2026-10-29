// Run after migrations. Supply secrets through the environment, never arguments.
const { provisionDemo } = require('../app/services/demoHouseholdService');
const db = require('../app/db/database');
try {
  provisionDemo({
    email: process.env.DEMO_PARENT_EMAIL,
    password: process.env.DEMO_PARENT_PASSWORD,
    disable: process.argv.includes('--disable')
  });
  console.log('Demo account provisioned or updated. No credentials are printed.');
} catch (error) {
  console.error(error instanceof RangeError ? error.message : 'Demo provisioning failed. Check migrations and database availability.');
  process.exitCode = 1;
} finally {
  db.close();
}
