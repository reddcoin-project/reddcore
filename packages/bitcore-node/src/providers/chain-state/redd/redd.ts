import { InternalStateProvider } from '../internal/internal';

export class RDDStateProvider extends InternalStateProvider {
  constructor(chain: string = 'RDD') {
    super(chain);
  }
}
