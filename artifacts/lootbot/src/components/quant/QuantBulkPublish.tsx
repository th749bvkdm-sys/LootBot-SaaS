import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { quantApi, QuantError, number } from "./api";
type Section = {
  id: string;
  title: string;
  status: string;
  questionCount: number;
  ready: boolean;
  reasons: string[];
};
type Preview = {
  fingerprint: string;
  readyCount: number;
  blockedCount: number;
  publishedCount: number;
  sections: Section[];
};
type Result = {
  publishedCount: number;
  approvedQuestionCount: number;
  blockedCount: number;
  alreadyPublishedCount: number;
  totalCount: number;
  blockedSections: { id: string; title: string; reasons: string[] }[];
};
type Action = {
  busy: boolean;
  error: string;
  can: (permission: string) => boolean;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<unknown>;
};
export function QuantBulkPublish({ action }: { action: Action }) {
  const missingPermissions = [
    ["quant.questions.approve", "اعتماد أسئلة الكمي"],
    ["quant.tests.write", "إدارة اختبارات الكمي"],
    ["quant.tests.publish", "نشر اختبارات الكمي"],
  ].filter(([permission]) => !action.can(permission));
  const canPublish = missingPermissions.length === 0,
    inFlight = useRef(false);
  const [open, setOpen] = useState(
      () =>
        new URLSearchParams(window.location.search).get("quantPublish") === "1",
    ),
    [result, setResult] = useState<Result | null>(null);
  const preview = useQuery<Preview>({
    queryKey: ["quant", "bulk-publication-preview"],
    enabled: open && canPublish,
    queryFn: () => quantApi<Preview>("/admin/tests/bulk-publish"),
    retry: false,
    staleTime: 0,
  });
  async function publish() {
    if (!canPublish) {
      setOpen(true);
      return;
    }
    if (inFlight.current || action.busy) return;
    inFlight.current = true;
    setResult(null);
    try {
      const saved = await action.run(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const plan = await quantApi<Preview>("/admin/tests/bulk-publish");
          try {
            const published = await quantApi<Result>(
              "/admin/tests/bulk-publish",
              "POST",
              {
                fingerprint: plan.fingerprint,
                humanReviewed: true,
                reviewNote:
                  "أقر المسؤول بمراجعة أسئلة الأقسام وطلب اعتمادها ونشر الاختبارات بالضغط على نشر الكل.",
              },
            );
            return { ...published, totalCount: plan.sections.length };
          } catch (error) {
            if (
              attempt === 0 &&
              error instanceof QuantError &&
              error.details.code === "PUBLICATION_PREVIEW_CHANGED"
            )
              continue;
            throw error;
          }
        }
        throw Error("تغيّر المحتوى أثناء النشر؛ حاول مرة أخرى.");
      }, "اكتملت معالجة طلب نشر أقسام المفكر؛ راجع العدد المنشور والنتيجة أدناه.");
      if (saved) setResult(saved as Result);
    } finally {
      inFlight.current = false;
    }
  }
  const resultPanel = result && (
    <div className="edu-notice" role="status">
      <p>
        {result.publishedCount
          ? `نُشر ${number(result.publishedCount)} قسمًا واعتمد ${number(result.approvedQuestionCount)} سؤالًا؛ أصبحت الاختبارات متاحة للطلاب في نطاقها.`
          : !result.totalCount
            ? "لا توجد أقسام مرتبطة بمصدر المفكر المسجّل."
            : result.blockedCount
              ? "بقيت الأقسام التالية بسبب أخطاء محددة:"
              : "جميع أقسام المفكر منشورة بالفعل."}
      </p>
      {!!result.blockedSections?.length && (
        <ul>
          {result.blockedSections.map((section) => (
            <li key={section.id}>
              <strong>{section.title}: </strong>
              {section.reasons.join(" ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  const publishButton = (
    <button
      className="edu-button"
      disabled={action.busy}
      onClick={() => void publish()}
    >
      {action.busy ? "جار اعتماد الأسئلة ونشر الاختبارات…" : "اعتماد ونشر الكل"}
    </button>
  );
  return (
    <>
      <section className="edu-card" aria-label="نشر أقسام المفكر">
        <h3>نشر أقسام المفكر للطلاب</h3>
        <p>
          راجعت الأسئلة؟ اضغط «اعتماد ونشر الكل» ليُسجّل اعتمادك وتُنشر
          الاختبارات مباشرة. لا تحتاج لاعتماد كل سؤال على حدة.
        </p>
        <div className="edu-actions">
          {publishButton}
          <button
            className="edu-button secondary"
            disabled={action.busy}
            onClick={() => setOpen(true)}
          >
            تفاصيل الأقسام
          </button>
        </div>
        {!canPublish && (
          <p className="edu-note">
            الحساب يحتاج صلاحيات الاعتماد والنشر؛ اضغط الزر لعرض الصلاحيات
            المطلوبة.
          </p>
        )}
        {!open && resultPanel}
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!action.busy) setOpen(value);
        }}
      >
        <DialogContent
          className="quant-editor-dialog edu-room"
          dir="rtl"
          style={{ width: "calc(100% - 24px)", minHeight: 0, borderRadius: 20 }}
        >
          <DialogTitle>اعتماد ونشر أقسام المفكر</DialogTitle>
          <DialogDescription>
            ضغطك على «اعتماد ونشر الكل» يسجل إقرارك بأنك راجعت الأسئلة وينشر
            الاختبارات. تبقى خصوصية المدرسة والفصل وسلامة ملف السؤال محفوظة.
          </DialogDescription>
          {!canPublish && (
            <div className="edu-notice edu-error" role="alert">
              <p>الصلاحيات المطلوبة للحساب:</p>
              <ul>
                {missingPermissions.map(([key, label]) => (
                  <li key={key}>{label}</li>
                ))}
              </ul>
            </div>
          )}
          {action.error && (
            <p className="edu-notice edu-error" role="alert">
              {action.error}
            </p>
          )}
          {resultPanel}
          {canPublish && publishButton}
          {preview.isFetching && <p role="status">جار تحميل حالة الأقسام…</p>}
          {preview.isError && (
            <p className="edu-notice edu-error" role="alert">
              {preview.error.message}
            </p>
          )}
          {canPublish && preview.data && (
            <>
              <p className="edu-note">
                جاهز للنشر: {number(preview.data.readyCount)} · منشور سابقًا:{" "}
                {number(preview.data.publishedCount)} · يحتاج تصحيح بيانات:{" "}
                {number(preview.data.blockedCount)}
              </p>
              {preview.data.sections.map((section) => (
                <div className="edu-row" key={section.id}>
                  <div>
                    <strong>{section.title}</strong>
                    <small>
                      {number(section.questionCount)} أسئلة ·{" "}
                      {section.ready
                        ? section.status === "published"
                          ? "منشور"
                          : "جاهز للنشر"
                        : "يحتاج تصحيحًا"}
                    </small>
                    {section.reasons.map((reason) => (
                      <p className="edu-note" key={reason}>
                        {reason}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
