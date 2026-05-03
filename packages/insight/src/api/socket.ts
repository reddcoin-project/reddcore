import {useEffect, useRef} from 'react';
import {io, Socket} from 'socket.io-client';
import {getApiRoot} from '../utilities/helper-methods';

// bitcore-node mounts socket.io on the same http server as the REST
// API (services/socket.ts:64). The REST root looks like
// `https://host[/api]`; strip the `/api` suffix to get the socket
// origin.
const apiOrigin = (currency: string) =>
  getApiRoot(currency).replace(/\/api\/?$/, '');

/**
 * Subscribe to bitcore-node's `block` event for the given chain/network.
 *
 * The server-side contract (services/socket.ts:65–88, :128–133) is:
 *   1. Connect to the http origin.
 *   2. Emit `room` with the path `/<chain>/<network>/inv`.
 *      (No auth payload — only `wallet`/`wallets` rooms gate on the
 *      bws-key signature; `inv` is public-readable.)
 *   3. The server emits `block` into that room on every confirmed
 *      block, payload IBlock (raw indexer doc, no feeData/posData).
 *
 * The hook intentionally does NOT pass the socket payload to the
 * caller — IBlock lacks the formatter-added fields (feeData, posData)
 * that the REST `/block?limit=N` endpoint provides. Instead callers
 * use this as a nudge to refetch via SWR's `mutate`, which keeps the
 * data shape consistent with the rest of the page.
 */
export const useBlockEvents = (
  currency: string | undefined,
  network: string | undefined,
  onBlock: () => void,
) => {
  // Pin the latest callback in a ref so handler re-creates don't
  // teardown+reconnect the socket every render.
  const onBlockRef = useRef(onBlock);
  useEffect(() => {
    onBlockRef.current = onBlock;
  }, [onBlock]);

  useEffect(() => {
    if (!currency || !network) return;
    const socket: Socket = io(apiOrigin(currency), {
      // Prefer websocket; fall back to polling if needed (some proxies
      // strip the upgrade header). socket.io-client handles reconnection
      // automatically, so a transient network blip doesn't permanently
      // demote the page back to polling-only.
      transports: ['websocket', 'polling'],
    });

    const room = `/${currency}/${network}/inv`;
    const join = () => socket.emit('room', room);
    socket.on('connect', join);
    socket.on('reconnect', join);

    socket.on('block', () => {
      onBlockRef.current();
    });

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [currency, network]);
};
