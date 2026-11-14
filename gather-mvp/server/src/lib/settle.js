// Expense math. All amounts are integer cents.

// Split an amount equally; leftover cents go to the first participants.
function equalSplit(amountCents, participantIds) {
  const n = participantIds.length;
  const base = Math.floor(amountCents / n);
  let remainder = amountCents - base * n;
  return participantIds.map((userId) => ({ userId, shareCents: base + (remainder-- > 0 ? 1 : 0) }));
}

/**
 * Net balance per member. Positive = the group owes them; negative = they owe.
 * @param {number[]} memberIds
 * @param {{paidBy:number, amountCents:number, splits:{userId:number, shareCents:number}[]}[]} expenses
 * @param {{fromUser:number, toUser:number, amountCents:number}[]} settlements
 */
function netBalances(memberIds, expenses, settlements) {
  const net = new Map(memberIds.map((id) => [id, 0]));
  const add = (id, cents) => net.set(id, (net.get(id) || 0) + cents);
  for (const e of expenses) {
    add(e.paidBy, e.amountCents);
    for (const s of e.splits) add(s.userId, -s.shareCents);
  }
  for (const s of settlements) {
    add(s.fromUser, s.amountCents); // paying off debt raises your balance
    add(s.toUser, -s.amountCents);  // receiving money lowers what you're owed
  }
  return net;
}

// Fewest payments: repeatedly match the biggest debtor with the biggest creditor.
// Produces at most n - 1 payments.
function settle(net) {
  const creditors = [];
  const debtors = [];
  for (const [userId, cents] of net) {
    if (cents > 0) creditors.push({ userId, cents });
    else if (cents < 0) debtors.push({ userId, cents: -cents });
  }
  const payments = [];
  while (creditors.length && debtors.length) {
    creditors.sort((a, b) => b.cents - a.cents);
    debtors.sort((a, b) => b.cents - a.cents);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.cents, d.cents);
    payments.push({ fromUser: d.userId, toUser: c.userId, amountCents: amount });
    c.cents -= amount;
    d.cents -= amount;
    if (c.cents === 0) creditors.shift();
    if (d.cents === 0) debtors.shift();
  }
  return payments;
}

module.exports = { equalSplit, netBalances, settle };
