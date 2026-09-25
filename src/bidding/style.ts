export const BIDDING_STYLES = ["sealed"] as const;

export type BiddingStyle = (typeof BIDDING_STYLES)[number];

export function readBiddingStyle(value: unknown): BiddingStyle {
    if (value === undefined || value === "sealed") return "sealed";
    throw new Error(`Unsupported bidding style "${String(value)}".`);
}
