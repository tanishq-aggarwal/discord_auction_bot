// https://discord.com/oauth2/authorize?client_id=1477614199340404839&permissions=274877991936&integration_type=0&scope=bot+applications.commands

import 'dotenv/config';
import {
    Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { errorReplyBuilder, getRelativeDiscordTimestamp, replyBuilder } from './utils/discord-utils.js';
import { isServerAdmin, verifyAuctionAdmin } from './utils/auth.js';
import { setAdminRole } from './commands/set-admin-role.js';
import { auctions } from './database/global.js';
import { createAuction } from './commands/create.js';
import { addSlave } from './commands/add-slave.js';
import { addMaster } from './commands/add-master.js';
import { removeMaster } from './commands/remove-master.js';
import { removeSlave } from './commands/remove-slave.js';
import { updateSlaveSpecialty } from './commands/update-slave-specialty.js';
import { getPermutations } from './utils/common.js';
import { startAuction } from './commands/start.js';
import { resetAuction } from './commands/reset.js';
import { handlePlaceBidButton, handlePlaceBidModal, startNextRound as startNextRoundCommand } from './commands/start-next-round.js';


// Handle autocompletion interactions
async function handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    if (interaction.commandName !== 'auction') return;
    // Autocomplete should fail silently when context is invalid.
    if (!interaction.inGuild() || !interaction.guildId) return;

    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value ?? '').toLowerCase();

    if (focused.name === 'auction_name') {
        const names = auctions
            .listOpenAuctionNames(interaction.guildId)
            .filter(n => n.toLowerCase().includes(typed));

        await interaction.respond(names.map(n => ({ name: n, value: n })));
    }

    else if (focused.name === 'priority_order') {
        // Suggest possible combinations (permutations) of masters' discord tags for the entered auction_name
        const auctionName = interaction.options.getString('auction_name', false);
        if (!auctionName) {
            // Don't suggest anything if auction_name isn't typed yet
            await interaction.respond([]);
            return;
        }

        const auction = auctions.getByName(interaction.guildId, auctionName);
        if (!auction || !auction.masters.size) {
            await interaction.respond([]);
            return;
        }

        // Get all master usernames
        const masterTags = Array.from(auction.masters.values()).map(m => m.tag);

        const permutations = getPermutations(masterTags);
        const orderedStrings = permutations.map(tags => tags.join(', '));

        // Filter out permutations that don't start with what the user has typed so far (case-insensitive and forgiving extra spaces)
        // Normalize both user input and permutation to ignore extra spaces around commas/names
        function normalize(s: string): string {
            return s
                .split(',')
                .map(part => part.trim().toLowerCase())
                .join(', ');
        }

        const normalizedTyped = normalize(typed);

        const filteredOrderedStrings = orderedStrings.filter(s => {
            // Check if user has typed anything; if not, offer all
            if (!normalizedTyped) return true;
            const normalizedString = normalize(s);
            return normalizedString.startsWith(normalizedTyped);
        });

        // Only send a reasonable number of autocomplete options
        await interaction.respond(
            filteredOrderedStrings.slice(0, 25).map(s => ({ name: s, value: s }))
        );
        return;
      }
}


// Handle slash command interactions
async function handleChatInputInteraction(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName !== 'auction') return;
    if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.reply(errorReplyBuilder({description: 'This command can only be used inside a server.'}));
        return;
    }
    if (!interaction.channelId) {
        await interaction.reply(errorReplyBuilder({description: 'This command can only be used inside a server channel.'}));
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    // Enforce auth
    if (subcommand === 'set-admin-role') {
      // TODO: Uncomment this in prod
        // if (!isServerAdmin(interaction)) {
        //     await interaction.reply(errorReplyBuilder(
        //         'Only server administrators can run this command.',
        //         false
        //     ));
        //     return;
        // }
    }
    else if (
        subcommand === 'create' ||
        subcommand === 'add-slave' ||
        subcommand === 'add-master' ||
        subcommand === 'remove-slave' ||
        subcommand === 'remove-master' ||
        subcommand === 'start' ||
        subcommand === 'reset' ||
        subcommand === 'start-next-round'
    ) {
        // TODO: Uncomment this in prod
        // if (!await verifyAuctionAdmin(interaction)) return;
    }


    if (subcommand === 'set-admin-role') {
        await setAdminRole(interaction);
    }

    
    else if (subcommand === 'create') {
        await createAuction(interaction);
    }

    else if (subcommand === 'add-slave') {
        await addSlave(interaction);
    }

    else if (subcommand === 'update-slave-specialty') {
        await updateSlaveSpecialty(interaction);
    }

    else if (subcommand === 'add-master') {
        await addMaster(interaction);
    }

    else if (subcommand === 'remove-slave') {
        await removeSlave(interaction);
    }

    else if (subcommand === 'remove-master') {
        await removeMaster(interaction);
    }

    else if (subcommand === 'start') {
        await startAuction(interaction);
    }
    else if (subcommand === 'reset') {
        await resetAuction(interaction);
    }
    else if (subcommand === 'start-next-round') {
        await startNextRoundCommand(interaction);
    }
}



const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(`${c.user.tag} is online!`);

    // Testing setup
    const auction = auctions.create(
        '1288936489534754826',
        'test',
    );
    auctions.addSlave('1288936489534754826', 'test', '284509170412027905', 'deathstar6678', 'Attacker');
    // auctions.addSlave('1288936489534754826', 'test', '1384661102251737169', 'godman_69', 'hosting/managing, well-respected figure in cc community');
    auctions.addSlave('1288936489534754826', 'test', '1279092301825704038', 'jpk11.1', 'Base Builder');
    // auctions.addSlave('1288936489534754826', 'test', '678342626646163506', 'xanderheij', 'elite attacker, leader of #2 global cc clan');
    auctions.addMaster('1288936489534754826', 'test', '235648483003072512', 'spyke_x');


    auction.channelId = '1478447176605503626';
    auction.status = 'LIVE';
    auction.rules = {
        startingBudget: 100,
        roundDurationMs: 2 * 60 * 1000,
        maxSlavesPerMaster: Math.ceil(auction.slaves.size / auction.masters.size),
        priorityType: 'fixed',
        startingPriorityOrder: ['235648483003072512'],
    };
    auction.state = {
        startedAt: Date.now(),
        balances: new Map(Array.from(auction.masters.entries()).map(([id, master]) => [id, auction.rules?.startingBudget ?? 100])),
        purchases: new Map(Array.from(auction.masters.entries()).map(([id, master]) => [id, []])),
    };
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
        await handleAutocompleteInteraction(interaction);
    }

    else if (interaction.isChatInputCommand()) {
        await handleChatInputInteraction(interaction);
    }

    else if (interaction.isButton()) {
        await handlePlaceBidButton(interaction);
    }

    else if (interaction.isModalSubmit()) {
        await handlePlaceBidModal(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);