import './ui.css';

interface GlassSwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function GlassSwitch({ checked = false, onChange, disabled = false, className = '' }: GlassSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`g-switch ${checked ? 'g-switch-on' : ''} ${disabled ? 'g-switch-disabled' : ''} ${className}`}
      onClick={() => !disabled && onChange?.(!checked)}
    >
      <span className="g-switch-thumb" />
    </button>
  );
}
