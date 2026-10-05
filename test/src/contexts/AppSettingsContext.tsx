import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  APPLY_FONTS_KEY,
  DARK_MODE_KEY,
  FANCY_CHECKBOXES_KEY,
  getBooleanSetting,
  REMOVE_PARAGRAPH_MARGINS_KEY,
  setBooleanSetting,
} from "../utils/settings";

const SYNC_SCROLL_KEY = "syncScroll";

type AppSettingsContextValue = {
  removeParagraphMargins: boolean;
  darkMode: boolean;
  fancyCheckboxes: boolean;
  syncScroll: boolean;
  applyFonts: boolean;
  setApplyFonts: (value: boolean) => void;
  setRemoveParagraphMargins: (value: boolean) => void;
  setDarkMode: (value: boolean) => void;
  setFancyCheckboxes: (value: boolean) => void;
  setSyncScroll: (value: boolean) => void;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

type AppSettingsProviderProps = {
  children: ReactNode;
};

export function AppSettingsProvider({ children }: AppSettingsProviderProps) {
  const [applyFonts, setApplyFontsState] = useState(() => {
    return getBooleanSetting(APPLY_FONTS_KEY, true);
  });

  const [removeParagraphMargins, setRemoveParagraphMarginsState] = useState(() => {
    return getBooleanSetting(REMOVE_PARAGRAPH_MARGINS_KEY, true);
  });

  const [darkMode, setDarkModeState] = useState(() => {
    return getBooleanSetting(DARK_MODE_KEY, false);
  });

  const [fancyCheckboxes, setFancyCheckboxesState] = useState(() => {
    return getBooleanSetting(FANCY_CHECKBOXES_KEY, true);
  });

  const [syncScroll, setSyncScrollState] = useState(() => {
    return getBooleanSetting(SYNC_SCROLL_KEY, false);
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-bs-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const setApplyFonts = (value: boolean) => {
    setApplyFontsState(value);
    setBooleanSetting(APPLY_FONTS_KEY, value);
  };

  const setRemoveParagraphMargins = (value: boolean) => {
    setRemoveParagraphMarginsState(value);
    setBooleanSetting(REMOVE_PARAGRAPH_MARGINS_KEY, value);
  };

  const setDarkMode = (value: boolean) => {
    setDarkModeState(value);
    setBooleanSetting(DARK_MODE_KEY, value);
  };

  const setFancyCheckboxes = (value: boolean) => {
    setFancyCheckboxesState(value);
    setBooleanSetting(FANCY_CHECKBOXES_KEY, value);
  };

  const setSyncScroll = (value: boolean) => {
    setSyncScrollState(value);
    setBooleanSetting(SYNC_SCROLL_KEY, value);
  };

  return (
    <AppSettingsContext.Provider
      value={{
        applyFonts,
        removeParagraphMargins,
        darkMode,
        fancyCheckboxes,
        syncScroll,
        setApplyFonts,
        setRemoveParagraphMargins,
        setDarkMode,
        setFancyCheckboxes,
        setSyncScroll,
      }}
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