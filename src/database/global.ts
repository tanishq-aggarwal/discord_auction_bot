import { AuctionStore } from "./auctionStore.js";
import { GuildConfigStore } from "./guildConfigStore.js";
import { SqlitePersistence } from "./sqlitePersistence.js";


export const guildConfigs = new GuildConfigStore();
export const auctions = new AuctionStore();
const persistence = new SqlitePersistence();

export function loadPersistentState(): void {
    guildConfigs.hydrate(persistence.getJson("guildConfigs", {}));
    auctions.hydrate(persistence.getJson("auctions", {}));
}

export function persistState(): void {
    persistence.setJson("guildConfigs", guildConfigs.toSerializable());
    persistence.setJson("auctions", auctions.toSerializable());
}

loadPersistentState();