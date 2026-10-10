export interface TeacherOcrResult {
  status: "manual" | "completed" | "error";
  text: string;
  blocks: {
    text: string;
    confidence: number | null;
    requiresReview: boolean;
  }[];
  message: string;
  provider: string;
}
export async function extractTeacherImage(
  bytes: Buffer,
  _mimeType: string,
): Promise<TeacherOcrResult> {
  const manual: TeacherOcrResult = {
    status: "manual",
    text: "",
    blocks: [],
    message:
      "الاستخراج الآلي غير مفعّل. راجع الصورة بجانب المحرر وأضف الأسئلة يدويًا. تُحفظ الصورة الأصلية منفصلة.",
    provider: "manual",
  };
  if (process.env.TEACHER_OCR_PROVIDER !== "azure-read") return manual;
  const endpoint = process.env.TEACHER_OCR_ENDPOINT,
    key = process.env.TEACHER_OCR_KEY;
  if (!endpoint || !key)
    return {
      ...manual,
      message:
        "إعدادات خدمة الاستخراج غير مكتملة. يمكنك متابعة التحرير اليدوي.",
    };
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.endsWith(".cognitiveservices.azure.com")
    )
      throw new Error("InvalidOcrEndpoint");
    url.pathname = "/vision/v3.2/read/analyze";
    url.search = "";
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("OcrRequestFailed");
    const operation = response.headers.get("operation-location");
    if (!operation) throw new Error("OcrOperationMissing");
    const operationUrl = new URL(operation);
    if (operationUrl.origin !== url.origin) throw new Error("OcrOperationHost");
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const read = await fetch(operationUrl, {
        redirect: "error",
        headers: { "Ocp-Apim-Subscription-Key": key },
        signal: AbortSignal.timeout(5000),
      });
      if (!read.ok) throw new Error("OcrReadFailed");
      const result = (await read.json()) as {
        status?: string;
        analyzeResult?: {
          readResults?: {
            lines?: { text?: string; words?: { confidence?: number }[] }[];
          }[];
        };
      };
      if (result.status === "failed") throw new Error("OcrProcessingFailed");
      if (result.status === "succeeded") {
        const lines = (result.analyzeResult?.readResults ?? []).flatMap(
          (page) => page.lines ?? [],
        );
        const blocks = lines.slice(0, 1000).map((line) => {
          const confidences = (line.words ?? [])
            .map((w) => w.confidence)
            .filter((v): v is number => typeof v === "number");
          const confidence = confidences.length
            ? Math.min(...confidences)
            : null;
          return {
            text: (line.text ?? "").slice(0, 10000),
            confidence,
            requiresReview: true,
          };
        });
        return {
          status: "completed",
          text: blocks
            .map((b) => b.text)
            .join("\n")
            .slice(0, 100000),
          blocks,
          message:
            "استُخرج النص فقط. جميع الأسطر تحتاج مراجعة المعلم؛ لم تُستنتج إجابات أو درجات تلقائيًا.",
          provider: "azure-read",
        };
      }
    }
    throw new Error("OcrTimeout");
  } catch {
    return {
      status: "error",
      text: "",
      blocks: [],
      message:
        "تعذر استخراج النص آليًا. يمكنك إكمال الأسئلة يدويًا ومراجعة الصورة الأصلية.",
      provider: "azure-read",
    };
  }
}
