import { TradeOffer } from 'steam-tradeoffer-manager';
import { Currency } from '../../../types/TeamFortress2';
import { UnknownDictionary } from '../../../types/common';
import SchemaManager from 'tf2-schema';

import Currencies from 'tf2-currencies';
import SKU from 'tf2-sku';

export = function(schema: SchemaManager.Schema): string {
    // @ts-ignore
    const self = this as TradeOffer;

    const value: { our: Currency; their: Currency } = self.data('value');

    const items: {
        our: UnknownDictionary<number>;
        their: UnknownDictionary<number>;
    } = self.data('dict') || { our: null, their: null };

    if (!value) {
        return (
            'Asked: ' +
            summarizeItemsWithLink(items.our, schema) +
            'Offered: ' +
            summarizeItemsWithLink(items.their, schema)
        );
    } else {
        const valueDiff = new Currencies(value.their).toValue() - new Currencies(value.our).toValue();
        const valueDiffRef = Currencies.toRefined(Currencies.toScrap(Math.abs(valueDiff * (1 / 9)))).toString();
        return (
            'Asked: ' +
            new Currencies(value.our).toString() +
            ' (' +
            summarizeItemsWithLink(items.our, schema) +
            ')\nOffered: ' +
            new Currencies(value.their).toString() +
            ' (' +
            summarizeItemsWithLink(items.their, schema) +
            (valueDiff > 0
                ? ')\nProfit from overpay: ' + valueDiffRef + ' ref'
                : valueDiff < 0
                ? ')\nLoss from underpay: ' + valueDiffRef + ' ref'
                : ')')
        );
    }
};

function summarizeItemsWithLink(dict: UnknownDictionary<number>, schema: SchemaManager.Schema): string {
    if (dict === null) {
        return 'unknown items';
    }

    const summary: string[] = [];

    for (const sku in dict) {
        if (!Object.prototype.hasOwnProperty.call(dict, sku)) {
            continue;
        }

        const amount = dict[sku];
        const name = schema.getName(SKU.fromString(sku), false);

        summary.push('[' + name + '](https://www.prices.tf/items/' + sku + ')' + (amount > 1 ? ' x' + amount : ''));
    }

    if (summary.length === 0) {
        return 'nothing';
    }

    return summary.join(', ');
}