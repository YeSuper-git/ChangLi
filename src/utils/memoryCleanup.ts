type CleanupHandler = () => void;

const CLEANUP_EVENT = 'changli:memory-cleanup';
const handlers = new Set<CleanupHandler>();

export function registerMemoryCleanup(handler: CleanupHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function requestAppMemoryCleanup(reason = 'manual') {
  for (const handler of Array.from(handlers)) {
    try {
      handler();
    } catch (error) {
      console.warn('[MemoryCleanup] handler failed:', error);
    }
  }

  try {
    window.dispatchEvent(new CustomEvent(CLEANUP_EVENT, { detail: { reason } }));
  } catch {
    // ignore
  }

  // WebView/Chromium normally doesn't expose gc(). If it is available in dev builds,
  // call it only after app caches are cleared.
  const maybeGc = (globalThis as { gc?: () => void }).gc;
  if (typeof maybeGc === 'function') {
    try { maybeGc(); } catch { /* ignore */ }
  }
}

export function addMemoryCleanupListener(handler: (reason: string) => void): () => void {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<{ reason?: string }>;
    handler(custom.detail?.reason || 'unknown');
  };
  window.addEventListener(CLEANUP_EVENT, listener);
  return () => window.removeEventListener(CLEANUP_EVENT, listener);
}

export function scheduleIdleMemoryCleanup(reason = 'idle') {
  const run = () => requestAppMemoryCleanup(reason);
  const requestIdle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number }).requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 1000);
  }
}

export function getJsHeapUsageRatio(): number | null {
  const memory = (performance as unknown as {
    memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;
  const used = memory?.usedJSHeapSize;
  const limit = memory?.jsHeapSizeLimit;
  if (!used || !limit || limit <= 0) return null;
  return used / limit;
}