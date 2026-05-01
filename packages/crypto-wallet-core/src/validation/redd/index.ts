import BitcoreRedd from '@reddcoinproject/bitcore-lib-redd';
import type { IValidation } from '../../types/validation';

export class ReddValidation implements IValidation {
  validateAddress(network: string, address: string): boolean {
    const Address = BitcoreRedd.Address;
    return Address.isValid(address, network);
  }

  validateUri(addressUri: string): boolean {
    // Check if the input is a valid uri or address.
    // bitcore-lib-redd's URI accepts the `reddcoin:` scheme (Phase 3b.7).
    const URIRedd = BitcoreRedd.URI;
    return URIRedd.isValid(addressUri);
  }
}
