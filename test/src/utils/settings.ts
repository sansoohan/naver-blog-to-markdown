export const REMOVE_PARAGRAPH_MARGINS_KEY = "removeParagraphMargins";
export const DARK_MODE_KEY = "darkMode";
export const FANCY_CHECKBOXES_KEY = "fancyCheckboxes";
export const APPLY_FONTS_KEY = "applyFonts";

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
  fancyCheckboxes: boolean,
) {
  document.documentElement.style.zoom = `${markdownZoom}%`;

  const style = getOrCreateStyle(document, "viewer-markdown-settings");
  const rules: string[] = [];

  if (removeParagraphMargins) {
    rules.push(`
      li > p,
      li > h1,
      li > h2,
      li > h3,
      li > h4,
      li > h5,
      li > h6,
      body > p,
      body > h1,
      body > h2,
      body > h3,
      body > h4,
      body > h5,
      body > h6 {
        margin-top: 0;
        margin-bottom: 0;
      }

      ul,
      ol {
        padding-inline-start: 2em;
        margin: 0;
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

      pre {
        background-color: #2b3035 !important;
        color: #dee2e6 !important;
      }

      code {
        color: #dee2e6 !important;
      }
    `);
  }

  if (fancyCheckboxes) {
    rules.push(`
      .task-list-item-checkbox {
        appearance: none;
        position: relative;
        width: 18px;
        height: 18px;
        margin: 0 7px 0 0;
        border: 2px solid #adb5bd;
        border-radius: 5px;
        background-color: transparent;
        vertical-align: -3px;
        transition:
          background-color 0.15s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .task-list-item-checkbox:checked {
        border-color: #20a464;
        background-color: #20a464;
        box-shadow: 0 0 0 2px rgba(32, 164, 100, 0.15);
      }

      .task-list-item-checkbox:checked::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 5px;
        height: 9px;
        border: solid #fff;
        border-width: 0 2px 2px 0;
        transform: translate(-50%, -60%) rotate(45deg);
      }
    `);
  }

  style.textContent = rules.join("\n");
}