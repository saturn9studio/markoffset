import { DelimiterMatch, DelimiterRule } from '../../core/types.js';

const isGfmStrikethroughRun = (match: DelimiterMatch): boolean =>
    match.openerRunLength === match.closerRunLength && match.openerRunLength <= 2;

export const strikethrough: DelimiterRule = {
    name: 'strikethrough-single',
    delimiter: '~',
    kind: 'strikethrough',
    bindingPower: 5,
    canMatch: isGfmStrikethroughRun,
};

export const strikethroughDouble: DelimiterRule = {
    name: 'strikethrough-double',
    delimiter: '~~',
    kind: 'strikethrough',
    bindingPower: 6,
    canMatch: isGfmStrikethroughRun,
};
