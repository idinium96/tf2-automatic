import Handler from './Handler';
import Bot from './Bot';
import { Entry, EntryData } from './Pricelist';
import Commands from './Commands';
import CartQueue from './CartQueue';
import Inventory from './Inventory';
import { UnknownDictionary } from '../types/common';
import { Currency } from '../types/TeamFortress2';

import SteamUser from 'steam-user';
import TradeOfferManager, { TradeOffer, PollData } from 'steam-tradeoffer-manager';
import pluralize from 'pluralize';
import SteamID from 'steamid';
import Currencies from 'tf2-currencies';
import SKU from 'tf2-sku';
import async from 'async';

import { XMLHttpRequest } from 'xmlhttprequest-ts';
import moment from 'moment-timezone';

import log from '../lib/logger';
import * as files from '../lib/files';
import paths from '../resources/paths';
import { parseJSON, exponentialBackoff } from '../lib/helpers';
import TF2Inventory from './TF2Inventory';

export = class MyHandler extends Handler {
    private readonly commands: Commands;

    readonly cartQueue: CartQueue;

    private groups: string[] = [];

    private friendsToKeep: string[] = [];

    private minimumScrap = 9;

    private minimumReclaimed = 9;

    private combineThreshold = 9;

    private dupeCheckEnabled = false;

    private minimumKeysDupeCheck = 0;

    recentlySentMessage: UnknownDictionary<number> = {};

    constructor(bot: Bot) {
        super(bot);

        this.commands = new Commands(bot);
        this.cartQueue = new CartQueue(bot);

        const minimumScrap = parseInt(process.env.MINIMUM_SCRAP);
        const minimumReclaimed = parseInt(process.env.MINIMUM_RECLAIMED);
        const combineThreshold = parseInt(process.env.METAL_THRESHOLD);

        if (!isNaN(minimumScrap)) {
            this.minimumScrap = minimumScrap;
        }

        if (!isNaN(minimumReclaimed)) {
            this.minimumReclaimed = minimumReclaimed;
        }

        if (!isNaN(combineThreshold)) {
            this.combineThreshold = combineThreshold;
        }

        if (process.env.ENABLE_DUPE_CHECK === 'true') {
            this.dupeCheckEnabled = true;
        }

        const minimumKeysDupeCheck = parseInt(process.env.MINIMUM_KEYS_DUPE_CHECK);
        if (!isNaN(minimumKeysDupeCheck)) {
            this.minimumKeysDupeCheck = minimumKeysDupeCheck;
        }

        const groups = parseJSON(process.env.GROUPS);
        if (groups !== null && Array.isArray(groups)) {
            groups.forEach(function(groupID64) {
                if (!new SteamID(groupID64).isValid()) {
                    throw new Error(`Invalid group SteamID64 "${groupID64}"`);
                }
            });

            this.groups = groups;
        }

        const friendsToKeep = parseJSON(process.env.KEEP).concat(this.bot.getAdmins());
        if (friendsToKeep !== null && Array.isArray(friendsToKeep)) {
            friendsToKeep.forEach(function(steamID64) {
                if (!new SteamID(steamID64).isValid()) {
                    throw new Error(`Invalid SteamID64 "${steamID64}"`);
                }
            });

            this.friendsToKeep = friendsToKeep;
        }

        setInterval(() => {
            this.recentlySentMessage = {};
        }, 1000);
    }

    hasDupeCheckEnabled(): boolean {
        return this.dupeCheckEnabled;
    }

    getMinimumKeysDupeCheck(): number {
        return this.minimumKeysDupeCheck;
    }

    onRun(): Promise<{
        loginAttempts?: number[];
        pricelist?: EntryData[];
        loginKey?: string;
        pollData?: PollData;
    }> {
        return Promise.all([
            files.readFile(paths.files.loginKey, false),
            files.readFile(paths.files.pricelist, true),
            files.readFile(paths.files.loginAttempts, true),
            files.readFile(paths.files.pollData, true)
        ]).then(function([loginKey, pricelist, loginAttempts, pollData]) {
            return { loginKey, pricelist, loginAttempts, pollData };
        });
    }

    onReady(): void {
        log.info(
            'tf2-automatic v' +
                process.env.BOT_VERSION +
                ' is ready! ' +
                pluralize('item', this.bot.pricelist.getLength(), true) +
                ' in pricelist, ' +
                pluralize('listing', this.bot.listingManager.listings.length, true) +
                ' on www.backpack.tf (cap: ' +
                this.bot.listingManager.cap +
                ')'
        );

        this.bot.client.gamesPlayed(['tf2-automatic', 440]);
        this.bot.client.setPersona(SteamUser.EPersonaState.Online);

        // Smelt / combine metal if needed
        this.keepMetalSupply();

        // Sort the inventory after crafting / combining metal
        this.sortInventory();

        // Check friend requests that we got while offline
        this.checkFriendRequests();

        // Check group invites that we got while offline
        this.checkGroupInvites();

        // Set up autorelist if enabled in environment variable
        this.bot.listings.setupAutorelist();
    }

    onShutdown(): Promise<void> {
        return new Promise(resolve => {
            if (this.bot.listingManager.ready !== true) {
                // We have not set up the listing manager, don't try and remove listings
                return resolve();
            }

            this.bot.listings.removeAll().asCallback(function(err) {
                if (err) {
                    log.warn('Failed to remove all listings: ', err);
                }

                resolve();
            });
        });
    }

    onLoggedOn(): void {
        if (this.bot.isReady()) {
            this.bot.client.setPersona(SteamUser.EPersonaState.Online);
            this.bot.client.gamesPlayed(['tf2-automatic', 440]);
        }
    }

    onMessage(steamID: SteamID, message: string): void {
        const steamID64 = steamID.toString();

        if (!this.bot.friends.isFriend(steamID64)) {
            return;
        }

        const friend = this.bot.friends.getFriend(steamID64);

        if (friend === null) {
            log.info(`Message from ${steamID64}: ${message}`);
        } else {
            log.info(`Message from ${friend.player_name} (${steamID64}): ${message}`);
        }

        if (this.recentlySentMessage[steamID64] !== undefined && this.recentlySentMessage[steamID64] >= 1) {
            return;
        }

        this.recentlySentMessage[steamID64] = this.recentlySentMessage[steamID64] + 1;

        this.commands.processMessage(steamID, message);
    }

    onLoginKey(loginKey: string): void {
        log.debug('New login key');

        files.writeFile(paths.files.loginKey, loginKey, false).catch(function(err) {
            log.warn('Failed to save login key: ', err);
        });
    }

    onLoginError(err: Error): void {
        // @ts-ignore
        if (err.eresult === SteamUser.EResult.InvalidPassword) {
            files.deleteFile(paths.files.loginKey).catch(err => {
                log.warn('Failed to delete login key: ', err);
            });
        }
    }

    onLoginAttempts(attempts: number[]): void {
        files.writeFile(paths.files.loginAttempts, attempts, true).catch(function(err) {
            log.warn('Failed to save login attempts: ', err);
        });
    }

    onFriendRelationship(steamID: SteamID, relationship: number): void {
        if (relationship === SteamUser.EFriendRelationship.Friend) {
            this.onNewFriend(steamID);
            this.checkFriendsCount(steamID);
        } else if (relationship === SteamUser.EFriendRelationship.RequestRecipient) {
            this.respondToFriendRequest(steamID);
        }
    }

    onGroupRelationship(groupID: SteamID, relationship: number): void {
        log.debug('Group relation changed', { steamID: groupID, relationship: relationship });
        if (relationship === SteamUser.EClanRelationship.Invited) {
            const join = !this.groups.includes(groupID.getSteamID64());

            log.info(`Got invited to group ${groupID.getSteamID64()}, ${join ? 'accepting...' : 'declining...'}`);
            this.bot.client.respondToGroupInvite(groupID, !this.groups.includes(groupID.getSteamID64()));
        } else if (relationship === SteamUser.EClanRelationship.Member) {
            log.info(`Joined group ${groupID.getSteamID64()}`);
        }
    }

    onBptfAuth(auth: { apiKey: string; accessToken: string }): void {
        const details = Object.assign({ private: true }, auth);

        log.warn('Please add the backpack.tf API key and access token to the environment variables!', details);
    }

    async onNewTradeOffer(
        offer: TradeOffer
    ): Promise<null | {
        action: 'accept' | 'decline' | 'skip';
        reason: string;
        meta?: UnknownDictionary<any>;
    }> {
        offer.log('info', 'is being processed...');

        // Allow sending notifications
        offer.data('notify', true);

        const ourItems = Inventory.fromItems(
            this.bot.client.steamID,
            offer.itemsToGive,
            this.bot.manager,
            this.bot.schema
        );

        const theirItems = Inventory.fromItems(offer.partner, offer.itemsToReceive, this.bot.manager, this.bot.schema);

        const items = {
            our: ourItems.getItems(),
            their: theirItems.getItems()
        };

        const exchange = {
            contains: { items: false, metal: false, keys: false },
            our: { value: 0, keys: 0, scrap: 0, contains: { items: false, metal: false, keys: false } },
            their: { value: 0, keys: 0, scrap: 0, contains: { items: false, metal: false, keys: false } }
        };

        const itemsDict = { our: {}, their: {} };

        const states = [false, true];

        let hasInvalidItems = false;

        for (let i = 0; i < states.length; i++) {
            const buying = states[i];
            const which = buying ? 'their' : 'our';

            for (const sku in items[which]) {
                if (!Object.prototype.hasOwnProperty.call(items[which], sku)) {
                    continue;
                }

                if (sku === 'unknown') {
                    // Offer contains an item that is not from TF2
                    hasInvalidItems = true;
                }

                if (sku === '5000;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5001;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5002;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5021;6') {
                    exchange.contains.keys = true;
                    exchange[which].contains.keys = true;
                } else {
                    exchange.contains.items = true;
                    exchange[which].contains.items = true;
                }

                const amount = items[which][sku].length;

                itemsDict[which][sku] = amount;
            }
        }

        offer.data('dict', itemsDict);

        // Check if the offer is from an admin
        if (this.bot.isAdmin(offer.partner)) {
            offer.log('trade', `is from an admin, accepting. Summary:\n${offer.summarize(this.bot.schema)}`);
            return { action: 'accept', reason: 'ADMIN' };
        }

        if (hasInvalidItems) {
            // Using boolean because items dict always needs to be saved
            offer.log('info', 'contains items not from TF2, declining...');
            return { action: 'decline', reason: '🟨INVALID_ITEMS_CONTAINS_NON_TF2' };
        }

        const itemsDiff = offer.getDiff();

        const offerMessage = offer.message.toLowerCase();

        if (
            offer.itemsToGive.length === 0 &&
            (offerMessage.includes('gift') ||
            offerMessage.includes('donat') || // So that 'donate' or 'donation' will also be accepted
            offerMessage.includes('tip') || // All others are synonyms
            offerMessage.includes('tribute') ||
            offerMessage.includes('souvenir') ||
            offerMessage.includes('favor') ||
            offerMessage.includes('giveaway') ||
            offerMessage.includes('bonus') ||
            offerMessage.includes('grant') ||
            offerMessage.includes('bounty') ||
            offerMessage.includes('present') ||
            offerMessage.includes('contribution') ||
            offerMessage.includes('award') ||
            offerMessage.includes('nice') || // Up until here actually
            offerMessage.includes('happy') || // All below people might also use
            offerMessage.includes('thank') ||
            offerMessage.includes('goo') || // For 'good', 'goodie' or anything else
                offerMessage.includes('awesome') ||
                offerMessage.includes('rep') ||
                offerMessage.includes('joy') ||
                offerMessage.includes('cute')) // right?
        ) {
            offer.log('trade', `is a gift offer, accepting. Summary:\n${offer.summarize(this.bot.schema)}`);
            return { action: 'accept', reason: 'GIFT' };
        } else if (offer.itemsToReceive.length === 0 || offer.itemsToGive.length === 0) {
            offer.log('info', 'is a gift offer, declining...');
            return { action: 'decline', reason: 'GIFT' };
        }

        const manualReviewEnabled = process.env.ENABLE_MANUAL_REVIEW !== 'false';

        const itemPrices = {};

        const keyPrice = this.bot.pricelist.getKeyPrice();

        let hasOverstock = false;

        // A list of things that is wrong about the offer and other information
        const wrongAboutOffer: (
            | {
                  reason: '🟦OVERSTOCKED';
                  sku: string;
                  buying: boolean;
                  diff: number;
                  amountCanTrade: number;
              }
            | {
                  reason: '🟨INVALID_ITEMS';
                  sku: string;
                  buying: boolean;
                  amount: number;
              }
            | {
                  reason: '🟥INVALID_VALUE';
                  our: number;
                  their: number;
              }
            | {
                  reason: '🟪DUPE_CHECK_FAILED';
                  assetid?: string;
                  error?: string;
              }
            | {
                  reason: '🟫DUPED_ITEMS';
                  assetid: string;
              }
        )[] = [];

        let assetidsToCheck = [];

        offer.data('prices', itemPrices);

        for (let i = 0; i < states.length; i++) {
            const buying = states[i];
            const which = buying ? 'their' : 'our';
            const intentString = buying ? 'buy' : 'sell';

            for (const sku in items[which]) {
                if (!Object.prototype.hasOwnProperty.call(items[which], sku)) {
                    continue;
                }

                const assetids = items[which][sku];
                const amount = assetids.length;

                if (sku === '5000;6') {
                    exchange[which].value += amount;
                    exchange[which].scrap += amount;
                } else if (sku === '5001;6') {
                    const value = 3 * amount;
                    exchange[which].value += value;
                    exchange[which].scrap += value;
                } else if (sku === '5002;6') {
                    const value = 9 * amount;
                    exchange[which].value += value;
                    exchange[which].scrap += value;
                } else {
                    const match = this.bot.pricelist.getPrice(sku, true);

                    // TODO: Go through all assetids and check if the item is being sold for a specific price

                    if (match !== null && (sku !== '5021;6' || !exchange.contains.items)) {
                        // If we found a matching price and the item is not a key, or the we are not trading items (meaning that we are trading keys) then add the price of the item

                        // Add value of items
                        exchange[which].value += match[intentString].toValue(keyPrice.metal) * amount;
                        exchange[which].keys += match[intentString].keys * amount;
                        exchange[which].scrap += Currencies.toScrap(match[intentString].metal) * amount;

                        itemPrices[match.sku] = {
                            buy: match.buy,
                            sell: match.sell
                        };

                        // Check stock limits (not for keys)
                        const diff = itemsDiff[sku];

                        const buyingOverstockCheck = diff > 0;
                        const amountCanTrade = this.bot.inventoryManager.amountCanTrade(sku, buyingOverstockCheck);

                        if (diff !== 0 && amountCanTrade < diff) {
                            // User is taking too many / offering too many
                            hasOverstock = true;

                            wrongAboutOffer.push({
                                reason: '🟦OVERSTOCKED',
                                sku: sku,
                                buying: buyingOverstockCheck,
                                diff: diff,
                                amountCanTrade: amountCanTrade
                            });
                        }

                        const item = SKU.fromString(sku);

                        if (
                            item.effect !== null &&
                            match.buy.toValue(keyPrice.metal) > this.minimumKeysDupeCheck * keyPrice.toValue()
                        ) {
                            assetidsToCheck = assetidsToCheck.concat(assetids);
                        }
                    } else if (sku === '5021;6' && exchange.contains.items) {
                        // Offer contains keys and we are not trading keys, add key value
                        exchange[which].value += keyPrice.toValue() * amount;
                        exchange[which].keys += amount;
                    } else if (match === null || match.intent === (buying ? 1 : 0)) {
                        // Offer contains an item that we are not trading
                        hasInvalidItems = true;

                        wrongAboutOffer.push({
                            reason: '🟨INVALID_ITEMS',
                            sku: sku,
                            buying: buying,
                            amount: amount
                        });
                    }
                }
            }
        }

        // Doing this so that the prices will always be displayed as only metal
        if (process.env.ENABLE_SHOW_ONLY_METAL === 'true') {
            exchange.our.scrap += exchange.our.keys * keyPrice.toValue();
            exchange.our.keys = 0;
            exchange.their.scrap += exchange.their.keys * keyPrice.toValue();
            exchange.their.keys = 0;
        }

        offer.data('value', {
            our: {
                total: exchange.our.value,
                keys: exchange.our.keys,
                metal: Currencies.toRefined(exchange.our.scrap)
            },
            their: {
                total: exchange.their.value,
                keys: exchange.their.keys,
                metal: Currencies.toRefined(exchange.their.scrap)
            },
            rate: keyPrice.metal
        });

        if (exchange.contains.metal && !exchange.contains.keys && !exchange.contains.items) {
            // Offer only contains metal
            offer.log('info', 'only contains metal, declining...');
            return { action: 'decline', reason: 'ONLY_METAL' };
        } else if (exchange.contains.keys && !exchange.contains.items) {
            // Offer is for trading keys, check if we are trading them
            const priceEntry = this.bot.pricelist.getPrice('5021;6', true);
            if (priceEntry === null) {
                // We are not trading keys
                offer.log('info', 'we are not trading keys, declining...');
                return { action: 'decline', reason: 'NOT_TRADING_KEYS' };
            } else if (exchange.our.contains.keys && priceEntry.intent !== 1 && priceEntry.intent !== 2) {
                // We are not selling keys
                offer.log('info', 'we are not selling keys, declining...');
                return { action: 'decline', reason: 'NOT_TRADING_KEYS' };
            } else if (exchange.their.contains.keys && priceEntry.intent !== 0 && priceEntry.intent !== 2) {
                // We are not buying keys
                offer.log('info', 'we are not buying keys, declining...');
                return { action: 'decline', reason: 'NOT_TRADING_KEYS' };
            } else {
                // Check overstock / understock on keys
                const diff = itemsDiff['5021;6'];
                // If the diff is greater than 0 then we are buying, less than is selling

                const buying = diff > 0;
                const amountCanTrade = this.bot.inventoryManager.amountCanTrade('5021;6', buying);

                if (diff !== 0 && amountCanTrade < diff) {
                    // User is taking too many / offering too many
                    hasOverstock = true;
                    wrongAboutOffer.push({
                        reason: '🟦OVERSTOCKED',
                        sku: '5021;6',
                        buying: buying,
                        diff: diff,
                        amountCanTrade: amountCanTrade
                    });
                }
            }
        }

        let hasInvalidValue = false;
        if (exchange.our.value > exchange.their.value) {
            // Check if the values are correct
            hasInvalidValue = true;
            wrongAboutOffer.push({
                reason: '🟥INVALID_VALUE',
                our: exchange.our.value,
                their: exchange.their.value
            });
        }

        if (!manualReviewEnabled) {
            if (hasOverstock) {
                offer.log('info', 'is taking / offering too many, declining...');

                const reasons = wrongAboutOffer.map(wrong => wrong.reason);
                const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

                return {
                    action: 'decline',
                    reason: '🟦OVERSTOCKED',
                    meta: {
                        uniqueReasons: uniqueReasons,
                        reasons: wrongAboutOffer
                    }
                };
            }

            if (hasInvalidValue) {
                // We are offering more than them, decline the offer
                offer.log('info', 'is not offering enough, declining...');

                const reasons = wrongAboutOffer.map(wrong => wrong.reason);
                const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

                return {
                    action: 'decline',
                    reason: '🟥INVALID_VALUE',
                    meta: {
                        uniqueReasons: uniqueReasons,
                        reasons: wrongAboutOffer
                    }
                };
            }
        }

        if (exchange.our.value < exchange.their.value && process.env.ALLOW_OVERPAY === 'false') {
            offer.log('info', 'is offering more than needed, declining...');
            return { action: 'decline', reason: 'OVERPAY' };
        }

        // TODO: If we are receiving items, mark them as pending and use it to check overstock / understock for new offers

        offer.log('info', 'checking escrow...');

        try {
            const hasEscrow = await this.bot.checkEscrow(offer);

            if (hasEscrow) {
                offer.log('info', 'would be held if accepted, declining...');
                return { action: 'decline', reason: 'ESCROW' };
            }
        } catch (err) {
            log.warn('Failed to check escrow: ', err);
            return;
        }

        offer.log('info', 'checking bans...');

        try {
            const isBanned = await this.bot.checkBanned(offer.partner.getSteamID64());

            if (isBanned) {
                offer.log('info', 'partner is banned in one or more communities, declining...');
                return { action: 'decline', reason: 'BANNED' };
            }
        } catch (err) {
            log.warn('Failed to check banned: ', err);
            return;
        }

        if (this.dupeCheckEnabled && assetidsToCheck.length > 0) {
            offer.log('info', 'checking ' + pluralize('item', assetidsToCheck.length, true) + ' for dupes...');
            const inventory = new TF2Inventory(offer.partner, this.bot.manager);

            const requests = assetidsToCheck.map(assetid => {
                return (callback: (err: Error | null, result: boolean | null) => void): void => {
                    log.debug('Dupe checking ' + assetid + '...');
                    Promise.resolve(inventory.isDuped(assetid)).asCallback(function(err, result) {
                        log.debug('Dupe check for ' + assetid + ' done');
                        callback(err, result);
                    });
                };
            });

            try {
                const result: (boolean | null)[] = await Promise.fromCallback(function(callback) {
                    async.series(requests, callback);
                });

                log.debug('Got result from dupe checks', { result: result });

                // Decline by default
                const declineDupes = process.env.DECLINE_DUPES !== 'false';

                for (let i = 0; i < result.length; i++) {
                    if (result[i] === true) {
                        // Found duped item
                        if (declineDupes) {
                            // Offer contains duped items, decline it
                            return {
                                action: 'decline',
                                reason: '🟫DUPED_ITEMS',
                                meta: { assetids: assetidsToCheck, result: result }
                            };
                        } else {
                            // Offer contains duped items but we don't decline duped items, instead add it to the wrong about offer list and continue
                            wrongAboutOffer.push({
                                reason: '🟫DUPED_ITEMS',
                                assetid: assetidsToCheck[i]
                            });
                        }
                    } else if (result[i] === null) {
                        // Could not determine if the item was duped, make the offer be pending for review
                        wrongAboutOffer.push({
                            reason: '🟪DUPE_CHECK_FAILED',
                            assetid: assetidsToCheck[i]
                        });
                    }
                }
            } catch (err) {
                log.warn('Failed dupe check: ' + err.message);
                wrongAboutOffer.push({
                    reason: '🟪DUPE_CHECK_FAILED',
                    error: err.message
                });
            }
        }

        if (wrongAboutOffer.length !== 0) {
            const reasons = wrongAboutOffer.map(wrong => wrong.reason);
            const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

            offer.log('info', `offer needs review (${uniqueReasons.join(', ')}), skipping...`);
            return {
                action: 'skip',
                reason: 'REVIEW',
                meta: {
                    uniqueReasons: uniqueReasons,
                    reasons: wrongAboutOffer
                }
            };
        }

        offer.log('trade', `accepting. Summary:\n${offer.summarize(this.bot.schema)}`);

        return { action: 'accept', reason: 'VALID' };
    }

    // TODO: checkBanned and checkEscrow are copied from UserCart, don't duplicate them

    onTradeOfferChanged(offer: TradeOffer, oldState: number): void {
        // Not sure if it can go from other states to active
        if (oldState === TradeOfferManager.ETradeOfferState.Accepted) {
            offer.data('switchedState', oldState);
        }

        const handledByUs = offer.data('handledByUs') === true;
        const notify = offer.data('notify') === true;

        if (handledByUs && offer.data('switchedState') !== offer.state) {
            if (notify) {
                if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
                    this.bot.sendMessage(
                        offer.partner,
                        process.env.CUSTOM_SUCCESS_MESSAGE
                            ? process.env.CUSTOM_SUCCESS_MESSAGE
                            : '/pre ✅ Success! The offer went through successfully.'
                    );
                } else if (offer.state === TradeOfferManager.ETradeOfferState.Declined) {
                    this.bot.sendMessage(
                        offer.partner,
                        process.env.CUSTOM_DECLINED_MESSAGE
                            ? process.env.CUSTOM_DECLINED_MESSAGE
                            : '/pre ❌ Ohh nooooes! The offer is no longer available. Reason: The offer has been declined.'
                    );
                } else if (offer.state === TradeOfferManager.ETradeOfferState.Canceled) {
                    let reason: string;

                    if (offer.data('canceledByUser') === true) {
                        reason = 'Offer was canceled by user';
                    } else if (oldState === TradeOfferManager.ETradeOfferState.CreatedNeedsConfirmation) {
                        reason = 'Failed to accept mobile confirmation';
                    } else {
                        reason = 'The offer has been active for a while';
                    }

                    this.bot.sendMessage(
                        offer.partner,
                        '/pre ❌ Ohh nooooes! The offer is no longer available. Reason: ' + reason + '.'
                    );
                } else if (offer.state === TradeOfferManager.ETradeOfferState.InvalidItems) {
                    this.bot.sendMessage(
                        offer.partner,
                        process.env.CUSTOM_TRADED_AWAY_MESSAGE
                            ? process.env.CUSTOM_TRADED_AWAY_MESSAGE
                            : '/pre ❌ Ohh nooooes! Your offer is no longer available. Reason: Items not available (traded away in a different trade).'
                    );
                }
            }

            if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
                // Only run this if the bot handled the offer

                offer.data('isAccepted', true);

                offer.log('trade', 'has been accepted.');

                const pureStock = this.pureStock();

                const keyPrice = this.bot.pricelist.getKeyPrices();
                const value: { our: Currency; their: Currency } = offer.data('value');

                let valueDiff: number;
                let valueDiffRef: number;
                let valueDiffKey: string;
                if (!value) {
                    valueDiff = 0;
                    valueDiffRef = 0;
                    valueDiffKey = '';
                } else {
                    valueDiff =
                        new Currencies(value.their).toValue(keyPrice.sell.metal) -
                        new Currencies(value.our).toValue(keyPrice.sell.metal);
                    valueDiffRef = Currencies.toRefined(Currencies.toScrap(Math.abs(valueDiff * (1 / 9))));
                    valueDiffKey = Currencies.toCurrencies(
                        Math.abs(valueDiff),
                        Math.abs(valueDiff) >= keyPrice.sell.metal ? keyPrice.sell.metal : undefined
                    ).toString();
                }

                if (
                    process.env.DISABLE_DISCORD_WEBHOOK_TRADE_SUMMARY === 'false' &&
                    process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_URL
                ) {
                    this.sendWebHookTradeSummary(offer);
                } else {
                    this.bot.messageAdmins(
                        'trade',
                        `/me Trade #${offer.id} with ${offer.partner.getSteamID64()} is accepted. ✅\n\nSummary:\n` +
                            offer.summarize(this.bot.schema) +
                            (valueDiff > 0
                                ? `\n\n📈 Profit from overpay: ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : valueDiff < 0
                                ? `\n\n📉 Loss from underpay: ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : '') +
                            `\n🔑 Key rate: ${keyPrice.buy.metal.toString()}/${keyPrice.sell.metal.toString()} ref | 💰 Pure stock: ${pureStock
                                .join(', ')
                                .toString()} ref`,
                        []
                    );
                }
            }
        }

        if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
            // Offer is accepted

            // Smelt / combine metal
            this.keepMetalSupply();

            // Sort inventory
            this.sortInventory();

            // Update listings
            const diff = offer.getDiff() || {};

            for (const sku in diff) {
                if (!Object.prototype.hasOwnProperty.call(diff, sku)) {
                    continue;
                }

                this.bot.listings.checkBySKU(sku);
            }

            this.inviteToGroups(offer.partner);
        }
    }

    onOfferAction(
        offer: TradeOffer,
        action: 'accept' | 'decline' | 'skip',
        reason: string,
        meta: UnknownDictionary<any>
    ): void {
        const notify = offer.data('notify') === true;
        if (!notify) {
            return;
        }
        const keyPrice = this.bot.pricelist.getKeyPrices();
        const pureStock = this.pureStock();
        const items: { our: {}; their: {} } = offer.data('dict');
        const value: { our: Currency; their: Currency } = offer.data('value');

        let valueDiff: number;
        let valueDiffRef: number;
        let valueDiffKey: string;
        if (!value) {
            valueDiff = 0;
            valueDiffRef = 0;
            valueDiffKey = '';
        } else {
            valueDiff =
                new Currencies(value.their).toValue(keyPrice.sell.metal) -
                new Currencies(value.our).toValue(keyPrice.sell.metal);
            valueDiffRef = Currencies.toRefined(Currencies.toScrap(Math.abs(valueDiff * (1 / 9))));
            valueDiffKey = Currencies.toCurrencies(
                Math.abs(valueDiff),
                Math.abs(valueDiff) >= keyPrice.sell.metal ? keyPrice.sell.metal : undefined
            ).toString();
        }

        const itemsList: string[] = [];
        for (const sku in items.their) {
            if (!Object.prototype.hasOwnProperty.call(items.their, sku)) {
                continue;
            }
            const theirItemsSku = sku;
            itemsList.push(theirItemsSku);
        }

        if (action === 'skip') {
            const reviewReasons: string[] = [];
            let note: string;
            let missingPureNote: string;

            if (meta.uniqueReasons.includes('🟨INVALID_ITEMS')) {
                note = process.env.INVALID_ITEMS_NOTE
                    ? `🟨INVALID_ITEMS - ${process.env.INVALID_ITEMS_NOTE}`
                    : '🟨INVALID_ITEMS - Some item(s) you offered might not in my pricelist. Please wait for the owner to verify it.';
                reviewReasons.push(note);
            }
            if (meta.uniqueReasons.includes('🟦OVERSTOCKED')) {
                note = process.env.OVERSTOCKED_NOTE
                    ? `🟦OVERSTOCKED - ${process.env.OVERSTOCKED_NOTE}`
                    : "🟦OVERSTOCKED - Some item(s) you offered might already reached max amount I can have OR it's a common bug on me. Please wait.";
                reviewReasons.push(note);
            }
            if (meta.uniqueReasons.includes('🟥INVALID_VALUE')) {
                note = process.env.INVALID_VALUE_NOTE
                    ? `🟥INVALID_VALUE - ${process.env.INVALID_VALUE_NOTE}`
                    : '🟥INVALID_VALUE - Your offer will be ignored. Please cancel it and make another offer with correct value.';
                reviewReasons.push(note);
                missingPureNote =
                    "\n💥[You're missing: " +
                    (itemsList.includes('5021;6') ? `${valueDiffKey}]💥` : `${valueDiffRef} ref]💥`);
            }
            if (meta.uniqueReasons.includes('🟫DUPED_ITEMS')) {
                note = process.env.DUPE_ITEMS_NOTE
                    ? `🟫DUPED_ITEMS - ${process.env.DUPE_ITEMS_NOTE}`
                    : '🟫DUPED_ITEMS - The item(s) you offered is appeared to be duped. Please wait for my owner to review it. Thank you.';
                reviewReasons.push(note);
            }
            if (meta.uniqueReasons.includes('🟪DUPE_CHECK_FAILED')) {
                note = process.env.DUPE_CHECK_FAILED_NOTE
                    ? `🟪DUPE_CHECK_FAILED - ${process.env.DUPE_CHECK_FAILED_NOTE}`
                    : '🟪DUPE_CHECK_FAILED - Backpack.tf still does not recognize your item(s) Original ID to check for the duped item. You can try again later. Check it yourself by going to your item history page. Thank you.';
                reviewReasons.push(note);
            }
            // Notify partner and admin that the offer is waiting for manual review
            this.bot.sendMessage(
                offer.partner,
                `/pre ⚠️ Your offer is waiting for review.\nReason: ${meta.uniqueReasons.join(', ')}` +
                    '\n\nYour offer summary:\n' +
                    offer
                        .summarize(this.bot.schema)
                        .replace('Asked', '🤖  My side')
                        .replace('Offered', '🧐Your side') +
                    (meta.uniqueReasons.includes('🟥INVALID_VALUE') && !meta.uniqueReasons.includes('🟨INVALID_ITEMS')
                        ? missingPureNote
                        : '') +
                    (process.env.DISABLE_REVIEW_OFFER_NOTE === 'false'
                        ? `\n\n📝Note📝\n${reviewReasons.join('\n')}`
                        : '') +
                    (process.env.ADDITIONAL_NOTE
                        ? '\n\n' +
                          process.env.ADDITIONAL_NOTE.replace(
                              /%keyRate%/g,
                              `${keyPrice.sell.metal.toString()} ref`
                          ).replace(/%pureStock%/g, pureStock.join(', ').toString())
                        : '')
            );
            if (
                process.env.DISABLE_DISCORD_WEBHOOK_OFFER_REVIEW === 'false' &&
                process.env.DISCORD_WEBHOOK_REVIEW_OFFER_URL
            ) {
                this.sendWebHookReviewOfferSummary(offer, meta.uniqueReasons.join(', '));
            } else {
                const offerMessage = offer.message;
                this.bot.messageAdmins(
                    `/pre ⚠️ Offer #${offer.id} from ${offer.partner} is waiting for review.\nReason: ` +
                        `${meta.uniqueReasons.join(', ')}\n\nOffer Summary:\n${offer.summarize(this.bot.schema)}` +
                        (offerMessage.length !== 0 ? `\n\n💬 Offer message: "${offerMessage}"` : '') +
                        (valueDiff > 0
                            ? `\n\n📈 Profit from overpay: ${valueDiffRef} ref` +
                              (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                            : valueDiff < 0
                            ? `\n\n📉 Loss from underpay: ${valueDiffRef} ref` +
                              (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                            : '') +
                        `\n🔑 Key rate: ${keyPrice.buy.metal.toString()}/${keyPrice.sell.metal.toString()} ref`,
                    []
                );
            }
        }
    }

    private keepMetalSupply(): void {
        const currencies = this.bot.inventoryManager.getInventory().getCurrencies();

        // let refined = currencies['5002;6'].length;
        let reclaimed = currencies['5001;6'].length;
        let scrap = currencies['5000;6'].length;

        const maxReclaimed = this.minimumReclaimed + this.combineThreshold;
        const maxScrap = this.minimumScrap + this.combineThreshold;
        const minReclaimed = this.minimumReclaimed;
        const minScrap = this.minimumScrap;

        let smeltReclaimed = 0;
        let smeltRefined = 0;
        let combineScrap = 0;
        let combineReclaimed = 0;

        if (reclaimed > maxReclaimed) {
            combineReclaimed = Math.ceil((reclaimed - maxReclaimed) / 3);
            // refined += combineReclaimed;
            reclaimed -= combineReclaimed * 3;
        } else if (minReclaimed > reclaimed) {
            smeltRefined = Math.ceil((minReclaimed - reclaimed) / 3);
            reclaimed += smeltRefined * 3;
            // refined -= smeltRefined;
        }

        if (scrap > maxScrap) {
            combineScrap = Math.ceil((scrap - maxScrap) / 3);
            reclaimed += combineScrap;
            scrap -= combineScrap * 3;
        } else if (minScrap > scrap) {
            smeltReclaimed = Math.ceil((minScrap - scrap) / 3);
            scrap += smeltReclaimed * 3;
            reclaimed -= smeltReclaimed;
        }

        // TODO: When smelting metal mark the item as being used, then we won't use it when sending offers

        for (let i = 0; i < combineScrap; i++) {
            this.bot.tf2gc.combineMetal(5000);
        }

        for (let i = 0; i < combineReclaimed; i++) {
            this.bot.tf2gc.combineMetal(5001);
        }

        for (let i = 0; i < smeltRefined; i++) {
            this.bot.tf2gc.smeltMetal(5002);
        }

        for (let i = 0; i < smeltReclaimed; i++) {
            this.bot.tf2gc.smeltMetal(5001);
        }
    }

    private sortInventory(): void {
        if (process.env.DISABLE_INVENTORY_SORT !== 'true') {
            this.bot.tf2gc.sortInventory(3);
        }
    }

    private inviteToGroups(steamID: SteamID | string): void {
        this.bot.groups.inviteToGroups(steamID, this.groups);
    }

    private checkFriendRequests(): void {
        if (!this.bot.client.myFriends) {
            return;
        }

        this.checkFriendsCount();

        for (const steamID64 in this.bot.client.myFriends) {
            if (!Object.prototype.hasOwnProperty.call(this.bot.client.myFriends, steamID64)) {
                continue;
            }

            const relation = this.bot.client.myFriends[steamID64];
            if (relation === SteamUser.EFriendRelationship.RequestRecipient) {
                this.respondToFriendRequest(steamID64);
            }
        }

        this.bot.getAdmins().forEach(steamID => {
            if (!this.bot.friends.isFriend(steamID)) {
                log.info(`Not friends with admin ${steamID}, sending friend request...`);
                this.bot.client.addFriend(steamID, function(err) {
                    if (err) {
                        log.warn('Failed to send friend request: ', err);
                    }
                });
            }
        });
    }

    private respondToFriendRequest(steamID: SteamID | string): void {
        const steamID64 = typeof steamID === 'string' ? steamID : steamID.getSteamID64();

        log.debug(`Sending friend request to ${steamID64}...`);

        this.bot.client.addFriend(steamID, function(err) {
            if (err) {
                log.warn(`Failed to send friend request to ${steamID64}: `, err);
                return;
            }

            log.debug('Friend request has been sent / accepted');
        });
    }

    private onNewFriend(steamID: SteamID, tries = 0): void {
        if (tries === 0) {
            log.debug(`Now friends with ${steamID.getSteamID64()}`);
        }

        const isAdmin = this.bot.isAdmin(steamID);

        setImmediate(() => {
            if (!this.bot.friends.isFriend(steamID)) {
                return;
            }

            const friend = this.bot.friends.getFriend(steamID);

            if (friend === null || friend.player_name === undefined) {
                tries++;

                if (tries >= 5) {
                    log.info(`I am now friends with ${steamID.getSteamID64()}`);

                    this.bot.sendMessage(
                        steamID,
                        process.env.CUSTOM_WELCOME_MESSAGE
                            ? process.env.CUSTOM_WELCOME_MESSAGE
                            : `🙋🏻‍♀️ Hi! If you don't know how things work, please type "!` +
                                  (isAdmin ? 'help' : 'how2trade') +
                                  '" 🤗'
                    );
                    return;
                }

                log.debug('Waiting for name');

                // Wait for friend info to be available
                setTimeout(() => {
                    this.onNewFriend(steamID, tries);
                }, exponentialBackoff(tries - 1, 200));
                return;
            }

            log.info(`I am now friends with ${friend.player_name} (${steamID.getSteamID64()})`);

            this.bot.sendMessage(
                steamID,
                process.env.CUSTOM_WELCOME_MESSAGE
                    ? process.env.CUSTOM_WELCOME_MESSAGE
                    : `🙋🏻‍♀️ Hi ${friend.player_name}! If you don't know how things work, please type "!` +
                          (isAdmin ? 'help' : 'how2trade') +
                          '" 🤗'
            );
        });
    }

    private checkFriendsCount(steamIDToIgnore?: SteamID | string): void {
        log.debug('Checking friends count');
        const friends = this.bot.friends.getFriends();

        const friendslistBuffer = 20;

        const friendsToRemoveCount = friends.length + friendslistBuffer - this.bot.friends.maxFriends;

        log.debug(`Friends to remove: ${friendsToRemoveCount}`);

        if (friendsToRemoveCount > 0) {
            // We have friends to remove, find people with fewest trades and remove them
            const friendsWithTrades = this.bot.trades.getTradesWithPeople(friends);

            // Ignore friends to keep
            this.friendsToKeep.forEach(function(steamID) {
                delete friendsWithTrades[steamID];
            });

            if (steamIDToIgnore) {
                delete friendsWithTrades[steamIDToIgnore.toString()];
            }

            // Convert object into an array so it can be sorted
            const tradesWithPeople: { steamID: string; trades: number }[] = [];

            for (const steamID in friendsWithTrades) {
                if (!Object.prototype.hasOwnProperty.call(friendsWithTrades, steamID)) {
                    continue;
                }

                tradesWithPeople.push({ steamID: steamID, trades: friendsWithTrades[steamID] });
            }

            // Sorts people by trades and picks people with lowest amounts of trades
            const friendsToRemove = tradesWithPeople
                .sort((a, b) => a.trades - b.trades)
                .splice(0, friendsToRemoveCount);

            log.info(`Cleaning up friendslist, removing ${friendsToRemove.length} people...`);

            friendsToRemove.forEach(element => {
                this.bot.sendMessage(
                    element.steamID,
                    process.env.CUSTOM_CLEARING_FRIENDS_MESSAGE
                        ? process.env.CUSTOM_CLEARING_FRIENDS_MESSAGE
                        : '/quote I am cleaning up my friend list and you have been selected to be removed.🙇🏻‍♂️ Feel free to add me again if you want to trade at the other time! 🤗'
                );
                this.bot.client.removeFriend(element.steamID);
            });
        }
    }

    private sendWebHookReviewOfferSummary(offer: TradeOfferManager.TradeOffer, reason: string): void {
        const request = new XMLHttpRequest();
        request.open('POST', process.env.DISCORD_WEBHOOK_REVIEW_OFFER_URL);
        request.setRequestHeader('Content-type', 'application/json');

        const partnerSteamID = offer.partner.toString();
        const tradeSummary = offer.summarizeWithLink(this.bot.schema);
        const time = moment()
            .tz(process.env.TIMEZONE ? process.env.TIMEZONE : 'UTC') //timezone format: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
            .format('MMMM Do YYYY, HH:mm:ss ZZ');

        const offerMessage = offer.message;
        const keyPrice = this.bot.pricelist.getKeyPrices();
        const value: { our: Currency; their: Currency } = offer.data('value');

        let valueDiff: number;
        let valueDiffRef: number;
        let valueDiffKey: string;
        if (!value) {
            valueDiff = 0;
            valueDiffRef = 0;
            valueDiffKey = '';
        } else {
            valueDiff =
                new Currencies(value.their).toValue(keyPrice.sell.metal) -
                new Currencies(value.our).toValue(keyPrice.sell.metal);
            valueDiffRef = Currencies.toRefined(Currencies.toScrap(Math.abs(valueDiff * (1 / 9))));
            valueDiffKey = Currencies.toCurrencies(
                Math.abs(valueDiff),
                Math.abs(valueDiff) >= keyPrice.sell.metal ? keyPrice.sell.metal : undefined
            ).toString();
        }

        let partnerAvatar: string;
        let partnerName: string;
        log.debug('getting partner Avatar and Name...');
        offer.getUserDetails(function(err, me, them) {
            if (err) {
                log.debug('Error retrieving partner Avatar and Name: ', err);
                partnerAvatar =
                    'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/72/72f78b4c8cc1f62323f8a33f6d53e27db57c2252_full.jpg'; //default "?" image
                partnerName = 'unknown';
            } else {
                log.debug('partner Avatar and Name retrieved. Applying...');
                partnerAvatar = them.avatarFull;
                partnerName = them.personaName;
            }
            /*eslint-disable */
            const webhookReview = JSON.stringify({
                username: process.env.DISCORD_WEBHOOK_USERNAME,
                avatar_url: process.env.DISCORD_WEBHOOK_AVATAR_URL,
                content: `<@!${process.env.DISCORD_OWNER_ID}>, check this! - ${offer.id}`,
                embeds: [
                    {
                        author: {
                            name: 'Offer from: ' + partnerName,
                            url: `https://steamcommunity.com/profiles/${partnerSteamID}`,
                            icon_url: partnerAvatar
                        },
                        footer: {
                            text: `Offer #${offer.id} • SteamID: ${partnerSteamID} • ${time}`
                        },
                        thumbnail: {
                            url: ''
                        },
                        title: '',
                        description:
                            `⚠️ An offer sent by ${partnerName} is waiting for review.\nReason: ${reason}\n\n__Offer Summary__:\n` +
                            tradeSummary.replace('Asked:', '**Asked:**').replace('Offered:', '**Offered:**') +
                            (offerMessage.length !== 0 ? `\n\n💬 Offer message: _${offerMessage}_` : '') +
                            (valueDiff > 0
                                ? `\n\n📈 ***Profit from overpay:*** ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : valueDiff < 0
                                ? `\n\n📉 ***Loss from underpay:*** ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : '') +
                            `\n🔑 Key rate: ${keyPrice.buy.metal.toString()}/${keyPrice.sell.metal.toString()} ref`,
                        color: process.env.DISCORD_WEBHOOK_EMBED_COLOR_IN_DECIMAL_INDEX
                    }
                ]
            });
            /*eslint-enable */
            request.send(webhookReview);
        });
    }

    private sendWebHookTradeSummary(offer: TradeOfferManager.TradeOffer): void {
        const request = new XMLHttpRequest();
        request.open('POST', process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_URL);
        request.setRequestHeader('Content-type', 'application/json');

        const partnerSteamID = offer.partner.toString();
        const tradeSummary = offer.summarizeWithLink(this.bot.schema);

        const skuSummary = offer.summarizeSKU();
        let skuFromEnv = process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_MENTION_OWNER_ONLY_ITEMS_SKU;
        if (skuFromEnv === '') {
            skuFromEnv = ';';
        }
        const mentionOwner =
            process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_MENTION_OWNER === 'true' && skuSummary.includes(skuFromEnv)
                ? `<@!${process.env.DISCORD_OWNER_ID}>`
                : '';

        const time = moment()
            .tz(process.env.TIMEZONE ? process.env.TIMEZONE : 'UTC') //timezone format: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
            .format('MMMM Do YYYY, HH:mm:ss ZZ');
        const pureStock = this.pureStock();
        const keyPrice = this.bot.pricelist.getKeyPrices();
        const value: { our: Currency; their: Currency } = offer.data('value');

        let valueDiff: number;
        let valueDiffRef: number;
        let valueDiffKey: string;
        if (!value) {
            valueDiff = 0;
            valueDiffRef = 0;
            valueDiffKey = '';
        } else {
            valueDiff =
                new Currencies(value.their).toValue(keyPrice.sell.metal) -
                new Currencies(value.our).toValue(keyPrice.sell.metal);
            valueDiffRef = Currencies.toRefined(Currencies.toScrap(Math.abs(valueDiff * (1 / 9))));
            valueDiffKey = Currencies.toCurrencies(
                Math.abs(valueDiff),
                Math.abs(valueDiff) >= keyPrice.sell.metal ? keyPrice.sell.metal : undefined
            ).toString();
        }

        let tradesTotal = 0;
        const offerData = this.bot.manager.pollData.offerData;
        for (const offerID in offerData) {
            if (!Object.prototype.hasOwnProperty.call(offerData, offerID)) {
                continue;
            }

            if (offerData[offerID].handledByUs === true && offerData[offerID].isAccepted === true) {
                // Sucessful trades handled by the bot
                tradesTotal++;
            }
        }
        const tradesMade = process.env.TRADES_MADE_STARTER_VALUE
            ? +process.env.TRADES_MADE_STARTER_VALUE + tradesTotal
            : 0 + tradesTotal;

        let personaName: string;
        let avatarFull: string;
        log.debug('getting partner Avatar and Name...');
        this.getPartnerDetails(offer, function(err, details) {
            if (err) {
                log.debug('Error retrieving partner Avatar and Name: ', err);
                personaName = 'unknown';
                avatarFull =
                    'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/72/72f78b4c8cc1f62323f8a33f6d53e27db57c2252_full.jpg'; //default "?" image
            } else {
                log.debug('partner Avatar and Name retrieved. Applying...');
                personaName = details.personaName;
                avatarFull = details.avatarFull;
            }
            /*eslint-disable */
            const acceptedTradeSummary = JSON.stringify({
                username: process.env.DISCORD_WEBHOOK_USERNAME,
                avatar_url: process.env.DISCORD_WEBHOOK_AVATAR_URL,
                content: mentionOwner,
                embeds: [
                    {
                        author: {
                            name: `Trade from: ${personaName} #${tradesMade.toString()}`,
                            url: `https://steamcommunity.com/profiles/${partnerSteamID}`,
                            icon_url: avatarFull
                        },
                        footer: {
                            text: `Offer #${offer.id} • SteamID: ${partnerSteamID} • ${time}`
                        },
                        thumbnail: {
                            url: ''
                        },
                        title: '',
                        description:
                            `A trade with ${personaName} has been marked as accepted.✅\n__Summary__:\n` +
                            tradeSummary.replace('Asked:', '**Asked:**').replace('Offered:', '**Offered:**') +
                            (valueDiff > 0
                                ? `\n📈 ***Profit from overpay:*** ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : valueDiff < 0
                                ? `\n📉 ***Loss from underpay:*** ${valueDiffRef} ref` +
                                  (valueDiffRef >= keyPrice.sell.metal ? ` (${valueDiffKey})` : '')
                                : '') +
                            `\n🔑 Key rate: ${keyPrice.buy.metal.toString()}/${keyPrice.sell.metal.toString()} ref\n💰 Pure stock: ${pureStock
                                .join(', ')
                                .toString()} ref\n` +
                            (process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_ADDITIONAL_DESCRIPTION_NOTE
                                ? process.env.DISCORD_WEBHOOK_TRADE_SUMMARY_ADDITIONAL_DESCRIPTION_NOTE
                                : ''),
                        color: process.env.DISCORD_WEBHOOK_EMBED_COLOR_IN_DECIMAL_INDEX
                    }
                ]
            });
            /*eslint-enable */
            request.send(acceptedTradeSummary);
        });
    }

    private getPartnerDetails(offer: TradeOfferManager.TradeOffer, callback: (err: any, details: any) => void): any {
        // check state of the offer
        if (offer.state === TradeOfferManager.ETradeOfferState.active) {
            offer.getUserDetails(function(err, me, them) {
                if (err) {
                    callback(err, {});
                } else {
                    callback(null, them);
                }
            });
        } else {
            this.bot.community.getSteamUser(offer.partner, (err, user) => {
                if (err) {
                    callback(err, {});
                } else {
                    callback(null, {
                        personaName: user.name,
                        avatarFull: user.getAvatarURL('full')
                    });
                }
            });
        }
    }

    private pureStock(): string[] {
        const pureStock: string[] = [];
        const pureScrap = this.bot.inventoryManager.getInventory().getAmount('5000;6') * (1 / 9);
        const pureRec = this.bot.inventoryManager.getInventory().getAmount('5001;6') * (1 / 3);
        const pureRef = this.bot.inventoryManager.getInventory().getAmount('5002;6');
        const pureScrapTotal = Currencies.toScrap(pureRef + pureRec + pureScrap);
        const pure = [
            {
                name: 'Key',
                amount: this.bot.inventoryManager.getInventory().getAmount('5021;6')
            },
            {
                name: 'Ref',
                amount: Currencies.toRefined(pureScrapTotal)
            }
        ];
        for (let i = 0; i < pure.length; i++) {
            pureStock.push(`${pure[i].name}: ${pure[i].amount}`);
        }
        return pureStock;
    }

    private checkGroupInvites(): void {
        log.debug('Checking group invites');

        for (const groupID64 in this.bot.client.myGroups) {
            if (!Object.prototype.hasOwnProperty.call(this.bot.client.myGroups, groupID64)) {
                continue;
            }

            const relationship = this.bot.client.myGroups[groupID64];

            if (relationship === SteamUser.EClanRelationship.Invited) {
                this.bot.client.respondToGroupInvite(groupID64, false);
            }
        }

        this.groups.forEach(steamID => {
            if (
                this.bot.client.myGroups[steamID] !== SteamUser.EClanRelationship.Member &&
                this.bot.client.myGroups[steamID] !== SteamUser.EClanRelationship.Blocked
            ) {
                this.bot.community.getSteamGroup(new SteamID(steamID), function(err, group) {
                    if (err) {
                        log.warn('Failed to get group: ', err);
                        return;
                    }

                    log.info(`Not member of group ${group.name} ("${steamID}"), joining...`);
                    group.join(function(err) {
                        if (err) {
                            log.warn('Failed to join group: ', err);
                        }
                    });
                });
            }
        });
    }

    onPollData(pollData: PollData): void {
        files.writeFile(paths.files.pollData, pollData, true).catch(function(err) {
            log.warn('Failed to save polldata: ', err);
        });
    }

    onPricelist(pricelist: Entry[]): void {
        log.debug('Pricelist changed');

        if (pricelist.length === 0) {
            // Ignore errors
            this.bot.listings.removeAll().asCallback();
        }

        files
            .writeFile(
                paths.files.pricelist,
                pricelist.map(entry => entry.getJSON()),
                true
            )
            .catch(function(err) {
                log.warn('Failed to save pricelist: ', err);
            });
    }

    onPriceChange(sku: string, entry: Entry): void {
        this.bot.listings.checkBySKU(sku, entry);
    }

    onLoginThrottle(wait: number): void {
        log.warn('Waiting ' + wait + ' ms before trying to sign in...');
    }

    onTF2QueueCompleted(): void {
        log.debug('Queue finished');
        this.bot.client.gamesPlayed(['tf2-automatic', 440]);
    }
};
