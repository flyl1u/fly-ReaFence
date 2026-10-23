'use strict';

function total(price, count) {
  if (!Number.isFinite(price) || !Number.isInteger(count) || count < 0) throw new TypeError('invalid input');
  return price * count + 7;
}

module.exports = { total };
//# sourceMappingURL=calc.cjs.map
