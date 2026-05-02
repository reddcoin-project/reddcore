export const SUPPORTED_CURRENCIES = ['BTC', 'BCH', 'ETH', 'DOGE', 'LTC', 'RDD'];
export const API_ROOT = process.env.REACT_APP_API_ROOT || 'https://api.bitcore.io/api';
export const API_ROOT_ETH = process.env.REACT_APP_API_ROOT_ETH || 'https://api-eth.bitcore.io/api';
export const API_ROOT_RDD = process.env.REACT_APP_API_ROOT_RDD || 'http://localhost:3000/api';
// Home-tile poll cadence. UTXO chains were 600_000 (10 min) and ETH was
// 300_000 (5 min); both felt broken on a single-chain explorer where
// users sit on the page waiting for the next block. BIT-6 Phase A drops
// these to a minute. Phase B will switch the blocks page itself to a
// socket.io subscription, at which point the home tile is the only
// place left polling and these intervals can be revisited again.
export const ETH_DEFAULT_REFRESH_INTERVAL = 60_000;
export const UTXO_DEFAULT_REFRESH_INTERVAL = 60_000;
export const COIN = 100000000;
export const DEFAULT_RBF_SEQ_NUMBER = 0xffffffff;

export const colorCodes: any = {
  BTC: '#F7931A',
  BCH: '#2FCF6E',
  ETH: '#6B71D6',
  LTC: '#868686',
  DOGE: '#B29832',
  RDD: '#CC0000',
};

// Media breakpoints
export const size = {
  mobileS: '320px',
  mobileM: '375px',
  mobileL: '425px',
  tablet: '768px',
  laptop: '1024px',
  laptopL: '1440px',
  desktop: '2560px',
};

export const device = {
  mobileS: `(min-width: ${size.mobileS})`,
  mobileM: `(min-width: ${size.mobileM})`,
  mobileL: `(min-width: ${size.mobileL})`,
  tablet: `(min-width: ${size.tablet})`,
  laptop: `(min-width: ${size.laptop})`,
  laptopL: `(min-width: ${size.laptopL})`,
  desktop: `(min-width: ${size.desktop})`,
  desktopL: `(min-width: ${size.desktop})`,
};
