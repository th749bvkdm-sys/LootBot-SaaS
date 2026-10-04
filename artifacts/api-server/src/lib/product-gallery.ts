export type GalleryImage = { imageUrl: string; altText: string };
export type GalleryInput = { images: GalleryImage[]; primaryIndex: number };

export function parseGalleryInput(value: unknown): GalleryInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.images) || body.images.length > 10) return null;
  const images: GalleryImage[] = [];
  for (const raw of body.images) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.imageUrl !== "string") return null;
    const imageUrl = item.imageUrl.trim();
    if (!imageUrl || imageUrl.length > 2048) return null;
    try {
      const url = new URL(imageUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    } catch { return null; }
    const altText = item.altText ?? "";
    if (typeof altText !== "string" || altText.length > 160) return null;
    images.push({ imageUrl, altText: altText.trim() });
  }
  if (new Set(images.map(image => image.imageUrl)).size !== images.length) return null;
  const primaryIndex = body.primaryIndex ?? 0;
  if (typeof primaryIndex !== "number" || !Number.isInteger(primaryIndex) || primaryIndex < 0 ||
      (images.length === 0 ? primaryIndex !== 0 : primaryIndex >= images.length)) return null;
  return { images, primaryIndex };
}

export function galleryWithLegacyFallback<T extends GalleryImage & { isPrimary: boolean }>(images: T[], imageUrl: string | null) {
  return images.length ? images : imageUrl ? [{ id: "legacy-primary", imageUrl, altText: "", sortOrder: 0, isPrimary: true }] : [];
}
