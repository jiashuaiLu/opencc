import { useEffect, type ReactNode } from 'react';
import './ui.css';

interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}

export function GlassModal({ open, onClose, title, children, width = 560, footer }: GlassModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="g-modal-overlay" onClick={onClose}>
      <div
        className="g-modal"
        style={{ width }}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="g-modal-header">
            <div className="g-modal-title">{title}</div>
            <button className="g-modal-close" onClick={onClose}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}
        <div className="g-modal-body">{children}</div>
        {footer && <div className="g-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
