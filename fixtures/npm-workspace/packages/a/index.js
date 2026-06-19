const leftPad = require('left-pad');

function format(value) {
  return leftPad(String(value), 2, '0');
}

if (require.main === module) {
  console.log(format(4));
}

module.exports = { format };

