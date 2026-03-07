import React, { createContext, useContext, useEffect, useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeManager, ThemeMode, ThemeColors } from '../theme/manager';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  customColors: Partial<ThemeColors>;
  setCustomColors: (colors: Partial<ThemeColors>) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeManager] = useState(() => new ThemeManager());
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [customColors, setCustomColorsState] = useState<Partial<ThemeColors>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI) {
          const settings = await window.electronAPI.getSettings();
          if (settings?.theme) {
            if (settings.theme.mode) setModeState(settings.theme.mode);
            if (settings.theme.customColors) setCustomColorsState(settings.theme.customColors);
          }
        }
      } catch (e) {
        console.error("Failed to load theme settings", e);
      } finally {
        setInitialized(true);
      }
    };
    loadSettings();
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    saveSettings(newMode, customColors);
  };

  const setCustomColors = (newColors: Partial<ThemeColors>) => {
    setCustomColorsState(newColors);
    saveSettings(mode, newColors);
  };

  const saveSettings = async (currentMode: ThemeMode, currentColors: Partial<ThemeColors>) => {
    try {
      if (window.electronAPI) {
        const settings = await window.electronAPI.getSettings() || {};
        settings.theme = {
          mode: currentMode,
          customColors: currentColors,
        };
        await window.electronAPI.saveSettings(settings);
      }
    } catch (e) {
      console.error("Failed to save theme settings", e);
    }
  };

  useEffect(() => {
    themeManager.setTheme(mode, customColors);
    themeManager.applyThemeToDocument();
  }, [mode, customColors, themeManager]);

  // Use useMemo to generate theme only when dependencies change, and ensure it uses the current state
  const antdTheme = React.useMemo(() => {
    // Ensure themeManager state is up to date before generating
    themeManager.setTheme(mode, customColors);
    return themeManager.generateAntdTheme();
  }, [mode, customColors, themeManager]);

  if (!initialized) {
    return null; // Or a loading spinner
  }

  return (
    <ThemeContext.Provider value={{ mode, setMode, customColors, setCustomColors }}>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
};
