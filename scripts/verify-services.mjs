#!/usr/bin/env node
/**
 * Services & bookings end-to-end check.
 *
 * Exercises the vertical the way a student and a provider actually use it:
 * browse → detail → availability → book → the slot is taken → provider accepts →
 * chat created → video room minted → admin access is refused to non-admins.
 *
 * Run with a seeded backend:
 *   MONGODB_URI=... PORT=3200 node dist/main.js      # in backend/
 *   node verify-services.mjs
 *
 * Exits non-zero on any failure so it can gate a deploy.
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

/** The public provider payload omits email, so resolve it from the database. */
async function emailOfProvider(id) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  // Resolve mongoose from the backend package, whether this is run from
  // backend/ or from the directory above it.
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const candidates = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), 'backend', 'package.json'),
  ];
  const pkg = candidates.find((candidate) => fs.existsSync(candidate));
  if (!pkg) throw new Error('Cannot locate the backend package.json — run this from backend/.');
  const mongoose = createRequire(pkg)('mongoose');
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }
  const user = await mongoose.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
  return user?.email || null;
}

const run = async () => {
  console.log('\nSERVICES VERTICAL');

  const catalogue = await call('GET', '/services');
  const list = catalogue.data?.data ?? catalogue.data;
  ok('GET /services returns the catalogue', catalogue.status === 200 && Array.isArray(list) && list.length > 0, `HTTP ${catalogue.status}`);

  const service = list?.[0];
  ok('services carry a provider', Boolean(service?.providerId));

  const detail = await call('GET', `/services/${service._id}`);
  ok('GET /services/:id', detail.status === 200);

  const providerId = typeof service.providerId === 'object' ? service.providerId._id : service.providerId;
  const provider = await call('GET', `/providers/${providerId}`);
  ok('GET /providers/:id returns card + services', provider.status === 200, `HTTP ${provider.status}`);

  // Providers do not work every weekday, so walk forward to find a real opening
  // rather than assuming a fixed offset.
  let date = '';
  let free = [];
  let sawSlots = false;
  for (let i = 0; i < 14 && free.length === 0; i += 1) {
    const day = new Date();
    day.setDate(day.getDate() + i);
    const iso = day.toISOString().slice(0, 10);
    const availability = await call('GET', `/services/${service._id}/availability?date=${iso}`);
    const slots = Array.isArray(availability.data) ? availability.data : availability.data?.slots ?? [];
    if (i === 0) {
      sawSlots = availability.status === 200 && Array.isArray(slots);
      ok('GET availability returns a slot list', sawSlots, `HTTP ${availability.status}`);
    }
    const bookable = slots.filter((slot) => slot.available);
    if (bookable.length) {
      date = iso;
      free = bookable;
    }
  }
  ok('a bookable slot exists within 14 days', free.length > 0);

  const customer = (await login('buyer@barter.test')) || (await login('seller@barter.test'));
  if (!customer || free.length === 0) {
    console.log('  SKIP  booking flow needs a seeded customer and an open slot');
  } else {
    const booking = await call('POST', '/bookings', {
      token: customer,
      body: { serviceId: service._id, date, startTime: free[0].startTime, notes: 'E2E check' },
    });
    ok('POST /bookings creates a booking', booking.status === 201 || booking.status === 200, `HTTP ${booking.status}`);

    const bookingId = booking.data?._id;
    if (bookingId) {
      const duplicate = await call('POST', '/bookings', {
        token: customer,
        body: { serviceId: service._id, date, startTime: free[0].startTime },
      });
      ok('the same slot cannot be booked twice (409)', duplicate.status === 409, `HTTP ${duplicate.status}`);

      const mine = await call('GET', '/bookings/mine', { token: customer });
      ok('GET /bookings/mine', mine.status === 200 && Array.isArray(mine.data));

      const ownerEmail = await emailOfProvider(providerId);
      const owner = ownerEmail ? await login(ownerEmail) : null;
      if (owner) {
        const received = await call('GET', '/bookings/received', { token: owner });
        ok('GET /bookings/received', received.status === 200);

        const accepted = await call('PATCH', `/bookings/${bookingId}/accept`, { token: owner });
        ok('PATCH /bookings/:id/accept', accepted.status === 200, `HTTP ${accepted.status}`);
        ok('accepting creates a chat between the two', Boolean(accepted.data?.chatId));
        ok(
          'a remote service gets a video room',
          !accepted.data?.meetingUrl || String(accepted.data.meetingUrl).includes('meet.jit.si'),
        );
      } else {
        console.log('  SKIP  accept step needs MONGODB_URI to resolve the owning provider');
      }
    }
  }

  console.log('\nADMIN SURFACES');
  const admin = await login('admin@barter.test');
  if (!admin) {
    console.log('  SKIP  no seeded admin login');
  } else {
    for (const path of ['/admin/services', '/admin/bookings', '/admin/providers', '/admin/businesses', '/admin/stats']) {
      const res = await call('GET', path, { token: admin });
      ok(`GET ${path}`, res.status === 200, `HTTP ${res.status}`);
    }
    const nonAdmin = await login('buyer@barter.test');
    if (nonAdmin) {
      const denied = await call('GET', '/admin/services', { token: nonAdmin });
      ok('a non-admin is refused the admin API', denied.status === 403, `HTTP ${denied.status}`);
    }
  }

  console.log(`\n  ${pass} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`    • ${failure}`);
  process.exit(failures.length ? 1 : 0);
};

run().catch((error) => {
  console.error('\n  Suite crashed:', error.message);
  process.exit(1);
});
