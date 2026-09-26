export const REMOVE_PARAGRAPH_MARGINS_KEY = "removeParagraphMargins";
export const DARK_MODE_KEY = "darkMode";

export function getBooleanSetting(key: string, defaultValue: boolean) {
  const saved = localStorage.getItem(key);

  return saved === null ? defaultValue : saved === "true";
}

export function setBooleanSetting(key: string, value: boolean) {
  localStorage.setItem(key, String(value));
}

function getOrCreateStyle(document: Document, id: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }

  return style;
}

export function applyOriginalSettings(document: Document, darkMode: boolean) {
  const style = getOrCreateStyle(document, "viewer-original-settings");

  style.textContent = darkMode
    ? `
      html {
        color-scheme: dark;
      }

      html,
      body {
        background-color: #212529 !important;
      }
    `
    : "";
}

export function applyMarkdownSettings(
  document: Document,
  markdownZoom: number,
  removeParagraphMargins: boolean,
  darkMode: boolean,
) {
  document.documentElement.style.zoom = `${markdownZoom}%`;

  const style = getOrCreateStyle(document, "viewer-markdown-settings");
  const rules: string[] = [];

  if (removeParagraphMargins) {
    rules.push(`
      p {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }
    `);
  }

  if (darkMode) {
    rules.push(`
      html {
        color-scheme: dark;
      }

      html,
      body {
        background-color: #212529 !important;
        color: #dee2e6 !important;
      }

      a {
        color: #6ea8fe !important;
      }

      pre,
      code {
        color: #dee2e6 !important;
      }
    `);
  }

  style.textContent = rules.join("\n");
}
