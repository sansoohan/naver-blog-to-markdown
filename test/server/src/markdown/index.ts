import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import deflist from "markdown-it-deflist";
import abbr from "markdown-it-abbr";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import anchor from "markdown-it-anchor";

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
});

markdown
  .use(taskLists)
  .use(footnote)
  .use(deflist)
  .use(abbr)
  .use(sub)
  .use(sup)
  .use(mark)
  .use(ins)
  .use(anchor);

export default markdown;
