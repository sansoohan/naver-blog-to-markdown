const SPRITE_URL = "https://editor-static.pstatic.net/v/basic/1.78.1/img/se-sp-viewer.ee5afa38.png";

const TYPES = ["default", "line1", "line2", "line3", "line4", "line5", "line6", "line7"];

function getLineType(component) {
  const section = component.find(".se-section-horizontalLine").first();
  const classes = String(section.attr("class") || component.attr("class") || "").split(/\s+/);

  for (const type of TYPES) {
    if (classes.includes(`se-l-${type}`)) return type;
  }

  return "default";
}

function getLineAlign(component) {
  const section = component.find(".se-section-horizontalLine").first();
  const classes = String(section.attr("class") || "").split(/\s+/);

  if (classes.includes("se-section-align-left")) return "left";
  if (classes.includes("se-section-align-center")) return "center";
  if (classes.includes("se-section-align-right")) return "right";

  return "left";
}

function renderHorizontalLine(type, align) {
  return `<div class="naver-hr naver-hr-${type} naver-hr-${align}" data-naver-line-type="${type}" data-naver-align="${align}"><div class="naver-hr-inner"><hr></div></div>`;
}

function protectHorizontalLines($, root, store) {
  const usedTypes = new Set();

  root.find(".se-component.se-horizontalLine").each((_, element) => {
    const component = $(element);
    const type = getLineType(component);
    const align = getLineAlign(component);

    usedTypes.add(type);

    const output = renderHorizontalLine(type, align);
    component.replaceWith(`<div class="naver-protected">${store.add(output)}</div>`);
  });

  return usedTypes;
}

function getHorizontalLineCss(usedTypes) {
  if (!usedTypes || !usedTypes.size) return "";

  const css = [];

  css.push(
    `.naver-hr{position:relative;margin-top:30px;}`,
    `.naver-hr *{box-sizing:content-box;}`,
    `.naver-hr-inner{margin-right:auto;margin-left:auto;}`,
    `.naver-hr hr{display:block;margin:0 auto;border:0;padding:0;}`,
    `.naver-hr-left .naver-hr-inner{margin-right:auto;margin-left:0;}`,
    `.naver-hr-center .naver-hr-inner{margin-right:auto;margin-left:auto;}`,
    `.naver-hr-right .naver-hr-inner{margin-right:0;margin-left:auto;}`
  );

  if (usedTypes.has("default")) {
    css.push(
      `.naver-hr-default .naver-hr-inner{width:220px;padding-top:30px;padding-bottom:29px;}`,
      `.naver-hr-default hr{height:1px;background-color:#ddd;}`
    );
  }

  if (usedTypes.has("line1")) {
    css.push(
      `.naver-hr-line1 .naver-hr-inner{width:100%;padding-top:30px;padding-bottom:29px;}`,
      `.naver-hr-line1 hr{width:100%;height:1px;background-color:#ddd;}`
    );
  }

  if (usedTypes.has("line2")) {
    css.push(
      `.naver-hr-line2 .naver-hr-inner{width:67px;padding-top:28px;padding-bottom:29px;}`,
      `.naver-hr-line2 hr{height:3px;background-color:#333;}`
    );
  }

  if (usedTypes.has("line3")) {
    css.push(
      `.naver-hr-line3 .naver-hr-inner{width:238px;padding-top:29px;padding-bottom:23px;}`,
      `.naver-hr-line3 hr{display:block;width:238px;height:9px;background-image:url("${SPRITE_URL}");background-repeat:no-repeat;background-size:466px 418px;background-position:-102px -350px;}`
    );
  }

  if (usedTypes.has("line4")) {
    css.push(
      `.naver-hr-line4 .naver-hr-inner{width:192px;padding-top:19px;padding-bottom:19px;}`,
      `.naver-hr-line4 hr{display:block;width:192px;height:23px;background-image:url("${SPRITE_URL}");background-repeat:no-repeat;background-size:466px 418px;background-position:-92px -306px;}`
    );
  }

  if (usedTypes.has("line5")) {
    css.push(
      `.naver-hr-line5 .naver-hr-inner{width:66px;padding-top:28px;padding-bottom:26px;}`,
      `.naver-hr-line5 hr{display:block;width:66px;height:6px;background-image:url("${SPRITE_URL}");background-repeat:no-repeat;background-size:466px 418px;background-position:-192px -168px;}`
    );
  }

  if (usedTypes.has("line6")) {
    css.push(
      `.naver-hr-line6 .naver-hr-inner{width:44px;padding-top:8px;padding-bottom:8px;}`,
      `.naver-hr-line6 hr{display:block;width:44px;height:44px;background-image:url("${SPRITE_URL}");background-repeat:no-repeat;background-size:466px 418px;background-position:-422px -46px;}`
    );
  }

  if (usedTypes.has("line7")) {
    css.push(
      `.naver-hr-line7 .naver-hr-inner{padding-top:0;padding-bottom:0;}`,
      `.naver-hr-line7 hr{display:inline-block;width:2px;height:60px;vertical-align:top;background-color:#aaa;}`,
      `.naver-hr-line7.naver-hr-left .naver-hr-inner{text-align:left;}`,
      `.naver-hr-line7.naver-hr-center .naver-hr-inner{text-align:center;}`,
      `.naver-hr-line7.naver-hr-right .naver-hr-inner{text-align:right;}`
    );
  }

  return `<style>\n${css.join("\n")}\n</style>`;
}

module.exports = {
  protectHorizontalLines,
  getHorizontalLineCss,
};
