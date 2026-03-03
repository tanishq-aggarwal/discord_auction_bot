import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { AuctionStore } from './store/auctionStore.js';
import { GuildConfigStore } from './store/guildConfigStore.js';
import { requireAuctionAdmin } from './auth/requireAuctionAdmin.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const auctions = new AuctionStore();
const guildConfigs = new GuildConfigStore();

client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (!interaction.guildId) return;

    if (interaction.commandName !== 'auction') return;

    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'auction_name') return;

    const typed = String(focused.value ?? '').toLowerCase();

    const names = auctions
      .listOpenAuctionNames(interaction.guildId)
      .filter(n => n.toLowerCase().includes(typed))
      .slice(0, 25);

    await interaction.respond(names.map(n => ({ name: n, value: n })));
    return;
  }
});


client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'auction') return;

    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
        if (!(await requireAuctionAdmin(interaction, guildConfigs))) return;
        
        if (!interaction.guildId || !interaction.channelId) {
            await interaction.reply({ content: 'This command can only be used inside a server channel.', flags: MessageFlags.Ephemeral });
            return;
        }

        const auctionName = interaction.options.getString('auction_name', true);

        try {
            const auction = auctions.create({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            name: auctionName,
            createdByUserId: interaction.user.id,
            });

            console.log('[auction:create]', auction, 'totalAuctionsInGuild=', auctions.count(interaction.guildId));

            await interaction.reply(`Created auction **${auction.name}** (id: \`${auction.id}\`) in this server.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create auction.';
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
    }

    if (sub === 'add-player') {
        if (!(await requireAuctionAdmin(interaction, guildConfigs))) return;
        
        if (!interaction.guildId) {
            await interaction.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const auctionName = interaction.options.getString('auction_name', true);
        const player = interaction.options.getUser('player', true);

        try {
            const auction = auctions.addPlayer(interaction.guildId, auctionName, player.id, interaction.user.id);

            console.log(`[auction:add-player] auction=${auctionName} player=${player.tag} (${player.id})`);

            await interaction.reply(
            `Added **${player.tag}** to **${auction.name}** player pool. Pool size: ${auction.players.size}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to add player.';
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }

        return;
    }

    if (sub === 'add-participant') {
        if (!(await requireAuctionAdmin(interaction, guildConfigs))) return;
        
        if (!interaction.guildId) {
            await interaction.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const openAuctions = auctions.listOpenAuctionNames(interaction.guildId);
        if (openAuctions.length === 0) {
            await interaction.reply({
            content: 'There are no open auctions right now. Run `/auction create` first.',
            flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const auctionName = interaction.options.getString('auction_name', true);
        const participant = interaction.options.getUser('participant', true);

        try {
            const auction = auctions.addParticipant(interaction.guildId, auctionName, participant.id, interaction.user.id);

            console.log(`[auction:add-participant] auction=${auctionName} participant=${participant.tag} (${participant.id})`);

            await interaction.reply(
            `Added **${participant.tag}** as a participant in **${auction.name}**. Participant count: ${auction.participants.size}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to add participant.';
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (sub === 'set-admin-role') {
        if (!interaction.inGuild() || !interaction.guildId) {
            await interaction.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Only server admins/managers can change the server config
        const perms = interaction.memberPermissions;
        const ok =
            !!perms?.has(PermissionFlagsBits.Administrator) ||
            !!perms?.has(PermissionFlagsBits.ManageGuild);

        if (!ok) {
            await interaction.reply({
            content: 'You need Admin or Manage Server to set the auction admin role.',
            flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const role = interaction.options.getRole('role', true);

        guildConfigs.setAdminRole(interaction.guildId, role.id, interaction.user.id);

        console.log(`[auction:set-admin-role] guild=${interaction.guildId} role=${role.name} (${role.id}) by=${interaction.user.tag}`);

        await interaction.reply(`Set auction admin role to **${role.name}**.`);
        return;
    }

    if (sub === 'remove-player') {
        if (!(await requireAuctionAdmin(interaction, guildConfigs))) return;
        if (!interaction.guildId) {
            await interaction.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const openAuctions = auctions.listOpenAuctionNames(interaction.guildId);
        if (openAuctions.length === 0) {
            await interaction.reply({
            content: 'There are no open auctions right now.',
            flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const auctionName = interaction.options.getString('auction_name', true);
        const player = interaction.options.getUser('player', true);

        try {
            const auction = auctions.removePlayer(interaction.guildId, auctionName, player.id);
            console.log(`[auction:remove-player] auction=${auctionName} player=${player.tag} (${player.id})`);
            await interaction.reply(
            `Removed **${player.tag}** from **${auction.name}** player pool. Pool size: ${auction.players.size}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to remove player.';
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
        return;
        }

    if (sub === 'remove-participant') {
        if (!(await requireAuctionAdmin(interaction, guildConfigs))) return;
        if (!interaction.guildId) {
            await interaction.reply({ content: 'Use this inside a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const openAuctions = auctions.listOpenAuctionNames(interaction.guildId);
        if (openAuctions.length === 0) {
            await interaction.reply({
            content: 'There are no open auctions right now.',
            flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const auctionName = interaction.options.getString('auction_name', true);
        const participant = interaction.options.getUser('participant', true);

        try {
            const auction = auctions.removeParticipant(interaction.guildId, auctionName, participant.id);
            console.log(`[auction:remove-participant] auction=${auctionName} participant=${participant.tag} (${participant.id})`);
            await interaction.reply(
            `Removed **${participant.tag}** from **${auction.name}** participants. Count: ${auction.participants.size}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to remove participant.';
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
        return;
    }
});

client.login(process.env.DISCORD_TOKEN);