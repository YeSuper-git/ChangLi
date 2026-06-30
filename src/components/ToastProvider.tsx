import React, { useEffect, useState } from 'react';
import { notifyEventName, type NotifyPayload, type NotifyType } from '../utils/notify';

type ToastItem = Required<Pick<NotifyPayload, 'message' | 'type'>> & { id: number };

const typeClass: Record<NotifyType, string> = {
  success: 'bg-gray-900 text-white',
  info: 'bg-gray-900 text-white',
  error: 'bg-red-600 text-white',
};

const ToastProvider: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleNotify = (event: Event) => {
      const detail = (event as CustomEvent<NotifyPayload>).detail;
      if (!detail?.message) return;

      const id = Date.now() + Math.random();
      const type = detail.type ?? 'info';
      const duration = detail.duration ?? 5000;
      setItems((current) => [...current, { id, message: detail.message, type }]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, duration);
    };

    window.addEventListener(notifyEventName, handleNotify);
    return () => window.removeEventListener(notifyEventName, handleNotify);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed right-4 top-16 z-[9999] flex max-w-[360px] flex-col gap-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg px-4 py-3 text-sm shadow-lg pointer-events-auto animate-[changliToastIn_300ms_ease-out] ${typeClass[item.type]}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
};

export default ToastProvider;
