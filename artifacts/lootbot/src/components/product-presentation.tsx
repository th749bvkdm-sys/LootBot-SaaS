import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGetCsrfToken } from '@workspace/api-client-react';

type Presentation = { oldPrice: number | null; warranty: string; tags: string[]; featured: boolean };
const input = 'mt-2 w-full rounded-lg border border-[#354344] bg-[#182123] p-2 text-sm';

/** Metadata is saved independently of the product form, after the product exists. */
export function ProductPresentation({ productId, price, enabled = true, locale = 'ar' }: { productId: string; price: number; enabled?: boolean; locale?: 'ar' | 'en' }) {
  const ar = locale === 'ar'; const csrf = useGetCsrfToken();
  const [values, setValues] = useState<Presentation>({ oldPrice: null, warranty: '', tags: [], featured: false });
  const [tagText, setTagText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, setPending] = useState(false);
  const metadata = useQuery({ queryKey: ['product-presentation', productId], enabled: !!productId, queryFn: async () => {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/presentation`, { credentials: 'include' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || (ar ? 'تعذر تحميل بيانات العرض.' : 'Could not load presentation.')); return data as Presentation;
  } });
  useEffect(() => { if (metadata.data) { setValues(metadata.data); setTagText(metadata.data.tags.join(', ')); } setError(''); setNotice(''); }, [metadata.data, productId]);
  async function save() {
    if (!csrf.data?.token || pending || !enabled) return; setPending(true); setError(''); setNotice('');
    try {
      const tags = [...new Set(tagText.split(/[,،]/).map(value => value.trim()).filter(Boolean))];
      if (tags.length > 20 || tags.some(tag => tag.length > 40)) throw new Error(ar ? 'استخدم حتى 20 وسمًا، وكل وسم حتى 40 حرفًا.' : 'Use up to 20 tags, each up to 40 characters.');
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/presentation`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.data.token }, body: JSON.stringify({ ...values, tags }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || (ar ? 'تعذر حفظ بيانات العرض.' : 'Could not save presentation.'));
      await metadata.refetch(); setNotice(ar ? 'تم حفظ عرض المنتج. سيظهر السعر السابق والضمان والوسوم في البوت.' : 'Product presentation saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); } finally { setPending(false); }
  }
  return <section className="mt-5 space-y-3 border-t border-[#354344] pt-5"><h3 className="text-sm font-semibold">{ar ? 'عرض المنتج والعروض' : 'Product presentation and offers'}</h3>
    {metadata.isLoading ? <p className="text-sm">{ar ? 'جار التحميل…' : 'Loading…'}</p> : metadata.isError ? <button type="button" className="text-sm underline" onClick={() => void metadata.refetch()}>{ar ? 'تعذر التحميل. إعادة المحاولة' : 'Could not load. Retry'}</button> : <>
      {!enabled && <p className="text-xs text-[#e5c996]">{ar ? 'تخصيص عرض المنتج متاح في Pro وBusiness.' : 'Product presentation requires Pro or Business.'}</p>}
      <fieldset disabled={!enabled || pending || !csrf.data?.token} className="space-y-3">
        <label className="block text-xs">{ar ? 'السعر السابق (اتركه فارغًا لإيقاف العرض)' : 'Previous price (empty removes the offer)'}<input className={input} type="number" min={price} max={9999999999} step="0.01" value={values.oldPrice ?? ''} onChange={event => setValues({ ...values, oldPrice: event.target.value === '' ? null : Number(event.target.value) })}/></label>
        {values.oldPrice !== null && values.oldPrice > price && <p className="text-xs text-[#85dabc]">{ar ? 'نسبة الخصم' : 'Discount'}: {Math.round((1 - price / values.oldPrice) * 100)}%</p>}
        <label className="block text-xs">{ar ? 'الضمان' : 'Warranty'}<textarea className={input} rows={2} maxLength={500} value={values.warranty} onChange={event => setValues({ ...values, warranty: event.target.value })}/></label>
        <label className="block text-xs">{ar ? 'الوسوم، مفصولة بفواصل' : 'Tags, separated by commas'}<input className={input} value={tagText} maxLength={850} onChange={event => setTagText(event.target.value)}/></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={values.featured} onChange={event => setValues({ ...values, featured: event.target.checked })}/>{ar ? 'منتج مميز' : 'Featured product'}</label>
        <button type="button" className="rounded-lg border border-[#354344] px-3 py-2 text-sm disabled:opacity-40" onClick={() => void save()}>{pending ? (ar ? 'جار الحفظ…' : 'Saving…') : (ar ? 'حفظ عرض المنتج' : 'Save presentation')}</button>
      </fieldset>
    </>}{error && <p role="alert" className="text-sm text-[#e4a09a]">{error}</p>}{notice && <p role="status" className="text-xs text-[#85dabc]">{notice}</p>}
  </section>;
}
