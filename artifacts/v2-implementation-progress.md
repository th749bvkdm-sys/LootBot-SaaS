# LootBot SaaS V2 — implementation and verification report

Updated **2026-10-05**. Authoritative specification: user attachment a0a1b741-3071-4b4a-bf37-3b87d1e11fbb/نص ملصق.txt, sections 01–32.

This replaces the obsolete initial checkpoint. Commerce, growth execution, staff, analytics, themes and the complete component catalogue are implemented in the current branch. Isolated verification, public deployment and actual Telegram delivery are reported separately.

## Release identity and acceptance boundary

| Item | Status |
| --- | --- |
| Repository | th749bvkdm-sys/LootBot-SaaS |
| Branch | codex/v2-telegram-studio |
| Starting deployed commit | b40df5f |
| Source commits | 5d645b9, 41b7702; complete expansion **8cc90da97e69575e051959fc73eaa5f1eb0c966e** pushed. |
| Pull request | [PR #4](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/4) **merged** into main as **73043f2705c5a163c018f3f9c05bcca8edf74b81**. |
| Public application | [LootBot](https://lootbot-saas.onrender.com/); final V2 deployment not yet verified. |
| Test database | Separate Neon schema-only branch; synthetic test accounts/catalog/customers/orders, no copied production customer data. Runners reject other database hosts. |
| Telegram transport in tests | Explicit controlled responses. Actual handler/renderer/database/execution code runs; no real Telegram messages are sent. |
| Live Telegram acceptance | **Not performed:** local live bot/customer credentials are unavailable. No real-chat delivery success is claimed. |
| Browser acceptance | **Passed local critical paths:** login, Pro draft/publish, Business child edit/save/real preview/publish/reload, searchable customer, coupon/campaign saves, actual catalog/analytics, mobile Studio tabs and Free lock/modal accessibility. Four viewport checks passed; three screenshots linked below. |

**Release evidence still required:** Render deployed commit/build command/public verification. Source commit and successful merge are recorded above. Local implementation and critical browser acceptance are complete; deployment and real Telegram delivery are not established by these checks.

## Audit and defects repaired

Existing catalog, store, order, session, encryption and central plan infrastructure was retained. The original /start path requested message updates without a callback router, sent a welcome message without a complete store menu, and relied on text commands for catalog browsing. The legacy designer also lacked independent draft/publication state.

Repairs include:

- Receive, acknowledge, validate and route callback updates to actual screens; construct a complete default menu with current feature filtering.
- Preserve originating catalog/category/search/favorites/account/order pages through product, gallery, support and notifications navigation.
- Filter private customer/orders data by store and acting Telegram user; group chats receive a private-chat prompt.
- Safely handle deleted/unpublished targets, expired references, changed conditions, disabled source actions and changed published configuration.
- Share actual product/gallery/action rendering between runtime and server preview.
- Publish only the saved draft under a store-row lock, revision check and current reference validation.
- Permit explicit staff order preparation while keeping payments, team, credentials and security owner-only.
- Redact staff financial facts and financial-derived segments; reject rule-based attempts to infer private spending.
- Avoid a SPA crash caused by malformed browser Accept headers while retaining JSON 404 responses for unknown API routes.
- Persist validated category emoji/HTTPS image metadata and render it in real catalogs.
- Execute additive migrations once through a transactional lock/checksum ledger. Repair the Drizzle schema glob so database deployment works in a Windows checkout containing Arabic directory names.
- Describe a stored bot design as saved, without implying that the current plan permits that design after a downgrade.
- Preserve the intended page when a locked navigation item opens a plan modal, gate direct locked URLs, and maintain keyboard focus during modal entry, Tab cycling and Escape exit.
- Restore six commerce CHECK constraints that schema pushes could remove when they were absent from Drizzle declarations. Declare the same named constraints in the schema and add migration 0009 without changing already applied migration 0005.

## Feature inventory

### Storefront and Pro Designer

- **9 home layouts:** two columns, three columns, vertical, compact, sections, featured first, categories first, offers first, custom order.
- **13 configurable home actions:** products, categories, search, orders, account, offers, cart, favorites, points, referrals, coupons, support, notifications. Current plan/store availability filters actions; a configured disabled action stays disabled.
- Header/subtitle/welcome/body/footer/banner, announcement, customer greeting, emoji, columns, labels and ordering.
- **16 screen style groups:** categories, products, product, offers, orders, order detail, account, search, empty, error, success, support, points, referrals, coupons, notifications.
- **9 product card styles:** classic, compact, premium, sale, minimal, image first, price first, warranty first, VIP.
- Category emoji/image grid, list/compact styles; offer discount card/flash label/banner/featured styles. Prices and discounts use actual catalog data, without fabricated expiry times.
- Gallery arrows/numbered/vertical controls, badge text/emoji/none, action placement before/after gallery, banner placement before/after content.
- Actual product metadata/gallery/rating totals; purchase, cart, favorites, known-username share links, verified buyer reviews and correct return actions.
- Backend search with escaped wildcards, paging/clear/empty states and preserved context; product deep links and owned order/account screens.

### Customer commerce

Persistent cart/favorites, scoped coupons, points ledger, referral claims, reviews and notifications are connected to actual database records.

Checkout uses live price/stock and integer cents in one transaction, with store/customer/product locking, monthly limits, update idempotency, coupon rechecks and rollback on failed stock. Coupons enforce expiry, minimum, usage cap and one use per customer. Durable reward receipts prevent repeated order/referral awards and repeated reversals. Referral claims require a new same-store customer and reject self/repeated/cyclic claims; completion follows the first paid order. Reviews require an eligible purchase. Preview cannot create an order, change a cart, redeem a coupon or issue rewards.

Account includes actual profile/orders/points/referrals/favorites/coupons/notifications; notifications combine owned order and point activity with current messaging consent. Support uses saved contact details.

### Business Bot Studio

- Desktop component library/canvas/properties and mobile Components/Preview/Properties tabs.
- **27 components:** Text, Header, Banner, Image, Product, Product Carousel, Category Grid, Category List, Featured, Offers, Search, Orders, Account, Cart, Favorites, Points, Referrals, Coupons, Support, FAQ, Divider, Spacer, Custom Button, External Link, Announcement, VIP Block, Segment Block.
- Tree editing: root/child/grandchild, reparent/reorder/duplicate/disable/delete/preview; at most 30 screens and 12 blocks/action buttons per screen.
- **18 allowlisted actions:** open screen/products/categories/product/category/offers/search/orders/account/cart/favorites/points/referrals/coupons/support, send message, safe URL, constrained custom callback. Custom callbacks allow Home/Close/Refresh; no user code execution.
- Backend screen/block/button conditions and actual store-scoped product/category/offer sources; shared product styles, placeholders, optional branding removal and deterministic customer A/B assignment.
- Independent draft/publication with conflicts, locks and reference checks. Last published Pro/Business configuration selects the active home mode; saving/previewing does not.
- Business descendants/search retain source origin. References bind store/customer/chat/source action/publication revision and recheck current visibility.
- Searchable paginated target/customer selectors and folding block/button properties are implemented with scoped selector regression coverage and an actual customer-search browser check. Selectors resolve the saved selection even when it is outside the current result page.

### Rules and growth execution

- **20 typed facts:** logged in/new/prior orders/active orders/VIP/points/order count/spend/coupon/referral/tags/segments/date/time/campaign/store mode/plan/order value/product/category.
- Required equality, numeric, list and AND/OR operators; bounded depth/size and validated types. UTC time ranges support midnight crossing.
- Campaign context requires owned actual delivery evidence, expires after 24 hours, and rejects forged/foreign/failed/expired evidence.
- Persisted segments, journeys, broadcasts and automation with actual server preview and owned selectors.
- Journeys execute event → conditions → ordered actions, wait and match/otherwise branch. First order combines ORDER_CREATED with an order-count condition.
- **12 triggers:** all 11 requested triggers plus VIP_LEVEL_CHANGED, emitted only on actual saved VIP change.
- **11 actions:** send message/product/category/coupon; add/remove points/tags/segments; notify admin.
- **6 audiences:** all/segment/VIP/inactive/high spending/selected. **7 templates:** welcome/sale/coupon/new product/VIP/inactive/referral.
- Scheduled durable campaign/job states; recipient paging, dedupe keys, predecessor dependencies, transactional point writes and bounded event depth.
- Advisory delivery coordination, heartbeat/expired lock recovery, bounded retries, Telegram 429 retry delay, permanent failure/opt-out handling and dependent cancellation.
- Logs represent execution and Telegram API acceptance/failure, not invented read receipts.

### Themes, dashboard, team and plans

All **11 themes** (Gaming, Neon, Premium, Minimal, Dark Store, Cyber, Luxury, Clean, Marketplace, Business, Colorful) affect actual headings/separators/spacing/columns/card defaults/emoji/banner placement.

The Arabic RTL shell, overview, plans, analytics, team, commerce and growth workspaces use shared controls, loading/empty/error states, current store and lock/upgrade UX. Overview/charts use actual paid revenue, orders, products, customers, usage, recent orders, health and alerts.

Analytics include real saved aggregates, growth outcomes and unique A/B variant visits. Staff financial responses are redacted. Team memberships use **11 allowlisted scopes**, immediate revocation and current plan checks; owners grant access to existing accounts. Team/payment/credentials/Super Admin remain protected.

Central gates apply in UI and backend. A one-time migration upgrades only exact old paid plan defaults and preserves administrative customization. Health distinguishes explicit real credential/webhook tests, polling success and published configuration; saved token presence alone does not establish connection.

## Acceptance map — all 32 sections

“Implemented” describes source and isolated evidence, not successful real Telegram delivery.

| Section | Implementation/evidence | Remaining acceptance |
| --- | --- | --- |
| 01 Audit | Existing stack retained; runtime/designers/plans/auth/schema/UI/tests reviewed; root causes above. | No production load benchmark claimed. |
| 02 /start | Store/customer/plan/published configuration → multiple actual actions with feature filtering; actual handler tested. | Real chat menu. |
| 03 Navigation | Home/Back/Close/Refresh/paging/search/nesting/deep links and commerce parent contexts. | Real chat walkthrough. |
| 04 Pro Designer | 9 layouts/cards, 16 screen groups, category/offer/content/gallery/badge/placement controls; actual Pro edit/save/publish tested in browser. | Real appearance matrix. |
| 05 Product | Actual metadata/images/rating and buy/cart/favorite/share/review/return; invalid target fallback. | Real Telegram media delivery. |
| 06 Search/customer | Real search/private account/orders/support and transactional customer commerce. | Real customer walkthrough. |
| 07 Business Studio | All 27 block types, actual sources/style/conditions/actions and responsive panes; child title/text saved, previewed, published and retained after browser reload. | Real Telegram rendering. |
| 08 Menu tree | Tree editing, 18 safe actions, reference validation and safe stale targets. | Live nested navigation. |
| 09 Dynamic menus | 20 facts/operators evaluated on backend; finance/campaign scope tests. | Live customer condition changes. |
| 10 Journeys | Persisted entry/ordered actions/waits/branches/logs with dedupe/depth bounds. | Actual elapsed-time/message delivery. |
| 11 Broadcast | 6 audiences/7 templates/scheduling/states/paging/retries/rate controls/logs. | Real campaign delivery; no read receipts. |
| 12 Automation | Requested triggers plus VIP change; 11 validated actions, logs/failures/scheduler. | Real Telegram actions. |
| 13 Themes | All 11 participate in shared runtime/preview presentation. | Native Telegram visual review; custom CSS is unavailable. |
| 14 Draft/preview/publish | Separate draft/published JSON, actual server preview, revision/lock/reference checks and disabled preview writes. | Published bot appearance. |
| 15 Website redesign | RTL shell/workspaces/navigation/profile/mobile drawer and plan locks; local critical visual/browser checks passed. | Public release smoke check. |
| 16 Dashboard | Actual statistics/usage/health/charts/recent orders/alerts with financial redaction. | Production display after deployment. |
| 17 Designer UI | Grouped Pro options, screen accordions, folding Business properties, searchable targets/customers, desktop panes/mobile tabs and Save/Preview/Publish/Reset; actual mobile tabs and accessible plan modal passed. | Public release smoke check. |
| 18 Pro expansion | Required presentation/customer options use persistence and shared renderer. | Live option matrix. |
| 19 Business expansion | Builder/rules/segments/campaign/VIP/content/growth/staff/branding/analytics/experiments/health. | Production and real delivery acceptance. |
| 20 Health | Real getMe/webhook test path, safe telemetry/rate limits/conflict handling/publication state. | Deployed live credential check. |
| 21 Gates | Current central catalog, backend enforcement, UI locks and safe one-time defaults upgrade. | Production migration evidence. |
| 22 Responsive | Mobile tabs/drawer/tables and RTL; 360/768/1366/1920 checks have no page overflow. Desktop/mobile/plan-lock screenshots saved. | Public release smoke check. |
| 23 Design system | Shared workspace/UI primitives, focus, touch controls, consistent accents/motion/loading states; local critical visual review passed. | Public release smoke check. |
| 24 Security | Session/CSRF/store/current plan/staff/admin/inputs/URLs/callbacks/rates/secret guards; real allowed/denied HTTP cases. | No external penetration-test claim. |
| 25 Callback safety | Store/customer/chat/source/revision/current condition checks and stale/deleted/private-group fallbacks. | Real stale callback walkthrough. |
| 26 DB/config | Existing settings/catalog/orders reused; nine additive migrations, checksummed ledger, declared/repaired CHECK constraints and repeated complete deployment rehearsal. | Production application identity. |
| 27 Tests | 84 helper tests, 16 API checks, separate isolated DB/HTTP suites, 2 migration/constraint tests and actual browser/mobile/modal flows. | Live cases and public release checks. |
| 28 Live Telegram | Actual handlers tested with controlled transport. | **Not passed:** live credentials unavailable. |
| 29 No fake completion | Actual data/renderers/jobs/transactions; labeled state preview; no fabricated revenue/rating/conversion/health/delivery. | Keep live/deployment boundary explicit. |
| 30 Execution | Audit, storefront, designer extensions, site/runtime/persistence and final local acceptance completed; source pushed and PR merged. | Deploy and live delivery checks. |
| 31 Done | Requested implementation and local critical acceptance completed with recorded evidence. | **Not fully accepted as a live release:** deployment and real Telegram steps remain. |
| 32 Final report | Features/bugs/schema/API/test scope/limits/files, screenshots, final source commit and merged PR recorded here. | Add production deployment and live delivery evidence. |

## Storage and migrations

Pro/Business drafts, publication, active home mode, presentation/branding and experiment visit metadata reuse store settings JSON. Additive relational storage serves customers, growth jobs/resources, points, commerce and staff.

| Migration | Purpose |
| --- | --- |
| 0001_product_gallery | Existing ordered gallery retained. |
| 0002_telegram_health | Nullable connection-test/poll telemetry. |
| 0003_growth_execution | Customers, resources, durable jobs/dedupe/indexes and points ledger. |
| 0004_product_presentation | Existing product old price/warranty/tags/featured fields. |
| 0005_customer_commerce | Coupons/redemptions/cart/favorites/reviews/referrals/order reward receipts. |
| 0006_store_team | Store/account membership and permission scopes. |
| 0007_category_presentation | Emoji and nullable image URL. |
| 0008_implemented_premium_features | Upgrade exact legacy paid defaults once, preserving custom definitions and Free gates. |
| 0009_commerce_check_constraints | Restore and retain six named commerce CHECK constraints; migration 0005 remains unchanged. |

The migration runner creates lootbot_schema_migrations, locks/sorts/checks SQL, rejects altered applied checksums and commits SQL with its ledger record. Failed migrations roll back. The root db:push command now also runs additive migrations, covering existing deployments that already invoke db:push; Render's repository definition also includes an explicit idempotent db:migrate. Actual deployment must still be verified.

The complete db:push flow passed against the isolated Neon branch after repairing the relative Drizzle schema path for Windows/Arabic checkout names. All nine migration files are accounted for in the migration ledger. The complete flow was repeated twice: the second run applied zero migrations and retained constraints/indexes. This was a test-branch deployment rehearsal, not a production schema update.

Negative database tests verify SQLSTATE 23514 for coupon percentages outside 1–100, cart quantities outside 0–20, review stars outside 1–5, self-referral and negative order/referral rewards. Tests also inspect fifteen named indexes and foreign/unique constraints. Drizzle schema declarations use the same six constraint names as migration 0009 so subsequent schema pushes retain them.

## API families

All routes are under /api. Mutations use session/CSRF plus explicit scope/current plan checks.

| Family | Routes/use |
| --- | --- |
| Pro/Business Studio | GET /stores/:storeId/telegram/studio or business-studio; POST draft/preview/publish. |
| Health | GET /stores/:storeId/telegram/health; POST test-connection. |
| Commerce | Store commerce overview/preferences/coupon creation/redemptions; runtime customer writes additionally bind the acting Telegram identity. |
| Growth | Store resources/save/enable/queue/cancel/delete, paginated options/customers/jobs, labels/customer changes/preferences and server preview. |
| Team | Store access, team read/add/member edit; team writes owner-only. |
| Overview/plans/analytics | Store workspace-summary, plan-catalog and analytics with real aggregates/redaction. |
| Catalog/orders | Existing routes extended with presentation metadata and explicit staff scopes; payment remains owner-only. |

## Verification results

Latest final revision checks reported by the coordinating implementation task:

| Check | Result and scope |
| --- | --- |
| Workspace typecheck | **Passed.** |
| ESLint | **Passed** safety and React hook checks; not an exhaustive external audit. |
| Pure helper tests | **84/84 passed**: configuration, presentation, navigation, rules, plans, staff, finance and commerce helpers. |
| API integration | **16/16 passed**, latest run **89.6 seconds**: actual login/hash/cookie/me/Super Admin; CSRF/ownership/plans/staff/finance, draft/references/preview, malformed inputs, SPA header regression, selector scopes and actual runtime callback scope/revision/VIP/private-group cases. |
| Commerce integration | **1 suite passed**: transaction races/coupon caps/stock rollback/idempotent checkout/rewards/referrals/reversal. |
| Commerce Back integration | **1 suite passed**: favorites page return, order support and account notification context. |
| Growth integration | **1 suite passed**: durable order/dedupe/branch/points/coupon/audiences/campaign/VIP/loops/retry/opt-out/failure paths with controlled Telegram transport. |
| Team/analytics integration | **7/7 passed**: owner/staff/team/current plan/revocation and actual aggregates/financial redaction. |
| Category presentation integration | **6/6 passed**: persistence and input/CSRF/plan/owner/staff/cross-store/deletion protections. |
| Migration and constraint tests | **2/2 passed**: temporary schema/default preservation/concurrency/checksum/rollback plus negative commerce constraints, fifteen named indexes, foreign/unique constraints and SQLSTATE 23514. |
| Deployment database rehearsal | **Passed** complete isolated db:push twice, nine recorded migration files and retained constraints/indexes; second run applied zero migrations. |
| API and frontend production builds | **Passed again after the final constraint declarations**, together with ESLint and the complete workspace typecheck/build. Initial JavaScript is 484.82 kB instead of 998.95 kB; the chunk-size advisory is gone. Existing tooltip sourcemap warning remains nonfatal. |
| Browser | **Passed local critical paths:** isolated login; Pro save/publish; Business edit/save/preview/publish/reload/mobile tabs; customer search; V2CHECK coupon; campaign draft; actual catalog/analytics; four viewports; Free lock/direct route/modal focus/Tab/Escape. |
| Diff/whitespace review | **Passed** for the latest final source revision. |
| Production release | Source merged as 73043f2; **deployment not verified**. Public health returns HTTP 200 with status ok, but public HTML still loads old /assets/index-BpWGasbh.js rather than new /assets/index-CnxID8Xt.js. Render dashboard requires account sign-in. |
| Live Telegram | **Not run** without live credentials; controlled test transport is not delivery acceptance. |

Integration runners are in artifacts/api-server/tests and read an ignored .env.v2-test, enforcing the isolated test host. No connection secrets are logged. The isolated UI application runs without production Telegram polling or growth workers.

### Browser acceptance evidence

| Viewport | Observed result |
| --- | --- |
| 360 × 800 | Components/Properties/Preview Studio tabs passed; document/client width 345 pixels: no horizontal overflow. |
| 768 × 1024 | No unnecessary horizontal document overflow. |
| 1366 × 900 | No unnecessary horizontal document overflow. |
| 1920 × 1080 | Business Studio document width 1905 pixels and scroll width 1905 pixels: no horizontal overflow; the remaining 15 pixels are the vertical scrollbar. |

The browser pass used synthetic isolated records. It verified Pro header save/publication; Business child title and content save, actual server preview, publish and retention after reload; actual searchable customer results; a saved V2CHECK coupon row; a saved campaign draft; actual catalog/analytics values; and all three mobile Studio tabs.

Free plan navigation shows current PRO/Business locks. Clicking a locked navigation item opens the appropriate upgrade modal while preserving the current URL; visiting the locked URL directly shows the gated workspace. The modal focuses its close control, cycles focus within the dialog with Tab, and Escape closes it and restores focus to the triggering navigation control.

Saved screenshots: [Business Studio desktop](v2-business-ui.png), [mobile Studio](v2-mobile-studio-ui.png), [plan lock and upgrade modal](v2-plan-lock-ui.png). These show the isolated test environment, not an already deployed production release.

Release access is separate: the Render dashboard currently requires sign-in, and the selected GitHub OAuth account did not establish access to the correct hosting account. Login to the correct account is pending. PR #4 has been merged successfully; no GitHub deployment/check status is available for the merged commit. Public /api/healthz returns HTTP 200 and status ok. Public HTML still references the old /assets/index-BpWGasbh.js; the expected new entry is /assets/index-CnxID8Xt.js. Reloading the old production dashboard showed React error 310, which also predates the merge in its console history. The isolated replacement dashboard completed its browser checks. This evidence does not establish a successful production deployment.

The local UI server was stopped and its generated bundle removed. Nine audited synthetic fixture users/stores and their dependent rows were removed from the guarded isolated Neon branch; remaining scoped users/stores/sessions are zero. Production data was not accessed for this cleanup.

### Frontend loading performance

The Studios and overview/analytics/growth/team/commerce/plans workspaces load as separate route chunks. The shell's summary query remains lightweight and shares its original cache key/refetch settings with overview. Loading displays a labeled skeleton inside the workspace while preserving the dashboard shell. Plan usage no longer imports the chart module.

Measured latest production output: initial JavaScript **998,945 → 484,817 bytes**, a **51.5% reduction** (148.16 kB gzip). The 401.95 kB analytics/chart module is deferred until overview or analytics is opened; other page modules are approximately 4–28 kB. This is a bundle-size measurement, not a measured network latency or production load benchmark. Typecheck, ESLint and the complete workspace build passed again after the final database constraint declarations.

## Known limitations and constraints

1. Real Telegram delivery/appearance is unverified. The requested /start → browsing/gallery → Back/Home → private account/orders → website draft/preview/publish → reorder/feature toggle acceptance sequence requires an actual bot/customer test.
2. Native Telegram rendering does not accept website CSS/custom fonts/arbitrary keyboard colors from this renderer. Themes use supported text, emoji, keyboard/media order and card presentation. Carousel is a Telegram gallery/buttons experience.
3. Existing **manual payment confirmation** and administrative plan assignment remain; no payment gateway, automatic charge or subscription billing was added.
4. Logs measure API acceptance/failure, and experiments measure actual unique visits. Read receipts, message opens, automatic conversion attribution and conversion lift are not fabricated.
5. Durable jobs are at-least-once. A Telegram send accepted immediately before a server crash can be retried because Telegram and PostgreSQL share no transaction; exactly-once external delivery is not claimed.
6. Scheduled delivery depends on the hosting process being awake; a sleeping free service can delay scheduled work. No continuous uptime guarantee is claimed.
7. Navigation/search contexts expire after 15 minutes and restart safely, rather than pretending to persist all conversations across process restarts.
8. Builder/rule/cart/action bounds are intentional: 30 screens, 12 blocks/buttons per screen, 10 growth actions, 500 selected campaign customers, 30 distinct cart products and bounded rule depth/content. Browsing and large broadcast audiences page through records.
9. Staff grants require an existing account. No invitation email service was introduced. Payments/team/credentials/security remain owner-only.
10. Empty/error/success states are clearly labeled appearance previews; preview does not invent customer actions or purchases.
11. Studio target/customer pagination and folding properties are implemented, with scoped selector regression coverage and an actual customer-search browser check. No unbounded catalogue download is required for selection.
12. No production-scale load benchmark or external penetration test was performed. Build advisories are disclosed above.

## Changed areas and release checklist

Changed source areas: Telegram bot manager/navigation/configuration/data/presentation/preview/product rendering; customer commerce and catalog/order extensions; typed rules/growth execution/finance policy; staff/Studio access; RTL shell and overview/plans/team/analytics/commerce/growth/studios/catalog metadata UI; additive schemas/migrations/runner; helper/HTTP/DB/migration/UI tests; lint/build/Render configuration. Detailed file changes are in [PR #4](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/4).

Secrets, caches, disposable fixture data and generated test bundles must not be committed.

- [x] 84 helper checks, 16 API checks, other isolated integration suites and 2 migration/constraint tests pass.
- [x] Final ESLint, complete workspace typecheck/build and 84 helper checks pass after the last schema constraint declarations. The mockup build requires its existing PORT/BASE_PATH environment settings; the complete build passed with those supplied.
- [x] Final selector/property regression and four-viewport overflow checks pass.
- [x] Isolated complete db:push and additive migration deployment rehearsal passes.
- [x] Final whitespace/diff review passes.
- [x] Free upgrade-modal/direct-route/focus/Tab/Escape checks pass; desktop/mobile/lock screenshots saved.
- [x] Complete source pushed as 8cc90da; PR #4 merged into main as 73043f2.
- [ ] Verify actual Render build command/migrations/deployed commit and public critical pages.
- [ ] Perform the real Telegram sequence when live bot/customer credentials are available.

The real Telegram item stays unverified until actual delivery is observed. Source completion alone is not a substitute for that evidence.
