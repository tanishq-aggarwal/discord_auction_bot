# Discord Auction Bot

A Discord.js bot for creating and running multi-round player auctions.

## Requirements

- Node.js 20.20.1 or newer
- pnpm 10
- A Discord application and bot token

Copy `.env.example` to `.env` and set:

- `DISCORD_TOKEN`: bot token used at runtime and when deploying commands.
- `CLIENT_ID`: Discord application ID used by `deploy:commands`.
- `GUILD_ID` (optional): deploy commands to one guild. Without it, deployment targets every guild visible to the bot.
- `STATE_PATH` (optional): JSON state path. Defaults to `data/auction-bot.json`.

`SQLITE_PATH` is accepted as a deprecated fallback for existing deployments, although persistence is JSON rather than SQLite.

## Commands

```sh
pnpm install
pnpm deploy:commands
pnpm dev
```

For production:

```sh
pnpm start
```

## Verification

```sh
pnpm check
```

This runs TypeScript, ESLint, Prettier, and the domain/persistence tests.

## Persistence and deployment

The bot writes one versioned JSON document using a temporary file and atomic rename. Before replacement, the previous primary file is copied to `<STATE_PATH>.bak`; a valid backup is loaded if the primary file is corrupt.

Back up the ignored `data/` directory outside Git. Run only one bot process against a given state path. The file backend does not coordinate multiple processes.

Rounds active during a restart are restored and their deadlines are rescheduled when Discord reconnects. An expired deadline finalizes immediately after startup.

## Auction policies

- Auctions start as **manual** or **random** nomination. Use `/auction start-next-round` for manual auctions and `/auction start-next-random-round` for random auctions.
- Manual auctions let an admin pick the nominated slave and nominating master. Random auctions pick an unpurchased slave and nominate on behalf of the next master in the internal starting-order cursor, unless `nominated_by` overrides that master.
- The obligated master must still have remaining purchase slots and must bid at least one coin.
- Random auctions do not announce the next nominator. Manual auctions still do.
- Fixed tie priority never changes. Rotating tie priority advances after completed rounds.
- Updating a slave specialty changes that user in every auction in the current Discord server.
