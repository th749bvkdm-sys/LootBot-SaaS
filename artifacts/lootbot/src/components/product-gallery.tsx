import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Image = { imageUrl: string; altText: string; isPrimary: boolean };
export function ProductGallery({ productId, csrfToken, locale, onSaved }: {
  productId: string; csrfToken?: string; locale: 'ar' | 'en'; onSaved: () => void;
}) {
  const ar = locale === 'ar';
  const queryClient = useQueryClient();
  const [images, setImages] = useState<Image[]>([]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: ['product-gallery', productId], refetchOnWindowFocus: false, queryFn: async () => {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/gallery`, { credentials: 'include' });
    if (!response.ok) throw new Error(ar ? 'تعذر تحميل الصور.' : 'Could not load images.');
    return response.json() as Promise<{ enabled: boolean; images: Image[] }>;
  }});
  useEffect(() => { if (query.data) setImages(query.data.images); }, [query.data]);
  const move = (index: number, direction: number) => {
    const next = [...images]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setImages(next); setSaved(false);
  };
  const add = () => {
    const imageUrl = url.trim();
    try {
      const parsed = new URL(imageUrl);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || imageUrl.length > 2048) throw new Error();
      if (images.some(image => image.imageUrl === imageUrl) || images.length >= 10) throw new Error();
      setImages([...images, { imageUrl, altText: '', isPrimary: images.length === 0 }]);
      setUrl(''); setError(''); setSaved(false);
    } catch { setError(ar ? 'أدخل رابط صورة HTTP أو HTTPS غير مكرر. الحد الأقصى 10 صور.' : 'Use a unique HTTP or HTTPS image URL. Maximum 10 images.'); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!csrfToken || pending) return;
    setPending(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/gallery`, {
        method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ images: images.map(({ imageUrl, altText }) => ({ imageUrl, altText })), primaryIndex: Math.max(0, images.findIndex(image => image.isPrimary)) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (ar ? 'تعذر حفظ الصور.' : 'Could not save images.'));
      queryClient.setQueryData(['product-gallery', productId], { enabled: true, images: payload.images });
      setImages(payload.images); setSaved(true); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : (ar ? 'تعذر حفظ الصور.' : 'Could not save images.')); }
    finally { setPending(false); }
  };
  if (query.isLoading) return <p role="status">{ar ? 'جار تحميل الصور…' : 'Loading images…'}</p>;
  if (query.isError) return <div role="alert">{ar ? 'تعذر تحميل الصور.' : 'Could not load images.'}<button onClick={() => void query.refetch()} className="ms-3 underline">{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>;
  if (!query.data?.enabled) return <p className="text-[#e5c996]">{ar ? 'معرض الصور متاح في Pro وBusiness.' : 'Gallery is available on Pro and Business.'}</p>;
  return <form onSubmit={save} className="space-y-4">
    <p className="text-xs text-[#9baaaa]">{ar ? 'أضف روابط الصور، ورتبها وحدد الصورة الرئيسية. تُحفظ التغييرات عند الضغط على حفظ.' : 'Add image URLs, reorder them and select the primary image. Changes apply when saved.'} ({images.length}/10)</p>
    <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
      <div className="flex gap-2"><input aria-label={ar ? 'رابط الصورة' : 'Image URL'} type="url" value={url} onChange={e => setUrl(e.target.value)} maxLength={2048} placeholder="https://…" className="min-w-0 flex-1 rounded-xl border border-[#354344] bg-[#182123] px-3 py-2"/><button type="button" disabled={images.length >= 10 || !url.trim()} onClick={add} className="rounded-xl border border-[#354344] px-4 py-2 disabled:opacity-40">{ar ? 'إضافة' : 'Add'}</button></div>
      {images.map((image, index) => <div key={image.imageUrl} className="flex flex-wrap gap-3 rounded-xl border border-[#354344] p-3">
        <img src={image.imageUrl} alt={image.altText} loading="lazy" referrerPolicy="no-referrer" className="h-20 w-20 rounded-lg object-cover"/>
        <div className="min-w-0 flex-1"><p className="truncate text-xs text-[#879595]">{image.imageUrl}</p><input aria-label={ar ? 'وصف الصورة' : 'Image description'} value={image.altText} maxLength={160} onChange={e => { setImages(images.map((value, i) => i === index ? { ...value, altText: e.target.value } : value)); setSaved(false); }} placeholder={ar ? 'وصف الصورة' : 'Image description'} className="mt-2 w-full rounded-lg border border-[#354344] bg-[#182123] px-2 py-1 text-sm"/>
          <div className="mt-2 flex flex-wrap gap-3 text-xs"><label><input type="radio" name="primary" checked={image.isPrimary} onChange={() => { setImages(images.map((value, i) => ({ ...value, isPrimary: i === index }))); setSaved(false); }}/> {ar ? 'رئيسية' : 'Primary'}</label><button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="disabled:opacity-40">↑ {ar ? 'أعلى' : 'Up'}</button><button type="button" disabled={index === images.length - 1} onClick={() => move(index, 1)} className="disabled:opacity-40">↓ {ar ? 'أسفل' : 'Down'}</button><button type="button" onClick={() => { const next = images.filter((_, i) => i !== index); if (!next.some(value => value.isPrimary) && next[0]) next[0] = { ...next[0], isPrimary: true }; setImages(next); setSaved(false); }} className="text-[#e4a09a]">{ar ? 'حذف' : 'Remove'}</button></div>
        </div>
      </div>)}
      {!images.length && <p className="text-sm text-[#879595]">{ar ? 'لا توجد صور.' : 'No images.'}</p>}
      <button disabled={!csrfToken} className="rounded-xl bg-[#62d6aa] px-5 py-3 text-sm font-bold text-[#10231d] disabled:opacity-40">{pending ? '…' : ar ? 'حفظ الصور' : 'Save images'}</button>
    </fieldset>
    {error && <p role="alert" className="text-sm text-[#e4a09a]">{error}</p>}{saved && <p role="status" className="text-sm text-[#80d7b5]">{ar ? 'تم حفظ الصور.' : 'Images saved.'}</p>}
  </form>;
}
