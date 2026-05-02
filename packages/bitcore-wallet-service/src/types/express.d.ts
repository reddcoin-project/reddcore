// Module augmentation for Express's Request type. The middleware in this
// package writes wallet-state onto `req` (auth, redirect, support flags)
// for downstream handlers to read, and the original code did this without
// declaring the properties — TypeScript's strict-property checks were
// hidden behind a misconfigured `typeRoots` until BIT-7 (commit 51281d146).
//
// All properties are optional because they're only set by specific
// middleware paths; handlers that read them must continue to handle
// the undefined case.

import { Session } from 'src/lib/model/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `expressapp.ts:835` when a route is internally redirected. */
      redirectedUrl?: string;
      /** Set by `expressapp.ts:188` once the auth chain confirms a support-staff session. */
      isSupportStaff?: boolean;
      /** Set by `expressapp.ts:196` after WalletService resolution. */
      walletId?: string;
      /** Set by `expressapp.ts:197` after WalletService resolution. */
      copayerId?: string;
      /** Set by `routes/middleware/authRequest.ts:107`. */
      copayer?: any;
      /** Set by `routes/middleware/authTssRequest.ts:57`. */
      session?: Session;
    }
  }
}

// Marking as a module so TS picks up the augmentation without polluting
// the file's scope with anything else.
export {};
