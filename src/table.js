const {
  renderParagraph,
  renderParagraphHtml,
  escapeHtmlText,
} = require("./paragraph");

function getSpan(cell, name) {
  const value = Number(cell.attr(name) || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function isEmptyCell(cell) {
  const text = cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim();
  return !text && !cell.find("img, video, iframe").length;
}

function getParagraphAlignment(paragraph) {
  const className = paragraph.attr("class") || "";

  if (className.includes("se-text-paragraph-align-center")) return "center";
  if (className.includes("se-text-paragraph-align-right")) return "right";
  if (className.includes("se-text-paragraph-align-left")) return "left";
  if (className.includes("se-text-paragraph-align-justify")) return "justify";

  const style = paragraph.attr("style") || "";
  const match = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i);

  return match ? match[1].toLowerCase() : "";
}

function hasAlignment(cell) {
  return cell.find("p.se-text-paragraph").toArray().some((element) => {
    return Boolean(getParagraphAlignment(cell.find(element)));
  });
}

function isSimpleTable($, table) {
  return table.find("tr").toArray().every((row) => {
    return $(row).children("th, td").toArray().every((element) => {
      const cell = $(element);

      return getSpan(cell, "rowspan") === 1
        && getSpan(cell, "colspan") === 1
        && !hasAlignment(cell);
    });
  });
}

function escapeMarkdownTableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>");
}

function renderMarkdownCell(cell) {
  const paragraphs = cell.find("p.se-text-paragraph").toArray();

  if (!paragraphs.length) {
    return escapeMarkdownTableCell(
      cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim(),
    );
  }

  return paragraphs.map((paragraph) => {
    const rendered = renderParagraph(paragraph);
    return rendered.empty ? "" : escapeMarkdownTableCell(rendered.text);
  }).filter(Boolean).join("<br>");
}

function renderSimpleTable($, table) {
  const rows = table.find("tr").toArray().map((row) => {
    return $(row).children("th, td").toArray().map((cell) => {
      return renderMarkdownCell($(cell));
    });
  });

  if (!rows.length) return "";

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")];
  const output = [];

  output.push(`| ${normalizeRow(rows[0]).join(" | ")} |`);
  output.push(`| ${Array(columnCount).fill("---").join(" | ")} |`);

  for (const row of rows.slice(1)) {
    output.push(`| ${normalizeRow(row).join(" | ")} |`);
  }

  return output.join("\n");
}

function renderHtmlCell(cell) {
  if (isEmptyCell(cell)) return "";

  const paragraphs = cell.find("p.se-text-paragraph").toArray();

  if (!paragraphs.length) {
    return escapeHtmlText(
      cell.text().replace(/\u200b/g, "").replace(/\u00a0/g, " ").trim(),
    );
  }

  return paragraphs.map((element) => {
    const paragraph = cell.find(element);
    const content = renderParagraphHtml(element);

    if (!content.trim()) return "";

    const align = getParagraphAlignment(paragraph);

    return align
      ? `<div style="text-align:${align};">${content}</div>`
      : `<div>${content}</div>`;
  }).filter(Boolean).join("");
}

function getColumnCount($, table) {
  let maximum = 0;

  for (const row of table.find("tr").toArray()) {
    let count = 0;

    for (const cell of $(row).children("th, td").toArray()) {
      count += getSpan($(cell), "colspan");
    }

    maximum = Math.max(maximum, count);
  }

  return maximum;
}

function getCellWidth(cell) {
  const style = cell.attr("style") || "";
  const match = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)%/i);

  return match ? Number(match[1]) : null;
}

function getColumnWidths($, table, columnCount) {
  const widths = Array(columnCount).fill(null);

  for (const row of table.find("tr").toArray()) {
    let column = 0;

    for (const element of $(row).children("th, td").toArray()) {
      const cell = $(element);
      const colspan = getSpan(cell, "colspan");
      const width = getCellWidth(cell);

      if (colspan === 1 && width !== null && widths[column] === null) {
        widths[column] = width;
      }

      column += colspan;
    }
  }

  return widths;
}

function renderColgroup(widths) {
  if (!widths.some((width) => width !== null)) return "";

  return `<colgroup>${widths.map((width) => (
    width === null ? "<col>" : `<col style="width:${width}%">`
  )).join("")}</colgroup>`;
}

function renderComplexTable($, table) {
  const columnCount = getColumnCount($, table);
  const widths = getColumnWidths($, table, columnCount);

  let html = '<table style="border-collapse:collapse;width:100%;background:transparent;">';
  html += renderColgroup(widths);

  for (const row of table.find("tr").toArray()) {
    html += "<tr>";

    for (const element of $(row).children("th, td").toArray()) {
      const cell = $(element);
      const tag = String(element.name || "").toLowerCase() === "th" ? "th" : "td";
      const rowspan = getSpan(cell, "rowspan");
      const colspan = getSpan(cell, "colspan");

      let attrs = "";

      if (rowspan > 1) attrs += ` rowspan="${rowspan}"`;
      if (colspan > 1) attrs += ` colspan="${colspan}"`;

      attrs += ' style="border:1px solid #d0d7de;padding:6px 10px;background:transparent;vertical-align:top;"';

      html += `<${tag}${attrs}>${renderHtmlCell(cell)}</${tag}>`;
    }

    html += "</tr>";
  }

  html += "</table>";

  return html;
}

function protectTables($, root, store) {
  root.find(".se-component.se-table").each((_, element) => {
    const component = $(element);
    const table = component.find("table").first();

    if (!table.length) return;

    const output = isSimpleTable($, table)
      ? renderSimpleTable($, table)
      : renderComplexTable($, table);

    component.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });

  root.find("table").each((_, element) => {
    const table = $(element);

    if (!table.closest(".post-view").length) return;
    if (table.closest(".naver-protected").length) return;

    const output = isSimpleTable($, table)
      ? renderSimpleTable($, table)
      : renderComplexTable($, table);

    table.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });
}

module.exports = {
  protectTables,
};
