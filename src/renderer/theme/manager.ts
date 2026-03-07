import { theme } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'auto';

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
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  customColors?: Partial<ThemeColors>;
}

export const lightTheme: ThemeColors = {
  primary: '#1677ff', // Vibrant Blue
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  info: '#1677ff',
  background: '#f5f7fa', // Slightly cooler grey
  surface: '#ffffff',
  text: '#1f1f1f', // Softer black
  textSecondary: '#8c8c8c',
  border: '#f0f0f0',
};

export const darkTheme: ThemeColors = {
  primary: '#1668dc', // Deep Blue
  success: '#49aa19',
  warning: '#d89614',
  danger: '#a61d24',
  info: '#1668dc',
  background: '#141414',
  surface: '#1f1f1f',
  text: 'rgba(255, 255, 255, 0.85)',
  textSecondary: 'rgba(255, 255, 255, 0.45)',
  border: '#303030',
};

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
    const root = document.documentElement;

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

    if (this.currentTheme.mode === 'dark') {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }
  }

  generateAntdTheme(): any {
    const colors = this.currentTheme.colors;
    
    return {
      algorithm: this.currentTheme.mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: colors.primary,
        colorSuccess: colors.success,
        colorWarning: colors.warning,
        colorError: colors.danger,
        colorInfo: colors.info,
        colorBgContainer: colors.surface,
        colorBgLayout: colors.background,
        colorText: colors.text,
        colorTextSecondary: colors.textSecondary,
        colorBorder: colors.border,
        borderRadius: 8,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
      },
      components: {
        Button: {
          borderRadius: 6,
          controlHeight: 36,
        },
        Input: {
          borderRadius: 6,
          controlHeight: 36,
        },
        Card: {
          borderRadiusLG: 12,
        },
        Modal: {
          borderRadiusLG: 12,
        },
        Table: {
          borderRadiusLG: 8,
        },
      },
    };
  }
}
