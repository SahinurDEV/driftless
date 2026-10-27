import { createInvoice, applyTax, formatMoney } from '../src/billing.js';

test('createInvoice builds an open invoice', () => {
  const inv = createInvoice('cus_1', 2500);
  expect(inv.status).toBe('open');
  expect(inv.amountCents).toBe(2500);
});

test('applyTax adds ten percent by default', () => {
  expect(applyTax(1000)).toBe(1100);
});

test('formatMoney renders dollars', () => {
  expect(formatMoney(1999)).toBe('19.99 USD');
});
