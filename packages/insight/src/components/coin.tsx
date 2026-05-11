import {CoinsList} from '../utilities/models';
import {FC, useEffect, useState, memo} from 'react';
import {getApiRoot, getConvertedValue, getFormattedDate} from '../utilities/helper-methods';
import {fetcher} from '../api/api';
import {
  TransactionTile,
  TransactionTileBody,
  TransactionChip,
  TransactionTileFlex,
  SpanLink,
  TransactionBodyCol,
} from '../assets/styles/transaction';
import {Tile, TileDescription, TileLink} from '../assets/styles/tile';
import {useNavigate} from 'react-router-dom';

interface CoinProps {
  transaction: CoinsList;
  currency: string;
  network: any;
  order: string;
}
const Coin: FC<CoinProps> = ({transaction, currency, network, order}) => {
  const navigate = useNavigate();
  const [showTimer, setShowTimer] = useState(false);
  const [time, setTime] = useState(null);
  const {mintTxid, height, confirmations, value, spentTxid, direction, inValue, outValue} =
    transaction;
  // Default to legacy semantics for any caller still constructing entries
  // without the grouping fields (e.g. ETH path constructs its own shape).
  const effectiveDirection: 'in' | 'out' | 'self' =
    direction ?? (mintTxid && spentTxid ? 'self' : spentTxid ? 'out' : 'in');
  const txid = mintTxid || spentTxid;
  const isStake = currency === 'RDD' && effectiveDirection === 'self' && (value ?? 0) > 0;

  const gotToTx = (txid: string | undefined) => {
    return navigate({pathname: `/${currency}/${network}/tx/${txid}`});
  };

  const getTxData = async (txid: string | undefined) => {
    const apiRoot = getApiRoot(currency as string);
    const endpoint = `${apiRoot}/${currency}/${network}/tx/${txid}`;
    try {
      const {blockTime} = await fetcher(endpoint);
      setTime(blockTime);
      setShowTimer(true);
    } catch (e) {
      console.log(e);
    }
  };

  // To reset Timer when list order changes
  useEffect(() => {
    setShowTimer(false);
  }, [order]);

  const statusChips = (
    <>
      {height === -2 && effectiveDirection === 'out' && <TransactionChip>Unspent</TransactionChip>}
      {height === -3 && <TransactionChip error>Invalid</TransactionChip>}
      {height === -4 && effectiveDirection !== 'in' && <TransactionChip error>Error</TransactionChip>}
      {height === -5 && <TransactionChip error>Expired</TransactionChip>}
      {confirmations === -1 && <TransactionChip warning>Unconfirmed</TransactionChip>}
      {confirmations === 1 && <TransactionChip primary>1 Confirmation</TransactionChip>}
      {confirmations > 1 && (
        <TransactionChip primary>{confirmations} Confirmations</TransactionChip>
      )}
    </>
  );

  // One tile per grouped tx. Three layouts:
  //   'in'   — green value, no sign prefix
  //   'out'  — red value with leading minus
  //   'self' — neutral chip + net value (Stake/Self-pay label on RDD)
  let valueChip: JSX.Element;
  if (effectiveDirection === 'out') {
    valueChip = (
      <TransactionChip error margin='0 0 0 1rem'>
        - {getConvertedValue(value, currency)} {currency}
      </TransactionChip>
    );
  } else if (effectiveDirection === 'self') {
    const absNet = Math.abs(value ?? 0);
    const sign = (value ?? 0) >= 0 ? '+' : '-';
    valueChip = (
      <>
        <TransactionChip margin='0 0 0 1rem'>{isStake ? 'Stake' : 'Self-pay'}</TransactionChip>
        <TransactionChip
          margin='0 0 0 0.5rem'
          title={`In: ${getConvertedValue(inValue ?? 0, currency)} ${currency}  ·  Out: ${getConvertedValue(outValue ?? 0, currency)} ${currency}`}>
          {sign} {getConvertedValue(absNet, currency)} {currency}
        </TransactionChip>
      </>
    );
  } else {
    valueChip = (
      <TransactionChip margin='0 0 0 1rem'>
        {getConvertedValue(value, currency)} {currency}
      </TransactionChip>
    );
  }

  return (
    <TransactionTile>
      {txid && (
        <>
          <TransactionTileBody>
            {height >= -1 && (
              <TransactionBodyCol type='Six' padding='0 1rem'>
                <Tile>
                  <TileDescription padding='0 1rem 0 0' value>
                    <SpanLink onClick={() => gotToTx(txid)}>{txid}</SpanLink>
                  </TileDescription>
                </Tile>
              </TransactionBodyCol>
            )}
            <TransactionBodyCol type='Six' backgroundColor='transparent' padding='0 1rem'>
              <TransactionTileFlex justifyContent='flex-end'>
                {statusChips}
                {valueChip}
              </TransactionTileFlex>
            </TransactionBodyCol>
          </TransactionTileBody>

          <TransactionTileFlex>
            {showTimer ? (
              <TileDescription value width='auto'>
                {' '}
                {confirmations > 0 ? 'Mined' : 'Seen'} on {getFormattedDate(time)}{' '}
              </TileDescription>
            ) : (
              <TileLink value width='auto' onClick={() => getTxData(txid)}>
                Tx Details
              </TileLink>
            )}
          </TransactionTileFlex>
        </>
      )}
    </TransactionTile>
  );
};

export default memo(Coin);
