import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import {
  requireAuth,
  requireTeacher,
  requireCsrf,
} from "../lib/auth-middleware";
import { createId } from "../lib/security";
import { chemistryPack, chemistryCheck, equation } from "../lib/chemistry";
export const chemistryRouter = Router();
chemistryRouter.use(
  "/teacher/chemistry",
  requireAuth,
  requireTeacher,
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method === "GET") next();
    else requireCsrf(req, res, next);
  },
);
const route =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (e instanceof z.ZodError)
        res.status(400).json({ error: "تحقق من المدخلات." });
      else next(e);
    }
  };
chemistryRouter.get(
  "/teacher/chemistry/catalog",
  route(async (_req, res) => {
    res.json(chemistryPack);
  }),
);
chemistryRouter.post(
  "/teacher/chemistry/check",
  route(async (req, res) => {
    const input = z
      .object({
        reactants: z.array(z.string().max(40)).min(1).max(4),
        condition: z.string().max(40),
        predictsReaction: z.boolean(),
        coefficients: z.array(z.number().int().min(1).max(20)).optional(),
      })
      .parse(req.body);
    res.json(chemistryCheck(input));
  }),
);
chemistryRouter.post(
  "/teacher/chemistry/activity",
  route(async (req, res) => {
    const { reactionId } = z.object({ reactionId: z.string() }).parse(req.body);
    const reaction = chemistryPack.reactions.find((r) => r.id === reactionId);
    if (!reaction) {
      res.status(400).json({ error: "نموذج غير موثق." });
      return;
    }
    const makeStep = (
      title: string,
      explanation: string,
      question: string,
      correct: string,
      wrong: string,
      concept: string,
    ) => ({
      id: createId(),
      title,
      explanation,
      altExplanation:
        concept === "conservation"
          ? "تخيل كل ذرة قطعة ثابتة: يعاد ترتيب القطع ولا تُفقد."
          : "قارن النواتج المعطاة في المعادلة بالمتفاعلات.",
      imageAssetId: null,
      altImageAssetId: null,
      question,
      options: [
        { id: createId(), text: correct, isCorrect: true },
        { id: createId(), text: wrong, isCorrect: false },
      ],
      hint: "راجع النموذج والشروط المائية المحددة.",
      correctExplanation: explanation,
      concept,
    });
    const draft = {
      title: "مختبر افتراضي — " + reaction.title,
      subject: "الكيمياء",
      grade: reaction.grade,
      objective: "التوقع والمحافظة على الذرات وموازنة المعادلة",
      description:
        chemistryPack.scope +
        "\n" +
        chemistryPack.review +
        "\n" +
        reaction.safety,
      chemistry: { reactionId, packVersion: chemistryPack.version },
      steps: [
        makeStep(
          "توقف للتوقع",
          "المواد: " +
            reaction.reactants.map((v) => v.formula).join(" + ") +
            " في نموذج مائي.",
          "هل يحدث تفاعل صافٍ في هذا النموذج؟",
          reaction.reaction ? "نعم" : "لا",
          reaction.reaction ? "لا" : "نعم",
          "prediction",
        ),
        makeStep(
          "راجع النواتج",
          reaction.explanation + "\n" + equation(reaction),
          "أي معادلة توافق النموذج الموثق؟",
          equation(reaction),
          "نفس المواد دائمًا دون مراعاة الشروط",
          "products",
        ),
        makeStep(
          "حفظ الذرات",
          "المعادلة المتوازنة تحفظ عدد ذرات كل عنصر.",
          "هل يمكن أن تختفي ذرات عنصر في المعادلة الكيميائية المتوازنة؟",
          "لا، عدد ذرات كل عنصر محفوظ",
          "نعم، قد تختفي بعض الذرات",
          "conservation",
        ),
      ],
    };
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      const activityId = createId(),
        versionId = createId();
      await q.query(
        "INSERT INTO teacher_activities(id,owner_id,type,draft,current_version_id,status) VALUES($1,$2,'chemistry',$3,$4,'published')",
        [activityId, req.auth!.userId, JSON.stringify(draft), versionId],
      );
      await q.query(
        "INSERT INTO teacher_activity_versions(id,activity_id,owner_id,number,content) VALUES($1,$2,$3,1,$4)",
        [versionId, activityId, req.auth!.userId, JSON.stringify(draft)],
      );
      await q.query("COMMIT");
      res.status(201).json({ id: activityId, versionId });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);
