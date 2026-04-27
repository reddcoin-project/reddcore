'use strict';

var Message = require('../message');
var inherits = require('util').inherits;
var bitcore = require('@reddcoinproject/bitcore-lib-redd');
var BufferUtil = bitcore.util.buffer;

/**
 * a message to tell the receiving peer that the sender can utilise addrv2 messages
 * @extends Message
 * @constructor
 */
function AddrV2Message(arg, options) {
  Message.call(this, options);
  this.command = 'sendaddrv2';
}
inherits(AddrV2Message, Message);

AddrV2Message.prototype.setPayload = function() {};

AddrV2Message.prototype.getPayload = function() {
  return BufferUtil.EMPTY_BUFFER;
};

module.exports = AddrV2Message;
