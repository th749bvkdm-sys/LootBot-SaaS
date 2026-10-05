export function parseStudioOptionsQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.q !== undefined && (typeof raw.q !== 'string' || raw.q.length > 100)) return null;
  if (raw.selected !== undefined && (typeof raw.selected !== 'string' || (raw.selected !== '' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.selected)))) return null;
  if (raw.page !== undefined && typeof raw.page !== 'string') return null;
  const page = raw.page === undefined ? 1 : Number(raw.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return null;
  return { q: typeof raw.q === 'string' ? raw.q.trim() : '', selected: typeof raw.selected === 'string' ? raw.selected : '', page };
}
