# One-click publication after the owner's review — 2026-10-18

The owner explicitly confirmed that they have already reviewed the questions and requested direct publication when clicking Publish All. This supersedes the previous extra review prompt and Super Admin self-review restriction for this publication action.

- Publish All now fetches the current server plan and immediately approves the questions and publishes the tests in one transaction. There is no second confirmation checkbox or review-note form. The audit note accurately records the administrator's publication click as their review approval.
- A Super Admin may approve imported questions authored by the same account, accept reviewed extraction flags/rejected review states, and republish hidden Almufakir sections through this explicit action. The same exception is not granted to other roles, and no role grants or global content-review settings are changed.
- The individual Publish action for an existing Almufakir test also performs question approval first, fixing the generic unapproved-question error from the owner's screenshot. Other sources retain their existing workflow.
- Previously published tests whose question approvals need repair are handled; repeating an already completed publication returns a no-op result instead of a generic error.
- Licensing, recorded publisher identity, valid choices/answer keys, source-page integrity and school/class/stage access remain enforced. Results identify any section that cannot be published because its data is incomplete. No scope is widened, no missing answer is invented, and no explanation is added.
- Approvals, question status updates, publication and audit insertion are batched to avoid thousands of sequential round trips for the imported bank.
- Workspace types, API and web builds must pass before publication. No new automated tests are added or run for this follow-up, and no authenticated production publication click is executed on the owner's behalf. The deployed control is for the owner to use.
