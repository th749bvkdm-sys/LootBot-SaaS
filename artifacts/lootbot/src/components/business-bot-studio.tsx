import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Block = { id: string; type: 'TEXT' | 'HEADER' | 'FAQ' | 'DIVIDER'; text: string; enabled: boolean };
type Action = 'OPEN_SCREEN' | 'OPEN_PRODUCTS' | 'OPEN_CATEGORIES' | 'OPEN_SEARCH' | 'OPEN_ORDERS' | 'OPEN_ACCOUNT';
type Screen = { id: string; parentId: string | null; title: string; enabled: boolean; audience: 'all' | 'new' | 'returning'; startsAt: string | null; endsAt: string | null; blocks: Block[]; buttons: { id: string; title: string; action: Action; target: string | null; enabled: boolean }[] };
type Config = { version: 1; columns: 1 | 2 | 3; screens: Screen[] };
type Preview = { text: string; keyboard: { text: string; callback_data: string }[][] };
type Studio = { draft: Config; published: Config | null; revision: number; enabled: boolean; preview: Preview | null };
const inputClass = 'mt-2 w-full rounded-lg border border-[#354344] bg-[#182123] p-2 text-sm';
const buttonClass = 'rounded-lg border border-[#354344] px-3 py-2 text-xs disabled:opacity-40';
const newId = (prefix: string) => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const actions: Action[] = ['OPEN_SCREEN', 'OPEN_PRODUCTS', 'OPEN_CATEGORIES', 'OPEN_SEARCH', 'OPEN_ORDERS', 'OPEN_ACCOUNT'];
const actionNames: Record<Action, string> = { OPEN_SCREEN: 'فتح شاشة', OPEN_PRODUCTS: 'المنتجات', OPEN_CATEGORIES: 'التصنيفات', OPEN_SEARCH: 'البحث', OPEN_ORDERS: 'طلباتي', OPEN_ACCOUNT: 'حسابي' };

export function BusinessBotStudio({ storeId, csrfToken, locale }: { storeId: string; csrfToken?: string; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar'; const qc = useQueryClient();
  const [config, setConfig] = useState<Config | null>(null); const [selected, setSelected] = useState('home');
  const [preview, setPreview] = useState<Preview | null>(null); const [previewed, setPreviewed] = useState(false); const [returning, setReturning] = useState(false);
  const [dirty, setDirty] = useState(false); const [pending, setPending] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['business-studio', storeId], enabled: !!storeId, refetchOnWindowFocus: false, queryFn: async () => {
    const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/business-studio`, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load Business Studio'); return response.json() as Promise<Studio>;
  } });
  useEffect(() => { if (query.data) { setConfig(query.data.draft); setSelected('home'); setPreview(query.data.preview); setPreviewed(true); setDirty(false); } }, [query.data]);
  const screen = config?.screens.find(s => s.id === selected);
  const change = (next: Config) => { setConfig(next); setDirty(true); setNotice(''); setPreviewed(false); setPreview(null); };
  const edit = (next: Screen) => { if (config) change({ ...config, screens: config.screens.map(s => s.id === next.id ? next : s) }); };
  const choose = (id: string) => { setSelected(id); setPreview(null); setPreviewed(false); };
  const submit = async (action: 'draft' | 'preview' | 'publish') => {
    if (!config || !csrfToken || pending) return;
    setPending(action); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/telegram/business-studio/${action}`, { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ configuration: config, revision: query.data?.revision, screenId: selected, returning }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (ar ? 'تعذر إكمال الطلب.' : 'Request failed.'));
      setPreview(payload.preview); setPreviewed(true);
      if (action !== 'preview') { qc.setQueryData(['business-studio', storeId], payload); setDirty(false); }
      setNotice(action === 'draft' ? (ar ? 'حُفظت مسودة Business.' : 'Business draft saved.') : action === 'publish' ? (ar ? 'تم النشر. يستخدم البوت شاشة Business الرئيسية عند /start.' : 'Published. The bot uses Business home on /start.') : '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed'); }
    finally { setPending(''); }
  };
  const addScreen = () => {
    if (!config || config.screens.length >= 30) return;
    const id = newId('s'); change({ ...config, screens: [...config.screens, { id, parentId: selected, title: ar ? 'شاشة جديدة' : 'New screen', enabled: true, audience: 'all', startsAt: null, endsAt: null, blocks: [], buttons: [] }] }); choose(id);
  };
  const duplicate = () => {
    if (!config || !screen || screen.id === 'home' || config.screens.length >= 30) return;
    const id = newId('s'); change({ ...config, screens: [...config.screens, { ...structuredClone(screen), id, title: screen.title.slice(0, 70) + (ar ? ' نسخة' : ' copy') }] }); choose(id);
  };
  const remove = () => {
    if (!config || !screen || screen.id === 'home') return;
    change({ ...config, screens: config.screens.filter(s => s.id !== screen.id).map(s => ({ ...s, parentId: s.parentId === screen.id ? screen.parentId : s.parentId,
      buttons: s.buttons.filter(b => !(b.action === 'OPEN_SCREEN' && b.target === screen.id)) })) }); choose(screen.parentId ?? 'home');
  };
  const moveScreen = (direction: number) => {
    if (!config || !screen || screen.id === 'home') return;
    const siblings = config.screens.filter(s => s.parentId === screen.parentId); const index = siblings.findIndex(s => s.id === screen.id); const neighbor = siblings[index + direction];
    if (!neighbor) return;
    const screens = [...config.screens]; const a = screens.findIndex(s => s.id === screen.id); const b = screens.findIndex(s => s.id === neighbor.id);
    [screens[a], screens[b]] = [screens[b], screens[a]]; change({ ...config, screens });
  };
  const moveBlock = (index: number, direction: number) => {
    if (!screen || index + direction < 0 || index + direction >= screen.blocks.length) return;
    const blocks = [...screen.blocks]; [blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]]; edit({ ...screen, blocks });
  };
  const timestampInput = (value: string | null) => value?.slice(0, 16) ?? '';
  const timestampValue = (value: string) => value ? new Date(value + ':00.000Z').toISOString() : null;
  if (!storeId) return null;
  return <section className="mt-5 rounded-2xl border border-[#514668] bg-[#171c27] p-5 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Business Bot Studio</h2><p className="mt-2 max-w-xl text-xs leading-6 text-[#a5a0b8]">{ar ? 'شاشات متفرعة، محتوى وأزرار فعلية، وقواعد ظهور حسب الطلبات السابقة والتوقيت. نشر Business يحدد الصفحة الرئيسية للبوت.' : 'Nested screens, content, real actions and visibility by prior orders and dates. Business publication controls the bot home.'}</p></div><span className="rounded-full bg-[#342848] px-3 py-1 text-xs text-[#d4bafa]">Business</span></div>
    {query.isLoading ? <p className="mt-4">{ar ? 'جار التحميل…' : 'Loading…'}</p> : query.isError ? <button className={buttonClass + ' mt-4'} onClick={() => void query.refetch()}>{ar ? 'تعذر التحميل. إعادة المحاولة' : 'Could not load. Retry'}</button> : !query.data?.enabled ? <p className="mt-4 text-sm text-[#e5c996]">{ar ? 'محرّر الشاشات والقواعد متاح في باقة Business.' : 'Screen and rule editing requires Business.'}</p> : config && screen && <>
      <fieldset disabled={!!pending} className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[190px_minmax(0,1fr)_300px] disabled:opacity-60">
        <div className="min-w-0 rounded-xl border border-[#394052] p-3"><h3 className="text-sm font-semibold">{ar ? 'الشاشات والمكوّنات' : 'Screens and components'}</h3><div className="mt-3 space-y-2">{config.screens.map(s => <button key={s.id} type="button" onClick={() => choose(s.id)} className={`${buttonClass} w-full truncate text-start ${s.id === selected ? 'bg-[#342848] text-[#d4bafa]' : ''}`}><span className="text-[#8f84b1]">{s.id !== 'home' ? '↳ ' : '⌂ '}</span>{s.title}{!s.enabled ? ' ◌' : ''}</button>)}</div><button type="button" className={buttonClass + ' mt-3 w-full'} disabled={config.screens.length >= 30} onClick={addScreen}>{ar ? '+ شاشة فرعية' : '+ Child screen'}</button>
          <div className="mt-5 space-y-2 border-t border-[#394052] pt-4">{(['TEXT', 'HEADER', 'FAQ', 'DIVIDER'] as const).map(type => <button key={type} type="button" disabled={screen.blocks.length >= 12} className={buttonClass + ' w-full'} onClick={() => edit({ ...screen, blocks: [...screen.blocks, { id: newId('b'), type, text: type === 'DIVIDER' ? '' : ar ? 'محتوى جديد' : 'New content', enabled: true }] })}>+ {type === 'TEXT' ? (ar ? 'نص' : 'Text') : type === 'HEADER' ? (ar ? 'عنوان' : 'Header') : type === 'FAQ' ? (ar ? 'سؤال وجواب' : 'FAQ') : (ar ? 'فاصل' : 'Divider')}</button>)}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-[#394052] bg-[#101722] p-4"><h3 className="text-sm font-semibold">{ar ? 'المعاينة' : 'Preview'}</h3><label className="mt-3 flex gap-2 text-xs text-[#a5a0b8]"><input type="checkbox" checked={returning} onChange={e => { setReturning(e.target.checked); setPreviewed(false); }}/>{ar ? 'عميل لديه طلب سابق (للمعاينة)' : 'Customer with a prior order (preview)'}</label>
          {previewed ? preview ? <><p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-[#263044] p-4 text-sm">{preview.text}</p><div className="mt-3 space-y-2">{preview.keyboard.map((row, i) => <div key={i} className="flex gap-2">{row.map(b => <div key={b.callback_data + b.text} className="min-w-0 flex-1 break-words rounded-lg border border-[#49536c] p-2 text-center text-xs">{b.text}</div>)}</div>)}</div></> : <p className="mt-5 text-sm text-[#e5c996]">{ar ? 'الشاشة مخفية في سياق المعاينة حسب قواعد الجمهور أو الوقت.' : 'Audience or date rules hide this screen in the preview context.'}</p> : <p className="mt-5 text-sm text-[#a5a0b8]">{ar ? 'اضغط معاينة لعرض الشاشة من الخادم.' : 'Preview to render this screen on the server.'}</p>}
          <p className="mt-5 text-xs text-[#a5a0b8]">{query.data.published ? (ar ? 'يوجد تصميم Business منشور.' : 'Business design published.') : (ar ? 'لم يُنشر تصميم Business بعد.' : 'No Business design published yet.')}</p>
        </div>
        <div className="min-w-0 space-y-4 rounded-xl border border-[#394052] p-4"><h3 className="text-sm font-semibold">{ar ? 'خصائص الشاشة' : 'Screen properties'}</h3>
          <label className="block text-xs">{ar ? 'العنوان' : 'Title'}<input className={inputClass} maxLength={80} value={screen.title} onChange={e => edit({ ...screen, title: e.target.value })}/></label>
          {screen.id !== 'home' && <><label className="block text-xs">{ar ? 'الشاشة الأم' : 'Parent screen'}<select className={inputClass} value={screen.parentId ?? 'home'} onChange={e => edit({ ...screen, parentId: e.target.value })}>{config.screens.filter(s => s.id !== screen.id).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><label className="flex gap-2 text-xs"><input type="checkbox" checked={screen.enabled} onChange={e => edit({ ...screen, enabled: e.target.checked })}/>{ar ? 'الشاشة مفعلة' : 'Enabled screen'}</label>
            <label className="block text-xs">{ar ? 'الجمهور حسب الطلبات السابقة' : 'Audience by prior orders'}<select className={inputClass} value={screen.audience} onChange={e => edit({ ...screen, audience: e.target.value as Screen['audience'] })}><option value="all">{ar ? 'الجميع' : 'Everyone'}</option><option value="new">{ar ? 'بلا طلبات سابقة' : 'No prior orders'}</option><option value="returning">{ar ? 'لديه طلب سابق' : 'Has a prior order'}</option></select></label>
            <label className="block text-xs">{ar ? 'بدء الظهور (UTC)' : 'Visible from (UTC)'}<input type="datetime-local" className={inputClass} value={timestampInput(screen.startsAt)} onChange={e => edit({ ...screen, startsAt: timestampValue(e.target.value) })}/></label><label className="block text-xs">{ar ? 'نهاية الظهور (UTC)' : 'Visible until (UTC)'}<input type="datetime-local" className={inputClass} value={timestampInput(screen.endsAt)} onChange={e => edit({ ...screen, endsAt: timestampValue(e.target.value) })}/></label>
            <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => moveScreen(-1)}>↑</button><button type="button" className={buttonClass} onClick={() => moveScreen(1)}>↓</button><button type="button" className={buttonClass} onClick={duplicate}>{ar ? 'نسخ' : 'Duplicate'}</button><button type="button" className={buttonClass + ' text-[#e4a09a]'} onClick={remove}>{ar ? 'حذف' : 'Delete'}</button></div></>}
          <label className="block text-xs">{ar ? 'أعمدة الأزرار' : 'Button columns'}<select className={inputClass} value={config.columns} onChange={e => change({ ...config, columns: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          {screen.blocks.map((block, index) => <div key={block.id} className="rounded-lg border border-[#394052] p-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={block.enabled} onChange={e => edit({ ...screen, blocks: screen.blocks.map(b => b.id === block.id ? { ...b, enabled: e.target.checked } : b) })}/>{block.type}</label>{block.type !== 'DIVIDER' && <textarea aria-label={ar ? 'محتوى المكوّن' : 'Block content'} rows={3} maxLength={500} className={inputClass} value={block.text} onChange={e => edit({ ...screen, blocks: screen.blocks.map(b => b.id === block.id ? { ...b, text: e.target.value } : b) })}/>}<div className="mt-2 flex gap-2"><button type="button" className={buttonClass} disabled={index === 0} onClick={() => moveBlock(index, -1)}>↑</button><button type="button" className={buttonClass} disabled={index === screen.blocks.length - 1} onClick={() => moveBlock(index, 1)}>↓</button><button type="button" className={buttonClass} onClick={() => edit({ ...screen, blocks: screen.blocks.filter(b => b.id !== block.id) })}>{ar ? 'حذف' : 'Delete'}</button></div></div>)}
          <h4 className="border-t border-[#394052] pt-4 text-xs font-semibold">{ar ? 'أزرار الإجراءات' : 'Action buttons'}</h4>{screen.buttons.map((button, index) => <div key={button.id} className="rounded-lg border border-[#394052] p-3"><label className="flex gap-2 text-xs"><input type="checkbox" checked={button.enabled} onChange={e => edit({ ...screen, buttons: screen.buttons.map(b => b.id === button.id ? { ...b, enabled: e.target.checked } : b) })}/>{ar ? 'مفعّل' : 'Enabled'}</label><input aria-label={ar ? 'عنوان الزر' : 'Button title'} maxLength={40} className={inputClass} value={button.title} onChange={e => edit({ ...screen, buttons: screen.buttons.map(b => b.id === button.id ? { ...b, title: e.target.value } : b) })}/><select aria-label={ar ? 'إجراء الزر' : 'Button action'} className={inputClass} value={button.action} onChange={e => edit({ ...screen, buttons: screen.buttons.map(b => b.id === button.id ? { ...b, action: e.target.value as Action, target: e.target.value === 'OPEN_SCREEN' ? 'home' : null } : b) })}>{actions.map(action => <option key={action} value={action}>{ar ? actionNames[action] : action.replace('OPEN_', '')}</option>)}</select>{button.action === 'OPEN_SCREEN' && <select aria-label={ar ? 'الشاشة المستهدفة' : 'Target screen'} className={inputClass} value={button.target ?? 'home'} onChange={e => edit({ ...screen, buttons: screen.buttons.map(b => b.id === button.id ? { ...b, target: e.target.value } : b) })}>{config.screens.filter(s => s.enabled).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}<div className="mt-2 flex flex-wrap gap-2">{[-1, 1].map(direction => <button key={direction} type="button" className={buttonClass} disabled={index + direction < 0 || index + direction >= screen.buttons.length} onClick={() => { const buttons = [...screen.buttons]; [buttons[index], buttons[index + direction]] = [buttons[index + direction], buttons[index]]; edit({ ...screen, buttons }); }}>{direction < 0 ? '↑' : '↓'}</button>)}<button type="button" className={buttonClass} onClick={() => edit({ ...screen, buttons: screen.buttons.filter(b => b.id !== button.id) })}>{ar ? 'حذف' : 'Delete'}</button></div></div>)}<button type="button" className={buttonClass + ' w-full'} disabled={screen.buttons.length >= 12} onClick={() => edit({ ...screen, buttons: [...screen.buttons, { id: newId('a'), title: ar ? 'المنتجات' : 'Products', action: 'OPEN_PRODUCTS', target: null, enabled: true }] })}>{ar ? '+ زر إجراء' : '+ Action button'}</button>
        </div>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={!csrfToken || !!pending} className={buttonClass} onClick={() => void submit('draft')}>{ar ? 'حفظ المسودة' : 'Save draft'}</button><button disabled={!csrfToken || !!pending} className={buttonClass} onClick={() => void submit('preview')}>{ar ? 'معاينة الشاشة' : 'Preview screen'}</button><button disabled={!csrfToken || !!pending || dirty} onClick={() => void submit('publish')} className="rounded-lg bg-[#c5b4f4] px-4 py-2 text-sm font-semibold text-[#1c1529] disabled:opacity-40">{ar ? 'نشر Business' : 'Publish Business'}</button>{dirty && <span className="text-xs text-[#e5c996]">{ar ? 'احفظ المسودة أولًا.' : 'Save the draft first.'}</span>}</div>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-[#e4a09a]">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-[#80d7b5]">{notice}</p>}
  </section>;
}
