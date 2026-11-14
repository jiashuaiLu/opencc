import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'small' | 'medium';
  icon?: ReactNode;
  loading?: boolean;
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ variant = 'default', size = 'medium', icon, loading, children, className = '', disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={`g-btn g-btn-${variant} g-btn-${size} ${className}`}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && <span className="g-btn-spinner" />}
        {!loading && icon && <span className="g-btn-icon">{icon}</span>}
        {children && <span>{children}</span>}
      </button>
    );
  }
);

GlassButton.displayName = 'GlassButton';
