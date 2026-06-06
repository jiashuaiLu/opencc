import { type ReactNode } from 'react';
import './ui.css';

type TagColor = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan';

interface GlassTagProps {
  children: ReactNode;
  color?: TagColor;
  className?: string;
  icon?: ReactNode;
}

export function GlassTag({ children, color = 'default', className = '', icon }: GlassTagProps) {
  return (
    <span className={`g-tag g-tag-${color} ${className}`}>
      {icon && <span className="g-tag-icon">{icon}</span>}
      {children}
    </span>
  );
}
