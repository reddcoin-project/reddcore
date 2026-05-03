import BlockList from 'src/components/block-list';
import React, {useEffect} from 'react';
import ChainHeader from '../components/chain-header';
import {useParams} from 'react-router-dom';
import {useAppDispatch} from 'src/utilities/hooks';
import {changeCurrency, changeNetwork} from 'src/store/app.actions';
import {getApiRoot, normalizeParams} from 'src/utilities/helper-methods';
import {useApi} from 'src/api/api';
import {useBlockEvents} from 'src/api/socket';
import nProgress from 'nprogress';
import Info from 'src/components/info';
import {useBlocks} from 'src/contexts';
import {BitcoinBlockType} from 'src/utilities/models';

// BIT-6 Phase B: socket.io subscription drives near-instant updates;
// SWR polling is now a 5-minute safety net for missed events / a
// dropped socket. Don't drop polling entirely — a long-running tab
// whose socket reconnect logic has given up shouldn't go silent.
const BLOCKS_REFRESH_INTERVAL_MS = 5 * 60_000;

const Blocks: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();

  const { blocks, setBlocks } = useBlocks();

  if (currency && network) {
    const _norm = normalizeParams(currency, network);
    currency = _norm.currency;
    network = _norm.network;
  }

  useEffect(() => {
    if (!currency || !network) return;
    dispatch(changeCurrency(currency));
    dispatch(changeNetwork(network));
  }, [currency, network]);

  const url = currency && network
    ? `${getApiRoot(currency)}/${currency}/${network}/block?limit=200`
    : null;

  const {data, error, mutate} = useApi(url, {refreshInterval: BLOCKS_REFRESH_INTERVAL_MS});
  // SWR 1.x doesn't expose `isLoading` — derive it the same way SWR
  // does internally: no data and no error means a request is in flight.
  const isLoading = !!url && !data && !error;

  // Live update via bitcore-node's socket.io `block` event. We don't
  // hand the raw payload up — it's the indexer-level IBlock without
  // feeData/posData — instead we nudge SWR to refetch the same /block
  // endpoint, so the data shape stays consistent with the rest of the
  // page and the merge logic in the next effect dedupes additions.
  useBlockEvents(currency, network, mutate);

  // Reset the context when the chain or network changes so blocks from
  // the previous chain don't bleed into the new view between fetches.
  useEffect(() => {
    setBlocks(undefined);
  }, [url, setBlocks]);

  // Merge SWR results into the BlocksContext rather than replacing — the
  // user may have scrolled to load older blocks via block-list's
  // infinite-scroll fetchMore, and a naive replace on every poll would
  // drop those.
  useEffect(() => {
    if (!data) return;
    setBlocks(prev => {
      if (!prev) return data;
      const seen = new Set(prev.map((b: BitcoinBlockType) => b.height));
      const additions = (data as BitcoinBlockType[]).filter(b => !seen.has(b.height));
      if (!additions.length) return prev;
      return [...additions, ...prev].sort((a, b) => b.height - a.height);
    });
  }, [data, setBlocks]);

  // Show nProgress on the first fetch only — background polls stay
  // quiet so the page doesn't blink every 30s.
  useEffect(() => {
    if (!blocks && isLoading) {
      nProgress.start();
    } else {
      nProgress.done();
    }
    return () => { nProgress.done(); };
  }, [blocks, isLoading]);

  if (!currency || !network) return null;

  const errorMessage = error ? (error.message || 'Something went wrong. Please try again later.') : '';

  return (
    <>
      {errorMessage ? <Info type={'error'} message={errorMessage} /> : null}
      <ChainHeader currency={currency} network={network} />
      { blocks && <BlockList currency={currency} network={network} /> }
    </>
  );
}

export default Blocks;
