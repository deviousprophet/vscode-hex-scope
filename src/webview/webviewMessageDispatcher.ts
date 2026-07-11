import { messageType, type ProviderToWebviewMessage } from '../webviewProtocol';

type ProviderMessageType = ProviderToWebviewMessage['type'];
type ProviderMessageByType<T extends ProviderMessageType> = Extract<ProviderToWebviewMessage, { type: T }>;

export type ProviderMessageHandlers = {
    [T in ProviderMessageType]: (msg: ProviderMessageByType<T>) => void;
};

const PROVIDER_MESSAGE_TYPES: readonly ProviderMessageType[] = [
    'init',
    'loadProgress',
    'recordPage',
    'loadError',
    'addLabel',
    'updateLabel',
    'copyCommand',
    'savedEdits',
    'externalChange',
    'externalChangeError',
    'repairComplete',
    'integrityProfiles',
];

const PROVIDER_MESSAGE_TYPE_SET = new Set<string>(PROVIDER_MESSAGE_TYPES);

function isProviderMessageType(type: string | undefined): type is ProviderMessageType {
    return typeof type === 'string' && PROVIDER_MESSAGE_TYPE_SET.has(type);
}

export function dispatchProviderMessage(message: unknown, handlers: ProviderMessageHandlers): boolean {
    const type = messageType(message);
    if (!isProviderMessageType(type)) { return false; }

    const handler = handlers[type] as (msg: ProviderToWebviewMessage) => void;
    handler(message as ProviderToWebviewMessage);
    return true;
}
