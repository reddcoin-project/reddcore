import React, {useEffect} from 'react';
import {useNavigate, useParams, useSearchParams} from 'react-router-dom';
import styled from 'styled-components';
import nProgress from 'nprogress';

import Info from '../components/info';
import {useApi} from 'src/api/api';
import {useAppDispatch} from 'src/utilities/hooks';
import {changeCurrency, changeNetwork} from 'src/store/app.actions';
import {
  getApiRoot,
  getConvertedValue,
  normalizeParams,
} from 'src/utilities/helper-methods';

// Server caches /stats/active for 10 min (BIT-32 route). Match it.
const REFRESH_INTERVAL_MS = 10 * 60_000;

const WINDOW_BUCKETS = [1, 7, 30, 90] as const;
type WindowBucket = (typeof WINDOW_BUCKETS)[number];
const DEFAULT_WINDOW: WindowBucket = 30;

const FILTERS = ['any', 'received', 'sent', 'staking'] as const;
type Filter = (typeof FILTERS)[number];
const DEFAULT_FILTER: Filter = 'any';

const FILTER_LABELS: Record<Filter, string> = {
  any: 'Any tx',
  received: 'Received',
  sent: 'Sent',
  staking: 'Staking',
};

interface ActiveEntry {
  rank: number;
  address: string;
  txCount: number;
  lastActiveHeight: number;
  lastActiveTime: string;
}

interface BalanceShape {
  confirmed: number;
  unconfirmed: number;
  balance: number;
}

const Wrapper = styled.div`
  margin: 1rem 0;
  overflow-x: auto;
`;

const ControlRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin: 0.75rem 0 1rem;
  align-items: center;
`;

const ControlGroup = styled.div`
  display: flex;
  gap: 0.25rem;
  align-items: center;
`;

const ControlLabel = styled.span`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin-right: 0.5rem;
`;

const TabButton = styled.button<{$active: boolean}>`
  padding: 0.4rem 0.9rem;
  border: 1px solid ${({theme: {dark}}) => (dark ? '#444' : '#c0c4c8')};
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.95em;
  font-weight: ${({$active}) => ($active ? 600 : 400)};
  background: ${({$active, theme: {dark}}) =>
    $active ? (dark ? '#3a3a3a' : '#e2e8ef') : 'transparent'};
  color: ${({theme: {dark}}) => (dark ? '#fff' : '#222')};
  &:hover {
    background: ${({theme: {dark}}) => (dark ? '#3a3a3a' : '#dfe6ed')};
  }
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 16px;
  th, td { padding: 0.6rem 0.8rem; text-align: left; }
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

const NumericCell = styled.td`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const Caption = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin: 0.5rem 0 0;
`;

const Muted = styled.span`
  color: ${({theme: {dark}}) => (dark ? '#888' : '#888')};
`;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

// Each visible row issues a per-address /balance fetch. Cheap (indexed
// lookup by address) and cached by SWR so revisiting the page reuses it.
const BalanceCell: React.FC<{chain: string; network: string; address: string}> = ({
  chain,
  network,
  address,
}) => {
  const url = `${getApiRoot(chain)}/${chain}/${network}/address/${address}/balance`;
  const {data} = useApi(url) as {data?: BalanceShape};
  if (!data) return <Muted>…</Muted>;
  return (
    <>
      {Number(getConvertedValue(data.confirmed, chain)).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      })}
    </>
  );
};

const ActiveList: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  if (currency && network) {
    const _n = normalizeParams(currency, network);
    currency = _n.currency;
    network = _n.network;
  }

  useEffect(() => {
    if (!currency || !network) return;
    dispatch(changeCurrency(currency));
    dispatch(changeNetwork(network));
  }, [currency, network]);

  // URL-driven controls. Validate against known buckets so a hand-crafted
  // ?windowDays=99 doesn't break the table.
  const windowParam = Number(searchParams.get('windowDays'));
  const windowDays: WindowBucket = (WINDOW_BUCKETS as readonly number[]).includes(windowParam)
    ? (windowParam as WindowBucket)
    : DEFAULT_WINDOW;
  const filterParam = searchParams.get('filter') as Filter | null;
  const filter: Filter = filterParam && FILTERS.includes(filterParam) ? filterParam : DEFAULT_FILTER;

  const apiBase = currency && network ? `${getApiRoot(currency)}/${currency}/${network}` : null;
  const url = apiBase
    ? `${apiBase}/stats/active?windowDays=${windowDays}&filter=${filter}&limit=100`
    : null;

  const {data, error} = useApi(url, {refreshInterval: REFRESH_INTERVAL_MS}) as {
    data?: ActiveEntry[];
    error?: Error;
  };
  const isLoading = !!url && !data && !error;

  useEffect(() => {
    if (isLoading) {
      nProgress.start();
    } else {
      nProgress.done();
    }
    return () => {
      nProgress.done();
    };
  }, [isLoading]);

  if (!currency || !network) return null;
  const chain = currency;
  const net = network;

  const errorMessage = error
    ? error.message || 'Something went wrong. Please try again later.'
    : '';

  const switchWindow = (n: WindowBucket) => {
    if (n === DEFAULT_WINDOW) searchParams.delete('windowDays');
    else searchParams.set('windowDays', String(n));
    setSearchParams(searchParams);
  };

  const switchFilter = (f: Filter) => {
    if (f === DEFAULT_FILTER) searchParams.delete('filter');
    else searchParams.set('filter', f);
    setSearchParams(searchParams);
  };

  const countLabel =
    filter === 'staking' ? 'Stakes' : filter === 'received' ? 'Received' : filter === 'sent' ? 'Sent' : 'Txs';

  return (
    <>
      {errorMessage ? <Info type={'error'} message={errorMessage} /> : null}
      <h2>{chain} {net} — active addresses (top {data?.length ?? '...'})</h2>
      <ControlRow>
        <ControlGroup>
          <ControlLabel>Window</ControlLabel>
          {WINDOW_BUCKETS.map(n => (
            <TabButton key={n} $active={n === windowDays} onClick={() => switchWindow(n)}>
              {n}d
            </TabButton>
          ))}
        </ControlGroup>
        <ControlGroup>
          <ControlLabel>Filter</ControlLabel>
          {FILTERS.map(f => (
            <TabButton key={f} $active={f === filter} onClick={() => switchFilter(f)}>
              {FILTER_LABELS[f]}
            </TabButton>
          ))}
        </ControlGroup>
      </ControlRow>
      <Caption>
        Top-balance addresses ranked by{' '}
        {filter === 'staking'
          ? 'coinstake transactions'
          : filter === 'sent'
          ? 'distinct spending transactions'
          : filter === 'received'
          ? 'distinct receiving transactions'
          : 'distinct transactions that touched the address'}{' '}
        in the last {windowDays} day{windowDays === 1 ? '' : 's'}. Refreshes every ten minutes.
      </Caption>
      {data && data.length === 0 && (
        <Caption>No activity in this window. Try a longer window.</Caption>
      )}
      {data && data.length > 0 && (
        <Wrapper>
          <Table>
            <thead>
              <tr>
                <th style={{textAlign: 'right'}}>#</th>
                <th>Address</th>
                <th style={{textAlign: 'right'}}>{countLabel} ({windowDays}d)</th>
                <th style={{textAlign: 'right'}}>Last active</th>
                <th style={{textAlign: 'right'}}>Balance ({chain})</th>
              </tr>
            </thead>
            <tbody>
              {data.map(entry => (
                <tr
                  key={entry.address}
                  onClick={() => navigate(`/${chain}/${net}/address/${entry.address}`)}
                  title={`Open ${entry.address}`}>
                  <RankCell>{entry.rank}</RankCell>
                  <AddressCell>{entry.address}</AddressCell>
                  <NumericCell>{entry.txCount.toLocaleString()}</NumericCell>
                  <NumericCell title={`block ${entry.lastActiveHeight.toLocaleString()}`}>
                    {formatDate(entry.lastActiveTime)}
                  </NumericCell>
                  <NumericCell>
                    <BalanceCell chain={chain} network={net} address={entry.address} />
                  </NumericCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Wrapper>
      )}
    </>
  );
};

export default ActiveList;
