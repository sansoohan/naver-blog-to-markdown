import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import anchor from "markdown-it-anchor";

const markdown = new MarkdownIt({html: true});

markdown
  .use(taskLists)
  .use(anchor);

export default markdown;
