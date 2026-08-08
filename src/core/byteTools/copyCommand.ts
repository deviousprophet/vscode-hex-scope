const COPY_COMMANDS = ['hex', 'hex-raw', 'binary', 'ascii', 'dec-array', 'hex-array', 'base64', 'dec', 'c-array'] as const;

export type CopyCommand = typeof COPY_COMMANDS[number];

const COPY_COMMAND_SET = new Set<string>(COPY_COMMANDS);

export function isCopyCommand(cmd: string): cmd is CopyCommand {
    return COPY_COMMAND_SET.has(cmd);
}
