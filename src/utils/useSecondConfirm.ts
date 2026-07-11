import { useCallback, useEffect, useRef, useState } from 'react';

export const useSecondConfirm = (timeoutMs = 3000) => {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingKey(null);
  }, []);

  useEffect(() => clearPending, [clearPending]);

  const requestSecondConfirm = useCallback(
    async (key: string, action: () => void | Promise<void>) => {
      if (pendingKey !== key) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        setPendingKey(key);
        timerRef.current = window.setTimeout(() => {
          setPendingKey((current) => (current === key ? null : current));
          timerRef.current = null;
        }, timeoutMs);
        return;
      }

      clearPending();
      await action();
    },
    [clearPending, pendingKey, timeoutMs]
  );

  return { pendingKey, requestSecondConfirm, clearPending };
};
