'use strict';

// current time, in seconds
module.exports = {
  currentTime: function() {
    return Math.round(Date.now() / 1000);
  }
};
