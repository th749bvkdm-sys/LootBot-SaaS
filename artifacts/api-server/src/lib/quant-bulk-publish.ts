import type { Request } from "express";
import { createHash } from "node:crypto";
import { actor, root, authorize, settings, type Query } from "./education";
import { createId } from "./security";
import {
  approvedVersion,
  snapshotItem,
  versionQuery,
  QuantError,
} from "./quant";

export const mufakirSourceHash =
  "3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b";
type TestRow = Record<string, any>;
type Section = {
  id: string;
  title: string;
  status: string;
  questionCount: number;
  ready: boolean;
  reasons: string[];
};

export async function bulkPublishAccess(req: Request, q: Query) {
  for (const key of [
    "quant.questions.approve",
    "quant.tests.write",
    "quant.tests.publish",
  ])
    await authorize(req, key, "", q);
}

/** Build and revalidate a complete server-side plan; never uses the paginated UI question list. */
export async function prepareMufakirPublication(
  req: Request,
  q: Query,
  lock = false,
  testId?: string,
) {
  await bulkPublishAccess(req, q);
  if (lock && !testId)
    await q.query(
      "SELECT pg_advisory_xact_lock(hashtext('quant-mufakir-bulk-publication'))",
    );
  const tests: TestRow[] = (
    await q.query(
      `SELECT t.* FROM quant_tests t WHERE EXISTS (
    SELECT 1 FROM quant_test_items i JOIN quant_question_reviews r ON r.version_id=i.version_id
    JOIN quant_sources s ON s.id=r.source_id WHERE i.test_id=t.id AND s.file_hash=$1)
    AND ($2::text IS NULL OR t.id=$2)
    ORDER BY t.id ${lock ? "FOR UPDATE OF t" : ""}`,
      [mufakirSourceHash, testId || null],
    )
  ).rows;
  const items: TestRow[] = tests.length
    ? (
        await q.query(
          `SELECT test_id,version_id,position FROM quant_test_items
    WHERE test_id=ANY($1::text[]) ORDER BY test_id,position ${lock ? "FOR SHARE" : ""}`,
          [tests.map((t) => t.id)],
        )
      ).rows
    : [];
  const versionIds = [...new Set(items.map((i) => i.version_id as string))];
  const rows: TestRow[] = versionIds.length
    ? (
        await q.query(
          versionQuery +
            ` WHERE v.id=ANY($1::text[]) ORDER BY v.id ${lock ? "FOR UPDATE OF r,q" : ""}`,
          [versionIds],
        )
      ).rows
    : [];
  if (lock && rows.length) {
    const sources = (
      await q.query(
        "SELECT * FROM quant_sources WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE",
        [[...new Set(rows.map((r) => r.source_id).filter(Boolean))]],
      )
    ).rows;
    for (const row of rows) {
      const source = sources.find((s) => s.id === row.source_id);
      Object.assign(row, {
        license_status: source?.license_status ?? null,
        license_note: source?.license_note ?? null,
        source_file_hash: source?.file_hash ?? null,
        source_page_count: source?.page_count ?? null,
        attribution: source?.attribution ?? null,
        source_title: source?.title ?? null,
      });
    }
  }
  const secondReviewer = (await settings("", q)).contentReview;
  // The owner explicitly authorizes the Super Admin's publication click as their review approval.
  const administratorReview = root(req);
  const byId = new Map(rows.map((r) => [r.version_id, r]));
  const scopes: TestRow[] = (
    await q.query(
      `SELECT c.id,c.archived,sc.school_id FROM teacher_classes c
    LEFT JOIN education_school_classes sc ON sc.class_id=c.id WHERE c.id=ANY($1::text[]) ORDER BY c.id`,
      [tests.map((t) => t.class_id).filter(Boolean)],
    )
  ).rows;
  const schools: TestRow[] = (
    await q.query(
      "SELECT id,status FROM education_schools WHERE id=ANY($1::text[]) ORDER BY id",
      [tests.map((t) => t.school_id).filter(Boolean)],
    )
  ).rows;
  const sections: Section[] = tests.map((t) => {
    const list = items.filter((i) => i.test_id === t.id),
      reasons = new Set<string>(),
      seen = new Set<string>();
    // Explicit Super Admin publication includes hidden sections; other roles preserve the hidden state.
    if (t.status === "hidden" && !administratorReview)
      reasons.add("القسم مخفي عمدًا؛ أعد نشره منفردًا عند الرغبة.");
    if (!list.length || list.length > 100)
      reasons.add("عدد الأسئلة يجب أن يكون بين 1 و100.");
    if (
      ["timed", "simulation"].includes(t.mode) &&
      (!t.time_limit_sec || t.time_limit_sec < 60 || t.time_limit_sec > 14400)
    )
      reasons.add("مدة الاختبار غير مكتملة.");
    if (t.reveal_policy === "after_deadline" && !t.reveal_at)
      reasons.add("موعد إظهار الحلول غير محدد.");
    if (
      t.school_id &&
      !schools.some((s) => s.id === t.school_id && s.status === "active")
    )
      reasons.add("مدرسة الاختبار غير نشطة.");
    if (
      t.class_id &&
      !scopes.some(
        (c) =>
          c.id === t.class_id && !c.archived && c.school_id === t.school_id,
      )
    )
      reasons.add("الفصل غير متاح في مدرسة الاختبار.");
    for (const item of list) {
      const row = byId.get(item.version_id);
      if (!row) {
        reasons.add("يوجد إصدار سؤال غير متاح.");
        continue;
      }
      if (seen.has(row.question_id)) reasons.add("يوجد سؤال مكرر داخل القسم.");
      seen.add(row.question_id);
      if (row.source_file_hash !== mufakirSourceHash)
        reasons.add("يتضمن القسم سؤالًا من مصدر آخر.");
      if (!approvedVersion({ ...row, review_status: "approved" }))
        reasons.add("ترخيص المصدر أو تصنيف السؤال غير متاح للنشر.");
      if (
        !row.source_page ||
        (row.source_page_count && row.source_page > row.source_page_count)
      )
        reasons.add("صفحة مصدر السؤال غير صالحة.");
      if (
        ![
          "draft",
          "extracted",
          "needs_review",
          "reviewed",
          "approved",
        ].includes(row.review_status) &&
        !administratorReview
      )
        reasons.add("يوجد سؤال مرفوض؛ راجعه منفردًا.");
      if (
        row.review_status !== "approved" &&
        secondReviewer &&
        !administratorReview &&
        row.author_id === actor(req)
      )
        reasons.add("اعتماد هذه الأسئلة يحتاج مراجعًا مخوّلًا غير مؤلفها.");
      if (
        Array.isArray(row.snapshot?.content?.extractionUncertainties) &&
        row.snapshot.content.extractionUncertainties.length &&
        row.review_status !== "approved" &&
        !administratorReview
      )
        reasons.add("يوجد سؤال عليه ملاحظة استخراج؛ عالجها وراجعه منفردًا.");
      if (
        (row.school_id && row.school_id !== t.school_id) ||
        (row.class_id && row.class_id !== t.class_id) ||
        (row.stage && row.stage !== t.stage)
      )
        reasons.add("نطاق السؤال لا يتوافق مع مدرسة أو فصل أو مرحلة الاختبار.");
      try {
        snapshotItem(row, item.position);
      } catch (error) {
        if (!(error instanceof QuantError)) throw error;
        reasons.add("يوجد سؤال بخيارات أو مفتاح إجابة غير مكتمل.");
      }
    }
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      questionCount: list.length,
      ready: reasons.size === 0,
      reasons: [...reasons],
    };
  });
  const ready = sections.filter(
    (s) =>
      s.ready &&
      (s.status !== "published" ||
        items.some(
          (i) =>
            i.test_id === s.id &&
            byId.get(i.version_id)?.review_status !== "approved",
        )),
  );
  const readyIds = new Set(ready.map((s) => s.id));
  const approvedIds = new Set(
    items.filter((i) => readyIds.has(i.test_id)).map((i) => i.version_id),
  );
  const toApprove = rows.filter(
    (r) => approvedIds.has(r.version_id) && r.review_status !== "approved",
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tests,
        items,
        rows,
        scopes,
        schools,
        secondReviewer,
        actor: actor(req),
      }),
    )
    .digest("hex");
  return {
    preview: {
      fingerprint,
      sections,
      readyCount: ready.length,
      blockedCount: sections.filter((s) => !s.ready).length,
      publishedCount: sections.filter((s) => s.status === "published").length,
      questionApprovalCount: toApprove.length,
      requiresHumanReview: toApprove.some(
        (r) => r.review_status !== "reviewed",
      ),
    },
    ready,
    toApprove,
  };
}

/** Review approval and test publication share one transaction; audit rows are inserted in batches. */
export async function applyMufakirPublication(
  req: Request,
  q: Query,
  plan: Awaited<ReturnType<typeof prepareMufakirPublication>>,
  reviewNote: string,
) {
  const ids = plan.toApprove.map((row) => row.version_id);
  if (ids.length) {
    await q.query(
      "UPDATE quant_question_reviews SET review_status='approved',review_note=$2,reviewed_by=$3,updated_at=now() WHERE version_id=ANY($1::text[])",
      [ids, reviewNote, actor(req)],
    );
    await q.query(
      `UPDATE education_questions question SET status='published',reviewed_by=$2,updated_at=now()
      FROM education_question_versions version WHERE version.id=ANY($1::text[]) AND question.id=version.question_id AND question.revision=version.number`,
      [ids, actor(req)],
    );
  }
  const readyIds = plan.ready.map((section) => section.id);
  if (readyIds.length)
    await q.query(
      "UPDATE quant_tests SET status='published',updated_at=now() WHERE id=ANY($1::text[])",
      [readyIds],
    );
  const events = [
    ...plan.toApprove.map((row) => ({
      id: createId(),
      action: "education.quant.question.bulk-approved",
      details: {
        resource: row.question_id,
        versionId: row.version_id,
        previousStatus: row.review_status,
        reviewNote,
        humanReviewed: true,
        administratorReview: root(req),
      },
    })),
    ...plan.ready.map((section) => ({
      id: createId(),
      action: "education.quant.test.bulk-published",
      details: {
        resource: section.id,
        title: section.title,
        previousStatus: section.status,
        administratorReview: root(req),
      },
    })),
  ];
  if (events.length)
    await q.query(
      `INSERT INTO audit_logs(id,user_id,action,summary,details)
    SELECT event->>'id',$1,event->>'action','اعتماد ونشر أقسام المفكر',event->'details'
    FROM jsonb_array_elements($2::jsonb) AS event`,
      [actor(req), JSON.stringify(events)],
    );
  return {
    publishedCount: plan.ready.length,
    approvedQuestionCount: plan.toApprove.length,
    blockedCount: plan.preview.blockedCount,
    alreadyPublishedCount: plan.preview.publishedCount,
    blockedSections: plan.preview.sections
      .filter((section) => !section.ready)
      .map(({ id, title, reasons }) => ({ id, title, reasons })),
  };
}
