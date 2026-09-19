const { renderParagraphHtml } = require("./paragraph");

const QUOTE_TYPES = {
  quotation_line: {
    align: "left",
    style: "border-left:4px solid #d0d7de;padding:10px 16px;",
  },

  quotation_underline: {
    align: "left",
    style: "border-bottom:2px solid #d0d7de;padding:10px 4px;",
  },

  default: {
    align: "center",
    style: "padding:16px;",
  },

  quotation_bubble: {
    align: "center",
    style: "border:1px solid #d0d7de;border-radius:12px;padding:16px;",
  },

  quotation_postit: {
    align: "center",
    style: "border:1px solid #d0d7de;padding:16px;",
  },

  quotation_corner: {
    align: "center",
    style: "border-top:1px solid #d0d7de;border-bottom:1px solid #d0d7de;padding:16px;",
  },
};

function getQuoteType(component) {
  const layout = component.find("[class*='se-l-']").first();
  const classes = String(layout.attr("class") || "").split(/\s+/);

  if (classes.includes("se-l-quotation_line")) return "quotation_line";
  if (classes.includes("se-l-quotation_underline")) return "quotation_underline";
  if (classes.includes("se-l-quotation_bubble")) return "quotation_bubble";
  if (classes.includes("se-l-quotation_postit")) return "quotation_postit";
  if (classes.includes("se-l-quotation_corner")) return "quotation_corner";
  if (classes.includes("se-l-default")) return "default";

  return "default";
}

function renderModule(module) {
  const paragraphs = module.find("p.se-text-paragraph").toArray();

  if (!paragraphs.length) {
    return module.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();
  }

  return paragraphs
    .map((paragraph) => renderParagraphHtml(paragraph))
    .filter((text) => text.trim())
    .join("<br>");
}

function renderQuote(component) {
  const type = getQuoteType(component);
  const config = QUOTE_TYPES[type] || QUOTE_TYPES.default;

  const quoteModule = component.find(".se-module.se-module-text.se-quote").first();
  const citeModule = component.find(".se-module.se-module-text.se-cite").first();

  const quote = quoteModule.length ? renderModule(quoteModule) : "";
  const cite = citeModule.length ? renderModule(citeModule) : "";

  if (!quote && !cite) return "";

  const textAlign = `text-align:${config.align};`;
  const base = "margin:16px 0;background:transparent;";
  const quoteHtml = quote ? `<div class="naver-quote-content">${quote}</div>` : "";
  const citeHtml = cite ? `<div class="naver-quote-cite" style="margin-top:8px;font-size:0.9em;">${cite}</div>` : "";

  return `<div class="naver-quote" data-naver-quote-type="${type}" style="${base}${textAlign}${config.style}">${quoteHtml}${citeHtml}</div>`;
}

function protectQuotes($, root, store) {
  root.find(".se-component.se-quotation").each((_, element) => {
    const component = $(element);
    const output = renderQuote(component);

    if (!output) {
      component.remove();
      return;
    }

    component.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });
}

module.exports = {
  protectQuotes,
};
