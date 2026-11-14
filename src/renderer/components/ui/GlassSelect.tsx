import { useState, useRef, useEffect, type ReactNode } from 'react';
import './ui.css';

interface Option {
  label: string;
  value: string;
}

interface GlassSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: Option[];
  placeholder?: string;
  size?: 'small' | 'medium';
  className?: string;
  prefix?: ReactNode;
}

export function GlassSelect({ value, onChange, options, placeholder = '请选择', size = 'medium', className = '', prefix }: GlassSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`g-select g-select-${size} ${open ? 'g-select-open' : ''} ${className}`}>
      <div className="g-select-trigger" onClick={() => setOpen(!open)}>
        {prefix && <span className="g-select-prefix">{prefix}</span>}
        <span className={`g-select-value ${!selected ? 'g-select-placeholder' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="g-select-arrow">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </div>
      {open && (
        <div className="g-select-dropdown">
          {options.map(opt => (
            <div
              key={opt.value}
              className={`g-select-option ${opt.value === value ? 'g-select-option-active' : ''}`}
              onClick={() => { onChange?.(opt.value); setOpen(false); }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
