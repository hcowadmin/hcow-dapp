import { useEffect, useState } from "react";

/**
 * Local 1s tick for the epoch countdown.
 * This does NOT call the adapter. The epoch object is fetched once and the
 * remaining time is computed on the client, so the countdown costs no RPC.
 */
export function useCountdown(endsAt: number | null): { remainingMs: number; settling: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt === null) return { remainingMs: 0, settling: false };
  const remainingMs = endsAt - now;
  return { remainingMs, settling: remainingMs <= 0 };
}
