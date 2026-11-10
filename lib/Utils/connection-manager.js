import { DisconnectReason } from '../Types/index.js';
/** reads the numeric close code out of whatever error the socket produced */
export const getDisconnectCode = (error) => {
    const code = error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode;
    const n = Number(code);
    return Number.isFinite(n) ? n : undefined;
};
/**
 * Decides what to do after a connection closed.
 * - reconnect:    safe to open a new socket with the same session
 * - clearSession: the stored session is no longer valid, pair again
 * - immediate:    reconnect right away (WhatsApp asked for it)
 */
export const classifyDisconnect = (error) => {
    const code = getDisconnectCode(error);
    switch (code) {
        case DisconnectReason.loggedOut:
            return { code, reason: 'loggedOut', reconnect: false, clearSession: true, immediate: false };
        case DisconnectReason.forbidden:
            // restricted / banned: hammering the server only makes it worse
            return { code, reason: 'forbidden', reconnect: false, clearSession: false, immediate: false };
        case DisconnectReason.connectionReplaced:
            // the same session is open somewhere else. Reconnecting here starts a tug-of-war
            return { code, reason: 'connectionReplaced', reconnect: false, clearSession: false, immediate: false };
        case DisconnectReason.multideviceMismatch:
            return { code, reason: 'multideviceMismatch', reconnect: false, clearSession: false, immediate: false };
        case DisconnectReason.restartRequired:
            return { code, reason: 'restartRequired', reconnect: true, clearSession: false, immediate: true };
        case DisconnectReason.badSession:
            return { code, reason: 'badSession', reconnect: true, clearSession: false, immediate: false };
        default:
            return { code, reason: 'transient', reconnect: true, clearSession: false, immediate: false };
    }
};
/**
 * Keeps a socket alive: reconnects with exponential backoff, never loops on a dead session.
 *
 * `createSocket` must build the socket AND attach your own listeners (creds.update, messages.upsert, ...),
 * because a fresh socket is created on every reconnect.
 *
 * @example
 * const bot = makeAutoReconnect(async () => {
 *   const { state, saveCreds } = await useMultiFileAuthState('auth')
 *   const sock = makeWASocket({ auth: state })
 *   sock.ev.on('creds.update', saveCreds)
 *   sock.ev.on('messages.upsert', handler)
 *   return sock
 * }, {
 *   onLoggedOut: async () => { await rm('auth', { recursive: true, force: true }); return true } // true = pair again
 * })
 */
export const makeAutoReconnect = (createSocket, opts = {}) => {
    const { maxRetries = 10, baseDelayMs = 1000, maxDelayMs = 60000, jitterRatio = 0.3, stableAfterMs = 30000, logger, onSocket, onRetry, onClose, onLoggedOut, onGiveUp } = opts;
    let current;
    let attempts = 0;
    let openedAt = 0;
    let stopped = false;
    let starting = false;
    let timer;
    const schedule = (delayMs) => {
        clearTimeout(timer);
        timer = setTimeout(() => void start(), delayMs);
    };
    const backoff = () => {
        const base = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
        return Math.round(base * (1 - jitterRatio + Math.random() * jitterRatio * 2));
    };
    const failAndRetry = (info) => {
        attempts++;
        if (attempts > maxRetries) {
            stopped = true;
            logger?.error?.({ attempts, reason: info.reason }, 'giving up reconnecting');
            onGiveUp?.(info);
            return;
        }
        const delayMs = backoff();
        logger?.warn?.({ attempt: attempts, delayMs, reason: info.reason }, 'connection closed, will reconnect');
        onRetry?.({ attempt: attempts, delayMs, ...info });
        schedule(delayMs);
    };
    const handleClose = async (sock, error) => {
        if (stopped || sock !== current) {
            return;
        }
        if (openedAt && Date.now() - openedAt >= stableAfterMs) {
            attempts = 0; // it was healthy for a while, so this is a new incident, not a retry storm
        }
        openedAt = 0;
        const info = { ...classifyDisconnect(error), error };
        onClose?.(info);
        if (info.reason === 'loggedOut') {
            logger?.warn?.('session logged out');
            const pairAgain = await onLoggedOut?.(info);
            if (pairAgain === true && !stopped) {
                attempts = 0;
                schedule(0);
            }
            else {
                stopped = true;
            }
            return;
        }
        if (!info.reconnect) {
            stopped = true;
            logger?.warn?.({ reason: info.reason }, 'not reconnecting');
            onGiveUp?.(info);
            return;
        }
        if (info.immediate) {
            schedule(250);
            return;
        }
        failAndRetry(info);
    };
    const start = async () => {
        if (stopped || starting) {
            return;
        }
        starting = true;
        try {
            const sock = await createSocket();
            current = sock;
            sock.ev.on('connection.update', update => {
                if (update.connection === 'open') {
                    openedAt = Date.now();
                }
                else if (update.connection === 'close') {
                    void handleClose(sock, update.lastDisconnect?.error);
                }
            });
            onSocket?.(sock);
        }
        catch (error) {
            // building the socket itself failed (disk, network, bad config)
            current = undefined;
            starting = false;
            if (!stopped) {
                failAndRetry({ code: getDisconnectCode(error), reason: 'startFailed', reconnect: true, clearSession: false, immediate: false, error });
            }
            return;
        }
        starting = false;
    };
    void start();
    return {
        get socket() {
            return current;
        },
        /** stop reconnecting and close the current socket (does not log the device out) */
        async stop() {
            stopped = true;
            clearTimeout(timer);
            const sock = current;
            current = undefined;
            if (sock) {
                await sock.end(undefined);
            }
        }
    };
};
