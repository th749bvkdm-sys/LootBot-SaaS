import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { quantApi, number } from "./api";

type Preview = {
  fingerprint: string;
  readyCount: number;
  blockedCount: number;
  publishedCount: number;
  questionApprovalCount: number;
  requiresHumanReview: boolean;
  sections: {
    id: string;
    title: string;
    status: string;
    questionCount: number;
    ready: boolean;
    reasons: string[];
  }[];
};
type Result = {
  publishedCount: number;
  approvedQuestionCount: number;
  blockedCount: number;
};
type Action = {
  busy: boolean;
  error: string;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<unknown>;
};

export function QuantBulkPublish({ action }: { action: Action }) {
  const [open, setOpen] = useState(false),
    [reviewedFingerprint, setReviewedFingerprint] = useState(""),
    [note, setNote] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  const preview = useQuery<Preview>({
    queryKey: ["quant", "bulk-publication-preview"],
    enabled: open,
    queryFn: () => quantApi<Preview>("/admin/tests/bulk-publish"),
    retry: false,
    staleTime: 0,
  });
  const data = preview.data;
  const reviewed = !!data && reviewedFingerprint === data.fingerprint;
  async function submit() {
    if (!data || !reviewed || note.trim().length < 20 || !data.readyCount)
      return;
    const saved = await action.run(
      () =>
        quantApi<Result>("/admin/tests/bulk-publish", "POST", {
          fingerprint: data.fingerprint,
          humanReviewed: true,
          reviewNote: note.trim(),
        }),
      "اكتمل اعتماد ونشر الأقسام الجاهزة.",
    );
    if (saved) {
      setResult(saved as Result);
      setReviewedFingerprint("");
    }
  }
  return (
    <>
      <section className="edu-card" aria-label="نشر أقسام المفكر">
        <h3>إظهار أقسام المفكر للطلاب</h3>
        <p>
          يجب اعتماد أسئلة القسم ونشر اختباره حتى يظهر للطلاب في نطاقه. هذا
          الإجراء يجمع الخطوتين بعد تأكيد مراجعتك للمحتوى.
        </p>
        <button
          className="edu-button"
          disabled={action.busy}
          onClick={() => {
            setReviewedFingerprint("");
            setNote("");
            setResult(null);
            setOpen(true);
          }}
        >
          اعتماد ونشر الكل
        </button>
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
          <DialogTitle>اعتماد ونشر جميع أقسام المفكر الجاهزة</DialogTitle>
          <DialogDescription>
            تُفحص جميع الأقسام من المصدر المسجّل، ويُحفظ نطاق المدرسة والفصل
            والمرحلة. لا تُعاد إتاحة الأقسام المخفية عمدًا، ولا تُغيّر المحاولات
            السابقة.
          </DialogDescription>
          {preview.isFetching && <p role="status">جار فحص الأقسام والأسئلة…</p>}
          {preview.isError && (
            <p className="edu-notice edu-error" role="alert">
              {preview.error.message}
            </p>
          )}
          {action.error && (
            <p className="edu-notice edu-error" role="alert">
              {action.error}
            </p>
          )}
          {result && (
            <p className="edu-notice" role="status">
              نُشر {number(result.publishedCount)} قسمًا، واعتمد{" "}
              {number(result.approvedQuestionCount)} سؤالًا. بقي{" "}
              {number(result.blockedCount)} قسمًا مع توضيح السبب أدناه.
            </p>
          )}
          {data && (
            <>
              <div className="edu-notice" aria-live="polite">
                جاهز للنشر: {number(data.readyCount)} قسمًا · أسئلة تحتاج
                اعتمادك: {number(data.questionApprovalCount)} · غير جاهز أو
                مخفي: {number(data.blockedCount)} · منشور سابقًا:{" "}
                {number(data.publishedCount)}
              </div>
              {!data.sections.length && (
                <p className="edu-empty">
                  لا توجد اختبارات مرتبطة بمصدر المفكر المسجّل. استيراد الأسئلة
                  وحده لا يُنشئ قسمًا منشورًا.
                </p>
              )}
              {data.requiresHumanReview && (
                <p className="edu-note">
                  بعض الأسئلة لم تُسجّل مراجعتها بعد. أكّد المراجعة فقط بعد فحص
                  نصها وخياراتها ومفتاحها مقابل المصدر. زر النشر لا يراجع صحة
                  الإجابات نيابة عنك.
                </p>
              )}
              {!!data.readyCount && (
                <form
                  className="edu-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <label className="edu-wide quant-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={action.busy}
                      onChange={(e) =>
                        setReviewedFingerprint(
                          e.target.checked ? data.fingerprint : "",
                        )
                      }
                    />
                    <span>
                      أؤكد أنني راجعت الأسئلة المراد اعتمادها مقابل المصدر،
                      وأوافق على اعتماد ونشر الأقسام الجاهزة الموضحة.
                    </span>
                  </label>
                  <label className="edu-wide">
                    ملاحظة المراجعة (20 حرفًا على الأقل)
                    <textarea
                      minLength={20}
                      maxLength={2000}
                      required
                      value={note}
                      disabled={action.busy}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="دوّن نطاق مراجعتك وما تحققت منه…"
                    />
                  </label>
                  <button
                    className="edu-button"
                    disabled={
                      action.busy ||
                      preview.isFetching ||
                      !reviewed ||
                      note.trim().length < 20
                    }
                  >
                    {action.busy
                      ? "جار الاعتماد والنشر…"
                      : `تأكيد اعتماد ونشر ${number(data.readyCount)} قسمًا`}
                  </button>
                </form>
              )}
              <div className="edu-actions">
                <button
                  className="edu-button secondary"
                  disabled={action.busy || preview.isFetching}
                  onClick={() => {
                    setReviewedFingerprint("");
                    void preview.refetch();
                  }}
                >
                  تحديث المعاينة
                </button>
              </div>
              <div aria-label="حالة أقسام المفكر">
                {data.sections.map((section) => (
                  <div className="edu-row" key={section.id}>
                    <div>
                      <strong>{section.title}</strong>
                      <small>
                        {number(section.questionCount)} أسئلة ·{" "}
                        {section.status === "published"
                          ? "منشور"
                          : section.ready
                            ? "جاهز للنشر"
                            : "يتطلب إجراءً"}
                      </small>
                      {section.reasons.map((reason) => (
                        <p className="edu-note" key={reason}>
                          {reason}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
