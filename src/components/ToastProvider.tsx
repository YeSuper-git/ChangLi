import React, { useEffect, useState } from 'react';
import { notifyEventName, type NotifyPayload, type NotifyType } from '../utils/notify';

type ToastItem = Required<Pick<NotifyPayload, 'message' | 'type'>> & { id: number };

const typeClass: Record<NotifyType, string> = {
  success: 'border-emerald-200 bg-white text-gray-900',
  info: 'border-gray-200 bg-white text-gray-900',
  error: 'border-red-200 bg-white text-red-700',
};

const accentClass: Record<NotifyType, string> = {
  success: 'bg-emerald-500',
  info: 'bg-gray-900',
  error: 'bg-red-500',
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
    <div className="fixed right-5 top-16 z-[9999] flex max-w-[360px] flex-col gap-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`relative overflow-hidden rounded-xl border px-4 py-3 pl-5 text-sm shadow-xl pointer-events-auto animate-[changliToastIn_220ms_ease-out] ${typeClass[item.type]}`}
        >
          <span className={`absolute left-0 top-0 h-full w-1 ${accentClass[item.type]}`} />
          {item.message}
        </div>
      ))}
    </div>
  );
};

export default ToastProvider;
