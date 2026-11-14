import { type ReactNode } from 'react';
import './ui.css';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  extra?: ReactNode;
  noPadding?: boolean;
}

export function GlassCard({ children, className = '', title, extra, noPadding }: GlassCardProps) {
  return (
    <div className={`g-card ${className}`}>
      {(title || extra) && (
        <div className="g-card-header">
          {title && <div className="g-card-title">{title}</div>}
          {extra && <div className="g-card-extra">{extra}</div>}
        </div>
      )}
      <div className={`g-card-body ${noPadding ? 'g-card-body-flush' : ''}`}>
        {children}
      </div>
    </div>
  );
}
