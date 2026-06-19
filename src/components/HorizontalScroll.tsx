import React from 'react';

interface HorizontalScrollProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}

export function HorizontalScroll<T>({ items, renderItem }: HorizontalScrollProps<T>) {
  return (
    <div className="flex gap-8 overflow-x-auto pb-4 scrollbar-hide">
      {items.map((item, i) => (
        <div key={i} className="flex-shrink-0" style={{ width: 'calc(33.333% - 1.5rem)' }}>{renderItem(item)}</div>
      ))}
    </div>
  );
}
