export function subscribeWithSnapshot<T>(
  read: (() => Promise<T>) | undefined,
  subscribe: (onValue: (value: T) => void) => () => void,
  onValue: (value: T) => void,
): () => void {
  let revision = 0;
  let cancelled = false;
  const drop = subscribe((value) => {
    revision += 1;
    if (!cancelled) onValue(value);
  });
  const readAt = revision;
  void read?.().then((value) => {
    if (!cancelled && revision === readAt) onValue(value);
  });
  return () => {
    cancelled = true;
    drop();
  };
}
