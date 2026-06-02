import { createParser } from '../core/parser';
import { heading } from '../plugins/block/heading';
import { fence } from '../plugins/block/fence';
import { htmlBlock } from '../plugins/block/html-block';
import { indentedCode } from '../plugins/block/indented-code';
import { hr } from '../plugins/block/hr';
import { createBlockquoteRule } from '../plugins/block/blockquote';
import { createListRule } from '../plugins/block/list';
import {
    emAsteriskDelimiter,
    emUnderscoreDelimiter,
    strongAsteriskDelimiter,
    strongUnderscoreDelimiter,
} from '../plugins/inline/strong-em';
import { codeInline } from '../plugins/inline/code-inline';
import { link } from '../plugins/inline/link';
import { image } from '../plugins/inline/image';
import { autolink } from '../plugins/inline/autolink';
import { htmlInline } from '../plugins/inline/html-inline';
import { hardbreak } from '../plugins/inline/hardbreak';
import { createLinkReferenceExtension } from '../plugins/references';

export const commonmarkParser = createParser({
    block: [htmlBlock, heading, fence, hr, createBlockquoteRule(), createListRule(), indentedCode],
    inline: [
        strongAsteriskDelimiter,
        emAsteriskDelimiter,
        strongUnderscoreDelimiter,
        emUnderscoreDelimiter,
        codeInline,
        image,   // image before link (both triggered by '[' but image needs '!' before)
        link,
        autolink,
        htmlInline,
        hardbreak,
    ],
    extensions: [createLinkReferenceExtension()],
});
