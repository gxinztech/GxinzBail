export type SendRateLimitOptions = {
    /** minimum gap between any two sends, across all chats */
    globalMinDelayMs: number;
    /** minimum gap between two sends to the same chat */
    perChatMinDelayMs: number;
    /** random extra delay (0..jitterMs) added to the gaps above */
    jitterMs: number;
    /** hard ceiling: at most this many sends inside windowMs */
    maxPerWindow: number;
    windowMs: number;
    /** reject new sends once this many are waiting */
    maxQueueSize: number;
    /** retries after an explicit rate-limit response (429 / rate-overlimit) */
    maxRetries: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
};
export declare const DEFAULT_SEND_RATE_LIMIT: SendRateLimitOptions;
/** true only for explicit "slow down" answers; timeouts are not retried */
export declare const isRateLimitError: (err: any) => boolean;
export declare const makeSendLimiter: (options?: Partial<SendRateLimitOptions>, logger?: {
    warn?: (...args: any[]) => void;
}) => {
    schedule<T>(chat: string, task: () => Promise<T>): Promise<T>;
    pause(ms: number): void;
    stats(): {
        pending: number;
        activeChats: number;
        pausedForMs: number;
    };
    destroy(): void;
};
