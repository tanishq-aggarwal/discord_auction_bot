export type epochMilliseconds = number;
export type epochSeconds = number;
export type milliseconds = number;
export type seconds = number;

export function msToS(ms: milliseconds): seconds {
    return Math.floor(ms / 1000);
}