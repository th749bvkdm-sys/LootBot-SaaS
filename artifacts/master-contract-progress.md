# Master implementation contract progress

Authoritative specification: user attachment `860b70b7-c84d-483f-9dce-66529aa5744b/نص ملصق.txt`.
Working branch: `codex/master-contract-expansion`. This document tracks remaining work; it is not a completion claim.

## Implemented, with verification limits

- Repository audit: existing auth, CSRF/session, catalog, order, store, Telegram polling, Super Admin, plan settings and CSV report flows inspected. No lint script or database test environment exists locally.
- Login proxy configuration and extracted IP rate limiter; safe frontend auth messages and current-user invalidation. Password hash format validation, post-expiry lock counter reset and logout audit added. Limiter and real password verification/token primitive unit tests pass. Full login/session/CSRF integration tests remain required.
- Central catalog of plans, configurable limits/features, store settings plan assignment, API creation limits and usage already exist. FeatureGateService now provides can/require/getLimit/getUsage/remaining/isPlanAtLeast and protects gallery writes. The plan endpoint exposes remaining capacity and warning states. Subscription lifecycle, durable usage and adoption across other feature routes remain required.
- Telegram message settings: persisted welcome/help/catalog introduction and stock visibility; owner/session/CSRF guards and plan checks; messages consumed by bot. Validation tests pass. Full requested Header/Home/Navigation styling remains incomplete.
- Product gallery: new additive product_images schema/SQL, up to ten validated image URLs, descriptions, ordering, primary selection, legacy image fallback, transactional replacement and primary synchronization. Owner/session/CSRF/plan protection. Frontend editor and Telegram /product rendering implemented. Unit validation/media tests pass. Database and live Telegram verification remain required.
- Existing bulk publish/draft and Business CSV report remain usable; broader required bulk actions/analytics not implemented.

## Required next work

- Auth integration tests: register, successful/failed login, account lock, session expiry, CSRF mismatch, logout, dashboard read.
- Plan engine: subscription model/status/trial/expiry, FeatureGateService adoption across routes, durable usage, downgrade rules, migrations and usage limits for staff/broadcast/automation.
- Pro Telegram designer: branding/header, home blocks, editable navigation/actions/button layouts, preview and rendering.
- Product designer: old price/discount, short/full descriptions, tags/badges/warranty/delivery, featured/sort, CTA/catalog cards.
- Gallery: live persistence and Telegram QA, count/primary presentation in product table, future uploads architecture.
- Search: filters/sorting/range/tags/stock/featured/best sellers/discount; Telegram search and pagination.
- Coupons: lifecycle/eligibility/minimum/caps/usage/per-customer enforcement and order redemption.
- Reviews: verified order, rating/comment, moderation, Telegram review actions.
- Points: earn/redeem ledger and configurable conversion/rules.
- Referrals: codes/links/attribution, self/duplicate prevention and completion rewards.
- Pro broadcast queue/rate limits, analytics/date filters, remaining product/order/customer bulk tools.
- Business Bot Studio: persisted visual blocks, rendering and permissions.
- Nested/dynamic menus: conditions/actions/customer state/date/campaign rules.
- Advanced products: variants, custom fields, stock/segment/availability/featured schedules.
- Customer profiles/tags/segments: extensible AND/OR rules, VIP/spend/orders/activity/points.
- Business scheduled broadcast studio and outcomes/attribution.
- Automation: event/condition/action execution, job queue, runs/errors.
- Staff roles/permissions enforced across store APIs.
- Business analytics/report exports/branding and A/B experiment architecture.
- Super Admin: extend existing guards/UI/control APIs with all requested metrics/charts/search/usage/health/jobs/announcements/maintenance/feature flags.
- Dynamic comparison plans page, usable contact-admin upgrade experience and warning thresholds.
- Split Telegram services, structured errors/request IDs, full audit coverage, security/performance review.
- Additional architecture: favorites/recent views/offers/scheduling/notifications/timelines/notes/support/import/webhooks/API keys/integrations.
- Required integration/security tests, lint setup, builds, mobile/RTL/manual QA and final bug fixes.
- Push branch and create/attach PR describing final scope, schema, API, UI, Telegram, checks and limitations.

## Checkpoint verification

- Typecheck: workspace passed after gallery implementation.
- Tests: seventeen unit tests passed, covering plans, rate limiter, message parsing, gallery validation/legacy compatibility, old plan definitions, Telegram media request constraints, central feature gate enforcement and password/token primitives.
- API and frontend production builds passed after gallery wiring; repeat for later changes as needed.
- Gallery SQL is additive and schema is used by existing `db:push` deploy step. Migration has not been executed locally.
- Current changes have not been deployed; do not infer live behavior from local tests/builds.
