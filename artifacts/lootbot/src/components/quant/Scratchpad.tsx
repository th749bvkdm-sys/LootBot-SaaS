import { useEffect, useRef, useState, type PointerEvent } from "react";
import { PenLine, Eraser, Undo2, Redo2, Trash2, Hand, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import type { Stroke } from "./api";

const W = 1000, H = 900;
function ink(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (s.points.length === 1) { const [x, y, p] = s.points[0]; ctx.beginPath(); ctx.arc(x, y, s.width * (.4 + p) / 2, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 1; i < s.points.length; i++) {
    const [x, y, p] = s.points[i], [a, b, q] = s.points[i - 1];
    ctx.lineWidth = s.width * (.4 + (p + q) / 2); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(x, y); ctx.stroke();
  }
}
function distance(x: number, y: number, a: number, b: number, c: number, d: number) {
  const dx = c - a, dy = d - b, k = Math.max(0, Math.min(1, ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (a + k * dx), y - (b + k * dy));
}
export function Scratchpad({ value, onChange, disabled = false }: { value: Stroke[]; onChange: (s: Stroke[]) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), liveCanvas = useRef<HTMLCanvasElement>(null), area = useRef<HTMLDivElement>(null);
  const current = useRef<Stroke | null>(null), pointer = useRef<number | null>(null), lastPen = useRef(0), raf = useRef(0);
  const erased = useRef<Stroke[] | null>(null), panStart = useRef<[number, number, number, number] | null>(null);
  const [size, setSize] = useState({ w: 500, h: 450 }), [color, setColor] = useState("#243b65"), [width, setWidth] = useState(4);
  const [tool, setTool] = useState<"pen" | "eraser" | "pan">("pen"), [touch, setTouch] = useState(false), [zoom, setZoom] = useState(1), [pan, setPan] = useState([0, 0]);
  const [past, setPast] = useState<Stroke[][]>([]), [future, setFuture] = useState<Stroke[][]>([]), [clear, setClear] = useState(false);
  useEffect(() => { const el = area.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height })); observer.observe(el); return () => { observer.disconnect(); cancelAnimationFrame(raf.current); }; }, []);
  function context(el: HTMLCanvasElement | null, blank = true) {
    if (!el) return null; const ctx = el.getContext("2d"); if (!ctx) return null; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(size.w * dpr) || el.height !== Math.round(size.h * dpr)) { el.width = Math.round(size.w * dpr); el.height = Math.round(size.h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); if (blank) ctx.clearRect(0, 0, el.width, el.height);
    ctx.scale(dpr * size.w / W, dpr * size.h / H); ctx.translate(pan[0], pan[1]); ctx.scale(zoom, zoom); return ctx;
  }
  useEffect(() => { const ctx = context(canvas.current); if (ctx) value.forEach(s => ink(ctx, s)); context(liveCanvas.current); }, [value, size, zoom, pan]);
  function point(e: PointerEvent<HTMLCanvasElement>): [number, number, number] {
    const r = e.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(W, ((e.clientX - r.left) * W / r.width - pan[0]) / zoom)), Math.max(0, Math.min(H, ((e.clientY - r.top) * H / r.height - pan[1]) / zoom)), e.pointerType === "pen" ? e.pressure || .5 : .5];
  }
  function commit(next: Stroke[]) { setPast(p => [...p.slice(-29), value]); setFuture([]); onChange(next); }
  function erase(p: [number, number, number]) {
    const list = erased.current || value;
    erased.current = list.filter(s => !s.points.some((q, i) => { const prev = s.points[Math.max(0, i - 1)]; return distance(p[0], p[1], prev[0], prev[1], q[0], q[1]) < 14 + s.width; }));
    const ctx = context(canvas.current); if (ctx) erased.current.forEach(s => ink(ctx, s));
  }
  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (disabled || pointer.current !== null || e.button > 0) return;
    if (e.pointerType === "touch" && (!touch && tool !== "pan" || Date.now() - lastPen.current < 600)) return;
    if (e.pointerType === "pen") lastPen.current = Date.now();
    pointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "pan") { panStart.current = [e.clientX, e.clientY, pan[0], pan[1]]; return; }
    const p = point(e); if (tool === "eraser") { erased.current = value; erase(p); return; }
    if (value.length >= 400 || value.reduce((n, s) => n + s.points.length, 0) >= 12000) { pointer.current = null; return; }
    current.current = { color, width, points: [p] }; const ctx = context(liveCanvas.current); if (ctx) ink(ctx, current.current);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== e.pointerId) return;
    if (e.pointerType === "pen") lastPen.current = Date.now();
    if (panStart.current) { const [x, y, a, b] = panStart.current; setPan([Math.max(-W * (zoom - 1), Math.min(0, a + (e.clientX - x) * W / size.w)), Math.max(-H * (zoom - 1), Math.min(0, b + (e.clientY - y) * H / size.h))]); return; }
    if (tool === "eraser") { erase(point(e)); return; }
    const s = current.current; if (!s || s.points.length >= Math.min(4000, 12000 - value.reduce((n, stroke) => n + stroke.points.length, 0))) return;
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]; const r = e.currentTarget.getBoundingClientRect();
    for (const ev of events) {
      if (s.points.length >= Math.min(4000, 12000 - value.reduce((n, stroke) => n + stroke.points.length, 0))) break;
      const p: [number, number, number] = [Math.max(0, Math.min(W, ((ev.clientX - r.left) * W / r.width - pan[0]) / zoom)), Math.max(0, Math.min(H, ((ev.clientY - r.top) * H / r.height - pan[1]) / zoom)), ev.pointerType === "pen" ? ev.pressure || .5 : .5];
      const last = s.points[s.points.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) > .6) s.points.push(p);
    }
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => { const ctx = context(liveCanvas.current); if (ctx && current.current) ink(ctx, current.current); });
  }
  function up(e: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== e.pointerId) return; pointer.current = null; panStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (erased.current) { const next = erased.current; erased.current = null; if (next.length !== value.length) commit(next); }
    if (current.current) { const finished = current.current; current.current = null; commit([...value, finished]); }
    context(liveCanvas.current);
  }
  function zoomTo(next: number) { setZoom(Math.max(1, Math.min(3, next))); setPan([0, 0]); }
  return <section className="quant-pad" aria-label="مساحة الحل الخاصة">
    <div className="quant-pad-heading"><strong>مساحة الحل</strong><small>مسودة خاصة • لا تدخل في التصحيح</small></div>
    <div className="quant-ink-tools" role="toolbar" aria-label="أدوات القلم">
      {([["pen", PenLine, "قلم"], ["eraser", Eraser, "ممحاة الخط"], ["pan", Hand, "تحريك الورقة"]] as const).map(([t, Icon, title]) => <button type="button" key={t} aria-label={title} title={title} aria-pressed={tool === t} onClick={() => setTool(t)} disabled={disabled}><Icon size={18}/></button>)}
      <label className="quant-color"><span className="sr-only">لون القلم</span><select aria-label="لون القلم" value={color} onChange={e => setColor(e.target.value)}><option value="#243b65">كحلي</option><option value="#8356bd">بنفسجي</option><option value="#147b60">أخضر</option><option value="#bd3c5a">أحمر</option></select></label>
      <label className="quant-width"><span className="sr-only">سمك القلم</span><input aria-label="سمك القلم" type="range" min="2" max="10" value={width} onChange={e => setWidth(Number(e.target.value))}/></label>
      <button type="button" aria-label="تراجع عن الخط" disabled={disabled || !past.length} onClick={() => { const p = past[past.length - 1]; setPast(past.slice(0, -1)); setFuture(f => [...f, value]); onChange(p); }}><Undo2 size={18}/></button>
      <button type="button" aria-label="إعادة الخط" disabled={disabled || !future.length} onClick={() => { const f = future[future.length - 1]; setFuture(future.slice(0, -1)); setPast(p => [...p, value]); onChange(f); }}><Redo2 size={18}/></button>
      <button type="button" aria-label="مسح المسودة" disabled={disabled || !value.length} onClick={() => setClear(true)}><Trash2 size={18}/></button>
      <button type="button" aria-label="تكبير الورقة" disabled={zoom >= 3} onClick={() => zoomTo(zoom + .25)}><ZoomIn size={18}/></button>
      <button type="button" aria-label="تصغير الورقة" disabled={zoom <= 1} onClick={() => zoomTo(zoom - .25)}><ZoomOut size={18}/></button>
      <button type="button" aria-label="إعادة عرض الورقة" onClick={() => zoomTo(1)}><RotateCcw size={18}/></button>
    </div>
    <label className="quant-touch"><input type="checkbox" checked={touch} onChange={e => setTouch(e.target.checked)}/> الرسم بالإصبع (أوقفه للتمرير)</label>
    <div ref={area} className="quant-paper" data-testid="quant-scratchpad" style={{ backgroundSize: `${24 * zoom}px ${24 * zoom}px`, backgroundPosition: `${pan[0]}px ${pan[1]}px` }}>
      <canvas ref={canvas} className="quant-ink-layer" aria-hidden="true"/>
      <canvas ref={liveCanvas} className="quant-ink-live" aria-label="ورقة الحل؛ استخدم القلم أو الفأرة" onPointerOver={e => { if (e.pointerType === "pen") e.currentTarget.style.touchAction = "none"; }} onPointerLeave={e => { if (pointer.current === null) e.currentTarget.style.touchAction = touch || tool === "pan" ? "none" : "pan-y"; }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: touch || tool === "pan" ? "none" : "pan-y" }}/>
    </div>
    <p className="edu-note">{value.length} خطوط • {Math.round(zoom * 100)}٪. القلم والفأرة يعملان مباشرة. الممحاة تحذف الخط المتقاطع كاملًا.</p>
    {value.length >= 400 && <p role="alert">وصلت إلى حد الخطوط لهذه الورقة. امسح بعض الخطوط قبل المتابعة.</p>}
    <Dialog open={clear} onOpenChange={setClear}><DialogContent dir="rtl"><DialogTitle>مسح مسودة هذا السؤال؟</DialogTitle><DialogDescription>يمكن التراجع داخل هذه الجلسة قبل إغلاق الصفحة. لن تتغير إجابتك المختارة.</DialogDescription><DialogFooter><button className="edu-button secondary" onClick={() => setClear(false)}>إلغاء</button><button className="edu-button" onClick={() => { commit([]); setClear(false); }}>مسح الورقة</button></DialogFooter></DialogContent></Dialog>
  </section>;
}
