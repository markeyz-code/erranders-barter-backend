#!/usr/bin/env node
/**
 * End-to-end confirmation for the Barter API.
 *
 * Exercises every module the way the website and admin actually use it, and
 * reports a pass/fail per assertion. Creates its own data; safe on a throwaway
 * database (it never deletes anything it did not create).
 *
 * Usage: node verify-e2e.mjs [baseUrl]
 */

const BASE = (process.argv[2] || 'http://127.0.0.1:3200').replace(/\/+$/, '');
const V1 = `${BASE}/api/v1`;
const PASSWORD = 'TestPass123!';

let pass = 0;
const failures = [];

const ok = (label, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${V1}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

const stamp = Date.now().toString(36);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. AUTH');
const signup = (email, role) =>
  call('POST', '/auth/signup', {
    body: { firstName: 'E2E', lastName: role, email, password: PASSWORD, role },
  });

const sellerEmail = `e2e.seller.${stamp}@test.local`;
const buyerEmail = `e2e.buyer.${stamp}@test.local`;

const sSign = await signup(sellerEmail, 'user');
ok('signup (seller)', sSign.status === 201 || sSign.status === 200, `HTTP ${sSign.status}`);

const bSign = await signup(buyerEmail, 'user');
ok('signup (buyer)', bSign.status === 201 || bSign.status === 200, `HTTP ${bSign.status}`);

const login = async (email) =>
  call('POST', '/auth/login', { body: { email, password: PASSWORD } });
const sLogin = await login(sellerEmail);
const sTok = sLogin.data?.access_token || sLogin.data?.token;
ok('login returns a token', !!sTok, JSON.stringify(sLogin.data)?.slice(0, 80));

const bLogin = await login(buyerEmail);
const bTok = bLogin.data?.access_token || bLogin.data?.token;
ok('login (buyer) returns a token', !!bTok);

ok('bad password is rejected', (await call('POST', '/auth/login', {
  body: { email: sellerEmail, password: 'wrong' },
})).status === 401);

ok('unauthenticated request is rejected', (await call('GET', '/users/me')).status === 401);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. USERS');
const me = await call('GET', '/users/me', { token: sTok });
ok('GET /users/me', me.status === 200 && me.data?.email === sellerEmail, `HTTP ${me.status}`);

const patched = await call('PATCH', '/users/me', { token: sTok, body: { firstName: 'Renamed' } });
ok('PATCH /users/me updates a field', patched.status === 200 && patched.data?.firstName === 'Renamed');

// The whitelist must ignore privileged fields — this was a live privilege-escalation bug.
const escalated = await call('PATCH', '/users/me', {
  token: sTok,
  body: { walletBalance: 999999, isVerified: true },
});
ok(
  'PATCH /users/me cannot escalate wallet/verification',
  escalated.status === 200 || escalated.status === 400,
  `HTTP ${escalated.status}`,
);
const afterEsc = await call('GET', '/users/me', { token: sTok });
ok(
  'privileged fields unchanged after escalation attempt',
  Number(afterEsc.data?.walletBalance ?? 0) < 999999 && afterEsc.data?.isVerified !== true,
);

const stats = await call('GET', '/users/me/stats', { token: sTok });
ok('GET /users/me/stats', stats.status === 200, `HTTP ${stats.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. CATEGORIES & ITEMS');
const cats = await call('GET', '/categories');
ok('GET /categories', cats.status === 200 && Array.isArray(cats.data), `HTTP ${cats.status}`);
const catId = Array.isArray(cats.data) ? (cats.data[0]?._id || cats.data[0]?.id) : undefined;

const created = await call('POST', '/items', {
  token: sTok,
  body: {
    title: `E2E Test Item ${stamp}`,
    description: 'Created by the end-to-end verification script.',
    price: 5000,
    type: 'sell',
    category: catId,
    location: 'Lagos',
    images: [],
  },
});
ok('POST /items creates a listing', created.status === 201 || created.status === 200, `HTTP ${created.status}`);
const itemId = created.data?._id || created.data?.id;
ok('created item has an id', !!itemId);

const list = await call('GET', '/items');
ok('GET /items lists listings', list.status === 200);

const one = await call('GET', `/items/${itemId}`);
ok('GET /items/:id', one.status === 200 && (one.data?._id === itemId || one.data?.id === itemId));

const edited = await call('PATCH', `/items/${itemId}`, {
  token: sTok,
  body: { title: `E2E Edited ${stamp}` },
});
ok('PATCH /items/:id edits a listing', edited.status === 200, `HTTP ${edited.status}`);

const foreignEdit = await call('PATCH', `/items/${itemId}`, {
  token: bTok,
  body: { title: 'hijacked' },
});
ok('PATCH /items/:id is owner-only', foreignEdit.status === 403, `HTTP ${foreignEdit.status}`);

const mine = await call('GET', '/items/me/listings', { token: sTok });
ok('GET /items/me/listings', mine.status === 200);

const badId = await call('GET', '/items/not-an-object-id');
ok('GET /items/:id with a malformed id does not 500', badId.status === 404 || badId.status === 400, `HTTP ${badId.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. OFFERS');
// A barter offer is a SWAP: the buyer puts an item up and may add a cash top-up.
// Create the buyer's item first — a cash-only payload is correctly rejected.
const buyerItem = await call('POST', '/items', {
  token: bTok,
  body: {
    title: `E2E Buyer Item ${stamp}`,
    description: 'Offered in exchange.',
    price: 4000,
    type: 'swap',
    category: catId,
    location: 'Lagos',
    images: [],
  },
});
const buyerItemId = buyerItem.data?._id || buyerItem.data?.id;

const offer = await call('POST', '/offers', {
  token: bTok,
  body: {
    receiverId: afterEsc.data?._id,
    targetItemId: itemId,
    offeredItemId: buyerItemId,
    cashTopUp: 500,
  },
});
ok('POST /offers creates a swap offer', offer.status === 201 || offer.status === 200, `HTTP ${offer.status}`);
const offerId = offer.data?._id || offer.data?.id;

const myOffers = await call('GET', '/offers/my-offers', { token: bTok });
ok('GET /offers/my-offers', myOffers.status === 200);

const received = await call('GET', '/offers/received', { token: sTok });
ok('GET /offers/received', received.status === 200);

if (offerId) {
  const accepted = await call('PATCH', `/offers/${offerId}/status`, {
    token: sTok,
    body: { status: 'accepted' },
  });
  ok('PATCH /offers/:id/status accepts an offer', accepted.status === 200, `HTTP ${accepted.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. ESCROW & CONCURRENCY INTEGRITY');
// itemId is now pending because the swap offer was accepted in Step 4.
// Attempting to buy it via escrow MUST be rejected!
const rejectPending = await call('POST', '/escrow/initiate', {
  token: bTok,
  body: {
    sellerId: afterEsc.data?._id,
    itemId,
    amount: 4500,
    itemPrice: 4500,
    deliveryMethod: 'pickup',
  },
});
ok('escrow rejects purchasing pending/sold items (concurrency lock)', rejectPending.status === 400, `HTTP ${rejectPending.status}`);

// Now create a fresh active listing to test normal escrow initiation
const escrowItem = await call('POST', '/items', {
  token: sTok,
  body: {
    title: `E2E Escrow Item ${stamp}`,
    description: 'Active item for escrow test',
    price: 4500,
    type: 'sell',
    category: catId,
    location: 'Lagos',
    images: [],
  },
});
const escrowItemId = escrowItem.data?._id || escrowItem.data?.id;

const init = await call('POST', '/escrow/initiate', {
  token: bTok,
  body: {
    sellerId: afterEsc.data?._id,
    itemId: escrowItemId,
    amount: 4500,
    itemPrice: 4500,
    deliveryMethod: 'pickup',
  },
});
ok('POST /escrow/initiate', init.status === 201 || init.status === 200, `HTTP ${init.status}`);
const txId = init.data?._id || init.data?.transaction?._id || init.data?.id;

const myTx = await call('GET', '/escrow/my-transactions', { token: bTok });
ok('GET /escrow/my-transactions', myTx.status === 200);

if (txId) {
  const dispute = await call('PATCH', `/escrow/${txId}/dispute`, {
    token: bTok,
    body: { reason: 'E2E dispute test' },
  });
  ok('PATCH /escrow/:id/dispute', dispute.status === 200 || dispute.status === 400, `HTTP ${dispute.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. CHAT');
const chatInit = await call('POST', '/chats/init', {
  token: bTok,
  body: { participantId: afterEsc.data?._id, itemId },
});
ok('POST /chats/init', chatInit.status === 201 || chatInit.status === 200, `HTTP ${chatInit.status}`);
const chatId = chatInit.data?._id || chatInit.data?.chat?._id;

const chatAgain = await call('POST', '/chats/init', {
  token: bTok,
  body: { participantId: afterEsc.data?._id, itemId },
});
ok(
  'POST /chats/init is idempotent',
  (chatAgain.data?._id || chatAgain.data?.chat?._id) === chatId,
);

const chats = await call('GET', '/chats', { token: bTok });
ok('GET /chats', chats.status === 200);

if (chatId) {
  const sent = await call('POST', `/chats/${chatId}/messages`, {
    token: bTok,
    body: { content: 'E2E hello' },
  });
  ok('POST /chats/:id/messages sends', sent.status === 201 || sent.status === 200, `HTTP ${sent.status}`);

  const msgs = await call('GET', `/chats/${chatId}/messages`, { token: bTok });
  ok('GET /chats/:id/messages returns the message', msgs.status === 200 && Array.isArray(msgs.data) && msgs.data.length > 0);

  // The IDOR that used to exist: a non-participant could read any chat.
  const outsiderEmail = `e2e.outsider.${stamp}@test.local`;
  await signup(outsiderEmail, 'user');
  const oLogin = await login(outsiderEmail);
  const oTok = oLogin.data?.access_token || oLogin.data?.token;
  if (oTok) {
    const peek = await call('GET', `/chats/${chatId}/messages`, { token: oTok });
    ok('a non-participant CANNOT read the chat (IDOR closed)', peek.status === 403, `HTTP ${peek.status}`);
    const inject = await call('POST', `/chats/${chatId}/messages`, { token: oTok, body: { content: 'x' } });
    ok('a non-participant CANNOT post into the chat', inject.status === 403, `HTTP ${inject.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. LOGISTICS');
const deliveries = await call('GET', '/logistics/deliveries', { token: sTok });
ok('GET /logistics/deliveries', deliveries.status === 200, `HTTP ${deliveries.status}`);
const logStats = await call('GET', '/logistics/stats', { token: sTok });
ok('GET /logistics/stats', logStats.status === 200, `HTTP ${logStats.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8. WITHDRAWALS (Paystack)');
const banks = await call('GET', '/banks', { token: sTok });
ok('GET /banks returns real banks from Paystack', banks.status === 200 && Array.isArray(banks.data) && banks.data.length > 0, `HTTP ${banks.status}`);

const noBank = await call('POST', '/users/me/withdraw', { token: sTok, body: { amount: 5000 } });
ok('withdraw refuses without bank details', noBank.status === 400, `HTTP ${noBank.status}`);

const tooSmall = await call('POST', '/users/me/withdraw', { token: sTok, body: { amount: 10 } });
ok('withdraw enforces the minimum', tooSmall.status === 400, `HTTP ${tooSmall.status}`);

const tooMuch = await call('POST', '/users/me/withdraw', { token: sTok, body: { amount: 9_999_999 } });
ok('withdraw refuses more than the balance', tooMuch.status === 400, `HTTP ${tooMuch.status}`);

const badResolve = await call('GET', '/banks/resolve?accountNumber=123&bankCode=058', { token: sTok });
ok('bank resolve validates the account number', badResolve.status === 400, `HTTP ${badResolve.status}`);

const history = await call('GET', '/users/me/withdrawals', { token: sTok });
ok('GET /users/me/withdrawals', history.status === 200 && Array.isArray(history.data), `HTTP ${history.status}`);

// The Erranders-forward path: reject without the shared key, accept with it.
const noKey = await call('POST', '/webhooks/erranders', { body: { event: 'transfer.success', data: { reference: 'WD-NOPE' } } });
ok('Erranders webhook rejects a missing key', noKey.status === 401, `HTTP ${noKey.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n9. ADMIN SURFACES');
const adminUsers = await call('GET', '/users/admin/all', { token: sTok });
ok('GET /users/admin/all responds', adminUsers.status === 200 || adminUsers.status === 403, `HTTP ${adminUsers.status}`);
const adminEscrow = await call('GET', '/escrow/admin/all', { token: sTok });
ok('GET /escrow/admin/all responds', adminEscrow.status === 200 || adminEscrow.status === 403, `HTTP ${adminEscrow.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n10. DECLUTTER, REELS & CATCH-UP SESSIONS');
// Declutter batch creation
const declutterBatch = await call('POST', '/items/declutter-batch', {
  token: sTok,
  body: {
    hostel: 'Kuti Hall, Room 42',
    bundleDiscountPercent: 15,
    autoPriceDrop: true,
    items: [
      {
        title: `Declutter Kettle ${stamp}`,
        description: 'Stainless steel kettle, 1.8L',
        price: 4500,
        category: catId,
        condition: 'good',
        images: ['https://images.unsplash.com/photo-1544816155-12df9643f363?w=800'],
      },
      {
        title: `Declutter Reading Lamp ${stamp}`,
        description: 'Rechargeable LED study lamp',
        price: 2500,
        category: catId,
        condition: 'like-new',
        images: ['https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800'],
      },
    ],
  },
});
ok('POST /items/declutter-batch creates automated clearance batch', declutterBatch.status === 201 || declutterBatch.status === 200, `HTTP ${declutterBatch.status}`);
const batchId = declutterBatch.data?.batchId;
ok('declutter batch returns a batchId', !!batchId);

if (batchId) {
  const getBatch = await call('GET', `/items/declutter-batch/${batchId}`);
  ok('GET /items/declutter-batch/:batchId retrieves batch room clearance', getBatch.status === 200 && Array.isArray(getBatch.data?.items), `HTTP ${getBatch.status}`);
}

// Session Catch-Up (items & services added since timestamp)
const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
const catchUp = await call('GET', `/items/catch-up?since=${encodeURIComponent(oneHourAgo)}`);
const catchUpItems = catchUp.data?.data?.items || catchUp.data?.items;
ok('GET /items/catch-up returns new listings and services since last session', catchUp.status === 200 && catchUpItems !== undefined, `HTTP ${catchUp.status}`);

// Reels feed
const reels = await call('GET', '/items/reels');
ok('GET /items/reels returns video/visual reels feed', reels.status === 200 && (Array.isArray(reels.data) || Array.isArray(reels.data?.data)), `HTTP ${reels.status}`);

// Reels social engagement (like, comment, repost) on created item
const likeRes = await call('POST', `/items/${itemId}/like`, { token: bTok });
ok('POST /items/:id/like toggles like on reel', (likeRes.status === 200 || likeRes.status === 201) && (likeRes.data?.liked !== undefined || likeRes.data?.data?.liked !== undefined), `HTTP ${likeRes.status}`);

const commentRes = await call('POST', `/items/${itemId}/comments`, {
  token: bTok,
  body: { text: 'Is this available for instant pickup in Zik?' },
});
ok('POST /items/:id/comments adds interactive comment to reel', commentRes.status === 201 || commentRes.status === 200, `HTTP ${commentRes.status}`);

const repostRes = await call('POST', `/items/${itemId}/repost`, { token: bTok });
ok('POST /items/:id/repost boosts/reposts reel to campus feed', (repostRes.status === 200 || repostRes.status === 201) && (repostRes.data?.reposted !== undefined || repostRes.data?.data?.reposted !== undefined), `HTTP ${repostRes.status}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    • ${f}`);
}
console.log('');
process.exit(failures.length === 0 ? 0 : 1);
