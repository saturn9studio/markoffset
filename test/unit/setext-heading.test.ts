import { describe, expect, it } from 'vitest';
import { setextHeadingLevel } from '../../src/index.js';

describe('setext heading syntax', () => {
    it.each([
        ['===', 1],
        ['  ===  ', 1],
        ['---', 2],
        ['   ---\t', 2],
        ['    ---', undefined],
        ['--', 2],
        ['--- text', undefined],
        ['', undefined],
    ])('classifies %j', (line, expected) => {
        expect(setextHeadingLevel(line)).toBe(expected);
    });
});
