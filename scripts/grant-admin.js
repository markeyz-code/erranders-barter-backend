#!/usr/bin/env node
/**
 * Grant or revoke the minimal admin flag on one Barter account.
 *
 * The admin dashboard's /admin/* routes require `isAdmin === true` on the account (or the
 * account's email in the backend's ADMIN_EMAILS environment variable). This script is the
 * safe, explicit way to set the first flag without touching any other field.
 *
 * Usage (from barter/backend):
 *
 *   node scripts/grant-admin.js owner@example.com
 *   node scripts/grant-admin.js owner@example.com --revoke
 *   node scripts/grant-admin.js owner@example.com --allow-remote
 *
 * It reads MONGODB_URI from the environment, falling back to backend/.env. It refuses a
 * non-local database unless --allow-remote is passed. It only writes `isAdmin`.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const email = (args.find((arg) => !arg.startsWith('--')) || '').trim().toLowerCase();
  const revoke = args.includes('--revoke');
  const allowRemote = args.includes('--allow-remote');

  if (!email) {
    fail('Usage: node scripts/grant-admin.js <email> [--revoke] [--allow-remote]');
  }

  loadEnvFile();
  const uri = process.env.MONGODB_URI;
  if (!uri) fail('MONGODB_URI is not set. Add it to backend/.env or export it.');

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    fail('MONGODB_URI is not a valid URL.');
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (!isLocal && !allowRemote) {
    fail(
      `Refusing to write to a remote database (${parsed.hostname}).\n` +
        '  Re-run with --allow-remote if you are certain this is the Barter database.',
    );
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const result = await mongoose.connection.db.collection('users').findOneAndUpdate(
    { email },
    { $set: { isAdmin: !revoke } },
    { returnDocument: 'after', projection: { email: 1, isAdmin: 1 } },
  );

  const user = result && result.value ? result.value : result;
  await mongoose.disconnect();

  if (!user) {
    fail(`No user found with email ${email}`);
  }

  console.log(
    `✔ ${email} is now ${user.isAdmin ? 'an admin' : 'not an admin'} (isAdmin: ${!!user.isAdmin}).`,
  );
}

main().catch(async (error) => {
  console.error(`\n✖ ${error.message}\n`);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
