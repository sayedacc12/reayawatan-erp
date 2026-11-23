// اختبار وحدة بلا اعتماديات: node --test --experimental-strip-types src/modules/billing/numbers.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latinNum, num } from './numbers.ts';

test('reads Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
  assert.equal(num('٢'), 2);
  assert.equal(num('١٫٥'), 1.5);
  assert.equal(num('۱۲'), 12);
  assert.equal(num('1,5'), 1.5);
  assert.equal(num(3), 3);
  assert.equal(latinNum('٢٠٠ ريال'), '200');
});

test('an empty or invalid field is NaN, never 0, so a filled line is not dropped silently', () => {
  assert.ok(Number.isNaN(num('')));
  assert.ok(Number.isNaN(num('.')));
  assert.ok(Number.isNaN(num(null)));
});
