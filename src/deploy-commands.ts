import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;

const commands = [
  new SlashCommandBuilder()
  .setName('auction')
  .setDescription('Auction commands')
  .addSubcommand(sub =>
    sub
      .setName('set-admin-role')
      .setDescription('Configure which role can manage auctions in this server')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Pick an existing role from this server').setRequired(true),
      ),
  )
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
      .setName('add-slave')
      .setDescription('Add a player to the slave pool')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('player').setDescription('Select a user to enslave').setRequired(true),
      )
      .addStringOption(opt =>
        opt.setName('specialty').setDescription('Specify what this slave does best').setRequired(true).setChoices([
          { name: 'Base Builder', value: 'Base Builder' },
          { name: 'Attacker', value: 'Attacker' },
          { name: 'All Rounder', value: 'All Rounder' },
          { name: 'Water Boy', value: 'Water Boy' },
        ]),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('update-slave-specialty')
      .setDescription('Update the specialty of a slave')
      .addUserOption(opt =>
        opt.setName('slave').setDescription('Select the slave').setRequired(true),
      )
      .addStringOption(opt =>
        opt.setName('specialty').setDescription('Specify what this slave does best').setRequired(true).setChoices([
          { name: 'Base Builder', value: 'Base Builder' },
          { name: 'Attacker', value: 'Attacker' },
          { name: 'All Rounder', value: 'All Rounder' },
          { name: 'Water Boy', value: 'Water Boy' },
        ]),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('add-master')
      .setDescription('Add a player to the bidder pool')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt
          .setName('player')
          .setDescription('Select a user')
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-slave')
      .setDescription('Remove a player from the slave pool')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('slave').setDescription('Free a slave').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-master')
      .setDescription('Remove a player from the bidder pool')
      .addStringOption(opt =>
        opt.setName('auction_name').setDescription('Auction name').setRequired(true).setAutocomplete(true),
      )
      .addUserOption(opt =>
        opt.setName('master').setDescription('Pick a master').setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('start')
      .setDescription('Start the auction')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(opt =>
        opt
          .setName('priority_order')
          .setDescription("A comma-separated list of Discord user IDs, representing the priority order for breaking ties")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(opt =>
        opt
          .setName('priority_type')
          .setDescription('Type of priority order')
          .setRequired(false)
          .setChoices([
            { name: 'Fixed (default)', value: 'fixed' },
            { name: 'Rotating', value: 'rotating' },
          ])
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('reset')
      .setDescription('Reset an auction to its initial state (all purchases will be reverted)')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('start-next-round')
      .setDescription('Start the next round of an auction')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addUserOption(opt =>
        opt
          .setName('nominated_slave')
          .setDescription('Pick a slave to be nominated for this round')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('cancel-current-round')
      .setDescription('Interrupt the currently active round')
      .addStringOption(opt =>
        opt
          .setName('auction_name')
          .setDescription('Auction name')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  const guilds = (await rest.get(Routes.userGuilds())) as Array<{ id: string; name: string }>;

  if (guilds.length === 0) {
    console.log('Bot is not in any guilds. No commands were registered.');
    return;
  }

  let successCount = 0;

  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: commands });
      successCount += 1;
      console.log(`Registered /auction commands in "${guild.name}" (${guild.id}).`);
    } catch (error) {
      console.error(`Failed to register commands in "${guild.name}" (${guild.id}).`, error);
    }
  }

  console.log(`Finished command deployment. Registered in ${successCount}/${guilds.length} guild(s).`);
})();