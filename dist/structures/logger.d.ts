export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export declare const LOG_LEVELS: readonly LogLevel[];
export declare const LOG_PREFIX = "[ReForgeCanvas]";
export declare function envLogLevel(): LogLevel | undefined;
/** Sets the level for the whole process (the last ReForgeCanvas created sets it). */
export declare function setLogLevel(l: LogLevel): void;
export declare function getLogLevel(): LogLevel;
export declare const log: {
    error: (msg: string) => void;
    warn: (msg: string) => void;
    info: (msg: string) => void;
    debug: (msg: string) => void;
    trace: (msg: string) => void;
    /** Lines the caller asked for explicitly (registerFonts(..., true), components.load(..., true)): shown unless silent. */
    print: (msg: string) => void;
    enabled: (l: LogLevel) => boolean;
};
