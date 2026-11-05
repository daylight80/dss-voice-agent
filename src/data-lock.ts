let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialise writes to DATA_DIR. The retention rewrite replaces files by rename,
 * so an append that lands during that rewrite would be lost. Live calls take
 * this same lock only around the disk append, and the event loop stays free
 * while the lock is held.
 */
export function withDataLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn, fn);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
