import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

interface DatePickerProps {
  value: string; // YYYY-MM-DD format
  onChange: (value: string) => void;
}

function parseDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d);
    }
  }
  return undefined;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDate = parseDate(value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = useCallback((date: Date | undefined) => {
    if (date) {
      onChange(formatDate(date));
      setIsOpen(false);
    }
  }, [onChange]);

  // Set startMonth to January 1940 and endMonth to December of current year
  const startMonth = new Date(1940, 0); // January 1940
  const endMonth = new Date(new Date().getFullYear(), 11); // December of current year

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        placeholder="YYYY-MM-DD"
        readOnly
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 cursor-pointer bg-white"
      />
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-800 rounded-lg shadow-xl border border-zinc-700 p-4">
          <style>
            {`
              .rdp {
                --rdp-accent-color: #3b82f6;
                --rdp-background-color: #3b82f6;
                color: white;
                margin: 0;
              }
              .rdp-day {
                color: white;
                font-size: 14px;
                padding: 8px;
                border-radius: 8px;
                transition: background-color 0.2s;
              }
              .rdp-day:hover:not(.rdp-day_selected):not(.rdp-day_disabled) {
                background-color: #3f3f46;
              }
              .rdp-day_selected {
                background-color: #3b82f6 !important;
                color: white !important;
              }
              .rdp-day_today:not(.rdp-day_selected) {
                border: 1px solid #52525b;
              }
              .rdp-caption_label {
                color: white;
                font-size: 16px;
                font-weight: 600;
              }
              .rdp-button_next,
              .rdp-button_previous {
                color: white !important;
                fill: white !important;
              }
              .rdp-button_next svg,
              .rdp-button_previous svg {
                fill: white !important;
                color: white !important;
              }
              .rdp-button_next:hover,
              .rdp-button_previous:hover {
                background-color: #3f3f46;
                border-radius: 8px;
              }
              .rdp-weekday {
                color: #a1a1aa !important;
                font-size: 12px;
                font-weight: 500;
                padding: 8px;
              }
              .rdp-dropdown {
                background-color: #27272a;
                color: white;
                border: 1px solid #3f3f46;
                border-radius: 8px;
                padding: 4px 8px;
                font-size: 14px;
              }
              .rdp-dropdown:focus {
                outline: none;
                border-color: #3b82f6;
              }
              .rdp-dropdowns {
                gap: 8px;
              }
              .rdp-nav {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
              }
            `}
          </style>
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            defaultMonth={selectedDate || new Date()}
          />
        </div>
      )}
    </div>
  );
};

export default DatePicker;
