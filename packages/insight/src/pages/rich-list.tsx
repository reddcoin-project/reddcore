import React, {useEffect} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import styled from 'styled-components';
import nProgress from 'nprogress';

import Info from '../components/info';
import WealthDistribution from '../components/wealth-distribution';
import {useApi} from 'src/api/api';
import {useAppDispatch} from 'src/utilities/hooks';
import {changeCurrency, changeNetwork} from 'src/store/app.actions';
import {
  getApiRoot,
  getConvertedValue,
  normalizeParams,
} from 'src/utilities/helper-methods';

// Server caches the underlying aggregation for 5 min already (BIT-28
// stats route); refreshing client-side any faster is wasted work.
const RICH_LIST_REFRESH_INTERVAL_MS = 5 * 60_000;
// Per-row stats are cached 1h server-side and change slowly — match the
// browser-side refresh to keep network chatter low.
const ROW_STATS_REFRESH_INTERVAL_MS = 60 * 60_000;

interface RichListEntry {
  rank: number;
  address: string;
  balance: number;
}

interface ChainSupply {
  circulating: number;
  unspentCount: number;
  asOfHeight: number;
  asOf: string;
}

interface ActivityRef {
  height: number;
  time: string;
}

interface AddressStats {
  address: string;
  firstIn: ActivityRef | null;
  lastIn: ActivityRef | null;
  numIns: number;
  firstOut: ActivityRef | null;
  lastOut: ActivityRef | null;
  numOuts: number;
}

const Wrapper = styled.div`
  margin: 1rem 0;
  overflow-x: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
  th, td {
    padding: 0.55rem 0.7rem;
    text-align: left;
    white-space: nowrap;
  }
  th {
    border-bottom: 2px solid ${({theme: {dark}}) => (dark ? '#444' : '#d0d4d8')};
    font-weight: 600;
  }
  tbody tr:nth-child(odd) {
    background-color: ${({theme: {dark}}) => (dark ? '#2a2a2a' : '#f6f7f9')};
  }
  tbody tr:nth-child(even) {
    background-color: ${({theme: {dark}}) => (dark ? '#0f0f0f' : '#e0e4e7')};
  }
  tbody tr:hover {
    background-color: ${({theme: {dark}}) => (dark ? '#3a3a3a' : '#dfe6ed')};
    cursor: pointer;
  }
  td.num, th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  /* Hide first/last in/out columns on narrower viewports — keep counts. */
  @media (max-width: 1100px) {
    th.activity-date, td.activity-date {
      display: none;
    }
  }
`;

const RankCell = styled.td`
  width: 4rem;
  font-weight: 600;
  text-align: right;
`;

const AddressCell = styled.td`
  font-family: monospace;
  word-break: break-all;
`;

const Muted = styled.span`
  color: ${({theme: {dark}}) => (dark ? '#888' : '#888')};
`;

const Caption = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin: 0.5rem 0 1rem;
`;

const formatDate = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const formatPercent = (balance: number, supply: number | undefined): string => {
  if (!supply) return '';
  const pct = (balance / supply) * 100;
  if (pct === 0) return '0%';
  if (pct < 0.0001) return '<0.0001%';
  return `${pct.toFixed(4)}%`;
};

interface RowProps {
  chain: string;
  network: string;
  entry: RichListEntry;
  supply: ChainSupply | undefined;
}

const RichListRow: React.FC<RowProps> = ({chain, network, entry, supply}) => {
  const navigate = useNavigate();
  const url = `${getApiRoot(chain)}/${chain}/${network}/address/${entry.address}/stats`;
  const {data: stats} = useApi(url, {
    refreshInterval: ROW_STATS_REFRESH_INTERVAL_MS,
  }) as {data?: AddressStats};

  const renderRef = (ref: ActivityRef | null | undefined): React.ReactNode => {
    if (!stats) return <Muted>…</Muted>;
    if (!ref) return <Muted>—</Muted>;
    return <span title={`block ${ref.height.toLocaleString()}`}>{formatDate(ref.time)}</span>;
  };

  const renderCount = (n: number | undefined): React.ReactNode => {
    if (!stats) return <Muted>…</Muted>;
    return (n ?? 0).toLocaleString();
  };

  return (
    <tr
      onClick={() => navigate(`/${chain}/${network}/address/${entry.address}`)}
      title={`Open ${entry.address}`}>
      <RankCell>{entry.rank}</RankCell>
      <AddressCell>{entry.address}</AddressCell>
      <td className='num'>
        {Number(getConvertedValue(entry.balance, chain)).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 8,
        })}
      </td>
      <td className='num'>
        {supply ? formatPercent(entry.balance, supply.circulating) : <Muted>…</Muted>}
      </td>
      <td className='activity-date'>{renderRef(stats?.firstIn)}</td>
      <td className='activity-date'>{renderRef(stats?.lastIn)}</td>
      <td className='num'>{renderCount(stats?.numIns)}</td>
      <td className='activity-date'>{renderRef(stats?.firstOut)}</td>
      <td className='activity-date'>{renderRef(stats?.lastOut)}</td>
      <td className='num'>{renderCount(stats?.numOuts)}</td>
    </tr>
  );
};

const RichList: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();

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
    ? `${getApiRoot(currency)}/${currency}/${network}/stats/rich-list?limit=100`
    : null;
  const supplyUrl = currency && network
    ? `${getApiRoot(currency)}/${currency}/${network}/stats/supply`
    : null;

  const {data, error} = useApi(url, {
    refreshInterval: RICH_LIST_REFRESH_INTERVAL_MS,
  }) as {data?: RichListEntry[]; error?: Error};
  const {data: supply} = useApi(supplyUrl, {
    refreshInterval: RICH_LIST_REFRESH_INTERVAL_MS,
  }) as {data?: ChainSupply};
  const isLoading = !!url && !data && !error;

  useEffect(() => {
    if (isLoading) {
      nProgress.start();
    } else {
      nProgress.done();
    }
    return () => { nProgress.done(); };
  }, [isLoading]);

  if (!currency || !network) return null;
  // TS doesn't carry the narrowing of `let` vars into closures (.map below
  // could in theory run after a reassignment), so freeze them as const.
  const chain = currency;
  const net = network;

  const errorMessage = error ? (error.message || 'Something went wrong. Please try again later.') : '';

  return (
    <>
      {errorMessage ? <Info type={'error'} message={errorMessage} /> : null}
      <h2>{chain} {net} — rich list</h2>
      <WealthDistribution chain={chain} network={net} />
      <h3>Top {data?.length ?? '...'} addresses</h3>
      <Caption>
        Aggregated from current unspent outputs. Refreshes every five
        minutes. Per-address activity (first/last receive and spend, counts)
        is cached hourly. Addresses with more than 10,000 lifetime coins
        report counts as &quot;&gt;10k&quot; to keep the fan-out bounded.
      </Caption>
      {data && (
        <Wrapper>
          <Table>
            <thead>
              <tr>
                <th className='num'>#</th>
                <th>Address</th>
                <th className='num'>Balance ({chain})</th>
                <th className='num'>% of supply</th>
                <th className='activity-date'>First in</th>
                <th className='activity-date'>Last in</th>
                <th className='num'>Ins</th>
                <th className='activity-date'>First out</th>
                <th className='activity-date'>Last out</th>
                <th className='num'>Outs</th>
              </tr>
            </thead>
            <tbody>
              {data.map(entry => (
                <RichListRow
                  key={entry.address}
                  chain={chain}
                  network={net}
                  entry={entry}
                  supply={supply}
                />
              ))}
            </tbody>
          </Table>
        </Wrapper>
      )}
    </>
  );
};

export default RichList;
