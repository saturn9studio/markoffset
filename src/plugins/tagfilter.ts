const DISALLOWED_TAGS = new Set([
    'title',
    'textarea',
    'style',
    'xmp',
    'iframe',
    'noembed',
    'noframes',
    'script',
    'plaintext',
]);

export function filterDisallowedHtmlTags(html: string): string {
    return html.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\t\n\f\r />])/gu, (match, tag: string) =>
        DISALLOWED_TAGS.has(tag.toLowerCase()) ? `&lt;${match.slice(1)}` : match
    );
}
