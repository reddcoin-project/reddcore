import { InternalStateProvider } from '../internal/internal';

export class REDDStateProvider extends InternalStateProvider {
  constructor(chain: string = 'REDD') {
    super(chain);
  }
}
