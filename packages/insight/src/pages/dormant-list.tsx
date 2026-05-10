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
  getFormattedDate,
  normalizeParams,
} from 'src/utilities/helper-methods';

// Server caches the underlying aggregation for 5 min (BIT-29 stats route);
// matching the SWR refresh interval avoids wasted client work.
const REFRESH_INTERVAL_MS = 5 * 60_000;

// Common dormancy buckets. Default 5y (the most-cited threshold).
const YEAR_BUCKETS = [1, 2, 3, 5, 7] as const;
type YearBucket = (typeof YEAR_BUCKETS)[number];
const DEFAULT_YEARS: YearBucket = 5;

interface DormantEntry {
  rank: number;
  address: string;
  balance: number;
  lastActiveHeight: number;
  lastActiveTime: string;
}

const Wrapper = styled.div`
  margin: 1rem 0;
  overflow-x: auto;
`;

const TabRow = styled.div`
  display: flex;
  gap: 0.25rem;
  margin: 0.75rem 0 1rem;
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

const DormantList: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Read the dormancy bucket from the URL (?years=5). Falls back to default.
  // Validate against YEAR_BUCKETS so a hand-crafted ?years=99 doesn't break.
  const yearsParam = Number(searchParams.get('years'));
  const years: YearBucket = (YEAR_BUCKETS as readonly number[]).includes(yearsParam)
    ? (yearsParam as YearBucket)
    : DEFAULT_YEARS;

  if (!currency || !network) return null;
  const chain = currency;
  const net = network;

  const url = `${getApiRoot(chain)}/${chain}/${net}/stats/dormant-list?years=${years}&limit=100`;

  const {data, error} = useApi(url, {
    refreshInterval: REFRESH_INTERVAL_MS,
  }) as {data?: DormantEntry[]; error?: Error};
  const isLoading = !data && !error;

  useEffect(() => {
    if (isLoading) {
      nProgress.start();
    } else {
      nProgress.done();
    }
    return () => { nProgress.done(); };
  }, [isLoading]);

  const errorMessage = error ? (error.message || 'Something went wrong. Please try again later.') : '';

  const switchYears = (n: YearBucket) => {
    if (n === DEFAULT_YEARS) {
      searchParams.delete('years');
    } else {
      searchParams.set('years', String(n));
    }
    setSearchParams(searchParams);
  };

  return (
    <>
      {errorMessage ? <Info type={'error'} message={errorMessage} /> : null}
      <h2>{chain} {net} — dormant addresses (top {data?.length ?? '...'})</h2>
      <TabRow>
        {YEAR_BUCKETS.map(n => (
          <TabButton key={n} $active={n === years} onClick={() => switchYears(n)}>
            {n}y
          </TabButton>
        ))}
      </TabRow>
      <Caption>
        Top-balance addresses with no on-chain receive activity for ≥ {years} year{years === 1 ? '' : 's'}.
        Last-activity is the height of the most-recent unspent receive; a
        change-output back to the same address resets this clock.
      </Caption>
      {data && (
        <Wrapper>
          <Table>
            <thead>
              <tr>
                <th style={{textAlign: 'right'}}>#</th>
                <th>Address</th>
                <th style={{textAlign: 'right'}}>Balance ({chain})</th>
                <th style={{textAlign: 'right'}}>Last active</th>
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
                  <NumericCell>
                    {Number(getConvertedValue(entry.balance, chain)).toLocaleString(
                      undefined,
                      {minimumFractionDigits: 0, maximumFractionDigits: 8}
                    )}
                  </NumericCell>
                  <NumericCell title={`block ${entry.lastActiveHeight}`}>
                    {getFormattedDate(entry.lastActiveTime)}
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

export default DormantList;
