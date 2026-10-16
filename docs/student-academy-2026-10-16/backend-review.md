# Student academy and study tools — backend review

Review date: 2026-10-16, Asia/Riyadh.

## Scope

Implementation reviewed and tested in:

`C:/Users/kh7bw/OneDrive/المستندات/GitHub/LootBot-SaaS-glass-release`

This report records local code review and disposable-database HTTP integration tests. It does not certify a production deployment or production data import.

## Changes made during this review

| File within the implementation workspace | Change |
| --- | --- |
| `artifacts/api-server/src/routes/student-academy.ts` | Serialize attempt closures with a consistent user-then-attempt lock order. Resolve mistake mastery from the latest persisted answer event, so delayed grading of an earlier expired attempt cannot override a newer correct or incorrect result. Preserve the most recent mistake timestamp. |
| `artifacts/api-server/src/routes/student-study.ts` | Serialize challenge reads that perform deadline grading with the same room lock as saves/submissions. Check challenge deadlines using `clock_timestamp()` after acquiring the lock. Require the client's pinned `challengeId` for answer saves and submission, returning 409 when another challenge has replaced it. Synchronize expired-result response submission flags with the values written to the database. |
| `artifacts/api-server/tests/student-academy-integration.ts` | Add regression coverage for both event-order directions: an older expired wrong attempt after a newer correct attempt, and an older expired correct attempt after a newer wrong attempt. |
| `artifacts/api-server/tests/student-study-integration.ts` | Add stale challenge rollover, missing challenge ID, STEP listening announcement, and expired-result submission-state assertions. Adapt existing writes to the required challenge ID contract. |

Two related issues were independently reported to the coordinating implementation agent and fixed there: missing `audioScript` in shared STEP challenge questions, and timezone-sensitive conversion of planner DATE values. Those changes are not claimed as edits by this review agent.

## Exact local test results

Commands ran from the implementation workspace's `artifacts/api-server` directory:

```text
node tests/run-teacher-local.mjs tests/student-study-integration.ts
node tests/run-teacher-local.mjs tests/student-academy-integration.ts
```

The study suite was rerun successfully after the final expired-result response fix.

| Suite | Tests passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `student-study-integration.ts` | 8 | 0 | 0 |
| `student-academy-integration.ts` | 9 | 0 | 0 |
| **Total** | **17** | **0** | **0** |

Node's counts include the outer parent test in each file. The detailed child checks were:

### Student study: 7 child checks plus its passing parent

1. Students only, real enrollment, feature policy, CSRF and no-store.
2. Persisted private planner, validation, idempotent completion and removal.
3. Focus uses server elapsed time, single active session and exactly-once credit.
4. Invite rooms hash codes, constrain schools/capacity and expose no identities or contacts.
5. Identical pinned room challenge, hidden answers, ownership, deadline and server grading. This also verifies stale challenge writes are rejected, missing challenge IDs return 400, listening scripts survive projection, and expired-result submission flags are consistent.
6. Presence expiration, leave, host closure and revoked enrollment.
7. Failed invite guesses are rate limited and cannot bypass persisted limits.

### Student academy: 8 child checks plus its passing parent

1. Original content has five tracks, 25 lessons and 100 well-formed unique questions.
2. Authentication, real student enrollment, feature switch, CSRF, offline privacy.
3. Attempts expose no answers, clamp lesson count and reject cross-account or invalid selections.
4. Answers persist with compare-and-swap; server grade, mistakes and idempotent finish.
5. Personal review and retry are owned; later correct answer resolves the automatic mistake.
6. Full lesson success unlocks progress and learner data remains private.
7. Lazy expiry follows event chronology and cannot undo a later correct or wrong answer.
8. Server time expires simulation and prevents late score rewriting.

Each run also reported:

```text
LOCAL_MIGRATION_PASS applied twice; legacy merchant preserved; teacher ownership constraints installed.
```

These checks used a fresh PGlite PostgreSQL database served on `127.0.0.1`, a randomly named `teacher_qa_<32 hex characters>` schema, random test-only sessions, and generated fixture users. They did not connect to the hosted application database.

## Security, privacy and content review

- New routes require authentication and a current student enrollment with the relevant school feature enabled. Teacher, merchant, admin and unjoined fixture accounts were rejected from student-only routes.
- Non-GET requests require CSRF. Student API responses carry `Cache-Control: no-store`.
- Attempts, personal mistakes, tasks and focus sessions are scoped to the authenticated user. Cross-account IDs were tested.
- Room invitation codes are random and stored hashed. Admission is scoped to an enabled school membership, and presence/capacity changes are serialized.
- Public room payloads use nicknames and room-specific pseudonymous identifiers, rather than email addresses, raw user IDs, real roster names or invitation hashes. There is no public room directory or global ranking.
- Active attempts and unrevealed room challenges omit answer keys and explanations. Scores are calculated from persisted answers on the server.
- Offline lesson export omits private progress, personal data and question banks. Its generated HTML escapes lesson text.
- Reviewed the 100 original question keys and explanations, including arithmetic, algebra, geometry, probability and physics calculations. No definite incorrect key was found. Structural tests verify five tracks, 25 lessons, 100 unique question IDs, four distinct choices per question, valid answer indices and nonempty explanations.
- The lessons are identified as limited original foundation training, separate from licensed Almufakir materials and official exam claims. No third-party academy content was copied during this review.

## Read-only frontend follow-up

Reviewed `student-academy.tsx`, `student-study.tsx`, their shared query/API helper and the surrounding education navigation. Query keys match the explicit cache update keys. Password login/logout clears the query cache; student-code login performs a full navigation after establishing the session.

One actionable state-reconciliation issue was sent to the coordinating agent: `AcademyAttempt.choose()` refetched after a failed answer write but retained stale local answers because its initialization effect runs only once per attempt ID. On a 409 conflict, another click could combine the latest server revision with stale local answers. The coordinating agent owns the frontend fix; this review did not edit frontend files.

## Limits of this evidence

- These are local integration results and a read-only frontend source review, not a production smoke-test receipt.
- The suites verify sequential conflict/expiry regression scenarios. This report does not claim a load test or a forced multi-connection database scheduling test.
- No production accounts, student records, secrets, external repositories or hosting settings were changed by this review.
- No commit, push, external messaging or deployment was performed by this review agent.
- Physical mobile devices, Safari and browser screen-reader behavior were not exercised by this review agent.
