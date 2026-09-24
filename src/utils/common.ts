export type epochMilliseconds = number;
export type milliseconds = number;
export type seconds = number;
export type minutes = number;

export function msToS(ms: milliseconds): seconds {
    return Math.floor(ms / 1000);
}

export function minsToMs(mins: minutes): milliseconds {
    return mins * 60 * 1000;
}

export function sleep(ms: milliseconds): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
