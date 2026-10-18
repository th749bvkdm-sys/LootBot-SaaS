# Quantitative bulk publication and viewport fix — 2026-10-18

## Changes

- Education administrator → إدارة الكمي now provides **اعتماد ونشر الكل** for accounts with question approval, test writing and test publication permissions.
- A server-side preview covers all registered Almufakir test sections, independently of the 500-question editor list. It reports ready sections, question approvals needed, previously published sections and explicit blocking reasons.
- Publishing requires an administrator's human-review attestation and a review note. This control does not automatically review or solve source questions. Existing second-reviewer restrictions remain: an author cannot approve their own questions when content review is enabled.
- The operation verifies licensing, source identity, question structure, scope, duplicates, rejected states, extraction warnings, timing and reveal settings. Intentionally hidden tests remain hidden. No test scope is widened and no explanation is invented.
- One transaction revalidates the exact preview, locks affected records, records each approval/publication in the audit trail and publishes ready sections. A changed preview must be confirmed again. Previous attempt snapshots are preserved.
- Teacher/student workspace grids now use available viewport width instead of a centered 1600px maximum. Responsive sidebar/mobile rules remain in place. This affects the webpage layout, not browser or operating-system chrome.

## Verification and limits

- Full workspace TypeScript check passed.
- API and LootBot production builds passed; existing non-blocking tooltip sourcemap and chunk-size warnings remain.
- No new automated tests were added or run for this follow-up. No authenticated production bulk approval was executed, and no claim is made that source questions have been reviewed or that all sections are currently eligible.
- No migration, new credential, account, role grant or production content mutation is required for deploying the control and layout fix. An authorized administrator must use the new control to approve/publish eligible content.
- Deployment is to the existing GitHub main / Railway service authorized in the preceding publication workflow. Public deployment success must be independently verified after the push.
