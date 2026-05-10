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

interface RichListEntry {
  rank: number;
  address: string;
  balance: number;
}

const Wrapper = styled.div`
  margin: 1rem 0;
  overflow-x: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 16px;
  th, td {
    padding: 0.6rem 0.8rem;
    text-align: left;
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

const BalanceCell = styled.td`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const Caption = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin: 0.5rem 0 1rem;
`;

const RichList: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

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

  const {data, error} = useApi(url, {
    refreshInterval: RICH_LIST_REFRESH_INTERVAL_MS,
  }) as {data?: RichListEntry[]; error?: Error};
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
        minutes. Server returns up to 1000 entries; the page shows the
        top 100.
      </Caption>
      {data && (
        <Wrapper>
          <Table>
            <thead>
              <tr>
                <th style={{textAlign: 'right'}}>#</th>
                <th>Address</th>
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
                  <BalanceCell>
                    {Number(getConvertedValue(entry.balance, chain)).toLocaleString(
                      undefined,
                      {minimumFractionDigits: 0, maximumFractionDigits: 8}
                    )}
                  </BalanceCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Wrapper>
      )}
    </>
  );
};

export default RichList;
