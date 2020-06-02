# tf2-automatic

A free and open source fully automated TF2 trading bot advertising on www.backpack.tf using prices from www.prices.tf

[![Build Status](https://img.shields.io/github/workflow/status/nicklason/tf2-automatic/CI/development)](https://github.com/Nicklason/tf2-automatic/actions)
[![GitHub issues](https://img.shields.io/github/issues/idinium96/tf2-automatic)](https://github.com/idinium96/tf2-automatic/issues)
[![GitHub forks](https://img.shields.io/github/forks/idinium96/tf2-automatic)](https://github.com/idinium96/tf2-automatic/network)
[![GitHub stars](https://img.shields.io/github/stars/idinium96/tf2-automatic)](https://github.com/idinium96/tf2-automatic/stargazers)
[![Discord](https://img.shields.io/discord/664971400678998016.svg)](https://discord.gg/ZrVT7mc)

Before you install the bot, there are a few things you need to have taken care off before you will be able to run the bot.

- You need a separate Steam account with a mobile authenticator. I suggest using the [Steam Desktop Authenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator) to authenticate the account and get the secret keys used to automate generating 2FA codes and managing mobile confirmations.
- NodeJS version 8 or more
- Typescript 3.7 or above

Please refer to the [wiki](https://github.com/Nicklason/tf2-automatic/wiki) for setting up the bot. For additional help and questions, please ask in the IdiNium's Trading Bot [Discord server](https://discord.gg/ZrVT7mc) or create an [issue](https://github.com/idinium96/tf2-automatic/issues/new/choose).

## Download and installation

You can clone or download the bot by clicking on the green button in the top right, follow the [installation guide](https://github.com/Nicklason/tf2-automatic/wiki/Installation) for more instructions.

## Configuration

Once you have downloaded the source and installed the necessary packages, you can move on to configuring the bot. Follow the [configuration guide](https://github.com/Nicklason/tf2-automatic/wiki/Configuration).


## Additional Configuration for Discord Webhook feature

If you want to use this feature, you must use [ecosystem.template.json](https://github.com/idinium96/tf2-automatic/blob/Public/ecosystem.template.json) from this version, which contains much more variables for you to fill in.

## Variables in ecosystem.json summary

### Your bot credentials
- STEAM_ACCOUNT_NAME: username that is used to login (preferably your bot/alt Steam account).
- STEAM_PASSWORD: your bot Steam account password.
- STEAM_SHARED_SECRET: you can found this in `<Your Bot SteamID64>.maFile` inside ~/SDA/maFiles (named `shared_secret`).
- STEAM_IDENTITY_SECRET: same as above (named `identity_secret`).

### Prices.TF token
- PRICESTF_API_TOKEN: You can leave this empty. No need at all.

### Backpack.tf token and API Key
You can run your bot without this first, which then on the first run, it will print out your bot backpack.tf access token and apiKey. You'll need to copy and paste it into your ecosystem.json or .env file, [see this image](https://cdn.discordapp.com/attachments/697415702637838366/697820077248086126/bptf-api-token.png), BUT if you want to find it yourself, then,
- BPTF_ACCESS_TOKEN: https://backpack.tf/connections and click on `Show Token` under User Token.
- BPTF_API_KEY: https://backpack.tf/developer/apikey/view - fill in site URL (`http://localhost:4566/tasks`) and comments (`Check if a user is banned on backpack.tf`).

### Your bot settings
- AUTOBUMP: If you don't have backpack.tf premium, then your bot will re-list all listings every 30 minutes.

- MINIMUM_SCRAP: [Number] Default is 9 scraps. If it has less, it will smelt reclaimed metal so your bot will have more than minimum scraps.
- MINIMUM_RECLAIMED: [Number] Default is 9 Reclaimed. Explained above.
- METAL_THRESHOLD: [Number] Default is 9, if scraps/reclaimed metal reached minimum + threshold (max), it will combine the metal.

- DISABLE_INVENTORY_SORT: [true or false] Default: true. Sort your bot inventory.
- DISABLE_LISTINGS: [true or false] Default: false. This is used if you want to temporarily disable trading while your bot is alive.
- DISABLE_MESSAGES: [true or false] Default: true. When true, people (that are friend with your bot) can send messages with "!message" command.
- DISABLE_QUEUE_ALERT: [true or false] - Default: true. My custom - Used to notify owner if your bot has a queue problem, which you'll need to restart your bot.

- TRADES_MADE_STARTER_VALUE: [Number] - Used mainly for displaying your bot total trades made, found in your bot Steam Profile page.
- LAST_TOTAL_TRADES: [Number] - Used if your polldata.json is getting bigger which consumed a lot of RAM, but you want to keep total successful trades that your bot has made.
- TRADING_STARTING_TIME_UNIX: [Number - Unix format] - Also same as LAST_TOTAL_TRADES, but this one is the latest time. You can read more on my [Discord server post](https://discordapp.com/channels/664971400678998016/666909518604533760/707706994932449410).

- ENABLE_SHOW_ONLY_METAL: [true or false] - Default: true. My custom - If set to false, it will show [x keys, y ref].
- ENABLE_DUPE_CHECK: [true or false] - Default: true. Used to enable/disable check on duped unusuals
- DECLINE_DUPES: [true or false] - Default: false. Explained itself.
- MINIMUM_KEYS_DUPE_CHECK: [Number] - Default: 10. Explained itself.

- SKIP_BPTF_TRADEOFFERURL: [true or false] - Default: true. Not sure why this thing might not work. Please add trade offer URL by yourself [here](https://backpack.tf/settings##general) (login as your bot Steam account).
- SKIP_ACCOUNT_LIMITATIONS: [true or false] - Default: false. Used to check your account limitation. It's better to set to true if your bot Steam account already a [premium account](https://support.steampowered.com/kb_article.php?ref=3330-IAGK-7663).
- SKIP_UPDATE_PROFILE_SETTINGS: [true or false] - Default: false. This is just set your bot profile to public, so backpack.tf can load your bot inventory and etc correctly. If you already set all to public, just set this to true.

- ALLOW_ESCROW: [true or false] - Default: false. Escrow = trade hold
- ALLOW_OVERPAY: [true or false] - Default: true. If people give an overpay, your bot will accept. Set it to false if you don't want.
- ALLOW_BANNED: [true or false] - Default: false. I think it's better to set as false.
- MAX_PRICE_AGE: [Number - in seconds] - Default: 28800 - If the time recorded in your pricelist reach/more than this, it will triggered to check with prices.tf.

- ADMINS: [Array] - Put your main SteamID64. Example - `["76561198013127982"]`, if you have multiple, `["76561198013127982", "76561198077208792"]`
- KEEP: [Array] - Same as ADMINS, you must fill in BOTH.
- GROUPS: [Array] - If you have Steam group, find your group ID and paste it here.
- ALERTS: [Array] - If you set to `["trade"]`, your bot will send message/discord webhook every time a successful trades were made, other option is `["none"]`.

- DEBUG: [true or false] - Used to debug if any problem occured.
- DEBUG_FILE: [true or false] - Same as above, but this will create a file which can be sent to [issue](https://github.com/idinium96/tf2-automatic/issues/new/choose).

- BPTF_DETAILS_BUY: [string] - Your buy order message. It will do for all items. available parameters: %name% (print out item name), %price% (item current buying price), %current_stock%, %max_stock% and %keyPrice% (print out: `Key rate: x ref/key`).
- BPTF_DETAILS_SELL [string] - Same as buy order, except have %amount_trade% parameter.
- OFFER_MESSAGE: [string] - Message that will appear when bot sends offer to trade partner.

### Discord Webhook Configuration
- DISCORD_OWNER_ID - Right click on yourself and click `Copy ID` and paste here.
- DISCORD_WEBHOOK_USERNAME - Your Discord Webhook name, example: ※Fumino⚡
- DISCORD_WEBHOOK_AVATAR_URL - Your Discord Webhook Avatar, must be in URL form.
- DISCORD_WEBHOOK_EMBED_COLOR_IN_DECIMAL_INDEX - Embed color, you can found yours at [spycolor.com](https://www.spycolor.com/) and copy the one that said "has decimal index of: `take the value here`"
- TIMEZONE - Please only use these [Timezone Format](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), for example "Asia/Kuala_Lumpur".

- DISABLE_DISCORD_WEBHOOK_QUEUE_ALERT: [true or false] - Same as `DISABLE_QUEUE_ALERT`, but if set to false, it will be sent to Discord Webhook instead of Steam Chat.
- DISCORD_WEBHOOK_QUEUE_ALERT_URL - Discord Webhook URL for QUEUE_ALERT.

- DISABLE_DISCORD_WEBHOOK_PRICE_UPDATE: [true or false] - Used to display price updates on the items that are in your pricelist.
- DISCORD_WEBHOOK_PRICE_UPDATE_URL - Discord Webhook URL for PRICE_UPDATE.
- DISCORD_WEBHOOK_PRICE_UPDATE_ADDITIONAL_DESCRIPTION_NOTE - You can add note there, or just leave it empty.

- DISABLE_DISCORD_WEBHOOK_TRADE_SUMMARY: [true or false] - Used to display every successful trade summary on your trade summary/live-trades channel. If set to false, it will send to your Steam Chat.
- DISCORD_WEBHOOK_TRADE_SUMMARY_URL - Discord Webhook URL for TRADE_SUMMARY.
- DISCORD_WEBHOOK_TRADE_SUMMARY_ADDITIONAL_DESCRIPTION_NOTE - Notes.
- DISCORD_WEBHOOK_TRADE_SUMMARY_MENTION_OWNER [true or false] - Set it to true if you want your bot to mention on every successful trades.

- DISABLE_DISCORD_WEBHOOK_OFFER_REVIEW: [true or false] - Used to alert you on the trade that needs for offer review via Discord Webhook. If set to false, it will send to your Steam Chat.
- DISCORD_WEBHOOK_REVIEW_OFFER_URL - Discord Webhook URL for REVIEW_OFFER.

- DISABLE_DISCORD_WEBHOOK_MESSAGE_FROM_PARTNER: [true or false] - Used to alert you on any messages sent from trade partner. If set to false, it will send to your Steam Chat.
- DISCORD_WEBHOOK_MESSAGE_FROM_PARTNER_URL - Discord Webhook URL for MESSAGE_FROM_PARTNER.

### Manual Review settings
- ENABLE_MANUAL_REVIEW: [true or false] - Set to true if you want any INVALID_VALUE/INVALID_ITEMS/OVERSTOCKED/DUPED_ITEMS/DUPE_CHECK_FAILED trades to be reviewed by you.
- DISABLE_REVIEW_OFFER_NOTE: [true or false] - If set to true, it will show note on [each error](https://github.com/idinium96/tf2-automatic/blob/Public/src/classes/MyHandler.ts#L906-L934)
- INVALID_VALUE_NOTE - Your custom INVALID_VALUE note.
- INVALID_ITEMS_NOTE - Your custom INVALID_ITEMS note.
- OVERSTOCKED_NOTE - Your custom OVERSTOCKED note.
- DUPE_ITEMS_NOTE - Your custom DUPE_ITEMS note.
- DUPE_CHECK_FAILED_NOTE - Your custom DUPE_CHECK_FAILED note.
- ADDITIONAL_NOTE - Your custom ADDITIONAL note.

### Others
- CUSTOM_WELCOME_MESSAGE - Your custom WELCOME_MESSAGE note.
- CUSTOM_I_DONT_KNOW_WHAT_YOU_MEAN - Your custom note when people sends wrong command.
- CUSTOM_HOW2TRADE_MESSAGE - Your custom HOW2TRADE note.

- CUSTOM_SUCCESS_MESSAGE - Your custom SUCCESS note.
- CUSTOM_DECLINED_MESSAGE - Your custom DECLINED note.
- CUSTOM_TRADED_AWAY_MESSAGE - Your custom TRADED_AWAY note.
- CUSTOM_CLEARING_FRIENDS_MESSAGE
