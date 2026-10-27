/** Simple billing helpers used by the Driftless tutorial. */
export function createInvoice(customerId, amountCents, currency = 'usd') {
  if (!customerId) throw new Error('customerId required');
  if (amountCents <= 0) throw new Error('amount must be positive');
  return {
    id: `inv_${customerId}_${amountCents}`,
    customerId,
    amountCents,
    currency,
    status: 'open',
  };
}

export function applyTax(amountCents, rate = 0.1) {
  return Math.round(amountCents * (1 + rate));
}

export function formatMoney(amountCents, currency = 'usd') {
  return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
