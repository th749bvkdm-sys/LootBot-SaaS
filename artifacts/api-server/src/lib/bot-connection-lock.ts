const pending = new Map<string, Promise<void>>();

/** Serialize local credential changes, worker replacement and disconnects per store. */
export async function withBotConnectionChange<T>(storeId: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(storeId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  pending.set(storeId, tail);
  await previous;
  try { return await action(); }
  finally { release(); if (pending.get(storeId) === tail) pending.delete(storeId); }
}
