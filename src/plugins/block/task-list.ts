import { BlockContext, BlockRule, Token } from '../../core/types';
import { createListRule } from './list';

export function createTaskListRule(): BlockRule {
    const listRule = createListRule();
    return {
        ...listRule,
        name: 'gfm-task-list',
        priority: listRule.priority + 1,
        parse(scanner, context: BlockContext): Token {
            const token = listRule.parse(scanner, context);
            markTaskItems(token, context);
            return token;
        },
    };
}

function markTaskItems(token: Token, context: BlockContext): void {
    if ((token.kind === 'bullet_list' || token.kind === 'ordered_list') && token.children) {
        token.children.forEach(item => markTaskItem(item, context));
        return;
    }
    token.children?.forEach(child => markTaskItems(child, context));
}

function markTaskItem(item: Token, context: BlockContext): void {
    const paragraph = findParagraphChild(item.children);
    const contentValue = paragraph?.content;
    const match = contentValue === undefined ? null : matchTaskMarker(contentValue);
    if (!paragraph || contentValue === undefined || !match) {
        item.children?.forEach(child => markTaskItems(child, context));
        return;
    }

    function findParagraphChild(children: Token[] | undefined): Token | undefined {
        if (children === undefined) return undefined;
        for (let index = 0; index < children.length; index++) {
            if (children[index].kind === 'paragraph') return children[index];
        }
        return undefined;
    }

    const content = contentValue.slice(match.markerLength);
    item.attrs = { ...item.attrs, checked: match.checked };
    paragraph.start += match.markerLength;
    paragraph.content = content;
    paragraph.children = context.parseInline(content);
    item.children?.forEach(child => {
        if (child !== paragraph) markTaskItems(child, context);
    });
}

function matchTaskMarker(content: string): { markerLength: number; checked: boolean } | null {
    if (content.length < 4) return null;
    if (content.charCodeAt(0) !== 91 || content.charCodeAt(2) !== 93) return null;
    const state = content.charCodeAt(1);
    if (state !== 32 && state !== 88 && state !== 120) return null;
    const after = content.charCodeAt(3);
    if (after !== 32 && after !== 9) return null;
    return { markerLength: 4, checked: state === 88 || state === 120 };
}
