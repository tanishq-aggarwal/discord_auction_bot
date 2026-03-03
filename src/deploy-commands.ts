import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;
const guildId = process.env.GUILD_ID!;

const commands = [
  new SlashCommandBuilder()
  .setName('auction')
  .setDescription('Auction commands')
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription('Create a new auction')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Name of the auction').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('add-player')
      .setDescription('Add a server member to the auction player pool')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('player').setDescription('Pick the player (server member)').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('add-participant')
      .setDescription('Add a participant to an auction')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt
          .setName('participant')
          .setDescription('Pick the participant (server member)')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('set-admin-role')
      .setDescription('Set which role can manage auctions in this server')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Admin role for auction commands').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-player')
      .setDescription('Remove a player from the auction player pool')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('player').setDescription('Player to remove').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-participant')
      .setDescription('Remove a participant from the auction')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('participant').setDescription('Participant to remove').setRequired(true),
      ),
  )
  .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Registered /auction commands in the test guild.');
})();