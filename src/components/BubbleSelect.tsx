import React, { useState, useRef, useEffect } from 'react';

interface BubbleSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
  dropUp?: boolean;
}

const BubbleSelect: React.FC<BubbleSelectProps> = ({ value, options, onChange, className, dropUp }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`changli-bubble-select ${className || ''}`} onClick={() => setOpen((v) => !v)}>
      <span className="changli-bubble-select-trigger">
        {current?.label || value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </span>
      {open && (
        <div className={`changli-bubble-select-dropdown ${dropUp ? 'drop-up' : ''}`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`changli-bubble-select-option ${opt.value === value ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default BubbleSelect;
