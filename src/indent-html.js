function fixHtmlIndentation(html) {
  const lines = String(html).split(/\r?\n/);
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

  return `${result.join("\n")}\n`;
}

module.exports = {fixHtmlIndentation};