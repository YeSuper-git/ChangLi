export type NotifyType = 'success' | 'info' | 'error';

export interface NotifyPayload {
  message: string;
  type?: NotifyType;
  duration?: number;
}

export const notifyEventName = 'changli:notify';

export function notify(payload: NotifyPayload | string) {
  const detail: NotifyPayload = typeof payload === 'string' ? { message: payload } : payload;
  window.dispatchEvent(new CustomEvent<NotifyPayload>(notifyEventName, { detail }));
}
