import React, { useRef, useEffect, useCallback, useState } from 'react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD format
  onChange: (value: string) => void;
}

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseDate(dateStr: string): { year: number; month: number; day: number } {
  if (dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return { year: y, month: m, day: d };
      }
    }
  }
  const now = new Date();
  return { year: now.getFullYear() - 25, month: 1, day: 1 };
}

function formatToDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1940 + 1 }, (_, i) => 1940 + i);

interface ScrollColumnProps {
  items: number[];
  selected: number;
  onSelect: (value: number) => void;
  label?: string;
}

const ScrollColumn: React.FC<ScrollColumnProps> = ({ items, selected, onSelect, label }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const selectedIndex = items.indexOf(selected);

  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      const scrollTop = selectedIndex * ITEM_HEIGHT;
      containerRef.current.scrollTop = scrollTop;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    scrollTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current) return;
      const scrollTop = containerRef.current.scrollTop;
      const index = Math.round(scrollTop / ITEM_HEIGHT);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
      const snappedScrollTop = clampedIndex * ITEM_HEIGHT;

      containerRef.current.scrollTo({
        top: snappedScrollTop,
        behavior: 'smooth',
      });

      if (items[clampedIndex] !== undefined) {
        onSelect(items[clampedIndex]);
      }
    }, 80);
  }, [items, onSelect]);

  return (
    <div className="flex flex-col items-center">
      {label && (
        <div className="text-xs text-gray-400 mb-1 select-none">{label}</div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative overflow-y-scroll scrollbar-hide"
        style={{
          height: PICKER_HEIGHT,
          width: 72,
          scrollSnapType: 'y mandatory',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {/* Top padding */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <div
              key={item}
              className={`flex items-center justify-center select-none transition-all duration-150 ${
                isSelected
                  ? 'text-gray-900 font-semibold text-base'
                  : 'text-gray-400 text-sm'
              }`}
              style={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
              }}
            >
              {item}
            </div>
          );
        })}
        {/* Bottom padding */}
        <div style={{ height: ITEM_HEIGHT * 2 }} />
      </div>
      {/* Selection highlight indicator */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: ITEM_HEIGHT * 2,
          height: ITEM_HEIGHT,
          left: 0,
          right: 0,
          borderTop: '1px solid rgba(0,0,0,0.08)',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}
      />
    </div>
  );
};

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange }) => {
  const { year: initYear, month: initMonth, day: initDay } = parseDate(value);
  const [selectedYear, setSelectedYear] = useState(initYear);
  const [selectedMonth, setSelectedMonth] = useState(initMonth);
  const [selectedDay, setSelectedDay] = useState(initDay);

  useEffect(() => {
    const parsed = parseDate(value);
    setSelectedYear(parsed.year);
    setSelectedMonth(parsed.month);
    setSelectedDay(parsed.day);
  }, [value]);

  const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
  const DAYS = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const handleYearChange = useCallback((y: number) => {
    setSelectedYear(y);
    const maxDay = getDaysInMonth(y, selectedMonth);
    const newDay = Math.min(selectedDay, maxDay);
    setSelectedDay(newDay);
    onChange(formatToDateString(y, selectedMonth, newDay));
  }, [selectedMonth, selectedDay, onChange]);

  const handleMonthChange = useCallback((m: number) => {
    setSelectedMonth(m);
    const maxDay = getDaysInMonth(selectedYear, m);
    const newDay = Math.min(selectedDay, maxDay);
    setSelectedDay(newDay);
    onChange(formatToDateString(selectedYear, m, newDay));
  }, [selectedYear, selectedDay, onChange]);

  const handleDayChange = useCallback((d: number) => {
    setSelectedDay(d);
    onChange(formatToDateString(selectedYear, selectedMonth, d));
  }, [selectedYear, selectedMonth, onChange]);

  // Ensure selectedDay is valid
  const validDay = Math.min(selectedDay, daysInMonth);

  return (
    <div className="inline-flex items-center bg-white border border-gray-200 rounded-xl px-2 py-2 relative">
      <ScrollColumn
        items={YEARS}
        selected={selectedYear}
        onSelect={handleYearChange}
        label="年"
      />
      <div className="mx-1 text-gray-300 text-lg select-none self-center" style={{ marginTop: 16 }}>—</div>
      <ScrollColumn
        items={MONTHS}
        selected={selectedMonth}
        onSelect={handleMonthChange}
        label="月"
      />
      <div className="mx-1 text-gray-300 text-lg select-none self-center" style={{ marginTop: 16 }}>—</div>
      <ScrollColumn
        items={DAYS}
        selected={validDay}
        onSelect={handleDayChange}
        label="日"
      />
      {/* Gradient fade at top and bottom */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none rounded-t-xl"
        style={{
          height: ITEM_HEIGHT * 2 + 8,
          background: 'linear-gradient(to bottom, white 40%, transparent)',
        }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none rounded-b-xl"
        style={{
          height: ITEM_HEIGHT * 2 + 8,
          background: 'linear-gradient(to top, white 40%, transparent)',
        }}
      />
    </div>
  );
};

export default DatePicker;
