import { useRef, useState } from "react";
import { ExternalLink, Film, Play, Search, X } from "lucide-react";
import { number } from "./api";
import { sectionVideos, videoChannel, videoPlaylist, type SectionVideo } from "./section-videos";
import "./videos.css";

const normalize = (text: string) => text.replace(/[٠-٩]/g, c => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[۰-۹]/g, c => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).trim();
const watchUrl = (video: SectionVideo) => `https://www.youtube.com/watch?v=${video.id}`;

/** Curated public videos; a title's section number is never a local test-group number. */
export function SectionVideos() {
  const params = new URLSearchParams(window.location.search);
  const initialVideo = sectionVideos.find(v => v.id === params.get("quantVideo")) || sectionVideos[0];
  const [selected, setSelected] = useState(initialVideo), [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState(""), [section, setSection] = useState(""), [updatesOnly, setUpdatesOnly] = useState(false);
  const playerHeading = useRef<HTMLHeadingElement>(null);
  const sectionNumber = Number(normalize(section));
  const invalidSection = !!section && (!Number.isInteger(sectionNumber) || sectionNumber < 1 || sectionNumber > 120);
  const visible = sectionVideos.filter(video => (!updatesOnly || video.kind === "update") && (!section || !invalidSection && video.sections.includes(sectionNumber)) && (!query || normalize(video.title).includes(normalize(query))));
  function choose(video: SectionVideo) {
    setLoaded(false); setSelected(video);
    const url = new URL(window.location.href); url.searchParams.set("quantVideos", "1"); url.searchParams.set("quantVideo", video.id); window.history.replaceState(null, "", url);
    playerHeading.current?.focus(); playerHeading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }
  return <section className="quant-videos" aria-label="مكتبة شرح أقسام المفكر">
    <div className="quant-video-intro"><div><span className="edu-eyebrow">تعلّم بالمشاهدة</span><h2>شروحات أقسام المفكر</h2><p>اختر رقم القسم في ملف المفكر، ثم شاهد الشرح من قناة تقفيلة. بعض المقاطع تجمع عدة أقسام في فيديو واحد.</p></div><span className="quant-video-total"><Film size={21}/>{number(sectionVideos.length)} فيديو</span></div>
    <div className="edu-card quant-video-player">
      <div className="quant-video-player-heading"><h3 ref={playerHeading} tabIndex={-1}>{selected.title}</h3><a href={videoChannel} target="_blank" rel="noopener noreferrer">تقفيلة — TAQFYLH <ExternalLink size={14}/><span className="sr-only">يفتح في تبويب جديد</span></a></div>
      <div className="quant-video-screen">
        {loaded ? <iframe key={selected.id} title={selected.title} src={`https://www.youtube-nocookie.com/embed/${selected.id}?hl=ar&playsinline=1&rel=0`} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen/> : <div className="quant-video-placeholder"><Film size={45} aria-hidden="true"/><strong>{selected.sections.length ? selected.sections.length === 1 ? `القسم ${number(selected.sections[0])}` : `الأقسام ${number(selected.sections[0])}–${number(selected.sections.at(-1))}` : "تحديثات الأقسام"}</strong><p>حمّل مشغّل يوتيوب عندما تكون مستعدًا للمشاهدة.</p><button type="button" className="edu-button" onClick={() => setLoaded(true)}><Play size={18}/> تحميل الفيديو</button></div>}
      </div>
      <div className="quant-video-player-actions"><a className="edu-button secondary" href={watchUrl(selected)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> افتح على يوتيوب<span className="sr-only">يفتح في تبويب جديد</span></a>{loaded && <button type="button" className="edu-button secondary" onClick={() => setLoaded(false)}><X size={16}/> إغلاق المشغّل</button>}</div>
      <p className="edu-note">إذا تعذر التشغيل داخل الصفحة، استخدم «افتح على يوتيوب». يبدأ الاتصال بيوتيوب عند تحميل الفيديو، وتبقى أدوات التشغيل والترجمة المتاحة في مشغّله الأصلي.</p>
    </div>
    <div className="quant-video-library-heading"><h3>اختر الشرح</h3><a href={videoPlaylist} target="_blank" rel="noopener noreferrer">قائمة التشغيل الأصلية <ExternalLink size={14}/><span className="sr-only">يفتح في تبويب جديد</span></a></div>
    <div className="edu-form quant-video-filters"><label>رقم قسم المفكر<input aria-label="رقم قسم المفكر" inputMode="numeric" placeholder="من ١ إلى ١٢٠" value={section} onChange={e => setSection(e.target.value)} aria-invalid={invalidSection} aria-describedby={invalidSection ? "quant-video-section-error" : undefined}/></label><label>البحث في عناوين الشروحات<div className="quant-video-search"><Search size={17} aria-hidden="true"/><input aria-label="البحث في عناوين الشروحات" type="search" placeholder="مثل: الأقسام الجديدة" value={query} onChange={e => setQuery(e.target.value)}/></div></label><label className="quant-check"><input type="checkbox" checked={updatesOnly} onChange={e => setUpdatesOnly(e.target.checked)}/> تحديثات الأقسام فقط</label></div>
    {invalidSection && <p id="quant-video-section-error" className="edu-note" role="alert">أدخل رقم قسم صحيحًا من ١ إلى ١٢٠.</p>}
    <p className="quant-video-match-count" role="status">{number(visible.length)} فيديو مطابق{section && !invalidSection && ` للقسم ${number(sectionNumber)}`}</p>
    <div className="quant-video-grid">{visible.map(video => <button type="button" className="quant-video-card" key={video.id} aria-pressed={selected.id === video.id} onClick={() => choose(video)}><span className="quant-video-card-icon"><Play size={20} aria-hidden="true"/></span><span><strong>{video.title}</strong><small>{video.kind === "update" ? "مراجعة التحديثات" : "شرح الأقسام • تقفيلة"}</small></span>{selected.id === video.id && <span className="quant-video-selected">المحدد</span>}</button>)}</div>
    {visible.length === 0 && <div className="edu-empty"><p>لا يوجد فيديو مطابق لهذه التصفية.</p><button type="button" className="edu-button secondary" onClick={() => { setQuery(""); setSection(""); setUpdatesOnly(false); }}>عرض جميع الشروحات</button></div>}
    <details className="quant-video-source-note"><summary>عن ترقيم الأقسام ومصدر الشرح</summary><p>الأرقام هنا هي أقسام ملف المفكر كما تظهر في عناوين قناة تقفيلة، وليست أرقام مجموعات الاختبار داخل الموقع. تقدم تقفيلة هذه الشروحات لأسئلة المفكر؛ لا تُنسب القناة إلى الناشر، ولا يُعد الفيديو شرحًا موثّقًا لكل سؤال في نسختك بمجرد تطابق رقم القسم. قد تختلف الأسئلة بين تحديثات الملف، لذلك أُدرج فيديو التحديثات أيضًا.</p><p>لا تُنسخ الفيديوهات أو يُعاد رفعها. لا تتغيّر أسئلة الاختبارات أو مفاتيح التصحيح بهذه المكتبة.</p></details>
  </section>;
}
