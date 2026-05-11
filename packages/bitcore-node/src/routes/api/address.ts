import express, { Request, Response } from 'express';
import logger from '../../logger';
import { ChainStateProvider } from '../../providers/chain-state';
import { StreamAddressUtxosParams } from '../../types/namespaces/ChainStateProvider';
import { CacheTimes, SetCache } from '../middleware';

const router = express.Router({ mergeParams: true });

async function streamCoins(req: Request, res) {
  try {
    const { chain, network, address } = req.params;
    const { unspent, limit = 10, since } = req.query;
    const payload = {
      chain,
      network,
      address,
      req,
      res,
      args: { ...req.query, unspent, limit, since }
    } as StreamAddressUtxosParams;
    await ChainStateProvider.streamAddressTransactions(payload);
  } catch (err: any) {
    logger.error('Error streaming coins: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
}

router.get('/:address', streamCoins);
router.get('/:address/txs', streamCoins);
router.get('/:address/coins', streamCoins);

/**
 * Per-address activity stats: first/last receive + count, first/last spend
 * (by distinct spending tx) + count.
 *
 * GET /api/<chain>/<network>/address/:address/stats
 *
 * Backs the activity columns on the rich-list page (BIT-30). Server caps
 * touched coin docs at 10,000 per address — exchange-class addresses
 * return `{ capped: true }` with zeroed counters rather than a chain-wide
 * scan. Cached 1 hour: activity metadata changes slowly and the rich-list
 * fan-out makes cache pressure the dominant cost.
 *
 * UTXO-only; non-UTXO providers return 501.
 */
router.get('/:address/stats', async function (req: Request, res: Response) {
  const { address, chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getAddressStats({ chain, network, address });
    SetCache(res, CacheTimes.Hour);
    return res.json(result);
  } catch (err: any) {
    if (/not implemented/i.test(err.message || '')) {
      return res.status(501).send(err.message);
    }
    logger.error('Error getting address stats: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:address/balance', async function (req: Request, res) {
  const { address, chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getBalanceForAddress({
      chain,
      network,
      address,
      args: req.query
    });
    return res.send(result || { confirmed: 0, unconfirmed: 0, balance: 0 });
  } catch (err: any) {
    logger.error('Error getting address balance: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

export const addressRoute = {
  router,
  path: '/address'
};
