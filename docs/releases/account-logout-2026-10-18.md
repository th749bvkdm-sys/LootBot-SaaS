# Visible sign out for all account types — 2026-10-18

## Coverage

- Student room and education administration: visible text button in the shared header, including school administrators, content managers and support accounts.
- Teacher workspace: shared sign-out button in the header and sidebar, plus teacher onboarding and initial account selection.
- Merchant workspace: text buttons in the desktop sidebar and responsive header, including staff accounts; merchant onboarding also has a button.
- Super administrator: the existing header button now uses the shared action.
- Standalone teacher projector: explicit sign-out control, hidden from printed output.
- Education access-explanation pages and account-workspace loading errors allow returning to a clean sign-in state.
- The separate legacy learning portal retains its dedicated `/api/student/logout` action; after success it now clears the UI query cache and reloads its own entry page.

## Session behavior

The shared button obtains a fresh CSRF token through the existing API helper, calls `/api/auth/logout`, and redirects with `location.replace('/login')` only after a successful response or an already-expired session (401). The existing backend deletes the current session and clears its session/CSRF cookies. A network or authorization error is shown and can be retried.

Successful primary-account sign-out cancels queries, clears the client query cache, and notifies other tabs through BroadcastChannel and a localStorage event containing only a random nonce. The receiver clears its cache and returns to sign in. This does not revoke sessions on other devices and does not delete saved drafts or other local work.

Buttons retain visible text, keyboard focus styling, touch-sized targets and Arabic/English labels. Header wrapping prevents the additional control from forcing a fixed-height merchant header to overflow. Projector/session controls are excluded from printing.

## Verification

- LootBot TypeScript check and production build passed.
- Existing non-blocking Vite sourcemap/chunk-size warnings remain.
- No new automated tests were added or run for this follow-up. No live user's session was ended as a test; authenticated logout and multi-tab behavior were not manually exercised during this publication.
- No database migration, role grant, account creation or permission change is involved. Production publication is verified separately through Railway status and matching public assets.
