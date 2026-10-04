# LootBot V2 implementation evidence

Specification: user attachment `a0a1b741-3071-4b4a-bf37-3b87d1e11fbb/نص ملصق.txt`.
Branch: `codex/v2-telegram-studio`, based on deployed `b40df5f`.
This is a progress checkpoint, not acceptance of the full V2 specification.

## Audit and root causes

- Existing: real store catalog/categories/orders, encrypted Telegram tokens, polling, product gallery, central plan catalog/gates, owner/session/CSRF guards, administrative dashboard.
- Broken/partial: polling requested only message updates; there was no callback router. `/start` sent text without a full menu. Product browsing used text commands. The legacy designer saved message settings directly with no independent draft or publication.
- Initially missing: Business block builder/custom menus and audience rules. The follow-up checkpoint implements a validated subset below. Advanced segmentation, customer journeys, broadcast/automation execution, loyalty/referrals/coupons/favorites/cart, themes and comprehensive acceptance tests remain missing.

## Implemented in this checkpoint

- Receive message and callback updates; validate callbacks against explicit actions and the 64-byte limit; rate-limit callbacks; acknowledge presses and close keyboards.
- Default `/start` menu: Products, Categories, Search, My orders, My account. Unsupported features are omitted.
- Real catalog/category queries, published/non-deleted filters, stable pagination and safe missing-target fallback. Category return preserves the originating list page; product return preserves the catalog/category/search page.
- Search by name/description/SKU; escape SQL wildcard characters; empty states, clear/new search, independent query snapshots and refresh. Context isolated by store/customer/chat and bounded to 10,000 entries with 15-minute expiry. Restart safely prompts another search or returns Home.
- Private customer account and order list/details, filtered by store and acting Telegram user. Arabic order/payment status labels, items/date/total, correct list-page return and refresh.
- Product details with real price/stock/description, one-item order action through the existing idempotent order flow, first image and previous/next gallery images with counter. `/start product_<12-character-product-code>` deep links. Pro gallery entitlement remains enforced.
- Pro/Business home designer: header, subtitle, welcome, footer, one/two/three columns, emoji visibility, five actual actions, labels, ordering, enabled state. Validation rejects unsupported actions, duplicates and empty menus.
- Persistent draft/published configurations in existing store settings. Revision conflict detection and store-row transaction lock. Publication uses the saved draft; unsaved UI changes cannot be published. Shared server renderer powers both preview and runtime. Runtime reads only published configuration, applies the current plan, and safely falls back to defaults.
- Telegram health API/UI: actual credential and webhook check with owner/session/CSRF/plan guards, three tests/minute/store, safe error messages and audit. Separate timestamps for successful polling and explicit connection tests. Token rotation prevents writing test results to another connection.
- Website shell visual update: muted violet/mint accents, active navigation, welcome panel, focus outlines, larger mobile controls, RTL-safe borders, reduced motion, scrollable sidebar, independent accessible close control. Corrected a conditional dashboard hook call. No fake online indicator.
- Business three-pane editor: screen list/component palette, server preview, editable properties. Root/child/grandchild screens (maximum depth three), add/duplicate/delete/reorder/reparent/disable, up to 30 screens. Text/Header/FAQ/Divider blocks with ordering, content and visibility. Six allowlisted real actions: screen/products/categories/search/orders/account. Custom buttons support label/enable/order/target. No arbitrary code or unimplemented action is accepted.
- Business visibility: all customers, customers with no prior store orders or with a prior order; UTC start/end dates; ancestor rules also enforced. Runtime resolves prior orders from the store and acting Telegram user, not client claims. Rules reevaluated on callbacks. This is not a full segmentation engine.
- Independent Business draft/published JSON, revision checks, transaction lock, audit and shared server/runtime renderer. Root cannot be hidden by audience/date rules; an empty root menu safely falls back to actual store actions. Publish rejects cycles, excessive depth, unknown actions, duplicate IDs, missing targets and invalid timestamps.
- Business navigation retains origin across built-in catalogs, pagination, product/gallery and text search using store/customer/chat-scoped references with 15-minute expiry. Expired references or disabled source screens prompt a new `/start`. Home always returns the active home.
- New central `telegram.studio` entitlement: Business default only; persisted administrative definitions gain this new key safely. Publishing Pro or Business sets `telegramHomeMode`, so the last published designer controls `/start`; saving/previewing does not switch runtime mode.

## API and storage

- GET `/api/stores/:storeId/telegram/studio`
- POST `/api/stores/:storeId/telegram/studio/{draft,preview,publish}`
- GET `/api/stores/:storeId/telegram/health`
- POST `/api/stores/:storeId/telegram/test-connection`
- GET `/api/stores/:storeId/telegram/business-studio`
- POST `/api/stores/:storeId/telegram/business-studio/{draft,preview,publish}`
- Home data: existing `store_settings.settings.telegramHomeStudio` `{draft,published,revision}`.
- Business data: existing settings JSON `telegramBusinessStudio` `{draft,published,revision}` and `telegramHomeMode`; no new tables for these configurations.
- Additive migration `lib/db/migrations/0002_telegram_health.sql`: three nullable telemetry fields in existing `telegram_bots`. Existing deployment `db:push` must apply the schema before this code runs. No duplicate configuration tables.

## Acceptance map (all 32 sections)

| Section | State and remaining work |
| --- | --- |
| 01 Audit | Recorded above; full performance audit still needed. |
| 02 /start | Implemented in code; live Telegram acceptance pending. Offers/cart/loyalty/etc unavailable and omitted. |
| 03 Navigation | Built-in nested screens, Back/Home/Close/Refresh/pagination/search/product deep link implemented; custom screen model remains. |
| 04 Pro Designer | Home/header/navigation implemented; other screen designers, banners/card/state styles remain. |
| 05 Product | Existing details/gallery/order plus navigation implemented; discounts/warranty/tags/rating/cart/share/favorites remain. |
| 06 Search/customer | Text search/order/account implemented; loyalty/referrals/favorites/coupons/notifications remain. |
| 07 Business Studio | Three-pane editor and four validated content block types implemented with runtime; full component catalogue remains. |
| 08 Menu tree | Root/child/grandchild, reorder/duplicate/disable/delete/preview and six actions implemented; product/category targets, external links and other requested actions remain. |
| 09 Dynamic menus | Prior-order audience and UTC date rules implemented including ancestor enforcement; full segments/campaign/spend/VIP/points rules remain. |
| 10 Journeys | Missing journey engine. |
| 11 Broadcast | Missing campaigns/queue/outcomes. |
| 12 Automation | Missing builder/validation/job execution. |
| 13 Themes | Missing bot themes and renderer integration. |
| 14 Draft/preview/publish | Pro home and Business screens/blocks implemented; full remaining component types need the same pipeline. |
| 15 Visual redesign | Shell styling begun; full site redesign remains. |
| 16 Dashboard | Welcome/navigation updated; expanded real-data charts/analytics remain. |
| 17 Designer UI | Responsive Pro home editor and Business three-pane editor/server preview implemented; browser/mobile QA pending. |
| 18 Pro expansion | Partial; remainder tracked in sections 04–06 and original contract. |
| 19 Business expansion | Required, incomplete. |
| 20 Health | API/UI/telemetry implemented; DB and live Telegram checks pending. |
| 21 Gates | Pro home/legacy designer/gallery, basic connection and Business studio enforced; gates for remaining features needed. |
| 22 Responsive | Responsive editor/shell controls implemented; browser/device QA pending. |
| 23 Design system | Shared shell accents/focus/mobile/motion rules implemented; full token/component adoption remains. |
| 24 Security | Existing auth/CSRF/owner gates retained, bounded allowlisted config/callbacks and private order scope added; integration/staff tests remain. |
| 25 Callbacks | Validated/scoped callbacks and deleted/expired fallbacks; full live stale callback matrix pending. |
| 26 DB/config | Reuses store settings; additive health migration included, not executed locally. Future Business models remain. |
| 27 Tests | Pure validation/navigation/plan tests covered; DB/API/browser/full feature integration matrix remains. |
| 28 Live acceptance | Not run against new branch: no local DB/Telegram credential environment provisioned. |
| 29 No fake completion | Unimplemented features remain omitted/disabled; this document explicitly records partial scope. |
| 30 Execution | Audit/start/Pro home/navigation checks completed locally; Business and full QA remain. |
| 31 Done | Not satisfied. |
| 32 Final report | This checkpoint documents evidence; final report requires remaining implementation and acceptance. |

## Verification limits

First checkpoint checks on 2026-10-04: full workspace typecheck passed; all 26 unit tests passed; API and frontend production builds passed; `git diff --check` passed. Business follow-up passes workspace typecheck, all 33 unit tests, both production builds and `git diff --check`. Frontend build retains an existing tooltip sourcemap warning; it does not fail the build.

- Unit checks cover pure helpers, not actual database writes, Telegram delivery, route authorization or browser interaction.
- No local `DATABASE_URL` configured; migration and API integration cannot be executed until a test DB environment is available.
- Live bot/customer credentials are not locally provisioned; no Telegram success is claimed for this branch.
- No lint script exists. Typecheck/build are separate checks, not a substitute for lint or live tests.
- Actions are limited to supported screens/products/categories/search/orders/account. Business still lacks image/product/category blocks, advanced conditions/segments, journeys, broadcasts, automation and themes. Customer commerce features remain required; flags for unimplemented paid features remain disabled.
- None of this checkpoint has been merged or deployed. Production still runs the previous release.
