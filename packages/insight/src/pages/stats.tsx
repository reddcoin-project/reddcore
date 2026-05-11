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
  getFormattedDate,
  normalizeParams,
} from 'src/utilities/helper-methods';

// All four underlying endpoints cache 5 min server-side; matching that
// here keeps the page snappy and avoids redundant network chatter.
const REFRESH_MS = 5 * 60_000;
const ACTIVE_REFRESH_MS = 10 * 60_000;  // matches /stats/active cache
const PREVIEW_TOP_LIMIT = 8;
const PREVIEW_DORMANT_LIMIT = 5;
const PREVIEW_ACTIVE_LIMIT = 5;
const DEFAULT_DORMANCY_YEARS = 5;
const ACTIVE_PREVIEW_WINDOW_DAYS = 7;

interface ChainSupply {
  circulating: number;
  unspentCount: number;
  asOfHeight: number;
  asOf: string;
}

interface AddressDistributionLite {
  totalSupply: number;
  totalAddresses: number;
}

interface RichListEntry {
  rank: number;
  address: string;
  balance: number;
}

interface DormantEntry extends RichListEntry {
  lastActiveHeight: number;
  lastActiveTime: string;
}

interface ActiveEntry {
  rank: number;
  address: string;
  txCount: number;
  lastActiveHeight: number;
  lastActiveTime: string;
}

const KpiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin: 1rem 0 2rem;
`;

const KpiCard = styled.div`
  background-color: ${({theme: {dark}}) => (dark ? '#1a1a1a' : '#f6f7f9')};
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
`;

const KpiLabel = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const KpiValue = styled.div`
  font-size: 1.6em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin: 0.4rem 0 0;
`;

const KpiSub = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin-top: 0.25rem;
`;

const Section = styled.section`
  margin: 2rem 0;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
`;

const ViewAll = styled.span`
  font-size: 0.9em;
  cursor: pointer;
  color: ${({theme: {dark}}) => (dark ? '#7ab' : '#06c')};
  &:hover { text-decoration: underline; }
`;

const Wrapper = styled.div`
  overflow-x: auto;
`;

const PreviewTable = styled.table`
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
`;

const RankCell = styled.td`
  width: 3rem;
  font-weight: 600;
  text-align: right;
`;

const AddressCell = styled.td`
  font-family: monospace;
  word-break: break-all;
`;

const formatCoin = (sats: number, chain: string): string =>
  Number(getConvertedValue(sats, chain)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });

const formatPercent = (numer: number, denom: number): string => {
  if (!denom) return '';
  const pct = (numer / denom) * 100;
  if (pct === 0) return '0%';
  if (pct < 0.01) return '<0.01%';
  return `${pct.toFixed(2)}%`;
};

const formatDate = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const Stats: React.FC = () => {
  let {currency, network} = useParams<{currency: string; network: string}>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

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

  // Build URLs (null when params are missing so the SWR fetchers stay idle).
  const apiBase = currency && network ? `${getApiRoot(currency)}/${currency}/${network}` : null;
  const supplyUrl = apiBase ? `${apiBase}/stats/supply` : null;
  const distUrl = apiBase ? `${apiBase}/stats/distribution` : null;
  const topUrl = apiBase ? `${apiBase}/stats/rich-list?limit=${PREVIEW_TOP_LIMIT}` : null;
  const dormUrl = apiBase
    ? `${apiBase}/stats/dormant-list?years=${DEFAULT_DORMANCY_YEARS}&limit=${PREVIEW_DORMANT_LIMIT}`
    : null;
  const activeUrl = apiBase
    ? `${apiBase}/stats/active?windowDays=${ACTIVE_PREVIEW_WINDOW_DAYS}&filter=staking&limit=${PREVIEW_ACTIVE_LIMIT}`
    : null;

  const {data: supply, error: supplyErr} = useApi(supplyUrl, {refreshInterval: REFRESH_MS}) as {
    data?: ChainSupply;
    error?: Error;
  };
  const {data: distribution} = useApi(distUrl, {refreshInterval: REFRESH_MS}) as {
    data?: AddressDistributionLite;
  };
  const {data: topHolders} = useApi(topUrl, {refreshInterval: REFRESH_MS}) as {
    data?: RichListEntry[];
  };
  const {data: dormant} = useApi(dormUrl, {refreshInterval: REFRESH_MS}) as {
    data?: DormantEntry[];
  };
  const {data: activeStakers} = useApi(activeUrl, {refreshInterval: ACTIVE_REFRESH_MS}) as {
    data?: ActiveEntry[];
  };

  const isLoading = !!supplyUrl && !supply && !supplyErr;
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
  // Freeze the narrowed params for use inside closures below — `let` vars
  // don't carry narrowing through callbacks (same pattern as rich-list).
  const chain = currency;
  const net = network;

  const errorMessage = supplyErr
    ? supplyErr.message || 'Something went wrong loading stats.'
    : '';

  return (
    <>
      {errorMessage ? <Info type={'error'} message={errorMessage} /> : null}
      <h2>{chain} {net} — chain stats</h2>

      <KpiGrid>
        <KpiCard>
          <KpiLabel>Circulating supply</KpiLabel>
          <KpiValue>{supply ? `${formatCoin(supply.circulating, chain)} ${chain}` : '…'}</KpiValue>
          <KpiSub>
            {supply ? `${supply.unspentCount.toLocaleString()} unspent outputs` : ''}
          </KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>Addresses with balance</KpiLabel>
          <KpiValue>
            {distribution ? distribution.totalAddresses.toLocaleString() : '…'}
          </KpiValue>
          <KpiSub>{distribution ? 'non-zero spendable balance' : ''}</KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>Tip height</KpiLabel>
          <KpiValue>{supply ? supply.asOfHeight.toLocaleString() : '…'}</KpiValue>
          <KpiSub>{supply ? `as of ${getFormattedDate(supply.asOf)}` : ''}</KpiSub>
        </KpiCard>
      </KpiGrid>

      <WealthDistribution chain={chain} network={net} />

      <Section>
        <SectionHeader>
          <h3>Top holders</h3>
          <ViewAll onClick={() => navigate(`/${chain}/${net}/rich-list`)}>
            Full rich list →
          </ViewAll>
        </SectionHeader>
        {topHolders && supply ? (
          <Wrapper>
            <PreviewTable>
              <thead>
                <tr>
                  <th className='num'>#</th>
                  <th>Address</th>
                  <th className='num'>Balance ({chain})</th>
                  <th className='num'>% of supply</th>
                </tr>
              </thead>
              <tbody>
                {topHolders.map(e => (
                  <tr
                    key={e.address}
                    onClick={() => navigate(`/${chain}/${net}/address/${e.address}`)}
                    title={`Open ${e.address}`}>
                    <RankCell>{e.rank}</RankCell>
                    <AddressCell>{e.address}</AddressCell>
                    <td className='num'>{formatCoin(e.balance, chain)}</td>
                    <td className='num'>{formatPercent(e.balance, supply.circulating)}</td>
                  </tr>
                ))}
              </tbody>
            </PreviewTable>
          </Wrapper>
        ) : null}
      </Section>

      <Section>
        <SectionHeader>
          <h3>Active stakers (last {ACTIVE_PREVIEW_WINDOW_DAYS}d)</h3>
          <ViewAll
            onClick={() =>
              navigate(
                `/${chain}/${net}/active?filter=staking&windowDays=${ACTIVE_PREVIEW_WINDOW_DAYS}`
              )
            }>
            All active addresses →
          </ViewAll>
        </SectionHeader>
        {activeStakers ? (
          activeStakers.length === 0 ? (
            <p style={{fontSize: '0.9em', opacity: 0.7}}>
              No coinstake transactions seen in the last {ACTIVE_PREVIEW_WINDOW_DAYS} days.
            </p>
          ) : (
            <Wrapper>
              <PreviewTable>
                <thead>
                  <tr>
                    <th className='num'>#</th>
                    <th>Address</th>
                    <th className='num'>Stakes ({ACTIVE_PREVIEW_WINDOW_DAYS}d)</th>
                    <th className='num'>Last stake</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStakers.map(e => (
                    <tr
                      key={e.address}
                      onClick={() => navigate(`/${chain}/${net}/address/${e.address}`)}
                      title={`Open ${e.address}`}>
                      <RankCell>{e.rank}</RankCell>
                      <AddressCell>{e.address}</AddressCell>
                      <td className='num'>{e.txCount.toLocaleString()}</td>
                      <td className='num' title={`block ${e.lastActiveHeight.toLocaleString()}`}>
                        {formatDate(e.lastActiveTime)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </PreviewTable>
            </Wrapper>
          )
        ) : null}
      </Section>

      <Section>
        <SectionHeader>
          <h3>Dormant holders ({DEFAULT_DORMANCY_YEARS}y+)</h3>
          <ViewAll onClick={() => navigate(`/${chain}/${net}/dormant`)}>
            Full dormant list →
          </ViewAll>
        </SectionHeader>
        {dormant ? (
          <Wrapper>
            <PreviewTable>
              <thead>
                <tr>
                  <th className='num'>#</th>
                  <th>Address</th>
                  <th className='num'>Balance ({chain})</th>
                  <th className='num'>Last active</th>
                </tr>
              </thead>
              <tbody>
                {dormant.map(e => (
                  <tr
                    key={e.address}
                    onClick={() => navigate(`/${chain}/${net}/address/${e.address}`)}
                    title={`Open ${e.address}`}>
                    <RankCell>{e.rank}</RankCell>
                    <AddressCell>{e.address}</AddressCell>
                    <td className='num'>{formatCoin(e.balance, chain)}</td>
                    <td className='num'>{formatDate(e.lastActiveTime)}</td>
                  </tr>
                ))}
              </tbody>
            </PreviewTable>
          </Wrapper>
        ) : null}
      </Section>
    </>
  );
};

export default Stats;
