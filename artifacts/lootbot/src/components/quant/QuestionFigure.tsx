import { useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";

/** Licensed question crops remain behind authenticated routes, including the enlarged view. */
export function QuestionFigure({ url, admin = false }: { url: string; admin?: boolean }) {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  const src = admin ? url.replace(/^\/api\/quant\/figures\//, "/api/quant/admin/figures/") : url;
  useEffect(() => { setFailed(false); setOpen(false); }, [src]);
  return <figure className="quant-figure">
    {failed ? <p role="alert" className="edu-notice edu-error">تعذر تحميل صورة السؤال. تحقق من الاتصال وأعد تحميل المحاولة؛ قد تكون مراجعة المصدر قد تغيرت.</p> : <>
      <img src={src} loading="lazy" className="quant-question-image" alt="صورة السؤال الأصلية مع خيارات الإجابة؛ استخدم التكبير لقراءة الرموز والرسوم." onError={() => setFailed(true)}/>
      <button type="button" className="edu-button secondary quant-figure-expand" onClick={() => setOpen(true)}><Maximize2 size={16}/> تكبير صورة السؤال</button>
    </>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent dir="rtl" className="quant-figure-dialog" style={{ width: "calc(100vw - 24px)", maxWidth: 1160 }}>
      <DialogTitle>صورة السؤال بحجم أكبر</DialogTitle><DialogDescription>الصورة تحفظ الرموز والرسوم كما في المصدر. يمكنك تمرير الصورة الكبيرة؛ أغلقها للعودة إلى أزرار الإجابة.</DialogDescription>
      <div className="quant-figure-scroll"><img src={src} alt="السؤال الأصلي وخياراته، دون سطر مفتاح الإجابة" onError={() => setFailed(true)}/></div>
      <button type="button" className="edu-button" onClick={() => setOpen(false)}>العودة إلى السؤال</button>
    </DialogContent></Dialog>
  </figure>;
}
