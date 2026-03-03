import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import type { GuildConfigStore } from '../store/guildConfigStore.js';

function roleIdsFromInteractionMember(member: ChatInputCommandInteraction['member']): string[] {
  const m: any = member;
  if (!m) return [];
  if (Array.isArray(m.roles)) return m.roles;           // APIInteractionGuildMember: roles is string[]
  if (m.roles?.cache) return [...m.roles.cache.keys()]; // GuildMember: roles.cache is a Collection
  return [];
}

export async function requireAuctionAdmin(
  interaction: ChatInputCommandInteraction,
  guildConfigs: GuildConfigStore,
): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return false;
  }

  const perms = interaction.memberPermissions;
  const isServerAdmin =
    !!perms?.has(PermissionFlagsBits.Administrator) ||
    !!perms?.has(PermissionFlagsBits.ManageGuild);

  const configuredRoleId = guildConfigs.getAdminRoleId(interaction.guildId);

  // Until configured, allow server admins to run setup commands
  if (!configuredRoleId) {
    // if (isServerAdmin) return true;

    await interaction.reply({
      content: 'Auction admin role is not configured yet. Ask a server admin to run `/auction set-admin-role`.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  const roleIds = roleIdsFromInteractionMember(interaction.member);
  if (roleIds.includes(configuredRoleId) || isServerAdmin) return true;

  await interaction.reply({
    content: 'You are not allowed to run auction admin commands in this server.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}