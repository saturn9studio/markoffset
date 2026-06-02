import { Token } from '../../src/core/types';

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function encodeUrl(url: string): string {
    try {
        return encodeURI(url).replace(/%25([0-9A-Fa-f]{2})/g, '%$1').replace(/[&<>"]/g, (ch) => {
            if (ch === '&') return '&amp;';
            if (ch === '<') return '&lt;';
            if (ch === '>') return '&gt;';
            if (ch === '"') return '&quot;';
            return ch;
        });
    } catch {
        return escapeHtml(url);
    }
}

function renderPlainText(tokens: Token[]): string {
    return tokens.map(token => {
        switch (token.kind) {
            case 'image':
                return token.content ?? '';
            case 'softbreak':
            case 'hardbreak':
                return '\n';
            case 'html_inline':
                return '';
            default:
                return token.children ? renderPlainText(token.children) : token.content ?? '';
        }
    }).join('');
}

function renderTokens(tokens: Token[], tight = false): string {
    let html = '';
    for (const token of tokens) {
        html += renderToken(token, tight);
    }
    return html;
}

function renderToken(token: Token, tight = false): string {
    switch (token.kind) {
        case 'heading': {
            const level = token.level ?? 1;
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            return `<h${level}>${inner}</h${level}>\n`;
        }

        case 'paragraph': {
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            if (tight) return inner + '\n';
            return `<p>${inner}</p>\n`;
        }

        case 'fence': {
            const info = (token.info ?? '').trim();
            const lang = info ? info.split(/\s+/)[0] : '';
            const codeClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
            const content = escapeHtml(token.content ?? '');
            return `<pre><code${codeClass}>${content}</code></pre>\n`;
        }

        case 'code_block': {
            const content = escapeHtml(token.content ?? '');
            return `<pre><code>${content}</code></pre>\n`;
        }

        case 'html_block': {
            return token.content ?? '';
        }

        case 'blockquote': {
            const inner = token.children ? renderTokens(token.children) : '';
            return `<blockquote>\n${inner}</blockquote>\n`;
        }

        case 'bullet_list': {
            const isTight = token.tight ?? false;
            const inner = token.children ? token.children.map(item => renderToken(item, isTight)).join('') : '';
            return `<ul>\n${inner}</ul>\n`;
        }

        case 'ordered_list': {
            const isTight = token.tight ?? false;
            const start = token.startNum ?? 1;
            const startAttr = start !== 1 ? ` start="${start}"` : '';
            const inner = token.children ? token.children.map(item => renderToken(item, isTight)).join('') : '';
            return `<ol${startAttr}>\n${inner}</ol>\n`;
        }

        case 'list_item': {
            if (!token.children || token.children.length === 0) {
                return '<li></li>\n';
            }
            // Tight list: render paragraph content without <p> tags
            const checked = token.attrs?.checked;
            const checkbox = typeof checked !== 'boolean'
                ? ''
                : `<input type="checkbox"${checked ? ' checked=""' : ''} disabled="" /> `;
            const inner = checkbox + renderTokens(token.children, tight);
            if (tight) {
                const prefix = token.children[0]?.kind === 'paragraph' ? '' : '\n';
                const content = token.children[token.children.length - 1]?.kind === 'paragraph'
                    ? inner.replace(/\n$/, '')
                    : inner;
                return `<li>${prefix}${content}</li>\n`;
            }
            return `<li>\n${inner}</li>\n`;
        }

        case 'hr': {
            return '<hr />\n';
        }

        case 'strong': {
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            return `<strong>${inner}</strong>`;
        }

        case 'em': {
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            return `<em>${inner}</em>`;
        }

        case 'strikethrough': {
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            return `<del>${inner}</del>`;
        }

        case 'code_inline': {
            return `<code>${escapeHtml(token.content ?? '')}</code>`;
        }

        case 'link': {
            const url = encodeUrl(token.url ?? '');
            const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
            const inner = token.children
                ? renderTokens(token.children)
                : escapeHtml(token.content ?? '');
            return `<a href="${url}"${titleAttr}>${inner}</a>`;
        }

        case 'image': {
            const url = encodeUrl(token.url ?? '');
            const alt = escapeHtml(token.children ? renderPlainText(token.children) : token.content ?? '');
            const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
            return `<img src="${url}" alt="${alt}"${titleAttr} />`;
        }

        case 'autolink': {
            const url = encodeUrl(token.url ?? '');
            const content = escapeHtml(token.content ?? '');
            return `<a href="${url}">${content}</a>`;
        }

        case 'footnote_ref': {
            const id = escapeHtml(String(token.attrs?.id ?? ''));
            const refId = escapeHtml(String(token.attrs?.refId ?? `fnref-${id}`));
            const number = escapeHtml(String(token.attrs?.number ?? ''));
            return `<sup class="footnote-ref"><a href="#fn-${id}" id="${refId}" data-footnote-ref>${number}</a></sup>`;
        }

        case 'footnotes': {
            return `<section class="footnotes" data-footnotes>\n<ol>\n${token.children ? renderTokens(token.children) : ''}</ol>\n</section>\n`;
        }

        case 'footnote_item': {
            const id = escapeHtml(String(token.attrs?.id ?? ''));
            const number = Number(token.attrs?.number ?? 0);
            const refCount = Number(token.attrs?.refCount ?? 0);
            const backrefs = Array.from({ length: refCount }, (_, index) => renderFootnoteBackref(id, number, index + 1)).join(' ');
            const inner = token.children ? renderTokens(token.children) : '';
            const withBackrefs = inner.match(/<\/p>\n$/u)
                ? inner.replace(/<\/p>\n$/u, ` ${backrefs}</p>\n`)
                : `${inner}${backrefs}\n`;
            return `<li id="fn-${id}">\n${withBackrefs}</li>\n`;
        }

        case 'html_inline': {
            return token.content ?? '';
        }

        function renderFootnoteBackref(id: string, number: number, refIndex: number): string {
            const refId = refIndex === 1 ? `fnref-${id}` : `fnref-${id}-${refIndex}`;
            const idx = refIndex === 1 ? `${number}` : `${number}-${refIndex}`;
            const suffix = refIndex === 1 ? '' : `<sup class="footnote-ref">${refIndex}</sup>`;
            return `<a href="#${escapeHtml(refId)}" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="${escapeHtml(idx)}" aria-label="Back to reference ${escapeHtml(idx)}">↩${suffix}</a>`;
        }

        case 'table': {
            return `<table>\n${token.children ? renderTokens(token.children) : ''}</table>\n`;
        }

        case 'table_head': {
            return `<thead>\n${token.children ? renderTokens(token.children) : ''}</thead>\n`;
        }

        case 'table_body': {
            return `<tbody>\n${token.children ? renderTokens(token.children) : ''}</tbody>\n`;
        }

        case 'table_header':
        case 'table_row': {
            return `<tr>\n${token.children ? renderTokens(token.children) : ''}</tr>\n`;
        }

        case 'table_header_cell':
        case 'table_cell': {
            const tag = token.kind === 'table_header_cell' ? 'th' : 'td';
            const align = typeof token.attrs?.align === 'string' ? ` align="${token.attrs.align}"` : '';
            const inner = token.children ? renderTokens(token.children) : escapeHtml(token.content ?? '');
            return `<${tag}${align}>${inner}</${tag}>\n`;
        }

        case 'hardbreak': {
            return '<br />\n';
        }


        case 'softbreak': {
            return '\n';
        }

        case 'text': {
            return escapeHtml(token.content ?? '');
        }

        default: {
            // Unknown token: render children if available, or empty
            if (token.children) {
                return renderTokens(token.children);
            }
            return escapeHtml(token.content ?? '');
        }
    }
}

export function renderToHtml(tokens: Token[]): string {
    return renderTokens(tokens);
}
