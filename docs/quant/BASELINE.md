# نقطة الأساس قبل تطوير الكمي

تاريخ التنفيذ: 2026-10-13. الفرع المحلي: `codex/education-platform` في checkout معزول `LootBot-SaaS-glass-release`.

سُجلت النتائج التالية قبل أي تعديل لميزة الكمي. تستخدم اختبارات التكامل قاعدة PostgreSQL محلية مؤقتة عبر PGlite، وتُنشئ حسابات وأسئلة أصلية تجريبية فقط.

| الأمر | النتيجة الفعلية | السجل |
|---|---|---|
| `pnpm --filter @workspace/api-server test` | 107 اختبارات ناجحة، 0 فشل | `baseline-unit.log` |
| `node tests/run-teacher-local.mjs tests/teacher-integration.ts` | 12 ناجحة، 0 فشل | `baseline-teacher.log` |
| `node tests/run-teacher-local.mjs tests/learning-integration.ts` | 12 ناجحة، 0 فشل | `baseline-learning.log` |
| `node tests/run-teacher-local.mjs tests/education-integration.ts` | 6 ناجحة، 0 فشل | `baseline-education.log` |
| `pnpm run typecheck` | exit 0 | `baseline-typecheck.log` |
| `pnpm --filter @workspace/api-server build` | exit 0 | `baseline-api-build.log` |
| `pnpm --filter @workspace/lootbot build` | exit 0 | `baseline-ui-build.log` |

المجموع المسجل: 137 اختبارًا ناجحًا. تحذير واجهة Vite عن ملفات JavaScript أكبر من 500kB موجود في نقطة الأساس، ولم يفشل البناء.

تُشغّل أوامر runner من مجلد `artifacts/api-server`. محاولة أولية من جذر المستودع أخفقت في حل مسار المخطط النسبي؛ صححت مجلد التشغيل ثم شغلت الاختبارات الثلاثة كاملة بنتائج الجدول. لم يتطلب هذا تعديلًا للكود.

لا تتضمن نقطة الأساس ادعاء تغطية ميزات الكمي الجديدة. تُسجل تغطيتها في `quant-integration.log` وتقرير التحقق بعد التنفيذ.

لم تُفتح ملفات PDF المرفقة أو تُستخرج محتوياتها ضمن هذه الأوامر. لم يُنفذ commit أو push أو نشر خارجي.
