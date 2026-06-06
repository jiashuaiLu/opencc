import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

interface GlassInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'small' | 'medium';
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ size = 'medium', prefix, suffix, className = '', ...rest }, ref) => {
    return (
      <div className={`g-input-wrap g-input-${size} ${className}`}>
        {prefix && <span className="g-input-prefix">{prefix}</span>}
        <input ref={ref} className="g-input" {...rest} />
        {suffix && <span className="g-input-suffix">{suffix}</span>}
      </div>
    );
  }
);

GlassInput.displayName = 'GlassInput';
