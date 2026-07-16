/*
 * Tiny leveled logger with timestamps. No dependencies.
 */

type Level = 'info' | 'warn' | 'error';

function stamp(): string {
    return new Date().toISOString().slice(11, 19);
}

function write(level: Level, tag: string, msg: string): void {
    const line = `[${stamp()}] [${tag}] ${msg}`;
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export const log = {
    info: (tag: string, msg: string) => write('info', tag, msg),
    warn: (tag: string, msg: string) => write('warn', tag, msg),
    error: (tag: string, msg: string) => write('error', tag, msg)
};
