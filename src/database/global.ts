import { AuctionStore } from "./auctionStore.js";
import { GuildConfigStore } from "./guildConfigStore.js";


export const guildConfigs = new GuildConfigStore();
export const auctions = new AuctionStore();