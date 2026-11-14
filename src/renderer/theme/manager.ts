import { theme } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type GlassLevel = 'light' | 'standard' | 'heavy';

export interface ThemeColors {
  primary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  glassLevel?: GlassLevel;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  customColors?: Partial<ThemeColors>;
}

export const lightTheme: ThemeColors = {
  primary: '#1677ff',
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  info: '#1677ff',
  background: 'transparent',
  surface: 'rgba(255, 255, 255, 0.65)',
  text: '#1f1f1f',
  textSecondary: '#6b7280',
  border: 'rgba(255, 255, 255, 0.3)',
  glassLevel: 'light',
};

export const darkTheme: ThemeColors = {
  primary: '#3b82f6',
  success: '#49aa19',
  warning: '#d89614',
  danger: '#a61d24',
  info: '#3b82f6',
  background: 'transparent',
  surface: 'rgba(30, 30, 40, 0.65)',
  text: 'rgba(255, 255, 255, 0.95)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  border: 'rgba(255, 255, 255, 0.12)',
  glassLevel: 'heavy',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(100, 100, 100, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

interface GlassParams {
  blur: number;
  bgAlpha: number;
  strongAlpha: number;
}

function getGlassParams(level: GlassLevel): GlassParams {
  switch (level) {
    case 'light':
      return { blur: 12, bgAlpha: 0.4, strongAlpha: 0.55 };
    case 'standard':
      return { blur: 20, bgAlpha: 0.6, strongAlpha: 0.72 };
    case 'heavy':
      return { blur: 30, bgAlpha: 0.78, strongAlpha: 0.88 };
  }
}

export class ThemeManager {
  private currentTheme: Theme;

  constructor() {
    this.currentTheme = {
      mode: 'light',
      colors: lightTheme,
    };
  }

  setTheme(mode: ThemeMode, customColors?: Partial<ThemeColors>): void {
    const baseColors = mode === 'dark' ? darkTheme : lightTheme;

    this.currentTheme = {
      mode,
      colors: {
        ...baseColors,
        ...customColors,
      },
      customColors,
    };
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  getThemeColors(): ThemeColors {
    return this.currentTheme.colors;
  }

  isDarkMode(): boolean {
    return this.currentTheme.mode === 'dark';
  }

  applyThemeToDocument(): void {
    const colors = this.currentTheme.colors;
    const isDark = this.currentTheme.mode === 'dark';
    const root = document.documentElement;
    const glassLevel = colors.glassLevel || 'standard';
    const params = getGlassParams(glassLevel);

    // Base theme colors
    root.style.setProperty('--primary-color', colors.primary);
    root.style.setProperty('--success-color', colors.success);
    root.style.setProperty('--warning-color', colors.warning);
    root.style.setProperty('--danger-color', colors.danger);
    root.style.setProperty('--info-color', colors.info);
    root.style.setProperty('--background-color', colors.background);
    root.style.setProperty('--surface-color', colors.surface);
    root.style.setProperty('--text-color', colors.text);
    root.style.setProperty('--text-secondary-color', colors.textSecondary);
    root.style.setProperty('--border-color', colors.border);

    // Glass variables — tint from primary color
    const tintRgb = hexToRgb(colors.primary);
    const tintColor = tintRgb
      ? `rgba(${tintRgb.r}, ${tintRgb.g}, ${tintRgb.b}, 0.06)`
      : 'rgba(100, 150, 255, 0.06)';

    if (isDark) {
      // Dark mode — premium warm-dark glass (reference: Agentic Island / Stats dashboard)
      const siderAlpha = Math.min(params.strongAlpha + 0.12, 0.94);
      root.style.setProperty('--sider-bg', `rgba(16, 14, 22, ${siderAlpha})`);
      root.style.setProperty('--sider-border', 'rgba(255, 255, 255, 0.04)');

      // Content panel: deep, translucent
      const panelAlpha = params.bgAlpha * 0.55;
      root.style.setProperty('--panel-bg', `rgba(18, 16, 24, ${panelAlpha})`);

      // Cards: subtle warm lift — not grey, slightly warm-tinted
      root.style.setProperty('--card-bg', `rgba(35, 32, 42, ${0.4 + params.bgAlpha * 0.15})`);
      root.style.setProperty('--card-border', 'rgba(255, 220, 150, 0.08)');

      // General glass
      root.style.setProperty('--glass-bg', `rgba(25, 22, 32, ${params.bgAlpha})`);
      root.style.setProperty('--glass-bg-strong', `rgba(20, 18, 26, ${params.strongAlpha})`);
      root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.06)');
      root.style.setProperty('--glass-shadow', '0 2px 12px rgba(0, 0, 0, 0.3)');

      // Input/hover
      root.style.setProperty('--input-bg', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--hover-bg', 'rgba(255, 255, 255, 0.04)');
      root.style.setProperty('--active-bg', 'rgba(255, 255, 255, 0.07)');

      // Nav item states
      root.style.setProperty('--nav-hover', 'rgba(255, 255, 255, 0.05)');
      root.style.setProperty('--nav-active', 'rgba(255, 255, 255, 0.08)');
    } else {
      // Light mode: white frosted glass
      root.style.setProperty('--glass-bg', `rgba(255, 255, 255, ${params.bgAlpha})`);
      root.style.setProperty('--glass-bg-strong', `rgba(255, 255, 255, ${params.strongAlpha})`);
      root.style.setProperty('--glass-border', `rgba(0, 0, 0, ${0.04 + params.bgAlpha * 0.02})`);
      root.style.setProperty('--glass-shadow', '0 4px 16px rgba(0, 0, 0, 0.06)');
      // Sidebar — pure vibrancy, no bg
      root.style.setProperty('--sider-bg', 'transparent');
      root.style.setProperty('--sider-border', 'rgba(0, 0, 0, 0.06)');
      // Panel
      root.style.setProperty('--panel-bg', `rgba(246, 246, 248, ${params.strongAlpha})`);
      // Card
      root.style.setProperty('--card-bg', `rgba(255, 255, 255, ${params.bgAlpha * 0.85})`);
      root.style.setProperty('--card-border', `rgba(0, 0, 0, ${0.03 + params.bgAlpha * 0.02})`);
      // Input
      root.style.setProperty('--input-bg', 'rgba(0, 0, 0, 0.04)');
      // Hover
      root.style.setProperty('--hover-bg', 'rgba(0, 0, 0, 0.03)');
      root.style.setProperty('--active-bg', 'rgba(0, 0, 0, 0.06)');

      // Nav item states
      root.style.setProperty('--nav-hover', 'rgba(0, 0, 0, 0.04)');
      root.style.setProperty('--nav-active', 'rgba(0, 0, 0, 0.06)');
    }

    root.style.setProperty('--glass-tint', tintColor);
    root.style.setProperty('--glass-blur', `${params.blur}px`);
    root.style.setProperty('--glass-saturate', '180%');

    if (isDark) {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }
  }

  generateAntdTheme(): any {
    const colors = this.currentTheme.colors;
    const isDark = this.currentTheme.mode === 'dark';

    return {
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: colors.primary,
        colorSuccess: colors.success,
        colorWarning: colors.warning,
        colorError: colors.danger,
        colorInfo: colors.info,
        colorBgContainer: isDark ? 'rgba(30, 30, 40, 0.6)' : 'rgba(255, 255, 255, 0.6)',
        colorBgElevated: isDark ? 'rgba(30, 30, 40, 0.85)' : 'rgba(255, 255, 255, 0.85)',
        colorBgLayout: 'transparent',
        colorText: colors.text,
        colorTextSecondary: colors.textSecondary,
        colorBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
        colorBorderSecondary: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
        borderRadius: 10,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      },
      components: {
        Button: {
          borderRadius: 8,
          controlHeight: 34,
        },
        Input: {
          borderRadius: 8,
          controlHeight: 34,
        },
        Card: {
          borderRadiusLG: 14,
        },
        Modal: {
          borderRadiusLG: 14,
        },
        Table: {
          borderRadiusLG: 10,
        },
        Menu: {
          itemBg: 'transparent',
          subMenuItemBg: 'transparent',
        },
      },
    };
  }
}
