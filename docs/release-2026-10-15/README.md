# Release verification — 2026-10-15

User authorization: verify all work and login flows, save the changes to GitHub and deploy the website.

## Verification before publication

278 passed, 0 failed, 1 skipped across the current test runs. The skipped private-figure symlink test cannot create a Windows symbolic link on this machine; other path/hash/PNG/authorization checks passed. The count includes Node parent tests as reported by each test runner.

| Suite | Passed |
|---|---:|
| API library unit tests | 110 |
| Authentication matrix | 8 |
| Teacher workspace | 12 |
| Learning and chemistry | 12 |
| Teacher tools | 9 |
| Education roles/schools | 6 |
| Quantitative tests | 18 |
| Private question assets | 12 |
| Result contracts | 6 |
| General API and Studio | 16 |
| Commerce transactions | 1 |
| Commerce navigation | 1 |
| Storefront | 4 |
| Team and analytics | 7 |
| Growth execution | 1 |
| Category presentation | 6 |
| Telegram reconnect | 13 |
| Migration ledger | 1 |
| Import tools and UI models | 35 |

Full root typecheck and build passed. The optional mockup-sandbox requires PORT and BASE_PATH at build time; the complete build ran with PORT=5199 and BASE_PATH=/. Railway builds the production API and LootBot UI directly. Existing Vite chunk-size/sourcemap warnings do not prevent building.

## Authentication coverage

Real HTTP requests and disposable PostgreSQL-compatible storage test merchant, teacher, Super Admin and school-manager credentials; registration without privilege escalation; preserved account types; malformed hashes; wrong/deleted/suspended accounts; CSRF; account/IP throttling; personal student code login without email/password; cross-role restrictions; code rotation/revocation; forged/expired sessions; and CSRF-protected logout. Existing classroom-code learning entry is covered by the learning suite.

These are isolated tests, not a claim that every owner's production credential has been used. No passwords, session tokens or real bot tokens are in this report.

## Fixes found while verifying

Growth point mutations and Telegram reconnects requested a second DB connection for a feature check while already holding a transaction. They now use a transaction-scoped feature reader. Their integration tests pass with one connection, preventing that specific pool-exhaustion deadlock.

Old commerce tests now accept the disposable local schema with an explicit host, NODE_ENV and schema-name guard. They still reject arbitrary/production databases. The local runner creates a temporary encryption secret for mocked Telegram credentials and bounds tests to 180 seconds.

## Deployment requirements

Run `corepack pnpm db:migrate` before deploying new code. Migrations 0014–0017 add education, personal student credentials, quantitative attempts and protected figure metadata. The runner locks and records each SQL migration transactionally; additive migrations preserve old merchant accounts. Production never uses drizzle push/force.

The tested implementation is under `LootBot-SaaS-glass-release`. Windows ACLs refused writes to the shared original Git object store while staging, so an independent publication clone is used for the same changed files, with file-hash verification. No original user checkout was reset.

## Data and evidence boundaries

The local preview server and fake demo identities are not deployed or seeded into production. Private permission screenshots, source PDFs, private question packs/crops, credentials, generated test schema bundles and node_modules are excluded from Git. The UI and reviewed question management/import tools are included. Publishing code does not transfer the disposable preview database or establish that private local question crops already exist on the production host. Any bank import must keep the license/review gates and use private durable storage; no unreviewed source is automatically enabled by a release.

Runtime deployment ID, commit hash and live checks are recorded after Railway completes in the delivery report. Automated tests reduce known failures; they cannot guarantee that every external service, device or future request is error-free.
