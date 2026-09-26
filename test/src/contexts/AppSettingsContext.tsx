import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  DARK_MODE_KEY,
  getBooleanSetting,
  REMOVE_PARAGRAPH_MARGINS_KEY,
  setBooleanSetting,
} from "../utils/settings";

type AppSettingsContextValue = {
  removeParagraphMargins: boolean;
  darkMode: boolean;
  setRemoveParagraphMargins: (value: boolean) => void;
  setDarkMode: (value: boolean) => void;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

type AppSettingsProviderProps = {
  children: ReactNode;
};

export function AppSettingsProvider({ children }: AppSettingsProviderProps) {
  const [removeParagraphMargins, setRemoveParagraphMarginsState] = useState(() => {
    return getBooleanSetting(REMOVE_PARAGRAPH_MARGINS_KEY, true);
  });

  const [darkMode, setDarkModeState] = useState(() => {
    return getBooleanSetting(DARK_MODE_KEY, false);
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-bs-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const setRemoveParagraphMargins = (value: boolean) => {
    setRemoveParagraphMarginsState(value);
    setBooleanSetting(REMOVE_PARAGRAPH_MARGINS_KEY, value);
  };

  const setDarkMode = (value: boolean) => {
    setDarkModeState(value);
    setBooleanSetting(DARK_MODE_KEY, value);
  };

  return (
    <AppSettingsContext.Provider
      value={{ removeParagraphMargins, darkMode, setRemoveParagraphMargins, setDarkMode }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider");
  }

  return context;
}
