const ansiStyles = require('ansi-styles');

module.exports = function green(value) {
  return `${ansiStyles.green.open}${value}${ansiStyles.green.close}`;
};
