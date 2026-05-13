import {FC, memo, useEffect, useState} from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';

import {TransactionEth} from '../utilities/models';

import InfiniteScrollLoadSpinner from '../components/infinite-scroll-load-spinner';
import Coin from './coin';
import TransactionDetailsEth from './transaction-details-eth';

import {motion} from 'framer-motion';
import styled from 'styled-components';
import {Action} from '../assets/styles/colors';

const SortDiv = styled.div`
  font-size: 16px;
  display: flex;
  margin-bottom: 1rem;

  span {
    margin-right: 0.5rem;
  }
`;

interface SortButtonProps {
  activeTextColor: boolean;
}

const SortButton = styled(motion.button)`
  background: transparent;
  border: none;
`;

const ButtonText = styled.div<SortButtonProps>`
  font-size: 16px;
  color: ${({activeTextColor, theme: {colors}}) => (activeTextColor ? Action : colors.color)};
`;

const LIMIT = 10;
const CHUNK_SIZE = 100;

const ToUiFriendlyEthCoin = (coin: TransactionEth, blockTipHeight: number) => {
  const {to, from, txid, fee, value, blockTime} = coin;
  const blockHeight = parseInt(coin.blockHeight + '', 10);
  const confirmations = blockHeight > 0 ? blockTipHeight - blockHeight + 1 : blockHeight;

  return {
    to,
    from,
    txid,
    fee,
    value,
    blockHeight,
    height: blockHeight,
    blockTime,
    confirmations,
  };
};

// Group coin docs by txid. A `coins` doc carries both a mint side
// (mintTxid: the tx that paid this address) and a spend side (spentTxid:
// the tx where this address spent it). On a normal UTXO chain those are
// different transactions, so each coin yields two entries with different
// txids — one per side. On PoSV (Reddcoin) the kernel input and the
// staked output share a txid, which used to produce two list entries for
// every stake (BIT-33). Grouping by txid collapses those into a single
// entry tagged direction:'self' with the net value.
//
// The same collapse also fixes the general self-pay case (multi-output
// to same address, multi-input from same address) without changing how
// distinct-tx mint/spend pairs render.
const ProcessData = (data: any, blockTipHeight: number) => {
  type Acc = {
    txid: string;
    height: number;
    inValue: number;
    outValue: number;
  };
  const groups = new Map<string, Acc>();

  const upsert = (txid: string, height: number) => {
    let g = groups.get(txid);
    if (!g) {
      g = {txid, height, inValue: 0, outValue: 0};
      groups.set(txid, g);
    } else if (g.height < 0 && height >= 0) {
      // Prefer a confirmed height if one side is still pending/unspent.
      g.height = height;
    }
    return g;
  };

  for (const coin of data) {
    const {mintHeight, mintTxid, value, spentHeight, spentTxid} = coin;

    if (mintTxid && mintHeight >= -1) {
      upsert(mintTxid, mintHeight).inValue += value;
    }
    if (spentTxid && spentHeight >= -1) {
      upsert(spentTxid, spentHeight).outValue += value;
    }
  }

  const txs: any = [];
  // Array.from instead of `for...of groups.values()` to satisfy CRA's
  // default lib target without enabling --downlevelIteration.
  for (const g of Array.from(groups.values())) {
    const isIn = g.inValue > 0;
    const isOut = g.outValue > 0;
    const direction: 'in' | 'out' | 'self' = isIn && isOut ? 'self' : isOut ? 'out' : 'in';
    // Display value: net for self-pays (typically a small positive stake
    // reward), gross for the one-sided cases. Existing chip rendering for
    // 'out' already prefixes a minus sign — keep value unsigned there to
    // avoid double-negation.
    const value =
      direction === 'self' ? g.inValue - g.outValue : direction === 'out' ? g.outValue : g.inValue;

    txs.push({
      txid: g.txid,
      height: g.height,
      confirmations: g.height > -1 ? blockTipHeight - g.height + 1 : g.height,
      mintTxid: direction !== 'out' ? g.txid : undefined,
      spentTxid: direction !== 'in' ? g.txid : undefined,
      direction,
      inValue: g.inValue,
      outValue: g.outValue,
      value,
    });
  }

  return txs;
};

const GetSortedTxs = (txList: any[], order: string) => {
  return txList.sort((a: any, b: any) => {
    // Sort remaining confirmed transactions by height based on `order`
    const orderSort = order === 'mostRecent' ? b.height - a.height : a.height - b.height;

    // Error transactions: Invalid, Error, Expired in specified order
    const errorOrder = [-3, -4, -5];
    const aErrorIndex = errorOrder.indexOf(a.height);
    const bErrorIndex = errorOrder.indexOf(b.height);

    // Place error transactions at the end
    if (aErrorIndex !== -1 && bErrorIndex !== -1) {
      return aErrorIndex - bErrorIndex;
    }
    if (aErrorIndex !== -1) return 1;
    if (bErrorIndex !== -1) return -1;

    // Place unspent transactions at the end
    if (a.height === -2) return 1;
    if (b.height === -2) return -1;

    // Place unconfirmed transactions at the beginning
    if (a.confirmations === -1) return -1;
    if (b.confirmations === -1) return 1;

    return orderSort;
  });
};

interface CoinListProps {
  txs: any;
  currency: string;
  network: string;
  tip: any;
  transactionsLength: any;
  /** Parent-driven pagination. Called when the InfiniteScroll trigger
   *  fires AND there are no more client-side rows to reveal. Returns
   *  a promise that resolves when the next page has been appended to
   *  `txs`. */
  onLoadMore?: () => Promise<void>;
  /** Parent's flag — true if the server is known to have more rows
   *  beyond what's currently in `txs`. (BIT-46) */
  hasMoreOnServer?: boolean;
  /** Called when the user clicks Most Recent / Oldest. When provided,
   *  the parent is expected to re-fetch with the new sort and update
   *  `txs`. CoinList's internal sort still runs for instant feedback
   *  but will be overwritten when the parent's data lands. (BIT-47) */
  onSortChange?: (order: 'mostRecent' | 'oldest') => void;
  /** Externally-driven sort (BIT-47). When set, overrides CoinList's
   *  internal `currentOrder` state — used by the parent to keep the
   *  sort indicator in sync with the data it just fetched. */
  order?: 'mostRecent' | 'oldest';
}

const CoinList: FC<CoinListProps> = ({
  txs,
  currency,
  network,
  tip,
  transactionsLength,
  onLoadMore,
  hasMoreOnServer,
  onSortChange,
  order,
}) => {
  const [limit, setLimit] = useState(LIMIT);
  const [chunkSize, setChunkSize] = useState(CHUNK_SIZE);
  // When `order` is passed by the parent, it wins (parent owns the sort
  // because it controls the server fetch). Otherwise default to in-memory.
  const [currentOrder, setCurrentOrder] = useState(order || 'mostRecent');

  const {height} = tip;

  const [txsCopy, setTxsCopy] = useState<any>([]);
  const [transactions, setTransactions] = useState<any>([]);
  const [hasMoreTxs, setHasMoreTxs] = useState<boolean>(false);
  const [newVal, setVal] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);

  useEffect(() => {
    setIsLoading(true);

    let _txs;
    if (currency === 'ETH') {
      _txs = txs.map((tx: any) => ToUiFriendlyEthCoin(tx, height));
    } else {
      _txs = ProcessData(txs, height);
    }
    transactionsLength(_txs.length);
    _txs = GetSortedTxs(_txs, currentOrder);
    setTxsCopy(_txs);
    const _transactions = _txs.slice(0, limit);
    setTransactions(_transactions);
    setHasMoreTxs(_transactions.length < _txs.length || !!hasMoreOnServer);
    setIsLoading(false);
  }, [txs, hasMoreOnServer]);

  const sortTransactions = (newOrder: 'mostRecent' | 'oldest') => {
    if (currentOrder === newOrder) {
      return;
    }

    setVal(newVal + 1);
    setCurrentOrder(newOrder);
    const sortedTxs = GetSortedTxs(txsCopy, newOrder);
    setTxsCopy(sortedTxs);
    setLimit(LIMIT);
    setChunkSize(CHUNK_SIZE);
    setTransactions(sortedTxs.slice(0, LIMIT));
    setHasMoreTxs(LIMIT < sortedTxs.length || !!hasMoreOnServer);
    // Tell the parent the sort changed so it can re-fetch from the server
    // with the new direction. Internal sort above gives instant visual
    // feedback while the network round-trip happens.
    if (onSortChange) {
      onSortChange(newOrder as 'mostRecent' | 'oldest');
    }
  };

  // When the parent passes `order` (BIT-47), keep our internal state in sync
  // so the highlighted sort button matches whatever data the parent fetched.
  useEffect(() => {
    if (order && order !== currentOrder) {
      setCurrentOrder(order);
    }
  }, [order]);

  const loadMore = () => {
    if (limit < txsCopy.length) {
      // More client-side rows available — reveal them.
      const newLimit = limit + chunkSize;
      setLimit(newLimit);
      setChunkSize(chunkSize * 2);
      setTransactions(txsCopy.slice(0, newLimit));
      setHasMoreTxs(newLimit < txsCopy.length || !!hasMoreOnServer);
    } else if (onLoadMore && hasMoreOnServer && !fetchingMore) {
      // Client side exhausted — ask the parent for the next server page.
      // The `txs` prop will update once the parent's fetch lands, at
      // which point the useEffect above re-runs ProcessData and reveals
      // the new rows.
      setFetchingMore(true);
      onLoadMore().finally(() => setFetchingMore(false));
    }
  };

  const sortBtnAnime = {
    whileHover: {
      cursor: 'pointer',
      scale: 1.02,
    },
  };

  return (
    <>
      {!isLoading ? (
        <>
          <SortDiv>
            <span>Sort by: </span>
            <SortButton
              variants={sortBtnAnime}
              whileHover='whileHover'
              onClick={() => sortTransactions('mostRecent')}>
              <ButtonText activeTextColor={currentOrder === 'mostRecent'}>Most Recent</ButtonText>
            </SortButton>{' '}
            |
            <SortButton
              variants={sortBtnAnime}
              whileHover='whileHover'
              onClick={() => sortTransactions('oldest')}>
              <ButtonText activeTextColor={currentOrder === 'oldest'}>Oldest</ButtonText>
            </SortButton>
          </SortDiv>

          <InfiniteScroll
            dataLength={transactions.length}
            next={loadMore}
            hasMore={hasMoreTxs}
            loader={<InfiniteScrollLoadSpinner />}>
            {transactions.map((tx: any, index: number) => {
              return (
                <div key={index}>
                  {currency === 'ETH' ? (
                    <TransactionDetailsEth transaction={tx} currency={currency} network={network} />
                  ) : (
                    <Coin
                      transaction={tx}
                      currency={currency}
                      network={network}
                      order={currentOrder}
                    />
                  )}
                </div>
              );
            })}
          </InfiniteScroll>
        </>
      ) : null}
    </>
  );
};

export default memo(CoinList);
