# تشغيل الكمي محليًا

checkout العمل: `C:/Users/kh7bw/OneDrive/المستندات/GitHub/LootBot-SaaS-glass-release`، فرع `codex/education-platform`.

## معاينة بيانات تجريبية دون الإنتاج

من جذر checkout:

```powershell
pnpm education:preview
```

ثم افتح `http://127.0.0.1:5191/__preview/student` واضغط «مركز القدرات». الإدارة `http://127.0.0.1:5191/__preview/admin` ← «إدارة الكمي». المعلم `http://127.0.0.1:5191/__preview/teacher`. الصفحة الرئيسية `/` وصفحة رمز الطالب `/student-entry`.

المعاينة تنشئ PGlite مؤقتة، دون اتصال بقاعدة الإنتاج. فيها38 سؤالًا أصليًا تجريبيًا (الحزمة30 وثمانية سابقة)، وبيانات مدرسية وهمية. إذا كانت حزمة المفكر الخاصة وإثباتها موجودين واجتازا التحقق، تضيف المعاينة مسودات المصدر وتفعّل المجموعة التي راجعتها المقارنة البصرية فقط. التفاصيل الحالية في `ALMUFAKIR_IMPORT.md`. مسارات `__preview` لا تُستورد في التطبيق العادي. إعادة تشغيل المعاينة تفقد محاولاتها وبياناتها المؤقتة. الرابط محلي لجهازك وليس رابطًا عامًا.

## البناء والتحقق

```powershell
pnpm run typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/lootbot build
pnpm --filter @workspace/api-server test
node --test scripts/import-quant-original.test.mjs
node scripts/import-quant-original.mjs
```

من `artifacts/api-server`:

```powershell
node tests/run-teacher-local.mjs tests/teacher-integration.ts
node tests/run-teacher-local.mjs tests/learning-integration.ts
node tests/run-teacher-local.mjs tests/education-integration.ts
node tests/run-teacher-local.mjs tests/quant-integration.ts
```

الترحيل0016 يضيف منصة الكمي، و0017 يضيف صور الأسئلة الخاصة المرتبطة بالإصدار والمصدر. يحتفظان بالجداول السابقة. لا تطبقهما على الإنتاج دون مراجعة وإذن. التشغيل العادي يستخدم إعداد `DATABASE_URL` الخاص بالخادم وأوامر المشروع القائمة؛ لا تضع سرًا في الواجهة أو التقرير.

## الأسئلة والمصادر

الحزمة الأصلية ودليل استيراد المسودات في `ORIGINAL_QUESTIONS.md`. أداة الحزمة دون أعلام تتحقق حسابيًا فقط ولا تكتب إلى قاعدة. الاستيراد يحتاج حساب مسؤول أعلى واتصالًا خاصًا ومصدرًا معتمدًا، ثم مراجعة الإصدار واعتماده من شخص مختلف عند تفعيل المراجعة. لا يعتمد السكربت أي سؤال ولا ينشر اختبارًا.

تحديث2026-10-14: قدم المالك إذنًا كتابيًا للمفكر، فاستُخدم ملف «المفكر120تحديث(١)» المرفق فقط. الملفان الآخران ما زالا غير مفعّلين. الإذن محفوظ خاصًا ولا ينشر مع الشفرة. بوابة الترخيص والتخزين الخاص وإجراءات الاستكمال في `SOURCES.md` و`ALMUFAKIR_IMPORT.md`.

التقرير الكامل `IMPLEMENTATION_REPORT.md`، والنتائج الآلية `AUTOMATED_VERIFICATION.md` والسجلات `final-*` و`original-tool-tests.log`. الصور داخل `previews`، ولا تحتوي رموز دخول.

تحديث 2026-10-14: مكتبة الفيديو العامة «شرح الأقسام» موثقة في `SECTION_VIDEOS.md`، مع تدقيق 37 رابط يوتيوب في `SECTION_VIDEO_SOURCE_AUDIT.md`. ترقيمها يتبع أقسام المصدر، ولا يربط تلقائيًا بأرقام مجموعات الاختبار المحلية.
