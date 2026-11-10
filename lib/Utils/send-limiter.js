import { Boom } from '@hapi/boom';
/**
 * Default pacing for outgoing messages. The values are deliberately conservative:
 * a single reply is sent immediately, bursts are spread out, and a whole-account
 * ceiling keeps broadcast-like traffic (same bot, many chats) from looking like spam.
 */
export const DEFAULT_SEND_RATE_LIMIT = {
    /** minimum gap between any two sends, across all chats */
    globalMinDelayMs: 300,
    /** minimum gap between two sends to the same chat */
    perChatMinDelayMs: 1000,
    /** random extra delay (0..jitterMs) added to the gaps above */
    jitterMs: 250,
    /** hard ceiling: at most this many sends inside windowMs */
    maxPerWindow: 40,
    windowMs: 30000,
    /** reject new sends once this many are waiting, instead of growing without bound */
    maxQueueSize: 500,
    /** retries after an explicit rate-limit response (429 / rate-overlimit) */
    maxRetries: 3,
    retryBaseDelayMs: 3000,
    retryMaxDelayMs: 30000
};
const noop = () => { };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const jitter = (max) => (max > 0 ? Math.floor(Math.random() * (max + 1)) : 0);
/** true only for explicit "slow down" answers. Timeouts are NOT retried: the message may already be out */
export const isRateLimitError = (err) => {
    const code = err?.output?.statusCode ?? err?.data?.statusCode ?? err?.statusCode;
    if (code === 429) {
        return true;
    }
    const text = `${err?.message ?? ''} ${err?.data?.code ?? ''} ${err?.data?.attrs?.error ?? ''}`;
    return /rate-?overlimit|too many requests/i.test(text);
};
/**
 * Serialises sends per chat (keeps order) and paces them globally.
 * Slots are reserved synchronously, so concurrent callers can never claim the same slot.
 */
export const makeSendLimiter = (options = {}, logger) => {
    const cfg = { ...DEFAULT_SEND_RATE_LIMIT, ...options };
    const chatTail = new Map(); // chat -> promise of the last queued task
    const chatNext = new Map(); // chat -> earliest time its next send may start
    const starts = []; // recent reserved start times (monotonic)
    let lastGlobalStart = 0;
    let pauseUntil = 0;
    let pending = 0;
    let destroyed = false;
    const reserve = (chat) => {
        const now = Date.now();
        let start = Math.max(now, pauseUntil, lastGlobalStart + cfg.globalMinDelayMs + jitter(cfg.jitterMs), chatNext.get(chat) ?? 0);
        while (starts.length && starts[0] <= start - cfg.windowMs) {
            starts.shift();
        }
        if (starts.length >= cfg.maxPerWindow) {
            start = Math.max(start, starts[starts.length - cfg.maxPerWindow] + cfg.windowMs);
        }
        starts.push(start);
        lastGlobalStart = start;
        chatNext.set(chat, start + cfg.perChatMinDelayMs + jitter(cfg.jitterMs));
        return start - now;
    };
    const pruneChatNext = () => {
        if (chatNext.size < 1000) {
            return;
        }
        const now = Date.now();
        for (const [chat, t] of chatNext) {
            if (t <= now && !chatTail.has(chat)) {
                chatNext.delete(chat);
            }
        }
    };
    const execute = async (chat, task) => {
        try {
            for (let attempt = 0;; attempt++) {
                const wait = reserve(chat);
                if (wait > 0) {
                    await sleep(wait);
                }
                if (destroyed) {
                    throw new Boom('Connection Closed', { statusCode: 428 });
                }
                try {
                    return await task();
                }
                catch (err) {
                    if (!isRateLimitError(err) || attempt >= cfg.maxRetries) {
                        throw err;
                    }
                    const backoff = Math.min(cfg.retryMaxDelayMs, cfg.retryBaseDelayMs * 2 ** attempt) + jitter(cfg.jitterMs * 4);
                    // the whole account backs off, not just this chat
                    pauseUntil = Math.max(pauseUntil, Date.now() + backoff);
                    logger?.warn?.({ chat, attempt: attempt + 1, backoffMs: backoff }, 'rate limited by WhatsApp, backing off');
                }
            }
        }
        finally {
            pending--;
        }
    };
    return {
        /** run `task` for `chat` once the pacing rules allow it */
        schedule(chat, task) {
            if (destroyed) {
                return Promise.reject(new Boom('Connection Closed', { statusCode: 428 }));
            }
            if (pending >= cfg.maxQueueSize) {
                return Promise.reject(new Boom('Send queue is full', { statusCode: 429, data: { pending } }));
            }
            pending++;
            pruneChatNext();
            const prev = chatTail.get(chat) ?? Promise.resolve();
            const run = prev.then(() => execute(chat, task));
            const tail = run.then(noop, noop);
            chatTail.set(chat, tail);
            void tail.then(() => {
                if (chatTail.get(chat) === tail) {
                    chatTail.delete(chat);
                }
            });
            return run;
        },
        /** pause every send for `ms` (for example after your own ban/limit detection) */
        pause(ms) {
            pauseUntil = Math.max(pauseUntil, Date.now() + ms);
        },
        stats() {
            return { pending, activeChats: chatTail.size, pausedForMs: Math.max(0, pauseUntil - Date.now()) };
        },
        /** reject everything that is still waiting. Called when the socket closes */
        destroy() {
            destroyed = true;
        }
    };
};
