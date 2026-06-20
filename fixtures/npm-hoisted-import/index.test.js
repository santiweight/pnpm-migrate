const assert = require('node:assert/strict');
const green = require('./index');

assert.equal(green('ok'), '\u001B[32mok\u001B[39m');
