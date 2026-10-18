# Teacher and student workspace release — 2026-10-18

Prepared from `57448804bbab49ddede6955e8c77be3e72e4754a` on `codex/teacher-student-redesign`. Publication was explicitly authorized by the owner on 18 October 2026.

## Included changes

- Teacher and student navigation redesign, shared active class, teacher live cockpit, student review cards, and editable exam tools.
- Classroom games, timer, relative quiet meter, directions, voting, honor board and same-device projector synchronization.
- Teacher can type names for hot-seat and ladder participants, including students outside the saved roster. These names are display-only: persisted individual points require selecting the actual student from the owned class roster. Existing ownership, authentication and reward validation remain in place.
- Additive migration `0021_teacher_classroom.sql`, applied by the existing migration runner before the service starts. Existing data is preserved.

## Verification

- Full workspace TypeScript check and API build passed again for this publication candidate. Frontend TypeScript check and build passed after the manual-name change.
- The implementation QA recorded 24 unit checks, 84 isolated HTTP checks and 70 browser scenarios (178 total), with zero browser JavaScript errors. See `../education/CLASSROOM_PROJECTOR_QA.md` and the accompanying result files. These recorded suites precede the final manual-name UI change; they were not rerun for publication. No new test run is claimed for that small change.
- Git staged whitespace review passed. Staged text files were scanned for private keys, GitHub tokens and remote PostgreSQL credentials; none found. The disposable localhost PGlite URL is an explicit test fixture.
- No production test account, test data, publisher approval or role changes are part of this release. Preview fixture entry points remain confined to the local test server.
- Existing non-blocking Vite sourcemap/chunk-size warnings remain. Actual Safari/iOS hardware and microphone hardware were not checked.

## Deployment destination

- Existing repository: `th749bvkdm-sys/LootBot-SaaS`, production branch `main`.
- Existing service: `f8f02356-a0b5-4332-9bad-3c64bfdcc63b` in Railway project `76b970d7-213d-4075-8be5-6d26701bdb1a`.
- Public URL: https://lootbot-saas-production.up.railway.app
- Previously verified service settings: automatic GitHub deployments; build API and web with pnpm; pre-deploy `corepack pnpm db:migrate`; start `corepack pnpm start`; health `/api/healthz`.
- No new service, plan, domain or environment credential is requested or added. Final deployment success must be checked against the public asset hashes and health endpoint after the push. Earlier QA reports describe the local implementation stage and should be read with this release record.

Local-only publisher preparation scripts and private content review files are outside this workspace release.
