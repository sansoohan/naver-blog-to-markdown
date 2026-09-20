function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function getClassList(element) {
  return String(element.attr("class") || "")
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function getCodeLayout(component) {
  const candidates = [
    component,
    component.find(".se-section-code").first(),
    component.find(".se-module-code").first(),
  ];

  for (const candidate of candidates) {
    if (!candidate?.length) continue;

    const className = getClassList(candidate).find(name => /^se-l-/i.test(name));

    if (className) return className;
  }

  return "se-l-default";
}

function getCodeContainer(component) {
  const selectors = [
    ".__se_code_view",
    ".se-code-source",
    "pre",
    "code",
    ".se-module-code",
    ".se-code",
  ];

  for (const selector of selectors) {
    if (component.is(selector)) return component;

    const found = component.find(selector).first();

    if (found.length) return found;
  }

  return component;
}

function getStructuredCodeText($, container) {
  const selectors = [
    ".se-code-line",
    ".se-code-source-line",
  ];

  for (const selector of selectors) {
    const lines = container.find(selector).toArray();

    if (!lines.length) continue;

    return lines
      .map(element => normalizeNewlines($(element).text()).replace(/\n/g, ""))
      .join("\n");
  }

  return null;
}

function getCodeTextFromHtml($, container) {
  const clone = container.clone();
  const breakToken = "NAVERCODELINEBREAKTOKEN";

  clone.find("br").replaceWith(breakToken);

  let text = normalizeNewlines(clone.text());
  text = text.split(breakToken).join("\n");

  return text;
}

function cleanCodeText(text) {
  let lines = normalizeNewlines(text).split("\n");

  /*
   * 코드 컨테이너 자체의 앞뒤에 생긴 빈 줄만 제거한다.
   *
   * 각 코드 줄의 leading whitespace는 절대 건드리지 않는다.
   * 실제 코드 indentation일 수 있기 때문이다.
   */
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  return lines
    .map(line => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

function getCodeText($, component) {
  const container = getCodeContainer(component);

  /*
   * 네이버 SmartEditor의 실제 코드 본문.
   *
   * 바깥 .se-module-code의 text()를 읽으면 HTML formatting whitespace가
   * 섞일 수 있으므로 __se_code_view를 최우선으로 사용한다.
   */
  if (container.hasClass("__se_code_view")) {
    return cleanCodeText(getCodeTextFromHtml($, container));
  }

  /*
   * line 단위 DOM이 존재하는 변형.
   */
  const structured = getStructuredCodeText($, container);

  if (structured !== null) {
    return cleanCodeText(structured);
  }

  /*
   * <pre>/<code>는 내부 whitespace 자체가 코드 데이터이므로
   * 각 줄의 앞쪽 공백을 제거하지 않는다.
   */
  if (container.is("pre, code")) {
    return cleanCodeText(container.text());
  }

  /*
   * 그 외 <br> 기반 구조.
   */
  return cleanCodeText(getCodeTextFromHtml($, container));
}

function getFence(code) {
  const matches = String(code).match(/`+/g) || [];
  const longest = matches.reduce((max, value) => Math.max(max, value.length), 0);

  return "`".repeat(Math.max(3, longest + 1));
}

function makeCodeMarkdown(layout, code) {
  const fence = getFence(code);

  return `${fence}{${layout}}\n${code}\n${fence}`;
}

function protectCodeBlocks($, root, store) {
  const components = root.find(".se-component.se-code").toArray();

  for (const element of components) {
    const component = $(element);
    const layout = getCodeLayout(component);
    const code = getCodeText($, component);
    const markdown = makeCodeMarkdown(layout, code);

    component.replaceWith(
      `<div class="naver-protected">${store.add(markdown)}</div>`
    );
  }

  /*
   * component wrapper가 없는 구형/변형 코드 블록.
   */
  const leftovers = root.find(".se-section-code").toArray();

  for (const element of leftovers) {
    const section = $(element);

    if (section.closest(".naver-protected").length) continue;

    const layout = getCodeLayout(section);
    const code = getCodeText($, section);
    const markdown = makeCodeMarkdown(layout, code);

    section.replaceWith(
      `<div class="naver-protected">${store.add(markdown)}</div>`
    );
  }
}

module.exports = {
  protectCodeBlocks,
};
