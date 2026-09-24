const OPEN_BID_OVERVIEW_PREFIX = "auction:open-bid-overview";
const PLACE_BID_PREFIX = "auction:place-bid";
const BID_MODAL_PREFIX = "auction:submit-bid";

function buildCustomId(prefix: string, auctionId: string): string {
    return `${prefix}:${auctionId}`;
}

function parseCustomId(customId: string, prefix: string): string | null {
    const prefixWithSeparator = `${prefix}:`;
    if (!customId.startsWith(prefixWithSeparator)) return null;
    const auctionId = customId.slice(prefixWithSeparator.length).trim();
    return auctionId || null;
}

export const auctionCustomIds = {
    openBidOverview: {
        build: (auctionId: string) => buildCustomId(OPEN_BID_OVERVIEW_PREFIX, auctionId),
        parse: (customId: string) => parseCustomId(customId, OPEN_BID_OVERVIEW_PREFIX),
    },
    placeBid: {
        build: (auctionId: string) => buildCustomId(PLACE_BID_PREFIX, auctionId),
        parse: (customId: string) => parseCustomId(customId, PLACE_BID_PREFIX),
    },
    bidModal: {
        build: (auctionId: string) => buildCustomId(BID_MODAL_PREFIX, auctionId),
        parse: (customId: string) => parseCustomId(customId, BID_MODAL_PREFIX),
    },
} as const;
