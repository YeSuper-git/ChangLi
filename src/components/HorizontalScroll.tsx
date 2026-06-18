import React from 'react';

interface HorizontalScrollProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}

export function HorizontalScroll<T>({ items, renderItem }: HorizontalScrollProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
      {items.map((item, i) => (
        <div key={i} className="flex-shrink-0 w-48">{renderItem(item)}</div>
      ))}
    </div>
  );
}
