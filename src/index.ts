// https://discord.com/oauth2/authorize?client_id=1477614199340404839&permissions=19456&integration_type=0&scope=bot+applications.commands

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
import { errorReplyBuilder, getRelativeDiscordTimestamp, infoReplyBuilder } from './utils/discord-utils.js';
import { isServerAdmin, verifyAuctionAdmin } from './utils/auth.js';
import { setAdminRole } from './commands/set-admin-role.js';
import { auctions } from './database/global.js';
import { createAuction } from './commands/create.js';
import { addSlave } from './commands/add-slave.js';
import { addMaster } from './commands/add-master.js';
import { removeMaster } from './commands/remove-master.js';
import { removeSlave } from './commands/remove-slave.js';
import { updateSlaveSpecialties } from './commands/update-slave-specialties.js';
import { setAuctionChannel } from './commands/set-auction-channel.js';


const ROUND_MS = 2 * 60 * 1000;
function bidButtonCustomId(auctionId: string, roundId: string) {
  return `auction:bid:${auctionId}:${roundId}`; // keep <= 100 chars [web:209]
}

function bidPanelCustomId(auctionId: string, roundId: string) {
  return `auction:bidpanel:${auctionId}:${roundId}`;
}
function bidOpenModalCustomId(auctionId: string, roundId: string) {
  return `auction:bidopen:${auctionId}:${roundId}`;
}
function bidModalCustomId(auctionId: string, roundId: string) {
  return `auction:bidmodal:${auctionId}:${roundId}`;
}

function purchasesCount(auction: any, userId: string) {
  return auction.live?.purchases.get(userId)?.length ?? 0;
}

function remainingSlots(auction: any, userId: string) {
  const live = auction.live!;
  return live.maxPurchasesPerParticipant - purchasesCount(auction, userId);
}


function findAuctionById(guildId: string, auctionId: string) {
  const auction = auctions.getById(auctionId);
  if (!auction) return undefined;
  if (auction.guildId !== guildId) return undefined; // safety for multi-guild
  return auction;
}

function computeMaxBidAllowed(balance: number, slotsLeft: number, isLastRoundOverall: boolean) {
  if (isLastRoundOverall) return Math.max(0, balance); // no future rounds, no reserve needed
  const reserve = Math.max(0, slotsLeft - 1);         // keep 1 coin per remaining purchase AFTER this
  return Math.max(0, balance - reserve);
}

function getSoldSet(auction: any) {
  const sold = new Set<string>();
  const purchases: Map<string, string[]> = auction.live?.purchases ?? new Map();
  for (const ids of purchases.values()) for (const pid of ids) sold.add(pid);
  return sold;
}

function isLastRoundOverall(auction: any) {
  const sold = getSoldSet(auction);
  const remaining = [...auction.slaves.keys()].filter(pid => !sold.has(pid));
  return remaining.length === 1; // only the current nominated player remains
}


async function startNextRound(auction: any) {
  const live = auction.live!;
  const sold = new Set<string>();
  for (const ids of live.purchases.values()) for (const pid of ids) sold.add(pid);

  const available = [...auction.slaves.keys()].filter(pid => !sold.has(pid));
  if (available.length === 0) {
    auction.status = 'CLOSED';
    await postToAuctionChannel(auction, `Auction **${auction.name}** finished. All players sold.`);
    return;
  }

  const nominated = available[Math.floor(Math.random() * available.length)];
  const roundId = randomUUID();
  const endsAt = Date.now() + ROUND_MS;

  live.round = {
    id: roundId,
    playerUserId: nominated,
    startedAt: Date.now(),
    endsAt,
    bids: new Map(),
  };

  const button = new ButtonBuilder()
    .setCustomId(bidPanelCustomId(auction.id, roundId))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Place bid');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  const tieOrderMentions = live.tiePriority.map((id: string) => `<@${id}>`).join(' > ');
  const msg = await postToAuctionChannel(
    auction,
    [
      `Round starting: nominated player <@${nominated}>`,
      `Bidding ends ${getRelativeDiscordTimestamp(endsAt)} (2 minutes).`,
      `Tie priority: ${tieOrderMentions}`,
    ].join('\n'),
    [row],
  );

  live.round.roundMessageId = msg.id;

  live.round.timeoutHandle = setTimeout(() => finalizeRound(auction, 'TIMEOUT'), ROUND_MS);
}

async function finalizeRound(auction: any, reason: 'TIMEOUT' | 'ALL_BIDS_IN') {
  const live = auction.live!;
  const round = live.round;
  if (!round) return;

  const participantIds = [...auction.masters.keys()];
  const nominated = round.playerUserId;

  const getPurchaseCount = (uid: string) => (live.purchases.get(uid)?.length ?? 0);
  const getSlotsLeft = (uid: string) => live.maxPurchasesPerParticipant - getPurchaseCount(uid);

  const soldSet = new Set<string>();
  for (const ids of live.purchases.values()) for (const pid of ids) soldSet.add(pid);

  const remainingAfterThis = [...auction.slaves.keys()].filter(
    (pid) => !soldSet.has(pid) && pid !== nominated,
  );
  const isLastRound = remainingAfterThis.length === 0;

  const computeMaxBidAllowed = (balance: number, slotsLeft: number) => {
    if (slotsLeft <= 0) return 0;
    if (isLastRound) return Math.max(0, balance); // last player: allow all remaining balance
    const reserve = Math.max(0, slotsLeft - 1);   // keep 1 coin for each remaining purchase AFTER this
    return Math.max(0, balance - reserve);
  };

  // Auto-bids for missing participants (respect purchase cap + reserve rule)
  for (const uid of participantIds) {
    if (round.bids.has(uid)) continue;

    const slotsLeft = getSlotsLeft(uid);
    const bal = live.balances.get(uid) ?? 0;
    const maxBidAllowed = computeMaxBidAllowed(bal, slotsLeft);

    let amount = 0;
    if (maxBidAllowed >= 1) {
      amount = isLastRound ? maxBidAllowed : 1;
    }

    round.bids.set(uid, { amount, isAuto: true, submittedAt: Date.now() });
  }

  // Enforce eligibility (in case someone’s state changed between modal open and finalize)
  // Also clamp any existing bids that exceed maxBidAllowed to 0 (or you could throw).
  for (const uid of participantIds) {
    const b = round.bids.get(uid);
    if (!b) continue;

    const slotsLeft = getSlotsLeft(uid);
    const bal = live.balances.get(uid) ?? 0;
    const maxBidAllowed = computeMaxBidAllowed(bal, slotsLeft);

    if (slotsLeft <= 0 || bal <= 0 || b.amount < 1 || b.amount > maxBidAllowed) {
      round.bids.set(uid, { amount: 0, isAuto: b.isAuto, submittedAt: b.submittedAt });
    }
  }

  // Build eligible set (positive bids only)
  const eligible = participantIds.filter((uid) => (round.bids.get(uid)?.amount ?? 0) > 0);

  // If nobody can bid, we must stop to avoid an infinite loop
  if (eligible.length === 0) {
    const lines = participantIds.map((uid) => {
      const b = round.bids.get(uid)!;
      return `- <@${uid}>: ${b.amount}${b.isAuto ? ' (auto)' : ''}`;
    });

    await postToAuctionChannel(
      auction,
      [
        `Bids revealed for <@${nominated}> (${reason === 'TIMEOUT' ? 'time up' : 'all bids in'}):`,
        ...lines,
        `No eligible bids were possible (purchase cap / reserve rule / 0 balance). Auction is stopping.`,
      ].join('\n'),
    );

    auction.status = 'CLOSED';
    live.round = undefined;
    return;
  }

  // Winner: max bid among eligible, tie-break via live.tiePriority order
  const maxBid = Math.max(...eligible.map((uid) => round.bids.get(uid)!.amount));
  const tied = eligible.filter((uid) => round.bids.get(uid)!.amount === maxBid);

  let winner = tied[0];
  for (const uid of live.tiePriority) {
    if (tied.includes(uid)) {
      winner = uid;
      break;
    }
  }

  // Apply purchase + balance change
  const winnerBal = live.balances.get(winner) ?? 0;
  live.balances.set(winner, winnerBal - maxBid);
  live.purchases.get(winner)!.push(nominated);

  // Rotate tie priority (A>B>C -> B>C>A)
  if (live.tiePriority.length > 0) live.tiePriority.push(live.tiePriority.shift());

  // Reveal message
  const lines = participantIds.map((uid) => {
    const b = round.bids.get(uid)!;
    return `- <@${uid}>: ${b.amount}${b.isAuto ? ' (auto)' : ''}`;
  });

  await postToAuctionChannel(
    auction,
    [
      `Bids revealed for <@${nominated}> (${reason === 'TIMEOUT' ? 'time up' : 'all bids in'}):`,
      ...lines,
      `Winner: <@${winner}> for ${maxBid} coins.`,
    ].join('\n'),
  );

  // Disable old round button (edit the round message)
  // IMPORTANT: use the same customId you used on the round message button.
  // If you switched to bidPanelCustomId(...), disable that one.
  try {
    const channel = await client.channels.fetch(auction.channelId);
    if (channel && channel.isTextBased() && round.roundMessageId) {
      // @ts-ignore
      const msg = await channel.messages.fetch(round.roundMessageId);

      const disabled = new ButtonBuilder()
        // If your round message button is now bidPanelCustomId, change this line:
        // .setCustomId(bidPanelCustomId(auction.id, round.id))
        .setCustomId(bidButtonCustomId(auction.id, round.id))
        .setStyle(ButtonStyle.Primary)
        .setLabel('Place bid')
        .setDisabled(true);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabled);
      await msg.edit({ components: [row] });
    }
  } catch {}

  live.round = undefined;
  await startNextRound(auction);
}

async function postToAuctionChannel(auction: any, content: string, components: any[] = []) {
  const channel = await client.channels.fetch(auction.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Auction channel not found / not text-based.');
  // @ts-ignore
  return channel.send({ content, components });
}


const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(`${c.user.tag} is online!`);
});

// client.on(Events.InteractionCreate, async (interaction) => {
//     if (interaction.isAutocomplete()) {
//         if (!interaction.guildId) return;

//         if (interaction.commandName !== 'auction') return;

//         const focused = interaction.options.getFocused(true);
//         if (focused.name !== 'auction_name') return;

//         const typed = String(focused.value ?? '').toLowerCase();

//         const names = auctions
//         .listOpenAuctionNames(interaction.guildId)
//         .filter(n => n.toLowerCase().includes(typed))
//         .slice(0, 25);

//         await interaction.respond(names.map(n => ({ name: n, value: n })));
//         return;
//     }

//     if (interaction.isButton()) {
//         if (!interaction.inGuild() || !interaction.guildId) return;

//         // customId examples:
//         // auction:bidpanel:<auctionId>:<roundId>
//         // auction:bidopen:<auctionId>:<roundId>
//         const parts = interaction.customId.split(':');
//         if (parts.length !== 4) return;
//         if (parts[0] !== 'auction') return;

//         const action = parts[1];
//         const auctionId = parts[2]!;
//         const roundId = parts[3];

//         if (action !== 'bidpanel' && action !== 'bidopen') return;

//         const auction = findAuctionById(interaction.guildId, auctionId);
//         const round = auction?.live?.round;

//         if (!auction || !round || round.id !== roundId) {
//             await interaction.reply({
//             content: 'This round is no longer active.',
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         const userId = interaction.user.id;

//         // Participant gate
//         if (!auction.masters.has(userId)) {
//             await interaction.reply({
//             content: 'You are not a participant in this auction.',
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         // Final-bid rule
//         if (round.bids.has(userId)) {
//             await interaction.reply({
//             content: 'You already submitted a bid (final).',
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         // Purchase-cap gate
//         const slotsLeft = remainingSlots(auction, userId);
//         if (slotsLeft <= 0) {
//             await interaction.reply({
//             content: `You’ve reached the maximum purchases (${auction.live!.maxPurchasesPerParticipant}) for this auction, so you can’t bid anymore.`,
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         const balance = auction.live!.balances.get(userId) ?? 0;
//         if (balance <= 0) {
//             await interaction.reply({
//             content: `You have 0 coins left, so you can’t bid.`,
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         const lastRound = isLastRoundOverall(auction);
//         const maxBidAllowed = computeMaxBidAllowed(balance, slotsLeft, lastRound);

//         if (maxBidAllowed < 1) {
//             await interaction.reply({
//                 content:
//                 `You can’t bid right now.\n` +
//                 `Balance: **${balance}**\n` +
//                 `Purchases left: **${slotsLeft}**\n` +
//                 `Max bid allowed: **${maxBidAllowed}** (reserved coins rule)`,
//                 flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         // Step 1: show ephemeral "bid panel"
//         if (action === 'bidpanel') {
//             const purchases = auction.live!.purchases.get(userId) ?? [];
//             const max = auction.live!.maxPurchasesPerParticipant;

//             const purchasesText =
//             purchases.length === 0 ? 'None' : purchases.map((pid: string) => `<@${pid}>`).join(', ');

//             const enterBidBtn = new ButtonBuilder()
//             .setCustomId(bidOpenModalCustomId(auctionId, roundId))
//             .setStyle(ButtonStyle.Success)
//             .setLabel('Enter bid');

//             const row = new ActionRowBuilder<ButtonBuilder>().addComponents(enterBidBtn);

//             await interaction.reply({
//             content:
//                 `Balance: **${balance}**\n` +
//                 `Purchases (${purchases.length}/${max}): ${purchasesText}\n` +
//                 `Purchases left: **${slotsLeft}**\n` +
//                 `Max bid allowed this round: **${maxBidAllowed}**\n\n` +
//                 `Bid is final once submitted.`,
//             components: [row],
//             flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         // Step 2: open the modal
//         if (action === 'bidopen') {
//             const modal = new ModalBuilder()
//                 .setCustomId(bidModalCustomId(auctionId, roundId))
//                 .setTitle(`Bid (Max: ${maxBidAllowed})`);

//             const bidInput = new TextInputBuilder()
//                 .setCustomId('amount')
//                 .setLabel('Bid amount')
//                 .setStyle(TextInputStyle.Short)
//                 .setPlaceholder(`1 - ${maxBidAllowed}`)
//                 .setRequired(true);


//             const row = new ActionRowBuilder<TextInputBuilder>().addComponents(bidInput);
//             modal.addComponents(row);

//             // Showing a modal must be the first response to that button interaction. [web:91]
//             await interaction.showModal(modal);
//             return;
//         }
//         }


//     if (interaction.isModalSubmit()) {

//         const parts = interaction.customId.split(':');
//         if (parts.length !== 4) return;
//         if (parts[0] !== 'auction' || parts[1] !== 'bidmodal') return;

//         const auctionId = parts[2]!;
//         const roundId = parts[3];

//         const auction = findAuctionById(interaction.guildId!, auctionId);
//         const round = auction?.live?.round;
//         if (!auction || !round || round.id !== roundId) {
//             await interaction.reply({ content: 'This round is no longer active.', flags: MessageFlags.Ephemeral });
//             return;
//         }

//         const userId = interaction.user.id;
//         if (!auction.masters.has(userId)) {
//             await interaction.reply({ content: 'You are not a participant in this auction.', flags: MessageFlags.Ephemeral });
//             return;
//         }
//         if (round.bids.has(userId)) {
//             await interaction.reply({ content: 'You already submitted a bid (final).', flags: MessageFlags.Ephemeral });
//             return;
//         }
        
//         const balance = auction.live!.balances.get(userId) ?? 0;
//         const slotsLeft = remainingSlots(auction, userId);
//         const lastRound = isLastRoundOverall(auction);
//         const maxBidAllowed = computeMaxBidAllowed(balance, slotsLeft, lastRound);

//         const raw = interaction.fields.getTextInputValue('amount').trim(); // modal field getter [web:91]
//         const bid = Number(raw);

//         if (!Number.isFinite(bid) || !Number.isInteger(bid) || bid < 1 || bid > maxBidAllowed) {
//             await interaction.reply({
//                 content: `Invalid bid. Enter an integer between 1 and ${maxBidAllowed}.`,
//                 flags: MessageFlags.Ephemeral,
//             });
//             return;
//         }

//         round.bids.set(userId, { amount: bid, isAuto: false, submittedAt: Date.now() });

//         await interaction.reply({ content: 'Bid received (final).', flags: MessageFlags.Ephemeral });

//         await postToAuctionChannel(auction, `<@${userId}> has placed their bid.`);

//         // If everyone has bid, finalize early
//         if (round.bids.size === auction.masters.size) {
//             if (round.timeoutHandle) clearTimeout(round.timeoutHandle);
//             await finalizeRound(auction, 'ALL_BIDS_IN');
//         }
//         return;
//     }
// });


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
}


// Handle slash command interactions
async function handleChatInputInteraction(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName !== 'auction') return;
    if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.reply(errorReplyBuilder({message: 'This command can only be used inside a server.'}));
        return;
    }
    if (!interaction.channelId) {
        await interaction.reply(errorReplyBuilder({message: 'This command can only be used inside a server channel.'}));
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
        subcommand === 'start'
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

    else if (subcommand === 'update-slave-specialties') {
        await updateSlaveSpecialties(interaction);
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

    else if (subcommand === 'set-auction-channel') {
        await setAuctionChannel(interaction);
    }

    else if (subcommand === 'start') {
        const auctionName = interaction.options.getString('auction_name', true);
        const auction = auctions.getByName(interaction.guildId, auctionName);
        if (!auction) {
            await interaction.reply({ content: `Auction "${auctionName}" not found.`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (auction.status !== 'OPEN') {
            await interaction.reply({ content: `Auction "${auctionName}" is not OPEN.`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (auction.masters.size < 2) {
            await interaction.reply({ content: 'Add at least 2 participants first.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (auction.slaves.size < 1) {
            await interaction.reply({ content: 'Add at least 1 player first.', flags: MessageFlags.Ephemeral });
            return;
        }

        auction.status = 'LIVE';

        const participantsCount = auction.masters.size;
        const playersCount = auction.slaves.size;

        const maxPurchasesPerParticipant = Math.ceil(playersCount / participantsCount);
        const participantIds = [...auction.masters.keys()]; // insertion order = initial priority

        auction.live = {
            startingBudget: 100,
            maxPurchasesPerParticipant,
            balances: new Map(participantIds.map(id => [id, 100] as const)),
            purchases: new Map(participantIds.map(id => [id, []] as const)),
            tiePriority: [...participantIds],
        };

        console.log(`[auction:start] ${auction.name} participants=${auction.masters.size} players=${auction.slaves.size}`);

        await interaction.reply(`Started auction **${auction.name}**. Beginning round 1...`);

        // Kick off first round
        await startNextRound(auction);
        return;
    }
}

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
        await handleAutocompleteInteraction(interaction);
    }

    else if (interaction.isChatInputCommand()) {
        await handleChatInputInteraction(interaction);
    }
});

client.login(process.env.DISCORD_TOKEN);