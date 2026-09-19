function cleanCodeText(value) {
  const text = String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ");

  const lines = text.split("\n");

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  if (!lines.length) return "";

  const firstIndent = lines[0].match(/^[ \t]+/)?.[0] || "";

  if (firstIndent.length >= 8) {
    lines[0] = lines[0].slice(firstIndent.length);
  }

  return lines.join("\n");
}

function getCodeText($, component) {
  const source = component.find(".se-code-source").first();

  if (source.length) {
    return cleanCodeText(source.text());
  }

  const code = component.find("code").first();

  if (code.length) {
    return cleanCodeText(code.text());
  }

  const lines = component.find(".se-text-paragraph").toArray();

  if (lines.length) {
    return cleanCodeText(lines.map(element => $(element).text()).join("\n"));
  }

  return cleanCodeText(component.text());
}

function getCodeClass(component) {
  const section = component.find(".se-section").first();

  const classes = [
    ...(component.attr("class") || "").split(/\s+/),
    ...(section.attr("class") || "").split(/\s+/),
  ];

  return classes.find(className =>
    className.startsWith("se-l-") &&
    className !== "se-l-default"
  ) || "se-l-default";
}

function getFence(code) {
  const matches = code.match(/`+/g) || [];
  const longest = matches.reduce((max, value) => Math.max(max, value.length), 0);

  return "`".repeat(Math.max(3, longest + 1));
}

function protectCodeBlocks($, root, store) {
  const components = root.find(".se-component.se-code").toArray();

  for (const element of components) {
    const component = $(element);
    const code = getCodeText($, component);

    if (!code) continue;

    const className = getCodeClass(component);
    const fence = getFence(code);

    const content = `${fence}{${className}}\n${code}\n${fence}`;

    component.replaceWith(`<div class="naver-protected">${store.add(content)}</div>`);
  }
}

module.exports = {
  protectCodeBlocks,
};
