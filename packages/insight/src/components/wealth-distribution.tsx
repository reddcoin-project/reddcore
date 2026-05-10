import React, {useEffect, useRef} from 'react';
import styled from 'styled-components';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from 'chart.js';

import {useApi} from 'src/api/api';
import {getApiRoot, getConvertedValue} from 'src/utilities/helper-methods';
import {colorCodes} from 'src/utilities/constants';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// Mirrors the server-side cache window (BIT-31 stats route).
const DISTRIBUTION_REFRESH_INTERVAL_MS = 5 * 60_000;

interface DistributionBucket {
  min: number;
  max: number | null;
  addressCount: number;
  valueSum: number;
}

interface AddressDistribution {
  totalSupply: number;
  totalAddresses: number;
  buckets: DistributionBucket[];
}

interface WealthDistributionProps {
  chain: string;
  network: string;
}

const Section = styled.section`
  margin: 2.5rem 0 1rem;
`;

const Caption = styled.div`
  font-size: 0.85em;
  color: ${({theme: {dark}}) => (dark ? '#999' : '#666')};
  margin: 0.5rem 0 1rem;
`;

const ChartWrapper = styled.div`
  position: relative;
  height: 220px;
  margin: 1rem 0 1.5rem;
`;

const Wrapper = styled.div`
  overflow-x: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
  th, td {
    padding: 0.5rem 0.8rem;
    text-align: right;
  }
  th:first-child, td:first-child {
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
  td {
    font-variant-numeric: tabular-nums;
  }
`;

// "10000" → "10k", "1500000" → "1.5M". Bands are powers of 10 so the
// edges always come out clean; the format only has to look right for
// integer powers, not arbitrary values.
const formatCoinCompact = (coins: number): string => {
  if (coins === 0) return '0';
  if (coins < 1) return coins.toString();
  if (coins >= 1e9) return `${coins / 1e9}B`;
  if (coins >= 1e6) return `${coins / 1e6}M`;
  if (coins >= 1e3) return `${coins / 1e3}k`;
  return coins.toString();
};

const bucketLabel = (bucket: DistributionBucket, chain: string): string => {
  const minCoins = Number(getConvertedValue(bucket.min, chain));
  if (bucket.max === null) {
    return `${formatCoinCompact(minCoins)}+`;
  }
  const maxCoins = Number(getConvertedValue(bucket.max, chain));
  return `${formatCoinCompact(minCoins)} – ${formatCoinCompact(maxCoins)}`;
};

const formatPercent = (value: number, total: number): string => {
  if (!total) return '0%';
  const pct = (value / total) * 100;
  if (pct === 0) return '0%';
  if (pct < 0.01) return '<0.01%';
  return `${pct.toFixed(2)}%`;
};

const WealthDistribution: React.FC<WealthDistributionProps> = ({chain, network}) => {
  const url = `${getApiRoot(chain)}/${chain}/${network}/stats/distribution`;
  const {data, error} = useApi(url, {
    refreshInterval: DISTRIBUTION_REFRESH_INTERVAL_MS,
  }) as {data?: AddressDistribution; error?: Error};

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;

    const labels = data.buckets.map(b => bucketLabel(b, chain));
    const supplyPct = data.buckets.map(b =>
      data.totalSupply ? (b.valueSum / data.totalSupply) * 100 : 0
    );

    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `% of supply (${chain})`,
            data: supplyPct,
            backgroundColor: colorCodes[chain] || '#888',
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {ticks: {autoSkip: false, maxRotation: 60, minRotation: 45}},
          y: {
            beginAtZero: true,
            ticks: {callback: v => `${v}%`},
          },
        },
        plugins: {
          legend: {display: false},
          tooltip: {
            callbacks: {
              label: ctx => `${(ctx.parsed.y as number).toFixed(4)}% of supply`,
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, chain]);

  if (error) {
    return (
      <Section>
        <h3>Wealth distribution</h3>
        <Caption>Could not load distribution data: {error.message || 'request failed'}.</Caption>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section>
        <h3>Wealth distribution</h3>
        <Caption>Loading…</Caption>
      </Section>
    );
  }

  return (
    <Section>
      <h3>Wealth distribution</h3>
      <Caption>
        How {chain} is held across balance bands, aggregated from current
        unspent outputs. {data.totalAddresses.toLocaleString()} addresses,{' '}
        {Number(getConvertedValue(data.totalSupply, chain)).toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}{' '}
        {chain} total. Refreshes every five minutes.
      </Caption>
      <ChartWrapper>
        <canvas ref={canvasRef} aria-label='wealth distribution bar chart' role='img' />
      </ChartWrapper>
      <Wrapper>
        <Table>
          <thead>
            <tr>
              <th>Balance ({chain})</th>
              <th>Addresses</th>
              <th>% of addresses</th>
              <th>Coins</th>
              <th>% of coins</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((bucket, idx) => {
              const coins = Number(getConvertedValue(bucket.valueSum, chain));
              return (
                <tr key={`${bucket.min}-${bucket.max ?? 'inf'}-${idx}`}>
                  <td>{bucketLabel(bucket, chain)}</td>
                  <td>{bucket.addressCount.toLocaleString()}</td>
                  <td>{formatPercent(bucket.addressCount, data.totalAddresses)}</td>
                  <td>
                    {coins.toLocaleString(undefined, {
                      maximumFractionDigits: 8,
                    })}
                  </td>
                  <td>{formatPercent(bucket.valueSum, data.totalSupply)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Wrapper>
    </Section>
  );
};

export default WealthDistribution;
