import "dotenv/config";
import {
    Client,
    Events,
    GatewayIntentBits,
    type AutocompleteInteraction,
    type ChatInputCommandInteraction,
    type Interaction,
} from "discord.js";
import { addMaster } from "./commands/add-master.js";
import { addSlave } from "./commands/add-slave.js";
import { cancelCurrentRound } from "./commands/cancel-current-round.js";
import { getCommandRouteSpec, type CommandAccess } from "./commands/commandRegistry.js";
import { createAuction } from "./commands/create.js";
import { deleteAuction } from "./commands/delete.js";
import { removeMaster } from "./commands/remove-master.js";
import { removeSlave } from "./commands/remove-slave.js";
import { resetAuction } from "./commands/reset.js";
import { setAdminRole } from "./commands/set-admin-role.js";
import { startNextRandomRound } from "./commands/start-next-random-round.js";
import { startNextRound } from "./commands/start-next-round.js";
import { handleBidButton, handleBidModal, resumePersistedRounds } from "./bidding/dispatch.js";
import { startAuction } from "./commands/start.js";
import { undoLastRound } from "./commands/undo-last-round.js";
import { updateSlaveSpecialty } from "./commands/update-slave-specialty.js";
import { viewParticipants } from "./commands/view-participants.js";
import { viewStatus } from "./commands/view-status.js";
import { requireEnvironmentVariable } from "./config.js";
import { auctions, persistState } from "./database/global.js";
import { isServerAdmin, verifyAuctionAdmin } from "./utils/auth.js";
import { errorReplyBuilder } from "./utils/discord-utils.js";

type CommandRoute = {
    access: CommandAccess;
    mutates: boolean;
    handler: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const commandHandlers = {
    "set-admin-role": setAdminRole,
    create: createAuction,
    delete: deleteAuction,
    "add-slave": addSlave,
    "update-slave-specialty": updateSlaveSpecialty,
    "add-master": addMaster,
    "remove-slave": removeSlave,
    "remove-master": removeMaster,
    start: startAuction,
    reset: resetAuction,
    "start-next-round": startNextRound,
    "start-next-random-round": startNextRandomRound,
    "cancel-current-round": cancelCurrentRound,
    "undo-last-round": undoLastRound,
    "view-status": viewStatus,
    "view-participants": viewParticipants,
} as const;

const commandRoutes = new Map<string, CommandRoute>(
    Object.entries(commandHandlers).map(([name, handler]) => {
        const spec = getCommandRouteSpec(name);
        if (!spec) {
            throw new Error(`Missing command route spec for "${name}".`);
        }
        return [name, { access: spec.access, mutates: spec.mutates, handler }];
    }),
);

function normalizePriorityInput(value: string): string[] {
    return value.split(",").map((part) => part.trim().toLowerCase());
}

function buildPrioritySuggestions(masterTags: string[], typed: string): string[] {
    if (masterTags.length === 0) return [];
    const parts = normalizePriorityInput(typed);
    const completed = parts.slice(0, -1);
    const partial = parts.at(-1) ?? "";
    const selected: string[] = [];

    for (const token of completed) {
        const match = masterTags.find((tag) => tag.toLowerCase() === token && !selected.includes(tag));
        if (!match) return [];
        selected.push(match);
    }

    const remaining = masterTags.filter((tag) => !selected.includes(tag));
    const matchingNext = remaining.filter((tag) => tag.toLowerCase().startsWith(partial));
    const candidates = (matchingNext.length > 0 ? matchingNext : remaining).slice(0, 25);
    return candidates.map((candidate) => {
        const rest = remaining.filter((tag) => tag !== candidate);
        return [...selected, candidate, ...rest].join(", ");
    });
}

async function handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.commandName !== "auction" || !interaction.inGuild() || !interaction.guildId) return;

    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value ?? "").toLowerCase();
    if (focused.name === "auction_name") {
        const subcommand = interaction.options.getSubcommand();
        const names = (
            subcommand === "view-participants" || subcommand === "view-status" || subcommand === "delete"
                ? auctions.listAuctionNames(interaction.guildId)
                : auctions.listOpenAuctionNames(interaction.guildId)
        )
            .filter((name) => name.toLowerCase().includes(typed))
            .slice(0, 25);
        await interaction.respond(names.map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) })));
        return;
    }

    if (focused.name === "priority_order") {
        const auctionName = interaction.options.getString("auction_name", false);
        const auction = auctionName ? auctions.getByName(interaction.guildId, auctionName) : undefined;
        const masterTags = auction ? Array.from(auction.masters.values()).map((master) => master.tag) : [];
        const suggestions = buildPrioritySuggestions(masterTags, typed);
        await interaction.respond(
            suggestions
                .filter((suggestion) => suggestion.length <= 100)
                .map((suggestion) => ({ name: suggestion, value: suggestion })),
        );
    }
}

async function authorizeCommand(interaction: ChatInputCommandInteraction, access: CommandAccess): Promise<boolean> {
    if (access === "public") return true;
    if (access === "server-admin") {
        if (isServerAdmin(interaction)) return true;
        await interaction.reply(
            errorReplyBuilder({ description: "Only server administrators can run this command.", ephemeral: false }),
        );
        return false;
    }
    return (await verifyAuctionAdmin(interaction)) === true;
}

async function handleChatInputInteraction(
    interaction: ChatInputCommandInteraction,
    route: CommandRoute | undefined,
): Promise<void> {
    if (interaction.commandName !== "auction") return;
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channelId) {
        await interaction.reply(
            errorReplyBuilder({ description: "This command can only be used inside a server channel." }),
        );
        return;
    }
    if (!route) {
        await interaction.reply(errorReplyBuilder({ description: "Unknown auction command." }));
        return;
    }
    if (!(await authorizeCommand(interaction, route.access))) return;
    await route.handler(interaction);
}

async function replyWithUnexpectedError(interaction: Interaction): Promise<void> {
    if (!interaction.isRepliable()) return;
    try {
        const response = errorReplyBuilder({
            description: "Something went wrong while handling that interaction. Please try again.",
        });
        if (interaction.deferred || interaction.replied) await interaction.followUp(response);
        else await interaction.reply(response);
    } catch (replyError) {
        console.error("[interaction:error-reply-failed]", replyError);
    }
}

async function handleInteractionSafely(interaction: Interaction): Promise<void> {
    let shouldPersist = false;
    try {
        if (interaction.isAutocomplete()) {
            await handleAutocompleteInteraction(interaction);
        } else if (interaction.isChatInputCommand()) {
            const route = commandRoutes.get(interaction.options.getSubcommand());
            shouldPersist = route?.mutates ?? false;
            await handleChatInputInteraction(interaction, route);
        } else if (interaction.isButton()) {
            await handleBidButton(interaction);
        } else if (interaction.isModalSubmit()) {
            shouldPersist = await handleBidModal(interaction);
        }
    } catch (error) {
        console.error("[interaction:unhandled]", error);
        await replyWithUnexpectedError(interaction);
    } finally {
        if (shouldPersist) {
            try {
                persistState();
            } catch (error) {
                console.error("[state:persist-after-interaction]", error);
            }
        }
    }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag} is online!`);
    resumePersistedRounds(readyClient);
});
client.on(Events.Error, (error) => console.error("[discord:client-error]", error));
client.on(Events.InteractionCreate, (interaction) => {
    void handleInteractionSafely(interaction);
});

let shuttingDown = false;
function shutdown(exitCode: number, reason: string, error?: unknown): void {
    if (shuttingDown) return;
    shuttingDown = true;
    if (error !== undefined) console.error(reason, error);
    try {
        persistState();
    } catch (persistError) {
        console.error("[state:persist-on-shutdown]", persistError);
    }
    client.destroy();
    process.exit(exitCode);
}

process.on("unhandledRejection", (reason) => shutdown(1, "[process:unhandled-rejection]", reason));
process.on("uncaughtException", (error) => shutdown(1, "[process:uncaught-exception]", error));
process.on("SIGINT", () => shutdown(0, "[process:sigint]"));
process.on("SIGTERM", () => shutdown(0, "[process:sigterm]"));

const token = requireEnvironmentVariable("DISCORD_TOKEN");
void client.login(token).catch((error) => shutdown(1, "[discord:login-failed]", error));
