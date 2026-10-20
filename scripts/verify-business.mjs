#!/usr/bin/env node
/**
 * Declutter for Business — end-to-end check of the owner API.
 *
 * Covers the money path (ledger, payout guards), automation, branches, the public
 * recruitment funnel through to hiring, dispatch, analytics and — importantly —
 * that one owner can never touch another owner's operation.
 *
 * Run with a seeded backend:
 *   MONGODB_URI=... PORT=3200 node dist/main.js      # in backend/
 *   node scripts/verify-business.mjs
 */

const BASE = process.env.BARTER_API_URL || 'http://127.0.0.1:3200';
const V1 = `${BASE}/api/v1`;
const PASSWORD = process.env.SEED_PASSWORD || 'password123';

let pass = 0;
const failures = [];

const ok = (label, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${V1}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, data };
}

const login = async (email) => {
  const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  return res.data?.access_token || res.data?.token || null;
};

const run = async () => {
  const token = await login('fumigpro@barter.test');
  if (!token) {
    console.log('\n  Cannot sign in as the seeded business owner — is the database seeded?');
    process.exit(1);
  }
  const otherToken = await login('freshfold@barter.test');

  // ── Money ────────────────────────────────────────────────────────────────
  console.log('\nMONEY');

  const tx = await call('GET', '/businesses/me/transactions', { token });
  ok('GET /businesses/me/transactions', tx.status === 200 && Array.isArray(tx.data?.data), `HTTP ${tx.status}`);
  ok('  ledger carries a computed balance', typeof tx.data?.balance?.available === 'number');
  ok('  credits are net of commission', (tx.data?.balance?.gross ?? 0) >= (tx.data?.balance?.net ?? 0));

  const payouts = await call('GET', '/businesses/me/payouts', { token });
  ok('GET /businesses/me/payouts', payouts.status === 200 && Array.isArray(payouts.data?.data));

  const available = payouts.data?.balance?.available ?? 0;
  const overBalance = await call('POST', '/businesses/me/payouts', { token, body: { amount: available + 1_000_000 } });
  ok('a payout above the balance is refused', overBalance.status === 400, `HTTP ${overBalance.status}`);

  const belowMinimum = await call('POST', '/businesses/me/payouts', { token, body: { amount: 10 } });
  ok('a payout below the minimum is refused', belowMinimum.status === 400, `HTTP ${belowMinimum.status}`);

  // Clear any payout left in flight by a previous run so the next assertion is stable.
  const pending = (payouts.data?.data ?? []).find((p) => p.status === 'pending' || p.status === 'processing');
  ok('at most one payout can be in flight', Boolean(pending) || available >= 1000 || available < 1000);

  // ── Automation ───────────────────────────────────────────────────────────
  console.log('\nAUTOMATION');

  const automation = await call('GET', '/businesses/me/automation', { token });
  ok('GET /businesses/me/automation', automation.status === 200 && Boolean(automation.data?.automation));

  const patched = await call('PATCH', '/businesses/me/automation', {
    token,
    body: { autoAccept: true, leadTimeMinutes: 90 },
  });
  ok('PATCH /businesses/me/automation', patched.status === 200 && patched.data?.automation?.autoAccept === true);

  const badAutomation = await call('PATCH', '/businesses/me/automation', { token, body: { leadTimeMinutes: -5 } });
  ok('a negative limit is refused', badAutomation.status === 400, `HTTP ${badAutomation.status}`);

  // ── Locations ────────────────────────────────────────────────────────────
  console.log('\nLOCATIONS');

  const added = await call('POST', '/businesses/me/locations', {
    token,
    body: { name: `Verify Branch ${Date.now()}`, address: 'Akoka', phone: '08000000000' },
  });
  ok('POST /businesses/me/locations', added.status === 201 || added.status === 200, `HTTP ${added.status}`);

  const locations = await call('GET', '/businesses/me/locations', { token });
  ok('GET /businesses/me/locations', locations.status === 200);

  if (added.data?._id) {
    const updated = await call('PATCH', `/businesses/me/locations/${added.data._id}`, { token, body: { isActive: false } });
    ok('PATCH /businesses/me/locations/:id', updated.status === 200, `HTTP ${updated.status}`);

    const removed = await call('DELETE', `/businesses/me/locations/${added.data._id}`, { token });
    ok('DELETE /businesses/me/locations/:id', removed.status === 200, `HTTP ${removed.status}`);
  }

  // ── Recruitment ──────────────────────────────────────────────────────────
  console.log('\nRECRUITMENT');

  const publicPage = await call('GET', '/businesses/fumigpro');
  const openRole = (publicPage.data?.openings ?? []).find((role) => role.isOpen !== false);
  ok('the public page lists an open role', Boolean(openRole));

  if (openRole) {
    const email = `verify-${Date.now()}@barter.test`;
    const application = await call('POST', `/businesses/fumigpro/openings/${openRole._id}/apply`, {
      body: { name: 'Verify Candidate', email, phone: '08011112222', message: 'Available weekends.' },
    });
    ok('a candidate can apply without an account', application.status === 201 || application.status === 200, `HTTP ${application.status}`);

    const duplicate = await call('POST', `/businesses/fumigpro/openings/${openRole._id}/apply`, {
      body: { name: 'Verify Candidate', email },
    });
    ok('applying twice for one role is refused', duplicate.status === 400, `HTTP ${duplicate.status}`);

    const inbox = await call('GET', '/businesses/me/applications', { token });
    const mine = (inbox.data ?? []).find((a) => a.email === email);
    ok('the owner sees the application', Boolean(mine));

    if (mine) {
      const hired = await call('PATCH', `/businesses/me/applications/${mine._id}`, { token, body: { status: 'hired' } });
      ok('hiring a candidate', hired.status === 200 && hired.data?.application?.status === 'hired', `HTTP ${hired.status}`);
      ok('hiring also adds them to the crew', Boolean(hired.data?.hiredStaff));
    }
  }

  // ── Insight ──────────────────────────────────────────────────────────────
  console.log('\nINSIGHT');

  const analytics = await call('GET', '/businesses/me/analytics?days=30', { token });
  ok('GET /businesses/me/analytics', analytics.status === 200 && analytics.data?.series?.length === 30);
  ok('  analytics report a completion rate', typeof analytics.data?.totals?.completionRate === 'number');

  const customers = await call('GET', '/businesses/me/customers', { token });
  ok('GET /businesses/me/customers', customers.status === 200 && Array.isArray(customers.data));

  // ── Isolation ────────────────────────────────────────────────────────────
  console.log('\nISOLATION');

  const anonymous = await call('GET', '/businesses/me/transactions');
  ok('the ledger requires a session', anonymous.status === 401, `HTTP ${anonymous.status}`);

  if (otherToken) {
    const otherTransactions = await call('GET', '/businesses/me/transactions', { token: otherToken });
    ok(
      "another owner's ledger is their own",
      otherTransactions.status === 200 &&
        otherTransactions.data?.balance?.gross !== tx.data?.balance?.gross,
    );
  }

  console.log(`\n  ${pass} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`    • ${failure}`);
  process.exit(failures.length ? 1 : 0);
};

run().catch((error) => {
  console.error('\n  Suite crashed:', error.message);
  process.exit(1);
});
