import { BaseModule } from '..';
import { REDDStateProvider } from '../../providers/chain-state/redd/redd';
import { IUtxoNetworkConfig } from '../../types/Config';
import { VerificationPeer } from '../bitcoin/VerificationPeer';
import { ReddcoinP2PWorker } from './p2p';

export default class REDDModule extends BaseModule {
  constructor(services: BaseModule['bitcoreServices'], chain: string, network: string, _config: IUtxoNetworkConfig) {
    super(services);
    services.Libs.register(chain, '@reddcoinproject/bitcore-lib-redd', '@reddcoinproject/bitcore-p2p-redd');
    services.P2P.register(chain, network, ReddcoinP2PWorker);
    services.CSP.registerService(chain, network, new REDDStateProvider());
    services.Verification.register(chain, network, VerificationPeer);
  }
}
