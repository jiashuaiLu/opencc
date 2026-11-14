import { type ReactNode } from 'react';
import './ui.css';

interface SegmentOption {
  label: ReactNode;
  value: string;
}

interface GlassSegmentedProps {
  value?: string;
  onChange?: (value: string) => void;
  options: SegmentOption[] | string[];
  size?: 'small' | 'medium';
  className?: string;
}

export function GlassSegmented({ value, onChange, options, size = 'medium', className = '' }: GlassSegmentedProps) {
  const normalizedOptions: SegmentOption[] = options.map(opt =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt
  );

  return (
    <div className={`g-segmented g-segmented-${size} ${className}`}>
      {normalizedOptions.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`g-segmented-item ${opt.value === value ? 'g-segmented-item-active' : ''}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
