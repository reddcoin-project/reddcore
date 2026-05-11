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

/**
 * Top-N addresses by current balance, filtered to those with no
 * receive activity for ≥ `years` years.
 *
 * GET /api/<chain>/<network>/stats/dormant-list?years=5&limit=100&offset=0
 *
 * Returns the rich-list shape plus per-row `lastActiveHeight` and
 * `lastActiveTime` (ISO timestamp). `years` defaults to 5; common buckets
 * the UI exposes are 1, 2, 3, 5, 7, 10.
 *
 * Same caching strategy as rich-list (5 min). Same UTXO-only
 * implementation note re: non-UTXO providers (501).
 *
 * Caveat documented in BIT-29: change-to-self resets the dormancy
 * clock; this is approximation, not balance-flow analysis.
 */
/**
 * Chain circulating supply: sum of all unspent coin values plus the
 * processed tip height/time the figure is "as of".
 *
 * GET /api/<chain>/<network>/stats/supply
 *
 * Backs the %-of-supply column on the rich-list page (BIT-30). UTXO-only;
 * non-UTXO providers return 501. Cached 5 min — chain supply moves slowly
 * and this is a full-collection aggregation.
 */
router.get('/supply', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getCirculatingSupply({ chain, network });
    SetCache(res, CacheTimes.Minute * 5);
    return res.json(result);
  } catch (err: any) {
    if (/not implemented/i.test(err.message || '')) {
      return res.status(501).send(err.message);
    }
    logger.error('Error getting circulating supply: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

/**
 * Address distribution / wealth concentration across power-of-10 balance
 * buckets.
 *
 * GET /api/<chain>/<network>/stats/distribution
 *
 * Returns `{ totalSupply, totalAddresses, buckets[] }` where each bucket
 * is `{ min, max, addressCount, valueSum }`. Boundaries are dense — empty
 * buckets are still returned so the UI can render a stable series.
 *
 * Backs the wealth-distribution component on the rich-list page (BIT-31).
 * UTXO-only; non-UTXO providers return 501 — same pattern as rich-list.
 * Cached 5 min; this aggregation is the same cost class as rich-list and
 * neither needs to be real-time.
 */
router.get('/distribution', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getAddressDistribution({ chain, network });
    SetCache(res, CacheTimes.Minute * 5);
    return res.json(result);
  } catch (err: any) {
    if (/not implemented/i.test(err.message || '')) {
      return res.status(501).send(err.message);
    }
    logger.error('Error getting address distribution: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/dormant-list', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getDormantAddresses({
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
    logger.error('Error getting dormant list: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

/**
 * Top-N "active" addresses over a recent window.
 *
 * GET /api/<chain>/<network>/stats/active
 *   ?windowDays=30                          (1..365, default 30)
 *   &filter=any|received|sent|staking       (default 'any')
 *   &limit=100&offset=0
 *
 * Backs the active-addresses page + summary insert (BIT-32).
 *
 * `staking` joins coinstake transactions in the window with their
 * outputs to surface the actively-staking population — Reddcoin-
 * specific signal of which holders are running staking nodes.
 *
 * UTXO-only; non-UTXO providers return 501. Cached 10 min; the
 * underlying aggregation is window-bounded but still non-trivial.
 */
router.get('/active', async function(req: Request, res: Response) {
  const { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getActiveAddresses({
      chain,
      network,
      args: req.query
    });
    SetCache(res, CacheTimes.Minute * 10);
    return res.json(result);
  } catch (err: any) {
    if (/not implemented/i.test(err.message || '')) {
      return res.status(501).send(err.message);
    }
    logger.error('Error getting active addresses: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

export const statsRoute = {
  router,
  path: '/stats'
};
