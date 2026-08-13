import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * Fetch-on-mount with an explicit reload, and no re-render storm.
 * Deliberately not a polling loop. Data refreshes when a write completes or
 * when the wallet emits a change, which is what `deps` is for.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) { setData(null); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    fn()
      .then((r) => { if (!cancelled && alive.current) { setData(r); setError(null); } })
      .catch((e) => { if (!cancelled && alive.current) { setError(e); setData(null); } })
      .finally(() => { if (!cancelled && alive.current) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
