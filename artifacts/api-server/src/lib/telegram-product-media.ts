export function productMediaRequest(chatId: number, images: { imageUrl: string }[], caption: string) {
  if (!images.length) return null;
  if (images.length === 1) return {
    method: "sendPhoto", body: { chat_id: chatId, photo: images[0].imageUrl, caption: caption.slice(0, 1024) },
  };
  return {
    method: "sendMediaGroup", body: {
      chat_id: chatId,
      media: images.slice(0, 10).map((image, index) => ({
        type: "photo", media: image.imageUrl, ...(index === 0 ? { caption: caption.slice(0, 1024) } : {}),
      })),
    },
  };
}
