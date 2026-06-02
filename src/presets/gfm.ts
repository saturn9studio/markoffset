import { createParser } from '../core/parser';
import { heading } from '../plugins/block/heading';
import { fence } from '../plugins/block/fence';
import { gfmHtmlBlock } from '../plugins/block/html-block';
import { indentedCode } from '../plugins/block/indented-code';
import { hr } from '../plugins/block/hr';
import { createBlockquoteRule } from '../plugins/block/blockquote';
import { createTaskListRule } from '../plugins/block/task-list';
import { createTableRule } from '../plugins/block/table';
import {
    emAsteriskDelimiter,
    emUnderscoreDelimiter,
    strongAsteriskDelimiter,
    strongUnderscoreDelimiter,
} from '../plugins/inline/strong-em';
import { strikethrough, strikethroughDouble } from '../plugins/inline/strikethrough';
import { codeInline } from '../plugins/inline/code-inline';
import { link } from '../plugins/inline/link';
import { image } from '../plugins/inline/image';
import { autolink } from '../plugins/inline/autolink';
import { gfmAutolink, gfmEmailAutolink } from '../plugins/inline/gfm-autolink';
import { gfmHtmlInline } from '../plugins/inline/html-inline';
import { hardbreak } from '../plugins/inline/hardbreak';
import { footnote } from '../plugins/inline/footnote';
import { createFootnotesExtension } from '../plugins/footnotes';
import { createLinkReferenceExtension } from '../plugins/references';

export const gfmParser = createParser({
    block: [
        gfmHtmlBlock,
        heading,
        fence,
        hr,
        createTableRule(),
        createBlockquoteRule(),
        createTaskListRule(),
        indentedCode,
    ],
    inline: [
        strongAsteriskDelimiter,
        emAsteriskDelimiter,
        strongUnderscoreDelimiter,
        emUnderscoreDelimiter,
        strikethroughDouble,
        strikethrough,
        codeInline,
        footnote,
        image,
        link,
        autolink,
        gfmHtmlInline,
        gfmAutolink,
        gfmEmailAutolink,
        hardbreak,
    ],
    extensions: [createLinkReferenceExtension(), createFootnotesExtension()],
});
