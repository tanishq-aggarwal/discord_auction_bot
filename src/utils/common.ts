export type epochMilliseconds = number;
export type epochSeconds = number;
export type milliseconds = number;
export type seconds = number;
export type minutes = number;

export function msToS(ms: milliseconds): seconds {
    return Math.floor(ms / 1000);
}

export function minsToMs(mins: minutes): milliseconds {
    return mins * 60 * 1000;
}

/** Generate all permutations of an array of strings */
export function getPermutations(arr: string[]): string[][] {
    const result: string[][] = [];
    const c = new Array(arr.length).fill(0);
    const copy = arr.slice();
    const swap = (items: string[], a: number, b: number) => {
        const aValue = items[a];
        const bValue = items[b];
        if (aValue === undefined || bValue === undefined) return;
        items[a] = bValue;
        items[b] = aValue;
    };

    result.push(copy.slice());

    let i = 0;
    while (i < arr.length) {
        if (c[i] < i) {
            if (i % 2 === 0) {
                swap(copy, 0, i);
            } else {
                const ci = c[i] ?? 0;
                swap(copy, ci, i);
            }
            result.push(copy.slice());
            c[i] += 1;
            i = 0;
        } else {
            c[i] = 0;
            i += 1;
        }
    }

    return result;
}

export function sleep(ms: milliseconds): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}