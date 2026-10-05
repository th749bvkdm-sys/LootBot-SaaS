# LootBot SaaS V2 — implementation and verification report

Updated **2026-10-05**. Authoritative specification: user attachment a0a1b741-3071-4b4a-bf37-3b87d1e11fbb/نص ملصق.txt, sections 01–32.

This replaces the obsolete initial checkpoint. Commerce, growth execution, staff, analytics, themes and the complete component catalogue were implemented, merged and successfully deployed. The saved Telegram connection recovery fix is also merged/deployed, and an actual successful production poll was observed. Real Telegram customer-chat delivery remains unverified.

## Release identity and acceptance boundary

| Item | Status |
| --- | --- |
| Repository | th749bvkdm-sys/LootBot-SaaS |
| V2 implementation branch | codex/v2-telegram-studio; merged. |
| Follow-up branch | codex/telegram-reconnect-release; source **3c5331d02ecce4f36bbebaf0ec0ec1806959dc0f**, [PR #5](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/5) merged as **0695391bca36f1ba4daa8e4af59fe180419fae9f**. |
| Starting deployed commit | b40df5f; [previous release evidence](deployment-b40df5f.jpg). |
| Source commits | 5d645b9, 41b7702; complete expansion **8cc90da97e69575e051959fc73eaa5f1eb0c966e** pushed. |
| Pull request | [PR #4](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/4) **merged** into main as **73043f2705c5a163c018f3f9c05bcca8edf74b81**. |
| First V2 deployed source | **8d653290751bf50cd865c650fc6e919031475299** (main after the merged implementation and evidence update). |
| Render deployment | **dep-db1nl15g1s2s73b1qhbg**, **Live**, **1m 26s**, existing free service. |
| Current Render deployment | **dep-db1o4jp42hec73dj8e9g**, **Live**, **1m 28s**, source **0695391**, October 5 at 13:56:15 Riyadh. Runtime/new public files verified; migrations ready (0 applied). |
| Public application | [LootBot](https://lootbot-saas.onrender.com/); **V2 plus recovery verified** through health, /assets/index-D4x9xCmk.js (486,882 bytes, JavaScript), signed-in pages and owner reconnect. |
| Test database | Separate Neon schema-only branch; synthetic test accounts/catalog/customers/orders, no copied production customer data. Runners reject other database hosts. |
| Telegram transport in tests | Explicit controlled responses. Actual handler/renderer/database/execution code runs; no real Telegram messages are sent. |
| Real Telegram credential check | **Passed in production:** the owner Test Connection invoked actual Telegram getMe/webhook checks with the saved credential. |
| Telegram polling follow-up | **Recovered:** owner resume at **13:58:44 Riyadh**; actual successful Telegram poll at **13:59:04**, connected **@lootSa_bot**, no recorded reception error. |
| Live Telegram chat acceptance | **Not performed.** No real-chat storefront walkthrough or delivery success is claimed. |
| Browser acceptance | **Passed local critical paths:** login, Pro draft/publish, Business child edit/save/real preview/publish/reload, searchable customer, coupon/campaign saves, actual catalog/analytics, mobile Studio tabs and Free lock/modal accessibility. Four viewport checks passed; three screenshots linked below. |

**Release boundary:** V2, its nine migrations and the saved-credential reconnect fix are verified in production, including actual polling recovery. A real Telegram storefront customer-chat walkthrough remains unverified.

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
| 15 Website redesign | RTL shell/workspaces/navigation/profile/mobile drawer and plan locks; local critical checks and signed-in production pages passed. | No outstanding first-release page smoke check. |
| 16 Dashboard | Actual statistics/usage/health/charts/recent orders/alerts with financial redaction; new production dashboard loads without the previous React 310 error. | Production polling recovery also verified. |
| 17 Designer UI | Grouped Pro options, screen accordions, folding Business properties, selectors/panes/mobile tabs and Save/Preview/Publish/Reset; production Pro real-catalog preview and all 27 Business palette entries observed. | Real Telegram published appearance. |
| 18 Pro expansion | Required presentation/customer options use persistence and shared renderer. | Live option matrix. |
| 19 Business expansion | Builder/rules/segments/campaign/VIP/content/growth/staff/branding/analytics/experiments/health; production workspaces load. | Real execution/delivery acceptance. |
| 20 Health | Real getMe/webhook checks, saved connection resume and actual successful polling verified in production. | Customer-chat delivery remains a separate acceptance item. |
| 21 Gates | Central catalog/backend enforcement/UI locks/safe defaults upgrade; all nine production migrations applied. | Real Telegram feature toggle sequence. |
| 22 Responsive | Mobile tabs/drawer/tables/RTL; four local viewports without overflow; desktop/mobile/lock screenshots and production page smoke check. | No outstanding first-release page smoke check. |
| 23 Design system | Shared primitives/focus/touch/accents/motion/loading; local visual review and production pages passed. | No outstanding first-release page smoke check. |
| 24 Security | Session/CSRF/store/current plan/staff/admin/inputs/URLs/callbacks/rates/secret guards; real allowed/denied HTTP cases. | No external penetration-test claim. |
| 25 Callback safety | Store/customer/chat/source/revision/current condition checks and stale/deleted/private-group fallbacks. | Real stale callback walkthrough. |
| 26 DB/config | Existing settings/catalog/orders reused; nine additive migrations/ledger/CHECK repairs and repeat rehearsal; production logs verify each 0001–0009 application. | No outstanding first-release migration evidence. |
| 27 Tests | 85 helpers, 16 API checks, 13 reconnect checks, isolated DB/HTTP suites, 2 migration/constraint tests, browser/mobile/modal and production page checks. | Real customer-chat cases remain unverified. |
| 28 Live Telegram | Actual handlers tested with controlled transport; actual production credential test passed. | **Chat sequence not passed:** real storefront interaction/delivery has not been observed. |
| 29 No fake completion | Actual data/renderers/jobs/transactions; labeled state preview; no fabricated revenue/rating/conversion/health/delivery. | Keep live/deployment boundary explicit. |
| 30 Execution | Implementation/local acceptance/source merge/production deployments/migrations/public smoke and actual polling recovery completed. | Real customer-chat sequence remains unverified. |
| 31 Done | Local implementation, production application release and bot polling verified. | **Full Telegram acceptance remains open:** real customer-chat storefront sequence. |
| 32 Final report | Features/bugs/schema/API/tests/limits/files/screenshots/source/merge/Render/migrations/public verification and reconnect identity/result recorded. | Real customer-chat evidence remains unavailable. |

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

The migration runner creates lootbot_schema_migrations, locks/sorts/checks SQL, rejects altered applied checksums and commits SQL with its ledger record. Failed migrations roll back. The root db:push command also runs additive migrations. The actual Render service build ends with db:push, and its production logs confirm this applied all nine migrations. The repository Render definition additionally includes an explicit idempotent db:migrate.

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
| Pure helper tests | **85/85 passed**: configuration, presentation, navigation, rules, plans, staff, finance, commerce and bot lifecycle serialization helpers. |
| API integration | **16/16 passed**, latest run **92.2 seconds** on the final reconnect source: actual login/hash/cookie/me/Super Admin; CSRF/ownership/plans/staff/finance, draft/references/preview, malformed inputs, SPA header regression, selector scopes and actual runtime callback scope/revision/VIP/private-group cases. |
| Commerce integration | **1 suite passed**: transaction races/coupon caps/stock rollback/idempotent checkout/rewards/referrals/reversal. |
| Commerce Back integration | **1 suite passed**: favorites page return, order support and account notification context. |
| Growth integration | **1 suite passed**: durable order/dedupe/branch/points/coupon/audiences/campaign/VIP/loops/retry/opt-out/failure paths with controlled Telegram transport. |
| Team/analytics integration | **7/7 passed**: owner/staff/team/current plan/revocation and actual aggregates/financial redaction. |
| Category presentation integration | **6/6 passed**: persistence and input/CSRF/plan/owner/staff/cross-store/deletion protections. |
| Migration and constraint tests | **2/2 passed**: temporary schema/default preservation/concurrency/checksum/rollback plus negative commerce constraints, fifteen named indexes, foreign/unique constraints and SQLSTATE 23514. |
| Deployment database rehearsal | **Passed** complete isolated db:push twice, nine recorded migration files and retained constraints/indexes; second run applied zero migrations. |
| API and frontend production builds | **Passed again with the reconnect repair**, together with ESLint and the complete workspace typecheck/build. Initial JavaScript is 486.88 kB instead of 998.95 kB; the chunk-size advisory is gone. Existing tooltip sourcemap warning remains nonfatal. |
| Browser | **Passed local critical paths:** isolated login; Pro save/publish; Business edit/save/preview/publish/reload/mobile tabs; customer search; V2CHECK coupon; campaign draft; actual catalog/analytics; four viewports; Free lock/direct route/modal focus/Tab/Escape. |
| Diff/whitespace review | **Passed** for the latest final source revision. |
| Production release | **Verified:** Render deployment dep-db1nl15g1s2s73b1qhbg is Live from 8d653290751bf50cd865c650fc6e919031475299; nine migrations applied; public health HTTP 200/ok and new /assets/index-CnxID8Xt.js confirmed; signed-in critical pages passed. |
| Real Telegram Test Connection | **Passed in production** actual getMe/webhook checks using the owner's saved credential; no secret disclosed. |
| Saved Telegram reconnect integration | **13/13 passed**, latest run **32.9 seconds**: owner/CSRF/plan/credential/webhook/duplicate/stale guards; saved offset; real health write with mocked poll; retry bounds; queued disconnect/archive; late same-token completions; startup and permanent shutdown. Transport is synthetic and never sends customer messages. |
| Telegram polling/chat | **Actual production polling recovered:** owner resume 13:58:44, successful poll 13:59:04 Riyadh, connected @lootSa_bot, no reception error. Real customer-chat storefront sequence remains unverified. |

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

### First V2 production release

The earlier hosting sign-in/deployment verification gap was resolved. The existing free Render service deployed main source **8d653290751bf50cd865c650fc6e919031475299** as [deployment dep-db1nl15g1s2s73b1qhbg](https://dashboard.render.com/web/srv-db0mf2k9v7es73c39g60/deploys/dep-db1nl15g1s2s73b1qhbg), **Live in 1m 26s**. Its actual build command ends with db:push. Logs show Applied 0001 through Applied 0009, Database migrations ready (9 applied), and Build successful.

Public /api/healthz returns HTTP 200 with status ok; public HTML/new JavaScript confirm **/assets/index-CnxID8Xt.js**. Signed-in production verification covered dashboard, catalog, categories, orders, commerce, customers, marketing, automation, analytics, team, plans and settings. Actual records or legitimate empty states appeared rather than data-loading errors. The new dashboard did not show the former React 310 error. Admin reported healthy API/database; Pro preview used the actual product catalogue, and all 27 Business component types were present.

Evidence: [Render Live status](v2-render-live.png) and [production migration/build log excerpt](v2-render-migrations.txt). These contain service/deployment metadata without tokens or connection strings. The production dashboard screenshot containing a private account email is deliberately excluded from committed public evidence.

The owner's deployed Test Connection successfully checked the saved credential against real Telegram getMe/webhook endpoints. It exposed a separate issue: the connection's stored status was error, there was no previous successful poll and startup reported zero active bots. That recovery issue was repaired in PR #5 and verified below. The real Telegram customer /start/storefront/publish walkthrough has not been performed.

The local UI server was stopped and its generated bundle removed. Nine audited synthetic fixture users/stores and their dependent rows were removed from the guarded isolated Neon branch; remaining scoped users/stores/sessions are zero. Production data was not accessed for this cleanup.

### Saved connection recovery follow-up

The final repair adds an owner-only, CSRF-protected saved-connection resume action. It validates the decrypted credential hash, bot identity and absent webhook; rechecks ownership/nondeleted store/current credential inside locked persistence; preserves the saved update offset; bounds retries; and records a safe audit event. Connection changes, archive/disconnect and worker side effects serialize per store. Aborted or replaced workers cannot persist late health/error/offset changes, and shutdown prevents in-flight or queued requests from starting new reception.

The UI offers **استئناف الاتصال** on a saved error connection, keeps Test Connection diagnostic, refreshes health every fifteen seconds and refreshes store/summary state after a transition. Store changes discard stale request results. The isolated reconnect suite passed 13/13 in 32.9 seconds; final API lint/typecheck/build, 85 helper checks and the full 16-case API regression passed after the final guards. Independent final review found no unresolved concrete issue. Its controlled Telegram transport uses only synthetic getMe/getWebhookInfo/getUpdates responses and cannot send a customer message. Final cleanup verification found zero scoped reconnect users/stores and zero API fixture users in the isolated database.

Source **3c5331d** was published through [PR #5](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/5) and merged as **0695391**. The first follow-up deployment dep-db1o05jtqb8s73e07omg reported Live, but public HTML still contained the old asset and unauthenticated reconnect returned 404. A service restart was recorded at 13:55 Riyadh. A subsequent manual retry, [dep-db1o4jp42hec73dj8e9g](https://dashboard.render.com/web/srv-db0mf2k9v7es73c39g60/deploys/dep-db1o4jp42hec73dj8e9g), completed **Live in 1m28s** from the same reviewed source, and public verification confirmed the actual new runtime. The initial deployment mismatch is not attributed to an established root cause.

Public HTML now loads **/assets/index-D4x9xCmk.js**; that asset returns 486,882 bytes with JavaScript MIME type. /api/healthz returns 200/ok, and unauthenticated reconnect returns 401. The owner resume action succeeded against the saved production credential at **13:58:44 Riyadh**. The UI showed **connected**, bot **@lootSa_bot**, then an actual successful Telegram poll at **13:59:04** and no recorded reception error. Production catalogues, designs, memberships and payment data were not changed for this recovery check. No new credential was entered.

Saved release evidence: [Render current Live deployment](v2-reconnect-render-live.png) and [build/migration/runtime excerpt](v2-reconnect-render-log.txt). The owner-facing bot health screenshot remains local because it includes private store information. During the GitHub backup check, the visible health card also showed a successful poll at **14:55:18 Riyadh** with no recorded reception error. An actual successful poll establishes update reception connectivity; it does not establish customer-menu delivery or a completed purchase walkthrough.

### Frontend loading performance

The Studios and overview/analytics/growth/team/commerce/plans workspaces load as separate route chunks. The shell's summary query remains lightweight and shares its original cache key/refetch settings with overview. Loading displays a labeled skeleton inside the workspace while preserving the dashboard shell. Plan usage no longer imports the chart module.

Measured latest production output: initial JavaScript **998,945 → 486,882 bytes**, a **51.3% reduction** (148.71 kB gzip). The 401.95 kB analytics/chart module is deferred until overview or analytics is opened; other page modules are approximately 4–28 kB. This is a bundle-size measurement, not a measured network latency or production load benchmark. Typecheck, ESLint and the complete workspace build passed again with the reconnect repair.

## Known limitations and constraints

1. Real Telegram credential validation, saved connection recovery and an actual successful poll passed in production. Actual customer-chat delivery/appearance remains unverified. The requested /start → browsing/gallery → Back/Home → private account/orders → website draft/preview/publish → reorder/feature toggle sequence still requires an authenticated Telegram customer test.
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

Changed source areas: Telegram bot manager/navigation/configuration/data/presentation/preview/product rendering; customer commerce and catalog/order extensions; typed rules/growth execution/finance policy; staff/Studio access; RTL shell and overview/plans/team/analytics/commerce/growth/studios/catalog metadata UI; additive schemas/migrations/runner; helper/HTTP/DB/migration/UI tests; lint/build/Render configuration. Detailed file changes are in [PR #4](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/4), with saved-connection/lifecycle/health recovery in [PR #5](https://github.com/th749bvkdm-sys/LootBot-SaaS/pull/5).

Secrets, caches, disposable fixture data and generated test bundles must not be committed.

- [x] 85 helper checks, 16 API checks, other isolated integration suites and 2 migration/constraint tests pass.
- [x] Final ESLint, complete workspace typecheck/build and 85 helper checks pass with the reconnect repair. The mockup build requires its existing PORT/BASE_PATH environment settings; the complete build passed with those supplied.
- [x] Final selector/property regression and four-viewport overflow checks pass.
- [x] Isolated complete db:push and additive migration deployment rehearsal passes.
- [x] Final whitespace/diff review passes.
- [x] Free upgrade-modal/direct-route/focus/Tab/Escape checks pass; desktop/mobile/lock screenshots saved.
- [x] Complete source pushed as 8cc90da; PR #4 merged into main as 73043f2.
- [x] First V2 Render deployment Live from 8d65329; actual build/migrations/new public assets/health and signed-in critical pages verified.
- [x] Real production owner Test Connection/getMe/webhook check succeeds.
- [x] Saved-credential polling resume fix merged/deployed; final source/PR/Render identity, public assets/health and actual successful polling recovery recorded.
- [ ] Perform the real customer-chat Telegram sequence when an authenticated customer session is available.

The real Telegram item stays unverified until actual delivery is observed. Source completion alone is not a substitute for that evidence.
