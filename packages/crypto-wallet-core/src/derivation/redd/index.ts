import BitcoreLibRedd from '@reddcoinproject/bitcore-lib-redd';
import { AbstractBitcoreLibDeriver } from '../btc';

export class ReddDeriver extends AbstractBitcoreLibDeriver {
  bitcoreLib = BitcoreLibRedd;
}
