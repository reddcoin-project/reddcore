import express, { Request, Response } from 'express';
import logger from '../../logger';
import { ChainStateProvider } from '../../providers/chain-state';
import { CacheTimes, SetCache } from '../middleware';

const router = express.Router({ mergeParams: true });

router.get('/', async function(_: Request, res: Response) {
  return res.send(404);
});

router.get('/daily-transactions', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const dailyTxs = await ChainStateProvider.getDailyTransactions({
      chain,
      network,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string
    });
    SetCache(res, CacheTimes.Day);
    return res.json(dailyTxs);
  } catch (err: any) {
    logger.error('Error getting daily transactions: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

/**
 * Top-N addresses by current (unspent) balance.
 *
 * GET /api/<chain>/<network>/stats/rich-list?limit=100&offset=0
 *
 * `limit` capped at 1000 server-side. Returns ordered array of
 * { rank, address, balance } where balance is in the chain's base unit
 * (satoshis for UTXO chains).
 *
 * Currently implemented for UTXO chains (InternalStateProvider). Non-UTXO
 * providers return 501 — see ChainStateProxy.getTopAddresses.
 *
 * Cached for 5 minutes; the underlying aggregation across all unspent
 * outputs is non-trivial and the rank list doesn't need to be real-time.
 */
router.get('/rich-list', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getTopAddresses({
      chain,
      network,
      args: req.query
    });
    SetCache(res, CacheTimes.Minute * 5);
    return res.json(result);
  } catch (err: any) {
    if (/not implemented/i.test(err.message || '')) {
      return res.status(501).send(err.message);
    }
    logger.error('Error getting rich list: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

export const statsRoute = {
  router,
  path: '/stats'
};
