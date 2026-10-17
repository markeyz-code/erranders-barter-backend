# Barter database seed

This directory is the **only** place in the Barter codebase that contains sample
content. The website, admin app and API never fabricate users, listings, offers,
escrows, chats or statistics — they render what is in the database. Run the seed
once and the app has realistic local data.

## Commands

```bash
cd barter/backend

# Upsert the demo dataset (idempotent — safe to run any number of times)
npm run seed

# Delete the demo dataset and recreate it
npm run seed -- --reset

# Explicitly allow a remote database
npm run seed -- --allow-remote
```

## Safety

The script reads `MONGODB_URI` from the environment, falling back to
`backend/.env`. It:

- **refuses to run** when the URI points at a remote database whose name does
  not look like a dev/test database (for example an Atlas URL ending in `/` or
  `/production`), unless `--allow-remote` is passed explicitly;
- never drops a collection and never deletes non-seeded data;
- `--reset` only deletes rows created by this seed (the four `@barter.test`
  users and everything owned by / referencing them);
- is idempotent: users, listings, offers, escrows and chats are matched on
  stable keys and upserted.

For a local MongoDB:

```bash
# in backend/.env
MONGODB_URI=mongodb://localhost:27017/barter-dev

npm run seed
```

## What it creates

| Data | Details |
| --- | --- |
| Users | `seller@barter.test` (Chioma Okafor), `buyer@barter.test` (Damilare Adeyemi), `swapper@barter.test` (Amara Nwosu), `admin@barter.test` (Barter Admin) |
| Password | `password123` for all four accounts |
| Categories | 11 campus categories, including `Services` |
| Settings | `base_errander_fee`, escrow/seller/errander commission percentages, `promoted_listing_fee` |
| Listings | 11 items across sell, swap and service types (mini fridge, standing fan, MacBook, textbooks, PS4 controller, hair braiding, room cleaning, etc.) |
| Offers | 2 pending swap offers between the seeded users |
| Escrows | 1 held in escrow, 1 released, 1 disputed (so every admin/user state has data) |
| Chats | 2 conversations with real message history, linked to a listing |

The admin app signs in with any seeded account; there is currently no separate
role model on the API.

## Why seed data lives here

The owner's rule is: *no mock data in the app, seed the database instead.*
Anything that looks like "John Doe" or "Transaction #TXN-8F92A" in a page is a
bug. If a screen needs data the API does not expose yet, the fix is a real
endpoint, not a hardcoded array.
