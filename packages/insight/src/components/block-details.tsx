import {motion} from 'framer-motion';
import nProgress from 'nprogress';
import {FC, memo, useEffect, useState} from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import {useNavigate} from 'react-router-dom';
import styled from 'styled-components';
import {fetcher} from '../api/api';
import {DisplayFlex} from '../assets/styles/global';
import {Grid} from '../assets/styles/grid';
import {Tile, TileDescription, TileLink} from '../assets/styles/tile';
import {MainTitle, SecondaryTitle} from '../assets/styles/titles';
import {routerFadeIn} from '../utilities/animations';
import {
  getApiRoot,
  getConvertedValue,
  getDifficultyFromBits,
  getFee,
  getFormattedDate,
  isPoSBlock,
  normalizeParams,
} from '../utilities/helper-methods';
import CopyText from './copy-text';
import SupCurrencyLogo from './icons/sup-currency-logo';
import InfiniteScrollLoadSpinner from './infinite-scroll-load-spinner';
import Info from './info';
import {SharedTile} from './shared';
import TransactionDetails from './transaction-details';

interface BlockDetailsProps {
  currency: string;
  network: string;
  block: string;
}

const ConsensusBadge = styled.span<{$pos: boolean}>`
  display: inline-block;
  margin-left: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.05em;
  vertical-align: middle;
  color: #fff;
  background: ${({$pos}) => ($pos ? '#7B4FD9' : '#F7931A')};
`;

const populateTxsForBlock = (
  txData: any,
  {time, height, isPoS}: {time: number; height: number; isPoS: boolean},
) => {
  // PoSV invariant: every PoS block has tx[0] = coinbase placeholder
  // and tx[1] = coinstake. The /block/<hash>/coins endpoint returns
  // txids in block order, so the second entry is the coinstake.
  //
  // We accept *either* signal as evidence the second tx is a coinstake:
  //   1. block.posData.isProofOfStake (server-truth — only present after
  //      the indexer / backfill has populated it)
  //   2. tx.outputs[0].value === 0 (the empty marker output on the
  //      coinstake — a structural property that holds for every PoSV
  //      coinstake regardless of whether posData has been backfilled
  //      yet, so the COINSTAKE badge shows up even on un-backfilled
  //      historical blocks)
  // Either way it requires inputs.length > 0 (rules out a coinbase).
  const txd = txData.txids.map((txid: any, index: number) => {
    const tx: any = {};
    tx.txid = txid;
    tx.inputs = txData.inputs.filter((input: any) => input.spentTxid === txid);
    tx.outputs = txData.outputs.filter((output: any) => output.mintTxid === txid);
    tx.coinbase = tx.inputs.length === 0;
    tx.isCoinBase = tx.coinbase;
    const couldBeCoinstake = index === 1 && tx.inputs.length > 0;
    const hasMarkerOutput = couldBeCoinstake && tx.outputs[0]?.value === 0;
    tx.isCoinstake = couldBeCoinstake && (isPoS || hasMarkerOutput);
    if (tx.isCoinstake) {
      const inputsTotal = tx.inputs.reduce((a: any, b: any) => a + b.value, 0);
      const outputsTotal = tx.outputs.reduce((a: any, b: any) => a + b.value, 0);
      tx.stakeReward = outputsTotal - inputsTotal;
      tx.fee = 0;
    } else {
      tx.fee = getFee(tx);
    }
    tx.blockHeight = tx.outputs[0].mintHeight;
    tx.blockTime = time;
    tx.value = tx.outputs
      .filter((output: any) => output.mintTxid === txid)
      .reduce((a: any, b: any) => a + b.value, 0);
    tx.confirmations = tx.blockHeight > 0 ? height - tx.blockHeight + 1 : tx.blockHeight;
    return tx;
  });
  return txd;
};

const BlockDetails: FC<BlockDetailsProps> = ({currency, network, block}) => {
  const _normalizeParams = normalizeParams(currency, network);
  currency = _normalizeParams.currency;
  network = _normalizeParams.network;
  const baseUrl = `${getApiRoot(currency)}/${currency}/${network}`;
  const navigate = useNavigate();
  const gotoBlock = (hash: string) => navigate(`/${currency}/${network}/block/${hash}`);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<any>();
  const [transactionList, setTransactionList] = useState<any>();
  const [hasMore, setHasMore] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [tip, setTip] = useState<any>();
  const [isLoadingMoreData, setIsLoadingMoreData] = useState<boolean>();

  useEffect(() => {
    if (!block) return;
    nProgress.start();
    Promise.all([
      fetcher(`${baseUrl}/block/${block}?limit=200`),
      fetcher(`${baseUrl}/block/${block}/coins/100/${pageNumber}`),
      fetcher(`${baseUrl}/block/tip`),
    ])
      .then(([_summary, _transactionList, _tip]) => {
        setSummary(_summary);
        setTip(_tip);
        if (_transactionList) {
          _transactionList = [_transactionList];
          const formattedData = _transactionList
            .map((data: any) =>
              populateTxsForBlock(data, {
                time: _tip.time,
                height: _tip.height,
                isPoS: isPoSBlock(_summary),
              }),
            )
            .flat();

          setTransactionList(formattedData);
          setHasMore(!!_transactionList[_transactionList.length - 1].next);
          setPageNumber(pageNumber + 1);
        }
      })
      .catch((e: any) => {
        setError(e.message || 'Something went wrong. Please try again later.');
      })
      .finally(() => {
        setIsLoading(false);
        nProgress.done();
      });
  }, [block]);

  const loadMore = () => {
    if (hasMore && !isLoadingMoreData) {
      setIsLoadingMoreData(true);
      fetcher(`${baseUrl}/block/${block}/coins/100/${pageNumber}`)
        .then(_transactionList => {
          _transactionList = [_transactionList];

          const formattedData = _transactionList
            .map((data: any) =>
              populateTxsForBlock(data, {
                time: tip.time,
                height: tip.height,
                isPoS: isPoSBlock(summary),
              }),
            )
            .flat();

          setTransactionList(transactionList.concat(formattedData));
          setHasMore(!!_transactionList[_transactionList.length - 1].next);
          setPageNumber(pageNumber + 1);
        })
        .catch(e => {
          setError(e.message || 'Something went wrong. Please try again later.');
        })
        .finally(() => setIsLoadingMoreData(false));
    }
  };

  return (
    <>
      {!isLoading ? (
        <>
          {error ? <Info type={'error'} message={error} /> : null}
          {summary ? (
            <motion.div variants={routerFadeIn} animate='animate' initial='initial'>
              <MainTitle style={{marginBottom: 8}}>
                Block #{summary.height}
                <SupCurrencyLogo currency={currency} />
                {summary.posData && (
                  <ConsensusBadge $pos={summary.posData.isProofOfStake}>
                    {summary.posData.isProofOfStake ? 'PoS' : 'PoW'}
                  </ConsensusBadge>
                )}
              </MainTitle>

              <DisplayFlex>
                <TileDescription margin='0 1rem 0 0' width='auto' noTruncate>
                  Block Hash
                </TileDescription>
                <TileDescription value>
                  {summary.hash}

                  <CopyText text={summary.hash} />
                </TileDescription>
              </DisplayFlex>

              <SecondaryTitle>Summary</SecondaryTitle>

              <Grid margin='0 0 3rem 0'>
                <SharedTile title='Merkle Root' description={summary.merkleRoot} />
                <SharedTile
                  title='Difficulty'
                  description={getDifficultyFromBits(summary.bits).toString()}
                />
                <SharedTile title='Bits' description={summary.bits} />
                <SharedTile title='Size (bytes)' description={summary.size} />
                <SharedTile title='Version' description={summary.version} />
                <SharedTile title='Nonce' description={summary.nonce} />
                <SharedTile title='Number of Transactions' description={summary.transactionCount} />

                <Tile withBorderBottom>
                  <TileDescription margin='0 1rem 0 0'>Previous Block</TileDescription>
                  <TileLink value textAlign='right' disabled={!summary.previousBlockHash || summary.height === 0}>
                    <span
                      onClick={() =>
                        summary.previousBlockHash ? gotoBlock(summary.previousBlockHash) : null
                      }>
                      {(summary.height > 0) ? summary.height - 1 : 'None'}
                    </span>
                  </TileLink>
                </Tile>

                <SharedTile title='Height' description={`${summary.height}`} />

                <Tile withBorderBottom>
                  <TileDescription margin='0 1rem 0 0'>Next Block</TileDescription>
                  <TileLink value textAlign='right' disabled={!summary.nextBlockHash}>
                    <span
                      onClick={() =>
                        summary.nextBlockHash ? gotoBlock(summary.nextBlockHash) : null
                      }>
                      {summary.height + 1}
                    </span>
                  </TileLink>
                </Tile>

                {/* BIT-48: PoSV blocks carry the staker payout in posData
                    (subsidy + collected fees), not in summary.reward (which
                    is 0 because the coinbase is the empty placeholder).
                    Show staking labels for these blocks; "Block Reward"
                    stays for PoW blocks. */}
                {summary.posData && summary.posData.isProofOfStake ? (
                  <>
                    <SharedTile
                      title='Stake Reward'
                      description={`${getConvertedValue(summary.posData.subsidy, currency).toFixed(3)} ${currency}`}
                    />
                    <SharedTile
                      title='Stake-tx Fees'
                      description={`${getConvertedValue(summary.posData.totalFeesCollected, currency).toFixed(5)} ${currency}`}
                    />
                  </>
                ) : (
                  <SharedTile
                    title='Block Reward'
                    description={`${getConvertedValue(summary.reward, currency).toFixed(3)} ${currency}`}
                  />
                )}
                <SharedTile title='Confirmations' description={summary.confirmations} />

                <SharedTile title='Timestamp' description={getFormattedDate(summary.time) || ''} />
              </Grid>

              <SecondaryTitle>Transactions</SecondaryTitle>

              {transactionList.length ? (
                <InfiniteScroll
                  next={() => loadMore()}
                  hasMore={hasMore}
                  loader={<InfiniteScrollLoadSpinner />}
                  scrollThreshold={0.95}
                  dataLength={transactionList.length}>
                  {transactionList.map((tx: any, index: number) => {
                    return (
                      <div key={index}>
                        <TransactionDetails
                          transaction={tx}
                          currency={currency}
                          network={network}
                        />
                      </div>
                    );
                  })}
                </InfiniteScroll>
              ) : (
                <Info
                  type={'warning'}
                  message={'There are no transactions involving this block.'}
                />
              )}
            </motion.div>
          ) : null}
        </>
      ) : null}
    </>
  );
};

export default memo(BlockDetails);
