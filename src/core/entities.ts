import { decodeHTMLStrict } from 'entities';

const ENTITY_PATTERN = /&(?:#([0-9]{1,7});|#[xX]([0-9A-Fa-f]{1,6});|[A-Za-z][A-Za-z0-9]{1,31};)/gu;

export function decodeEntities(value: string): string {
    if (!value.includes('&')) return value;

    return value.replace(ENTITY_PATTERN, (entity, decimal: string | undefined, hex: string | undefined) => {
        if (decimal !== undefined || hex !== undefined) {
            const codePoint = Number.parseInt(decimal ?? hex ?? '', decimal !== undefined ? 10 : 16);
            if (!Number.isFinite(codePoint) || codePoint > 0x10FFFF) return entity;
            if (codePoint === 0 || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return '\uFFFD';
            return String.fromCodePoint(codePoint);
        }

        const decoded = decodeHTMLStrict(entity);
        return decoded === entity ? entity : decoded;
    });
}
