'use strict';

/**
 * Fahrenheit to Celsius converter.
 *
 * @param f
 * @returns {number}
 */
function ftoc(f) {
  return (f - 32) / 1.8;
}

/**
 * Celsius to Fahrenheit converter.
 * @param {Number} c
 * @returns {number}
 * @private
 */
function ctof(c) {
  return (c * 1.8) + 32;
}


module.exports = {
  ftoc,
  ctof,
};
