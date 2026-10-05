import type {
    MappedSource,
    MappedSourcePart,
    SourceSegment,
    Token,
} from './types.js';

export type { MappedSource, MappedSourcePart, SourceSegment } from './types.js';

export function mappedSource(
    parts: readonly MappedSourcePart[],
    emptySourceOffset = 0,
): MappedSource {
    let text = '';
    const segments: SourceSegment[] = [];
    for (const part of parts) {
        const localFrom = text.length;
        text += part.text;
        if (part.text.length === 0) continue;
        segments.push({
            localFrom,
            localTo: text.length,
            sourceFrom: part.sourceFrom,
            sourceTo: part.sourceTo,
        });
    }
    return { text, segments, emptySourceOffset };
}

export function contiguousSource(text: string, sourceFrom: number): MappedSource {
    return {
        text,
        segments: text.length === 0
            ? []
            : [{
                localFrom: 0,
                localTo: text.length,
                sourceFrom,
                sourceTo: sourceFrom + text.length,
            }],
        emptySourceOffset: sourceFrom,
    };
}

export function transformedSource(
    text: string,
    original: string,
    sourceFrom: number,
): MappedSource {
    if (text === original) return contiguousSource(text, sourceFrom);

    let suffixLength = 0;
    while (
        suffixLength < text.length &&
        suffixLength < original.length &&
        text.charCodeAt(text.length - suffixLength - 1) ===
            original.charCodeAt(original.length - suffixLength - 1)
    ) {
        suffixLength++;
    }

    const transformedPrefix = text.slice(0, text.length - suffixLength);
    const originalPrefixLength = original.length - suffixLength;
    const parts: MappedSourcePart[] = [];
    if (transformedPrefix.length > 0) {
        parts.push({
            text: transformedPrefix,
            sourceFrom,
            sourceTo: sourceFrom + originalPrefixLength,
        });
    }
    if (suffixLength > 0) {
        parts.push({
            text: text.slice(text.length - suffixLength),
            sourceFrom: sourceFrom + originalPrefixLength,
            sourceTo: sourceFrom + original.length,
        });
    }
    return mappedSource(parts, sourceFrom);
}

export function concatenateSources(
    sources: readonly MappedSource[],
    emptySourceOffset = 0,
): MappedSource {
    let text = '';
    const segments: SourceSegment[] = [];
    for (const source of sources) {
        const localOffset = text.length;
        text += source.text;
        for (const segment of source.segments) {
            segments.push({
                localFrom: localOffset + segment.localFrom,
                localTo: localOffset + segment.localTo,
                sourceFrom: segment.sourceFrom,
                sourceTo: segment.sourceTo,
            });
        }
    }
    return { text, segments, emptySourceOffset };
}

export function mapTokensToSource(
    tokens: readonly Token[],
    source: MappedSource,
): Token[] {
    return tokens.map(token => mapTokenToSource(token, source));
}

export function mapTokensToSourceInPlace(
    tokens: Token[],
    source: MappedSource,
    sourceOffset = 0,
): Token[] {
    for (const token of tokens) {
        token.start = mapStart(source, token.start) - sourceOffset;
        token.end = mapEnd(source, token.end) - sourceOffset;
        if (token.children) {
            mapTokensToSourceInPlace(token.children, source, sourceOffset);
        }
    }
    return tokens;
}

function mapTokenToSource(token: Token, source: MappedSource): Token {
    return {
        ...token,
        start: mapStart(source, token.start),
        end: mapEnd(source, token.end),
        children: token.children
            ? mapTokensToSource(token.children, source)
            : undefined,
    };
}

function mapStart(source: MappedSource, offset: number): number {
    if (source.segments.length === 0) return source.emptySourceOffset;
    if (source.segments.length === 1) {
        return interpolate(source.segments[0], offset, false);
    }
    for (const segment of source.segments) {
        if (offset < segment.localFrom) return segment.sourceFrom;
        if (offset < segment.localTo) return interpolate(segment, offset, false);
    }
    return source.segments[source.segments.length - 1].sourceTo;
}

function mapEnd(source: MappedSource, offset: number): number {
    if (source.segments.length === 0) return source.emptySourceOffset;
    if (source.segments.length === 1) {
        return interpolate(source.segments[0], offset, true);
    }
    for (let index = source.segments.length - 1; index >= 0; index--) {
        const segment = source.segments[index];
        if (offset > segment.localTo) return segment.sourceTo;
        if (offset > segment.localFrom) return interpolate(segment, offset, true);
    }
    return source.segments[0].sourceFrom;
}

function interpolate(
    segment: SourceSegment,
    offset: number,
    roundUp: boolean,
): number {
    const localLength = segment.localTo - segment.localFrom;
    const sourceLength = segment.sourceTo - segment.sourceFrom;
    if (localLength === sourceLength) {
        return segment.sourceFrom + offset - segment.localFrom;
    }
    if (localLength === 0) return segment.sourceFrom;
    const scaled = (offset - segment.localFrom) * sourceLength / localLength;
    return segment.sourceFrom + (roundUp ? Math.ceil(scaled) : Math.floor(scaled));
}
