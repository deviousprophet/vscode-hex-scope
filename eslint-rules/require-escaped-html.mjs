const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);
const TRUSTED_HTML_NAME = /(?:Html|Class|Attr)$/;
const PROPERTY_VALUE = {
    Identifier: property => property.name,
    Literal: property => property.value,
};

function propertyName(member) {
    const property = member.property;
    const expectedType = member.computed ? 'Literal' : 'Identifier';
    return property.type === expectedType ? PROPERTY_VALUE[expectedType](property) : undefined;
}

function callableName(node) {
    if (node.type === 'Identifier') { return node.name; }
    return node.type === 'MemberExpression' ? propertyName(node) : undefined;
}

const SAFE_EXPRESSION = {
    Literal: () => true,
    Identifier: node => /Html$/.test(node.name),
    CallExpression: node => {
        const name = callableName(node.callee) ?? '';
        return name === 'esc' || TRUSTED_HTML_NAME.test(name);
    },
    TemplateLiteral: node => node.expressions.every(isSafeHtmlExpression),
    ConditionalExpression: node => [node.consequent, node.alternate].every(isSafeHtmlExpression),
    LogicalExpression: node => [node.left, node.right].every(isSafeHtmlExpression),
    UnaryExpression: () => true,
    BinaryExpression: node => [node.left, node.right].every(isSafeHtmlExpression),
};

function isSafeHtmlExpression(node) {
    return SAFE_EXPRESSION[node.type]?.(node) ?? false;
}

function isHtmlAssignment(node) {
    return node.left.type === 'MemberExpression' && HTML_SINKS.has(propertyName(node.left));
}

function isInsertAdjacentHtmlCall(node) {
    return node.callee.type === 'MemberExpression' && propertyName(node.callee) === 'insertAdjacentHTML';
}

const SINK_TEMPLATE_PARENT = {
    AssignmentExpression: (parent, node) => parent.right === node && isHtmlAssignment(parent),
    CallExpression: (parent, node) => parent.arguments[1] === node && isInsertAdjacentHtmlCall(parent),
};

function isSinkTemplate(node) {
    const parent = node.parent;
    return SINK_TEMPLATE_PARENT[parent?.type]?.(parent, node) ?? false;
}

function reportUnsafeValue(context, node) {
    if (node.type === 'TemplateLiteral' || isSafeHtmlExpression(node)) { return; }
    context.report({ node, messageId: 'unescaped' });
}

function checkAssignment(context, node) {
    if (isHtmlAssignment(node)) { reportUnsafeValue(context, node.right); }
}

function checkInsertAdjacentHtml(context, node) {
    if (!isInsertAdjacentHtmlCall(node)) { return; }
    const html = node.arguments[1];
    if (html && html.type !== 'SpreadElement') { reportUnsafeValue(context, html); }
}

function checkTemplate(context, node) {
    if (!isSinkTemplate(node)) { return; }
    node.expressions
        .filter(expression => !isSafeHtmlExpression(expression))
        .forEach(expression => context.report({ node: expression, messageId: 'unescaped' }));
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
            AssignmentExpression: node => checkAssignment(context, node),
            CallExpression: node => checkInsertAdjacentHtml(context, node),
            TemplateLiteral: node => checkTemplate(context, node),
        };
    },
};

export default { rules: { 'require-escaped-html': requireEscapedHtml } };
