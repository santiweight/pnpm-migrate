const leftPad = require('left-pad');

function format(value) {
  return leftPad(String(value), 3, '0');
}

if (require.main === module) {
  console.log(format(7));
}

module.exports = { format };

