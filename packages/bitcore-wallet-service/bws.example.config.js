/**
 * BWS configuration template.
 *
 * USAGE:
 *   cp bws.example.config.js bws.config.js
 *   # then edit the REQUIRED fields below.
 *
 * Resolution order (see src/config.ts):
 *   1. $BITCORE_CONFIG_PATH/bitcore.config.json (the `bitcoreWalletService`
 *      block, for monorepo / shared-config setups)
 *   2. $BWS_CONFIG_PATH/bws.config.js  (this file, for stand-alone setups)
 *   Whichever resolves first wins. Most operators want only #2.
 *
 * MINIMUM-VIABLE CONFIG for serving UTXO wallets against a self-hosted
 * bitcore-node + reddcoind, in roughly 30 lines:
 *
 *   module.exports = {
 *     basePath: '/bws/api',
 *     port: 3232,
 *     allowRegtest: true,                         // for local-dev only
 *     storageOpts: {
 *       mongoDb: { uri: 'mongodb://0.0.0.0:27017/bws', dbname: 'bws' }
 *     },
 *     messageBrokerOpts: {
 *       messageBrokerServer: { url: 'http://localhost:3380' }
 *     },
 *     blockchainExplorerOpts: {
 *       rdd: {
 *         livenet: { url: 'http://localhost:3000' },
 *         testnet: { url: 'http://localhost:3000', regtestEnabled: true }
 *       },
 *       socketApiKey: '<a_valid_WIF_see_note_below>'
 *     },
 *     staticRoot: '/tmp/static'
 *   };
 *
 * The full template below also wires BTC/BCH/ETH/etc against the public
 * BitPay endpoints, and includes the optional services (push, fiat,
 * email, buy/sell/swap providers) that BitPay's hosted product enables.
 * Strip what you don't need.
 *
 * --- KNOWN FOOTGUNS ---
 *
 * • socketApiKey MUST be a real Bitcoin-style WIF. The string literal
 *   below ('socketApiKey') will fail Bitcore.PrivateKey() with
 *   "Checksum mismatch" the moment bcmonitor tries to subscribe to
 *   any bitcore-node socket room. Generate a fresh one with:
 *     node -e 'console.log(new (require("@bitpay-labs/bitcore-lib").PrivateKey)("livenet").toWIF())'
 *
 * • allowRegtest defaults to false. If you're testing locally against
 *   regtest reddcoind, BWS will silently reject regtest wallet
 *   creation until you flip this to true.
 *
 * • The placeholder authorizationKey under pushNotificationsOpts is
 *   fine for a deployment that never actually sends pushes — the
 *   FCM call only fires when notifications are enqueued. If you
 *   never run pushnotificationsservice.js, it's inert.
 *
 * --- AUXILIARY PROCESSES (start.sh launches all of these) ---
 *
 *   bws.js                       — REQUIRED. The HTTP API.
 *   bcmonitor.js                 — REQUIRED for confirmation tracking.
 *                                  Subscribes to bitcore-node socket and
 *                                  feeds block events into BWS's
 *                                  confirmation counter. Without it,
 *                                  getStatus() reports `confirmations:
 *                                  0` even on confirmed UTXOs.
 *   messagebroker.js             — Optional. Cross-process events bus
 *                                  between bws/bcmonitor/etc. Without
 *                                  it, "Error connecting to message
 *                                  broker server" warnings flood the
 *                                  log; functionally non-blocking for
 *                                  single-process deployments.
 *   emailservice.js              — Optional. Outbound email
 *                                  notifications (uses emailOpts at
 *                                  the bottom of this file).
 *   pushnotificationsservice.js  — Optional. FCM push notifications
 *                                  (uses pushNotificationsOpts).
 *   fiatrateservice.js           — Optional. Polls a fiat-rate
 *                                  provider every fetchInterval mins
 *                                  and stores rates in mongo for the
 *                                  /fiatrates endpoint. Without it
 *                                  /fiatrates returns stale data.
 */

module.exports = {

  // === Server identity (REQUIRED) ===
  basePath: '/bws/api',                      // URL prefix for the API
  disableLogs: false,                        // OPTIONAL — set true to silence stdout
  port: 3232,                                // REQUIRED
  allowRegtest: false,                       // Set true for local-dev against regtest reddcoind

  // === Process management (OPTIONAL) ===
  // Uncomment to make BWS a forking server (one master + N workers):
  // cluster: true,
  // clusterInstances: 4,                    // defaults to host CPU count

  // === HTTPS (OPTIONAL) ===
  // For a public deploy, prefer terminating TLS at a reverse proxy
  // (nginx, caddy, etc) and let BWS speak plain HTTP on localhost.
  // If you must terminate TLS in BWS itself, uncomment:
  // https: true,
  // privateKeyFile: 'private.pem',
  // certificateFile: 'cert.pem',
  // CAinter1: '',  // ex. 'COMODORSADomainValidationSecureServerCA.crt'
  // CAinter2: '',  // ex. 'COMODORSAAddTrustCA.crt'
  // CAroot:   '',  // ex. 'AddTrustExternalCARoot.crt'

  // === Mongo (REQUIRED) ===
  // BWS uses Mongo for wallet records, addresses, txproposals, and
  // notifications. Mongo wire version compatibility: the bundled
  // driver is mongodb@3.5.9, which speaks to MongoDB 3.4 through 4.4.
  // A modern mongosh (≥4.2 wire-version 8) cannot talk to the same
  // mongod, but BWS itself is unaffected.
  storageOpts: {
    mongoDb: {
      uri: 'mongodb://0.0.0.0:27017/bws',
      dbname: 'bws'
    }
  },

  // === Inter-process message bus (OPTIONAL but recommended) ===
  // Used by messagebroker.js + bcmonitor.js + bws.js to coordinate.
  // Single-process deployments can leave this set; the resulting
  // "Error connecting to message broker server" warnings are benign.
  messageBrokerOpts: {
    messageBrokerServer: {
      url: 'http://localhost:3380'
    }
  },

  // === Blockchain explorer endpoints (REQUIRED for chains in use) ===
  // BWS proxies blockchain queries through bitcore-node's REST API.
  // Each chain block points BWS at the bitcore-node URL serving that
  // chain. For chains BitPay hosts (BTC, BCH, ETH, DOGE, LTC, XRP),
  // the public api.bitcore.io endpoints are usable as-is. For
  // self-hosted chains (Reddcoin's RDD), point at your own
  // bitcore-node instance.
  blockchainExplorerOpts: {
    btc: {
      livenet: { url: 'https://api.bitcore.io' },
      testnet: { url: 'https://api.bitcore.io', regtestEnabled: false },
      testnet3: { url: 'https://api.bitcore.io' },
      signet: { url: 'https://api.bitcore.io' },
    },
    bch: {
      livenet: { url: 'https://api.bitcore.io' },
      testnet: { url: 'https://api.bitcore.io', regtestEnabled: false },
      testnet3: { url: 'https://api.bitcore.io' },
      testnet4: { url: 'https://api.bitcore.io' },
      scalenet: { url: 'https://api.bitcore.io' },
      chipnet: { url: 'https://api.bitcore.io' },
    },
    eth: {
      livenet: { url: 'https://api-eth.bitcore.io' },
      testnet: { url: 'https://api-eth.bitcore.io', regtestEnabled: false },
      sepolia: { url: 'https://api-eth.bitcore.io' },
      holesky: { url: 'https://api-eth.bitcore.io' },
    },
    xrp: {
      livenet: { url: 'https://api-xrp.bitcore.io' },
      testnet: { url: 'https://api-xrp.bitcore.io', regtestEnabled: false }
    },
    doge: {
      livenet: { url: 'https://api.bitcore.io' },
      testnet: { url: 'https://api.bitcore.io', regtestEnabled: false }
    },
    ltc: {
      livenet: { url: 'https://api.bitcore.io' },
      testnet: { url: 'https://api.bitcore.io', regtestEnabled: false }
    },
    rdd: {
      // RDD is the only chain that has to be self-hosted — BitPay
      // doesn't run a Reddcoin endpoint. Point this at your own
      // bitcore-node serving the REDD chain. Defaults assume
      // bitcore-node on the same host listening on its standard 3000.
      livenet: { url: 'http://localhost:3000' },
      testnet: { url: 'http://localhost:3000', regtestEnabled: true }
    },

    // REQUIRED — must be a valid livenet WIF. See "KNOWN FOOTGUNS"
    // at the top of this file. Generate a fresh one with:
    //   node -e 'console.log(new (require("@bitpay-labs/bitcore-lib").PrivateKey)("livenet").toWIF())'
    // The example below is a syntactically-valid WIF and will not
    // crash bcmonitor at startup, but the corresponding pubkey is
    // public — DO NOT use it in production.
    socketApiKey: 'L2LX8jmxauVRFpw3JpjDQVUKVeUT1LAhMCWrKngQk5UjyQqpeTEr'
  },

  // === Push notifications (OPTIONAL) ===
  // Only matters if you run pushnotificationsservice.js. Replace
  // authorizationKey with your real FCM server key before enabling.
  pushNotificationsOpts: {
    templatePath: 'templates',
    defaultLanguage: 'en',
    defaultUnit: 'btc',
    subjectPrefix: '',
    pushServerUrl: 'https://fcm.googleapis.com/fcm',
    authorizationKey: 'You_have_to_put_something_here'
  },

  // === Fiat rate service (OPTIONAL) ===
  // Only matters if you run fiatrateservice.js. The default provider
  // ('BitPay') only knows about coins BitPay hosts; if you publish
  // an RDD wallet UI you'll want a CoinGecko-backed proxy (cf.
  // MIGRATION.md Phase 7.5e in the parent reddcore repo).
  fiatRateServiceOpts: {
    defaultProvider: 'BitPay',
    fetchInterval: 5 // in minutes
  },

  // === Maintenance flag (OPTIONAL) ===
  // When true, all write endpoints return 503. Read endpoints are
  // unaffected. Useful for staged migrations.
  maintenanceOpts: {
    maintenanceMode: false
  },

  // === On-ramp / off-ramp / swap providers (OPTIONAL) ===
  // These are BitPay's hosted-product integrations. For a vanilla
  // self-hosted wallet service none of them need to be enabled —
  // the corresponding API endpoints will respond 4xx if a client
  // hits them, but normal wallet operations are unaffected.
  services: {
    buyCrypto: {
      disabled: false,
      banxa: { disabled: false, removed: false },
      moonpay: { disabled: false, removed: false },
      ramp: { disabled: false, removed: false },
      sardine: { disabled: false, removed: false },
      simplex: { disabled: false, removed: false },
      transak: { disabled: false, removed: false },
      wyre: { disabled: false, removed: false }
    },
    sellCrypto: {
      disabled: false,
      moonpay: { disabled: false, removed: false },
      simplex: { disabled: false, removed: false }
    },
    swapCrypto: {
      disabled: false,
      changelly: { disabled: false, removed: false },
      thorswap: {
        disabled: false,
        removed: false,
        // config: {
        //   affiliateAddress: 'thorname_here',
        //   affiliateBasisPoints: 'type_number_fee_here'
        // }
      }
    },
  },

  // === Misc (OPTIONAL) ===
  suspendedChains: [],         // chain codes here are temporarily disabled
  staticRoot: '/tmp/static'    // serves /static/* for any in-tree assets

  // ===============================================================
  // The following are credentials for individual provider APIs
  // (banxa, moonpay, ramp, sardine, simplex, thorswap, transak,
  // wyre, changelly, oneInch, coinGecko, moralis). They're only
  // consumed by the buyCrypto / sellCrypto / swapCrypto endpoints
  // and the corresponding `services.*` block above. Self-hosted
  // wallet operators who don't expose those flows can leave this
  // entire region commented out.
  // ===============================================================

  // banxa : {
  //   sandbox: {
  //     api: 'https://bitpay.banxa-sandbox.com/api',
  //     apiKey: 'banxa_sandbox_api_key_here',
  //     secretKey: 'banxa_sandbox_secret_key_here',
  //   },
  //   production: {
  //     api: 'https://bitpay.banxa-sandbox.com/api',
  //     apiKey: 'banxa_production_api_key_here',
  //     secretKey: 'banxa_production_secret_key_here',
  //   },
  //   sandboxWeb: {
  //     api: 'https://bitpay.banxa-sandbox.com/api',
  //     apiKey: 'banxa_sandbox_web_api_key_here',
  //     secretKey: 'banxa_sandbox_web_secret_key_here',
  //   },
  //   productionWeb: {
  //     api: 'https://bitpay.banxa-sandbox.com/api',
  //     apiKey: 'banxa_production_web_api_key_here',
  //     secretKey: 'banxa_production_web_secret_key_here',
  //   },
  // },
  // moonpay: {
  //   sandbox: {
  //     apiKey: 'moonpay_sandbox_api_key_here',
  //     api: 'https://api.moonpay.com',
  //     widgetApi: 'https://buy-sandbox.moonpay.com',
  //     sellWidgetApi: 'https://sell-sandbox.moonpay.com',
  //     secretKey: 'moonpay_sandbox_secret_key_here',
  //   },
  //   production: {
  //     apiKey: 'moonpay_production_api_key_here',
  //     api: 'https://api.moonpay.com',
  //     widgetApi: 'https://buy.moonpay.com',
  //     sellWidgetApi: 'https://sell.moonpay.com',
  //     secretKey: 'moonpay_production_secret_key_here',
  //   },
  //   sandboxWeb: {
  //     apiKey: 'moonpay_sandbox_web_api_key_here',
  //     api: 'https://api.moonpay.com',
  //     widgetApi: 'https://buy-sandbox.moonpay.com',
  //     sellWidgetApi: 'https://sell-sandbox.moonpay.com',
  //     secretKey: 'moonpay_sandbox_web_secret_key_here',
  //   },
  //   productionWeb: {
  //     apiKey: 'moonpay_production_web_api_key_here',
  //     api: 'https://api.moonpay.com',
  //     widgetApi: 'https://buy.moonpay.com',
  //     sellWidgetApi: 'https://sell.moonpay.com',
  //     secretKey: 'moonpay_production_web_secret_key_here',
  //   }
  // },
  // ramp: {
  //   sandbox: {
  //     apiKey: 'ramp_sandbox_api_key_here',
  //     api: 'https://api.demo.rampnetwork.com/api',
  //     widgetApi: 'https://app.demo.rampnetwork.com/',
  //     signingKey: 'ramp_sandbox_signing_key_here',
  //   },
  //   production: {
  //     apiKey: 'ramp_production_api_key_here',
  //     api: 'https://api.rampnetwork.com/api',
  //     widgetApi: 'https://app.rampnetwork.com/',
  //     signingKey: 'ramp_production_signing_key_here',
  //   },
  //   sandboxWeb: {
  //     apiKey: 'ramp_sandbox_web_api_key_here',
  //     api: 'https://api.demo.rampnetwork.com/api',
  //     widgetApi: 'https://app.demo.rampnetwork.com/',
  //     signingKey: 'ramp_sandbox_web_signing_key_here',
  //   },
  //   productionWeb: {
  //     apiKey: 'ramp_production_web_api_key_here',
  //     api: 'https://api.rampnetwork.com/api',
  //     widgetApi: 'https://app.rampnetwork.com/',
  //     signingKey: 'ramp_production_web_signing_key_here',
  //   }
  // },
  // sardine: {
  //   sandbox: {
  //     api: 'https://api.sandbox.sardine.ai',
  //     secretKey: 'sardine_sandbox_secret_key_here',
  //     clientId: 'sardine_sandbox_client_id_here',
  //   },
  //   production: {
  //     api: 'https://api.sardine.ai/v1',
  //     secretKey: 'sardine_production_secret_key_here',
  //     clientId: 'sardine_production_client_id_here',
  //   },
  //   sandboxWeb: {
  //     api: 'https://api.sandbox.sardine.ai',
  //     secretKey: 'sardine_sandbox_web_secret_key_here',
  //     clientId: 'sardine_sandbox_web_client_id_here',
  //   },
  //   productionWeb: {
  //     api: 'https://api.sardine.ai/v1',
  //     secretKey: 'sardine_production_web_secret_key_here',
  //     clientId: 'sardine_production_web_client_id_here',
  //   }
  // },
  // simplex: {
  //   sandbox: {
  //     apiKey: 'simplex_sandbox_api_key_here',
  //     api: 'https://sandbox.test-simplexcc.com',
  //     apiSell: 'https://sell-checkout-waf.sandbox.test-simplexcc.com',
  //     appProviderId: 'simplex_provider_id_here',
  //     appSellRefId: 'simplex_sell_ref_id_here',
  //     publicKey: 'simplex_sandbox_public_key_here',
  //   },
  //   production: {
  //     apiKey: 'simplex_production_api_key_here',
  //     api: 'https://backend-wallet-api.simplexcc.com',
  //     apiSell: 'https://sell-checkout-widget.simplex.com',
  //     appProviderId: 'simplex_provider_id_here',
  //     appSellRefId: 'simplex_sell_ref_id_here',
  //     publicKey: 'simplex_public_key_here',
  //   },
  //   sandboxWeb: {
  //     apiKey: 'simplex_sandbox_web_api_key_here',
  //     api: 'https://sandbox.test-simplexcc.com',
  //     apiSell: 'https://sell-checkout-waf.sandbox.test-simplexcc.com',
  //     appProviderId: 'simplex_web_provider_id_here',
  //     appSellRefId: 'simplex_web_sell_ref_id_here',
  //     publicKey: 'simplex_web_sandbox_public_key_here',
  //   },
  //   productionWeb: {
  //     apiKey: 'simplex_production_web_api_key_here',
  //     api: 'https://backend-wallet-api.simplexcc.com',
  //     apiSell: 'https://sell-checkout-widget.simplex.com',
  //     appProviderId: 'simplex_web_provider_id_here',
  //     appSellRefId: 'simplex_web_sell_ref_id_here',
  //     publicKey: 'simplex_web_public_key_here',
  //   }
  // },
  // thorswap : {
  //   sandbox: {
  //     api: 'https://dev-api.thorswap.net',
  //     apiKey: 'thorswap_sandbox_api_key_here',
  //     secretKey: 'thorswap_sandbox_secret_key_here',
  //     referer: 'thorswap_sandbox_referer_here'
  //   },
  //   production: {
  //     api: 'https://api.thorswap.net',
  //     apiKey: 'thorswap_production_api_key_here',
  //     secretKey: 'thorswap_production_secret_key_here',
  //     referer: 'thorswap_production_referer_here'
  //   },
  // },
  // transak : {
  //   sandbox: {
  //     api: 'https://api-stg.transak.com',
  //     widgetApi: 'https://api-gateway-stg.transak.com',
  //     apiKey: 'transak_sandbox_api_key_here',
  //     secretKey: 'transak_sandbox_secret_key_here',
  //   },
  //   production: {
  //     api: 'https://api.transak.com',
  //     widgetApi: 'https://api-gateway.transak.com',
  //     apiKey: 'transak_production_api_key_here',
  //     secretKey: 'transak_production_secret_key_here',
  //   },
  //   sandboxWeb: {
  //     api: 'https://api-stg.transak.com',
  //     widgetApi: 'https://api-gateway-stg.transak.com',
  //     apiKey: 'transak_sandbox_web_api_key_here',
  //     secretKey: 'transak_sandbox_web_secret_key_here',
  //   },
  //   productionWeb: {
  //     api: 'https://api.transak.com',
  //     widgetApi: 'https://api-gateway.transak.com',
  //     apiKey: 'transak_production_web_api_key_here',
  //     secretKey: 'transak_production_web_secret_key_here',
  //   }
  // },
  // wyre: {
  //   sandbox: {
  //     apiKey: 'wyre_sandbox_api_key_here',
  //     secretApiKey: 'wyre_sandbox_secret_api_key_here',
  //     api: 'https://api.testwyre.com',
  //     widgetUrl: 'https://pay.testwyre.com',
  //     appProviderAccountId: 'wyre_provider_sandbox_account_id_here'
  //   },
  //   production: {
  //     apiKey: 'wyre_production_api_key_here',
  //     secretApiKey: 'wyre_production_secret_api_key_here',
  //     api: 'https://api.sendwyre.com',
  //     widgetUrl: 'https://pay.sendwyre.com/',
  //     appProviderAccountId: 'wyre_provider_production_account_id_here'
  //   }
  // },
  // changelly: {
  //   v1: {
  //     apiKey: 'changelly_api_key',
  //     secret: 'changelly_secret',
  //     api: 'https://api.changelly.com'
  //   },
  //   v2: {
  //     secret: 'changelly_secret_v2',
  //     api: 'https://api.changelly.com/v2'
  //   }
  // },
  // oneInch: {
  //   api: 'https://api.1inch.dev',
  //   apiKey: 'one_inch_api_key',
  //   referrerAddress: 'one_inch_referrer_address', // ETH
  //   referrerFee: 'one_inch_referrer_fee',         // min: 0; max: 3 (percent)
  // },
  // coinGecko: {
  //   api: 'https://api.coingecko.com/api',
  // },
  // moralis: {
  //   apiKey: 'moralis_api_key_here',
  //   whitelist: []
  // },

  // === Email notifications (OPTIONAL) ===
  // Only matters if you run emailservice.js. Configure either an
  // SMTP relay (emailOpts) or SendGrid (set mailer below).
  //
  // emailOpts: {
  //   host: 'localhost',
  //   port: 25,
  //   ignoreTLS: true,
  //   subjectPrefix: '[Wallet Service]',
  //   from: 'wallet-service@bitcore.io',
  //   // Prod templates live in the copay-emails repo: https://github.com/bitpay/copay-emails
  //   templatePath: 'templates',
  //   defaultLanguage: 'en',
  //   defaultUnit: 'btc',
  //   publicTxUrlTemplate: {
  //     btc:  { livenet: 'https://bitpay.com/insight/#/BTC/mainnet/tx/{{txid}}',  testnet: 'https://bitpay.com/insight/#/BTC/testnet/tx/{{txid}}' },
  //     bch:  { livenet: 'https://bitpay.com/insight/#/BCH/mainnet/tx/{{txid}}',  testnet: 'https://bitpay.com/insight/#/BCH/testnet/tx/{{txid}}' },
  //     eth:  { livenet: 'https://etherscan.io/tx/{{txid}}',                     testnet: 'https://kovan.etherscan.io/tx/{{txid}}' },
  //     xrp:  { livenet: 'https://xrpscan.com/tx/{{txid}}',                       testnet: 'https://test.bithomp.com/explorer//tx/{{txid}}' },
  //     doge: { livenet: 'https://blockchair.com/dogecoin/transaction/{{txid}}',  testnet: 'https://sochain.com/tx/DOGETEST/{{txid}}' },
  //     ltc:  { livenet: 'https://bitpay.com/insight/#/LTC/mainnet/tx/{{txid}}',  testnet: 'https://bitpay.com/insight/#/LTC/testnet/tx/{{txid}}' },
  //   },
  // },
  //
  // To use SendGrid instead of SMTP:
  //   const sgMail = require('@sendgrid/mail');
  //   sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // and then add to module.exports:
  //   mailer: sgMail,
};
