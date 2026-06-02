import { DelimiterMatch, DelimiterRule } from '../../core/types';

const commonmarkCanMatch = (match: DelimiterMatch): boolean => {
    if (!match.openerCanOpenAndClose && !match.closerCanOpenAndClose) return true;
    if ((match.openerRunLength + match.closerRunLength) % 3 !== 0) return true;
    return match.openerRunLength % 3 === 0 && match.closerRunLength % 3 === 0;
};

export const strongAsteriskDelimiter: DelimiterRule = {
    name: 'strong-asterisk',
    delimiter: '**',
    kind: 'strong',
    bindingPower: 7,
    canMatch: commonmarkCanMatch,
};

export const emAsteriskDelimiter: DelimiterRule = {
    name: 'em-asterisk',
    delimiter: '*',
    kind: 'em',
    bindingPower: 6,
    canMatch: commonmarkCanMatch,
};

export const strongUnderscoreDelimiter: DelimiterRule = {
    name: 'strong-underscore',
    delimiter: '__',
    kind: 'strong',
    bindingPower: 7,
    canMatch: commonmarkCanMatch,
};

export const emUnderscoreDelimiter: DelimiterRule = {
    name: 'em-underscore',
    delimiter: '_',
    kind: 'em',
    bindingPower: 6,
    canMatch: commonmarkCanMatch,
};
