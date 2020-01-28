import SteamUser from 'steam-user';
import SteamTradeOfferManager from 'steam-tradeoffer-manager';
import SteamID from 'steamid';
import { OptionsWithUri } from 'request';
import { UnknownDictionary } from '../types/common';

import Bot from './Bot';

import request from '@nicklason/request-retry';

export = class Friends {
    private readonly bot: Bot;
    maxFriends: number;

    constructor (bot: Bot) {
        this.bot = bot;
    }

    getFriend (steamID: SteamID|string) {
        const steamID64 = steamID.toString();

        const friend = this.bot.client.users[steamID64];

        if (friend === undefined) {
            return null;
        }

        return friend;
    }

    isFriend (steamID: SteamID|string): boolean {
        const steamID64 = steamID.toString();

        const relation = this.bot.client.myFriends[steamID64];

        return relation === SteamUser.EFriendRelationship.Friend;
    }

    getFriends (): string[] {
        const friends: string[] = [];

        for (const steamID64 in this.bot.client.myFriends) {
            if (!Object.prototype.hasOwnProperty.call(this.bot.client.myFriends, steamID64)) {
                continue;
            }

            if (this.isFriend(steamID64)) {
                friends.push(steamID64);
            }
        }

        return friends;
    }

    getMaxFriends (): Promise<number> {
        const options: OptionsWithUri = {
            uri: 'https://api.steampowered.com/IPlayerService/GetBadges/v1/',
            method: 'GET',
            json: true,
            gzip: true,
            qs: {
                key: this.bot.manager.apiKey,
                steamid: this.bot.client.steamID.getSteamID64()
            }
        };

        return new Promise((resolve, reject) => {
            request(options, (err: Error|null, response, body: UnknownDictionary<any>) => {
                if (err) {
                    return reject(err);
                }
        
                const result = body.response;
                const level = result.player_level;
        
                const base = 250;
                const multiplier = 5;
        
                this.maxFriends = base + level * multiplier;

                resolve(this.maxFriends);
            });
        });
    }
}
