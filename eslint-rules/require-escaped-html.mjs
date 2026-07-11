const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);

function propertyName(member) {
    if (!member.computed && member.property.type === 'Identifier') { return member.property.name; }
    if (member.computed && member.property.type === 'Literal') { return member.property.value; }
    return undefined;
}

function callableName(node) {
    if (node.type === 'Identifier') { return node.name; }
    if (node.type === 'MemberExpression') { return propertyName(node); }
    return undefined;
}

function isHtmlSinkTemplate(node) {
    const parent = node.parent;
    if (parent?.type === 'AssignmentExpression' && parent.right === node && parent.left.type === 'MemberExpression') {
        return HTML_SINKS.has(propertyName(parent.left));
    }
    if (parent?.type === 'CallExpression' && parent.arguments[1] === node && parent.callee.type === 'MemberExpression') {
        return propertyName(parent.callee) === 'insertAdjacentHTML';
    }
    return false;
}

function isSafeHtmlExpression(node) {
    if (node.type === 'Literal') { return true; }
    if (node.type === 'Identifier') { return /Html$/.test(node.name); }
    if (node.type === 'CallExpression') {
        const name = callableName(node.callee) ?? '';
        return name === 'esc' || /(?:Html|Class|Attr)$/.test(name);
    }
    if (node.type === 'TemplateLiteral') { return node.expressions.every(isSafeHtmlExpression); }
    if (node.type === 'ConditionalExpression') {
        return isSafeHtmlExpression(node.consequent) && isSafeHtmlExpression(node.alternate);
    }
    if (node.type === 'LogicalExpression') {
        return isSafeHtmlExpression(node.left) && isSafeHtmlExpression(node.right);
    }
    if (node.type === 'UnaryExpression') { return true; }
    if (node.type === 'BinaryExpression') {
        return isSafeHtmlExpression(node.left) && isSafeHtmlExpression(node.right);
    }
    return false;
}

export const requireEscapedHtml = {
    meta: {
        type: 'problem',
        docs: { description: 'require dynamic text in HTML templates to be escaped' },
        schema: [],
        messages: { unescaped: 'Wrap dynamic text in esc(), or use an explicitly named trusted HTML builder or fragment.' },
    },
    create(context) {
        return {
            AssignmentExpression(node) {
                if (node.left.type !== 'MemberExpression' || !HTML_SINKS.has(propertyName(node.left))) { return; }
                if (node.right.type !== 'TemplateLiteral' && !isSafeHtmlExpression(node.right)) {
                    context.report({ node: node.right, messageId: 'unescaped' });
                }
            },
            CallExpression(node) {
                if (node.callee.type !== 'MemberExpression' || propertyName(node.callee) !== 'insertAdjacentHTML') { return; }
                const html = node.arguments[1];
                if (html && html.type !== 'SpreadElement' && html.type !== 'TemplateLiteral' && !isSafeHtmlExpression(html)) {
                    context.report({ node: html, messageId: 'unescaped' });
                }
            },
            TemplateLiteral(node) {
                if (!isHtmlSinkTemplate(node)) { return; }
                for (const expression of node.expressions) {
                    if (!isSafeHtmlExpression(expression)) {
                        context.report({ node: expression, messageId: 'unescaped' });
                    }
                }
            },
        };
    },
};

export default { rules: { 'require-escaped-html': requireEscapedHtml } };
