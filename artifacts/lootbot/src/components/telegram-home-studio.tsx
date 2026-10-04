import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Configuration = { version: 1; welcomeMessage: string; headerTitle?: string; headerSubtitle?: string; footer?: string; columns: 1 | 2 | 3; showEmoji: boolean; buttons: { action: string; title: string; emoji: string; enabled: boolean }[] };
type Preview = { text: string; keyboard: { text: string; callback_data: string }[][] };
type Studio = { enabled: boolean; draft: Configuration; published: Configuration | null; revision: number; preview: Preview };
export function TelegramHomeStudio({ storeId, csrfToken, locale }: { storeId: string; csrfToken?: string; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar'; const qc = useQueryClient();
  const [draft, setDraft] = useState<Configuration | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [dirty, setDirty] = useState(false); const [pending, setPending] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['telegram-home-studio', storeId], enabled: !!storeId, refetchOnWindowFocus: false, queryFn: async () => {
    const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/studio`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load studio'); return response.json() as Promise<Studio>;
  }});
  useEffect(() => { if (query.data) { setDraft(query.data.draft); setPreview(query.data.preview); setDirty(false); } }, [query.data]);
  const change = (next: Configuration) => { setDraft(next); setDirty(true); setNotice(''); setPreview(null); };
  const submit = async (action: 'draft' | 'preview' | 'publish') => {
    if (!draft || !csrfToken || pending) return;
    setPending(action); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/studio/${action}`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ configuration: draft, revision: query.data?.revision }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || (ar ? 'تعذر إكمال الطلب.' : 'Request failed.'));
      setPreview(payload.preview);
      if (action !== 'preview') { qc.setQueryData(['telegram-home-studio', storeId], payload); setDirty(false); }
      setNotice(action === 'publish' ? (ar ? 'تم النشر. يظهر التصميم عند /start أو العودة للرئيسية.' : 'Published. Appears on /start or Home.') : action === 'draft' ? (ar ? 'حُفظت المسودة. اضغط نشر لتطبيقها على Telegram.' : 'Draft saved. Publish to apply it to Telegram.') : '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed'); }
    finally { setPending(''); }
  };
  const reorder = (index: number, direction: number) => {
    if (!draft || index + direction < 0 || index + direction >= draft.buttons.length) return;
    const buttons = [...draft.buttons]; [buttons[index], buttons[index + direction]] = [buttons[index + direction], buttons[index]]; change({ ...draft, buttons });
  };
  if (!storeId) return null;
  return <section className="mt-5 rounded-2xl border border-[#293638] bg-[#171f22] p-5 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{ar ? 'مصمم الصفحة الرئيسية للبوت' : 'Bot home designer'}</h2><p className="mt-2 text-xs text-[#879595]">{ar ? 'مسودة مستقلة، معاينة من الخادم، ثم نشر إلى Telegram.' : 'Save a draft, preview it, then publish to Telegram.'}</p></div><span className="rounded-full bg-[#1b3029] px-3 py-1 text-xs text-[#85dabc]">Pro · Business</span></div>
    {query.isLoading ? <p className="mt-4">{ar ? 'جار التحميل…' : 'Loading…'}</p> : query.isError ? <button onClick={() => void query.refetch()} className="mt-4 text-[#e4a09a]">{ar ? 'تعذر التحميل. إعادة المحاولة' : 'Could not load. Retry'}</button> : !query.data?.enabled ? <p className="mt-4 text-sm text-[#e5c996]">{ar ? 'التخصيص متاح في Pro وBusiness. القائمة الأساسية تعمل لجميع المتاجر.' : 'Customization requires Pro or Business. The basic menu works for all stores.'}</p> : draft && <>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <fieldset disabled={!!pending} className="space-y-4 disabled:opacity-60">
          <label className="block text-sm">{ar ? 'عنوان المتجر في البوت' : 'Bot header title'}<input maxLength={100} value={draft.headerTitle ?? ''} onChange={e => change({ ...draft, headerTitle: e.target.value })} className="mt-2 w-full rounded-xl border border-[#354344] bg-[#182123] p-3"/></label>
          <label className="block text-sm">{ar ? 'وصف مختصر' : 'Header subtitle'}<input maxLength={200} value={draft.headerSubtitle ?? ''} onChange={e => change({ ...draft, headerSubtitle: e.target.value })} className="mt-2 w-full rounded-xl border border-[#354344] bg-[#182123] p-3"/></label>
          <label className="block text-sm">{ar ? 'رسالة الترحيب' : 'Welcome message'}<textarea rows={4} maxLength={800} value={draft.welcomeMessage} onChange={e => change({ ...draft, welcomeMessage: e.target.value })} className="mt-2 w-full rounded-xl border border-[#354344] bg-[#182123] p-3"/><span className="text-xs text-[#879595]">{'{{store}} · {{customer}}'}</span></label>
          <label className="block text-sm">{ar ? 'تذييل الرسالة' : 'Message footer'}<input maxLength={200} value={draft.footer ?? ''} onChange={e => change({ ...draft, footer: e.target.value })} className="mt-2 w-full rounded-xl border border-[#354344] bg-[#182123] p-3"/></label>
          <div className="flex flex-wrap gap-4"><label className="text-sm">{ar ? 'أعمدة القائمة' : 'Menu columns'}<select value={draft.columns} onChange={e => change({ ...draft, columns: Number(e.target.value) as 1 | 2 | 3 })} className="ms-2 rounded-lg border border-[#354344] bg-[#182123] p-2"><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.showEmoji} onChange={e => change({ ...draft, showEmoji: e.target.checked })}/>{ar ? 'إظهار الرموز' : 'Show emoji'}</label></div>
          <div className="space-y-3">{draft.buttons.map((button, index) => <div key={button.action} className="rounded-xl border border-[#354344] p-3">
            <div className="flex gap-2"><input aria-label={ar ? 'رمز الزر' : 'Button emoji'} value={button.emoji} maxLength={16} onChange={e => change({ ...draft, buttons: draft.buttons.map((item, i) => i === index ? { ...item, emoji: e.target.value } : item) })} className="w-14 rounded-lg border border-[#354344] bg-[#182123] p-2"/><input aria-label={ar ? 'عنوان الزر' : 'Button title'} value={button.title} maxLength={40} onChange={e => change({ ...draft, buttons: draft.buttons.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} className="min-w-0 flex-1 rounded-lg border border-[#354344] bg-[#182123] p-2"/></div>
            <div className="mt-2 flex items-center gap-3 text-xs"><label className="me-auto"><input type="checkbox" checked={button.enabled} onChange={e => change({ ...draft, buttons: draft.buttons.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) })}/> {ar ? 'ظاهر' : 'Visible'}</label><button type="button" disabled={index === 0} onClick={() => reorder(index, -1)} className="disabled:opacity-40">↑</button><button type="button" disabled={index === draft.buttons.length - 1} onClick={() => reorder(index, 1)} className="disabled:opacity-40">↓</button></div>
          </div>)}</div>
        </fieldset>
        <div className="rounded-2xl border border-[#354344] bg-[#10191c] p-4"><h3 className="text-sm text-[#879595]">{ar ? 'معاينة Telegram' : 'Telegram preview'}</h3>{preview ? <><p className="mt-4 whitespace-pre-wrap rounded-xl bg-[#21332f] p-4 text-sm">{preview.text}</p><div className="mt-3 space-y-2">{preview.keyboard.map((row, index) => <div key={index} className="flex gap-2">{row.map(button => <div key={button.callback_data} className="min-w-0 flex-1 rounded-lg border border-[#365749] bg-[#1b3029] p-2 text-center text-xs">{button.text}</div>)}</div>)}</div></> : <p className="mt-5 text-sm text-[#879595]">{ar ? 'اضغط معاينة لعرض التعديلات.' : 'Preview to render your changes.'}</p>}<p className="mt-5 text-xs text-[#879595]">{query.data.published ? (ar ? 'يوجد تصميم منشور.' : 'A design is published.') : (ar ? 'Telegram يستخدم القائمة الافتراضية حتى النشر.' : 'Telegram uses the default menu until published.')}</p></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3"><button disabled={!csrfToken || !!pending} onClick={() => void submit('draft')} className="rounded-xl border border-[#354344] px-4 py-2 text-sm disabled:opacity-40">{ar ? 'حفظ المسودة' : 'Save draft'}</button><button disabled={!csrfToken || !!pending} onClick={() => void submit('preview')} className="rounded-xl border border-[#354344] px-4 py-2 text-sm disabled:opacity-40">{ar ? 'معاينة' : 'Preview'}</button><button disabled={!csrfToken || !!pending || dirty} onClick={() => void submit('publish')} className="rounded-xl bg-[#62d6aa] px-4 py-2 text-sm font-bold text-[#10231d] disabled:opacity-40">{ar ? 'نشر إلى Telegram' : 'Publish to Telegram'}</button>{dirty && <span className="self-center text-xs text-[#e5c996]">{ar ? 'احفظ المسودة قبل النشر.' : 'Save before publishing.'}</span>}</div>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-[#e4a09a]">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-[#80d7b5]">{notice}</p>}
  </section>;
}
