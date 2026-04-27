# Reddcoin URIs

Represents a reddcoin payment URI. Reddcoin URI strings became the most popular way to share payment requests, sometimes as a hyperlink and others using a QR code.

URI Examples:

```sh
reddcoin:RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV
reddcoin:RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV?amount=1.2
reddcoin:RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV?amount=1.2&message=Payment&label=Satoshi&extra=other-param
```

## URI Validation

The main use that we expect you'll have for the `URI` class in bitcore is validating and parsing reddcoin URIs. A `URI` instance exposes the address as a bitcore `Address` object and the amount in Satoshis, if present.

The code for validating URIs looks like this:

```javascript
var uriString = 'reddcoin:RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV?amount=1.2';
var valid = URI.isValid(uriString);
var uri = new URI(uriString);
console.log(uri.address.network, uri.amount); // 'livenet', 120000000
```

## URI Parameters

All standard parameters can be found as members of the `URI` instance. However a reddcoin URI may contain other non-standard parameters, all those can be found under the `extra` namespace.

See [the official BIP21 spec](https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki) for more information.

## Create URI

Another important use case for the `URI` class is creating a reddcoin URI for sharing a payment request. That can be accomplished by using a dictionary to create an instance of URI.

The code for creating an URI from an Object looks like this:

```javascript
var uriString = new URI({
  address: 'RtXwY8BB61A38iYgSSynhdAPyQ2azUT9gV',
  amount : 10000, // in satoshis
  message: 'My payment request'
});
var uriString = uri.toString();
```
