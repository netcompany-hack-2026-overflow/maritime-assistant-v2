/**
 * Run work for the same key one at a time, in arrival order. Used where a
 * read-check-write must not interleave: sending an email (so two clicks or two
 * tabs can't send it twice) and the insurance JSON on a voyage (so one write
 * can't overwrite another). The API runs as a single process, so an in-memory
 * queue is enough.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withKeyLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  tails.set(key, run);
  try {
    return await run;
  } finally {
    // Forget the key once nothing else has queued behind this run.
    if (tails.get(key) === run) tails.delete(key);
  }
}
