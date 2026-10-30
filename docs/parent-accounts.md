# Parent accounts and the public demo

Parent accounts live at `/parent/accounts`. Only an active household admin can open the page or submit account changes. An admin can create parents, edit names and emails, promote or demote admins, disable or re-enable accounts, and reset passwords. Normal parents keep the existing child, policy, review, and audit features. All account operations use the signed-in admin's household, regardless of submitted IDs or household fields.

There is no email delivery or invitation-token system in this version. Create the account and share its login details privately. Use a unique password with at least 12 characters and at most 72 UTF-8 bytes. Passwords are bcrypt hashes and never appear in lists or saved form values. Disabling preserves decision history and attribution. The last active admin cannot be disabled or demoted.

Every request rechecks the parent account in the database. Saving an existing account revokes its previous parent sessions, including password resets, role changes, and re-enabling. Editing your own account signs you out on your next request. Existing sessions from before migration 014 also need a fresh login. The independent child-mode cookie remains a household device selection, rather than an account session; disabling a parent does not revoke previously configured child devices.

## Demo architecture and limits

Use a separate household marked `is_demo = 1`. Never add public visitors to your real household. A household's name alone does not make it a demo: the older seed script's “Demo Household” remains a normal household, and migration 014 deliberately does not change that.

The operator-only provisioning script creates a dedicated demo parent with the normal parent role, one synthetic child, one synthetic policy, three synthetic catalog entries, a review item, decisions, and a search audit. It does not copy or update private household rows or existing catalog entries. Its catalog uses the separate `demo` source namespace. Re-running with the same email rotates the password and revokes existing parent sessions without duplicating fixtures. It refuses to convert an existing real account into a demo account.

Visitors can browse the demo dashboard, reviews, history, child profiles, and settings. Forms that would save changes are disabled in the UI and independently rejected by the server. Child handoff changes only browser cookies and the parent session. Child searches open the fixed “sample science” result without storing the visitor's text. The demo flag follows the signed child cookie after the parent session ends. Sample videos have no real media and cannot play. Playback tracking, review decisions, account management, and settings changes are blocked. Household browsing does not call external APIs. Model comparison is blocked unless the server explicitly enables it as described below. Parent login/logout and session housekeeping still work normally.

This is a read-only product tour, not a live search or playback trial. Interactive editing would need disposable visitor households or an isolated deployment; it must not relax these shared-demo restrictions. Demo visitors cannot list parent accounts or inspect another household's children, audit, queue, or decisions. Account/session responses are marked `Cache-Control: no-store`.

## Optional live model comparison

To let signed-in demo parents use the real comparison tool, add this line to the deployed server's `.env` file:

```dotenv
DEMO_MODEL_COMPARISON_ENABLED=true
```

Restart the app after changing the setting. No database migration or demo-account reset is needed for this option. Demo visitors will see a **Live model comparison** link on the parent dashboard. The tool uses the existing YouTube and OpenRouter API keys. It runs real searches and model assessments, but does not save queries, results, reviews, or settings to either household. The synthetic child search and household pages keep their existing restrictions. Child mode alone cannot access the comparison tool; the visitor must sign in as a parent.

The setting defaults to off. Set it to `false` and restart to disable demo comparison access. Normal parent accounts retain access either way. Only the comparison page, its two assets, and its search/compare actions are exempted from demo restrictions. No other demo writes are allowed.

Existing per-IP limits remain: 10 searches and 10 comparison submissions per 15 minutes. Demo parents also have separate account-wide limits of 10 searches and 10 comparisons per 15 minutes, shared across sessions and IP addresses for that account. Each comparison calls one to three selected models. Counters are kept in memory and reset when the single server process restarts. Different demo parent accounts have separate limits. These controls do not replace the provider account's configured quota or prepaid balance.

Demo visitors get generic availability messages for API failures; raw provider diagnostics aren't shown to them. Search results stay isolated to the visitor's parent session and expire after 30 minutes. Disabling or resetting the parent account continues to revoke its sessions.

## Deployment

These changes do not migrate or restart the running instance automatically. On the deployment host, install the updated source, keep the current `.env` and database, and use the existing Node 22.18.0 runtime. No dependencies were added. Do not run `db:reset` or the ordinary seed script against an existing installation.

1. Stop the app before changing the schema. For this checkout's PM2 setup, run `npm run pm2:stop` with Node 22.18.0 on `PATH` and the repository as the working directory. Use the equivalent stop command if production uses a different supervisor.
2. Back up the configured SQLite database. The following uses SQLite's backup API and includes committed WAL data. It writes a dated backup in the repository's ignored `data/` directory. Copy that backup to your normal protected backup location too.

   ```sh
   node -e 'const db = require("./app/db/database"); db.backup("data/kidview-before-parent-accounts-" + Date.now() + ".sqlite").then(() => db.close()).catch(() => { console.error("Database backup failed"); process.exitCode = 1; db.close(); });'
   ```

3. Run `NODE_ENV=production npm run db:migrate`. Migration `014_parent_accounts.sql` adds demo status, account roles, active status, session versions, and case-insensitive email uniqueness. Each existing household's oldest parent becomes its admin. Other existing parents keep normal parent access. If legacy emails collide ignoring case, migration 014 rolls back: resolve those account identities deliberately before retrying. Do not delete migration records or skip the index.
4. Provision a separate demo account only when you are ready to share access. In an interactive Bash terminal, enter the email and password without putting the password in command history:

   ```bash
   read -r -p 'Demo login email: ' DEMO_PARENT_EMAIL
   read -r -s -p 'Demo password (12+ characters): ' DEMO_PARENT_PASSWORD
   printf '\n'
   export DEMO_PARENT_EMAIL DEMO_PARENT_PASSWORD
   NODE_ENV=production node scripts/provision-demo.js
   unset DEMO_PARENT_EMAIL DEMO_PARENT_PASSWORD
   ```

Alternatively supply those two variables through your secret manager. Do not put secrets in command arguments, tracked files, or screenshots. The script prints no credentials. Existing production requirements for `SESSION_SECRET`, HTTPS `APP_ORIGIN`, and trusted proxies still apply.

5. Start the app with its existing supervisor configuration. For the documented PM2 production profile:

```sh
PM2_HOME=.pm2 pm2 startOrRestart ecosystem.config.js --only kidview --env production --update-env
```

6. Sign in again as the owner. Confirm **Parent accounts** is present, create a normal parent, and verify its access. In a separate browser session, sign in as the demo visitor and confirm synthetic data, disabled changes, sample child search, and model comparison access matching the server setting. Verify HTTPS login and secure cookies through the actual public proxy.

To rotate demo access, rerun step 4 with the same email and a new password. To disable demo parent login, set `DEMO_PARENT_EMAIL` privately and run `NODE_ENV=production node scripts/provision-demo.js --disable`. Disabling login does not erase existing child-mode cookies; they remain restricted to the read-only synthetic household. Keep the demo restriction in place even if you stop sharing the credentials.

For rollback, stop the app and restore both the previous application version and its matching database backup. Do not roll back only the code and leave public demo credentials active: the older app does not enforce demo restrictions.

## Validation and review

Validated on Node 22.18.0: 84 tests pass with `npm test`. Tests use disposable databases, not the configured live database. Coverage includes migration promotion and rollback on ambiguous emails, admin-only account actions, tenant-ID tampering, password validation, last-admin protection, session revocation, case-insensitive demo route checks, child handoff, blocked API actions, synthetic-only video access, and a before/after comparison of all application rows during demo browsing and attempted mutations. SQLite integrity and foreign-key checks run on the disposable databases.

The implementation keeps route handlers thin and account operations in a service. It uses the existing EJS, CSS, bcrypt, same-origin protection, rate limiting, and migration runner. The review also tightened child-household joins in search audits and rejects disabled/demo actors in the decision service. A branch review checked account authority, session revocation, demo child-cookie behavior, shared-catalog isolation, and credential handling. No dependency, framework, invitation service, or new CSS system was introduced. The optional-comparison tests use stubbed API responses, verify both switch states, reject anonymous/child access and cross-origin submissions, enforce shared account limits across sessions/IPs, and compare all application rows before and after live-demo actions. Public-server proxy/TLS behavior still needs the deployment smoke check above.
