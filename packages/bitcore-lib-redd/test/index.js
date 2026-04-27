"use strict";

var should = require("chai").should();
var reddcore = require("../");

describe('#versionGuard', function() {
  it('global._reddcore should be defined', function() {
    should.equal(global._reddcore, reddcore.version);
  });

  it('throw an error if version is already defined', function() {
    (function() {
      reddcore.versionGuard('version');
    }).should.throw('More than one instance of reddcore');
  });
});
