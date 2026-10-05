function fixHtmlIndentation(html) {
  const protectedCodeBlocks = [];
  const protectedHtml = String(html).replace(
    /<div\b[^>]*class=(["'])[^"']*\b__se_code_view\b[^"']*\1[^>]*>[\s\S]*?<\/div>/gi,
    match => {
      const token = `NAVERCODEBLOCKPLACEHOLDER${protectedCodeBlocks.length}END`;
      protectedCodeBlocks.push(match);
      return token;
    }
  );

  const lines = protectedHtml.split(/\r?\n/);
  const result = [];
  let depth = 0;

  for (const line of lines) {
    const content = line.trim();

    if (!content) {
      result.push("");
      continue;
    }

    const tags = content.match(/<\/?[a-zA-Z][^>]*>/g) || [];
    const leadingClosingTags = content.match(/^(?:<\/[a-zA-Z][^>]*>\s*)+/)?.[0] || "";
    const leadingClosingCount = (leadingClosingTags.match(/<\//g) || []).length;

    depth = Math.max(0, depth - leadingClosingCount);

    result.push(`${"  ".repeat(depth)}${content}`);

    let skippedLeadingClosings = 0;

    for (const tag of tags) {
      if (/^<\//.test(tag)) {
        if (skippedLeadingClosings < leadingClosingCount) {
          skippedLeadingClosings++;
        } else {
          depth = Math.max(0, depth - 1);
        }

        continue;
      }

      if (/\/\s*>$/.test(tag)) continue;
      if (/^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(tag)) continue;

      depth++;
    }
  }

  let resultHtml = `${result.join("\n")}\n`;

  resultHtml = resultHtml.replace(
    /NAVERCODEBLOCKPLACEHOLDER(\d+)END/g,
    (_, index) => protectedCodeBlocks[Number(index)]
  );

  return resultHtml;
}

module.exports = {fixHtmlIndentation};