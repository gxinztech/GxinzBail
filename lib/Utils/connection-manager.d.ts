import type { Boom } from '@hapi/boom';
export type DisconnectInfo = {
    code: number | undefined;
    reason: 'loggedOut' | 'forbidden' | 'connectionReplaced' | 'multideviceMismatch' | 'restartRequired' | 'badSession' | 'transient' | 'startFailed';
    /** safe to open a new socket with the same session */
    reconnect: boolean;
    /** the stored session is no longer valid, pair again */
    clearSession: boolean;
    /** reconnect right away (WhatsApp asked for it) */
    immediate: boolean;
    error?: Error | Boom;
};
export declare const getDisconnectCode: (error: any) => number | undefined;
export declare const classifyDisconnect: (error: any) => Omit<DisconnectInfo, 'error'>;
export type AutoReconnectOptions = {
    /** failed attempts in a row before giving up (default 10) */
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    /** a connection that stayed open this long resets the attempt counter (default 30000) */
    stableAfterMs?: number;
    logger?: {
        warn?: (...a: any[]) => void;
        error?: (...a: any[]) => void;
    };
    onSocket?: (sock: any) => void;
    onRetry?: (info: DisconnectInfo & {
        attempt: number;
        delayMs: number;
    }) => void;
    onClose?: (info: DisconnectInfo) => void;
    /** session was logged out. Return true to start again and pair a new session (clear the old one first) */
    onLoggedOut?: (info: DisconnectInfo) => boolean | void | Promise<boolean | void>;
    /** reconnecting stopped for good (banned, replaced, too many failures) */
    onGiveUp?: (info: DisconnectInfo) => void;
};
export declare const makeAutoReconnect: <S extends {
    ev: any;
    end: (e: Error | undefined) => Promise<void>;
}>(createSocket: () => S | Promise<S>, opts?: AutoReconnectOptions) => {
    readonly socket: S | undefined;
    stop(): Promise<void>;
};
