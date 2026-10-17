#!/usr/bin/env node
/**
 * The one and only Barter database seed.
 *
 * This is the ONLY place in the repository that is allowed to contain sample
 * content. Application code never invents users, listings, offers, escrows or
 * messages — it reads them from the API, which reads them from the database.
 *
 * Usage (from barter/backend):
 *
 *   npm run seed                  # idempotent upsert of the demo dataset
 *   npm run seed -- --reset       # delete the demo dataset, then recreate it
 *   npm run seed -- --allow-remote
 *                                 # required when MONGODB_URI is not local and does
 *                                 # not look like a dev/test database
 *
 * The script reads MONGODB_URI from the environment, falling back to backend/.env.
 * It refuses to run against a production-looking URI unless --allow-remote is
 * passed explicitly. It never drops collections.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const SEED_PASSWORD = 'password123';
const SEED_EMAILS = [
  'seller@barter.test',
  'buyer@barter.test',
  'swapper@barter.test',
  'admin@barter.test',
];
const SEED_TX_PREFIX = 'seed-escrow-';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

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

    // Real environment variables always win over the .env file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function assertSafeTarget(uri, flags) {
  if (!uri) {
    fail(
      'MONGODB_URI is not set. Add it to backend/.env or export it before running the seed.',
    );
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    fail(`MONGODB_URI is not a valid connection string: ${uri}`);
  }

  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '') || '(default)';
  const isLocal = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host);
  const devLookingName = /(^|[-_.])(dev|develop|development|test|local|sandbox|seed)([-_.]|$)/i.test(
    dbName,
  );
  const allowRemote = flags.has('--allow-remote') || flags.has('--allow-production');

  console.log(`\nTarget database: ${parsed.protocol}//${host}/${dbName}`);

  if (process.env.NODE_ENV === 'production') {
    console.log('NODE_ENV is "production" — the seed will still obey the target check below.');
  }

  if (!isLocal && !devLookingName && !allowRemote) {
    fail(
      'Refusing to seed what looks like a production database.\n' +
        `  Host: ${host}\n  Database: ${dbName}\n` +
        '  Use a local/dev database, or re-run with --allow-remote if you are certain.',
    );
  }

  if (!allowRemote && !isLocal) {
    console.log(
      'Remote database allowed only because its name looks like a dev/test database.',
    );
  }
}

// ---------------------------------------------------------------------------
// Schemas (kept in sync with backend/src/**/schemas)
// ---------------------------------------------------------------------------

const UserSchema = new mongoose.Schema(
  {
    firstName: String,
    lastName: String,
    email: { type: String, unique: true, lowercase: true },
    password: { type: String, select: false },
    isVerified: { type: Boolean, default: false },
    googleId: String,
    whatsappNumber: String,
    university: String,
    avatar: String,
    hostel: String,
    level: String,
    rating: { type: Number, default: 0 },
    totalTrades: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    fcmToken: String,
    recentlyViewed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
  },
  { timestamps: true },
);

const ItemSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: String,
    description: String,
    price: Number,
    swapPreference: String,
    type: { type: String, enum: ['sell', 'swap', 'service'], default: 'sell' },
    status: {
      type: String,
      enum: ['active', 'pending', 'sold', 'completed'],
      default: 'active',
    },
    location: String,
    category: String,
    images: [String],
    videos: [String],
    isPromoted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const OfferSchema = new mongoose.Schema(
  {
    proposerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    offeredItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    cashTopUp: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'countered', 'completed'],
      default: 'pending',
    },
    parentOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
  },
  { timestamps: true },
);

const TransactionSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    amount: Number,
    itemPrice: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    escrowFee: { type: Number, default: 0 },
    deliveryMethod: String,
    deliveryAddress: String,
    paymentReference: String,
    status: {
      type: String,
      enum: ['held_in_escrow', 'released', 'disputed'],
      default: 'held_in_escrow',
    },
  },
  { timestamps: true },
);

const ChatSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  },
  { timestamps: true },
);

const MessageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    type: { type: String, enum: ['text', 'image', 'voice'], default: 'text' },
    assetUrl: String,
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  },
  { timestamps: true },
);

const CategorySchema = new mongoose.Schema(
  { name: { type: String, required: true, unique: true }, icon: String },
  { timestamps: true },
);

const SettingSchema = new mongoose.Schema(
  { key: { type: String, required: true, unique: true }, value: mongoose.Schema.Types.Mixed },
  { timestamps: true },
);

const User = mongoose.model('User', UserSchema);
const Item = mongoose.model('Item', ItemSchema);
const Offer = mongoose.model('Offer', OfferSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Chat = mongoose.model('Chat', ChatSchema);
const Message = mongoose.model('Message', MessageSchema);
const Category = mongoose.model('Category', CategorySchema);
const Setting = mongoose.model('Setting', SettingSchema);

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { name: 'Electronics', icon: 'smartphone' },
  { name: 'Textbooks', icon: 'book' },
  { name: 'Furniture', icon: 'sofa' },
  { name: 'Clothing & Accessories', icon: 'shirt' },
  { name: 'Kitchen & Dining', icon: 'utensils' },
  { name: 'Beauty & Personal Care', icon: 'smile' },
  { name: 'Sports & Outdoors', icon: 'basketball' },
  { name: 'Stationery & Art Supplies', icon: 'pen-tool' },
  { name: 'Musical Instruments', icon: 'music' },
  { name: 'Gaming', icon: 'gamepad-2' },
  { name: 'Services', icon: 'sparkles' },
];

const SETTINGS = [
  { key: 'base_errander_fee', value: 500 },
  { key: 'escrow_fee_percentage', value: 0 },
  { key: 'seller_commission_percentage', value: 0 },
  { key: 'errander_commission_percentage', value: 0 },
  { key: 'promoted_listing_fee', value: 0 },
];

const USERS = [
  {
    key: 'seller',
    firstName: 'Chioma',
    lastName: 'Okafor',
    email: 'seller@barter.test',
    isVerified: true,
    whatsappNumber: '08031234567',
    university: 'UNILAG',
    hostel: 'Moremi Hall',
    level: '300L',
    rating: 4.8,
    totalTrades: 12,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Chioma+Okafor&background=FF5C1A&color=fff',
  },
  {
    key: 'buyer',
    firstName: 'Damilare',
    lastName: 'Adeyemi',
    email: 'buyer@barter.test',
    isVerified: true,
    whatsappNumber: '08122345678',
    university: 'UNILAG',
    hostel: 'Jaja Hall',
    level: '200L',
    rating: 4.6,
    totalTrades: 5,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Damilare+Adeyemi&background=2563EB&color=fff',
  },
  {
    key: 'swapper',
    firstName: 'Amara',
    lastName: 'Nwosu',
    email: 'swapper@barter.test',
    isVerified: true,
    whatsappNumber: '07053456789',
    university: 'UNILAG',
    hostel: 'Fagunwa Hall',
    level: '400L',
    rating: 4.9,
    totalTrades: 9,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Amara+Nwosu&background=7C3AED&color=fff',
  },
  {
    key: 'admin',
    firstName: 'Barter',
    lastName: 'Admin',
    email: 'admin@barter.test',
    isVerified: true,
    whatsappNumber: '08090000000',
    university: 'UNILAG',
    hostel: 'Staff Quarters',
    level: 'Staff',
    rating: 0,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Barter+Admin&background=0F172A&color=fff',
  },
];

const ITEMS = [
  {
    key: 'fridge',
    owner: 'seller',
    title: 'Haier Thermocool Mini Fridge',
    description:
      'Single-door mini fridge, perfect for a hostel corner. Keeps drinks and food properly cold. Selling because I am graduating.',
    price: 35000,
    type: 'sell',
    status: 'active',
    location: 'Moremi Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'fan',
    owner: 'seller',
    title: 'Ox 18-inch Standing Fan',
    description: 'Strong breeze, three speed settings. Used for one session only.',
    price: 18000,
    type: 'sell',
    status: 'active',
    location: 'Moremi Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1616788289417-0ec997a9f73f?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'braiding',
    owner: 'seller',
    title: 'Hostel Hair Braiding (Cornrows & Twists)',
    description:
      'I braid hair in my room. Cornrows, twists and knotless braids. Comes to your hostel within UNILAG.',
    price: 5000,
    type: 'service',
    status: 'active',
    location: 'Moremi Hall, UNILAG',
    category: 'Services',
    images: [
      'https://images.unsplash.com/photo-1595959183082-7b570b7e08e2?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'lamp',
    owner: 'seller',
    title: 'Rechargeable LED Reading Lamp',
    description: 'Lasts about six hours on a full charge. Bright enough for night reading.',
    price: 4500,
    type: 'sell',
    status: 'active',
    location: 'Moremi Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1507369512168-9b7ed6cfce4a?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'extension',
    owner: 'seller',
    title: '6-Socket Extension Box',
    description: 'Surge-protected extension box with a long cable.',
    price: 3000,
    type: 'sell',
    status: 'sold',
    location: 'Moremi Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1625948515291-69613efd103f?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'speaker',
    owner: 'seller',
    title: 'Anker Bluetooth Speaker',
    description: 'Loud, clear sound and holds charge well.',
    price: 8000,
    type: 'sell',
    status: 'pending',
    location: 'Moremi Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'cleaning',
    owner: 'buyer',
    title: 'Hostel Room Deep Cleaning',
    description: 'I clean rooms, scrub floors and arrange wardrobes. Bring my own supplies.',
    price: 4000,
    type: 'service',
    status: 'active',
    location: 'Jaja Hall, UNILAG',
    category: 'Services',
    images: [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'design',
    owner: 'buyer',
    title: 'Student ID Card & Flyer Design',
    description: 'Clean graphics for student events, societies and small businesses.',
    price: 7500,
    type: 'service',
    status: 'active',
    location: 'Jaja Hall, UNILAG',
    category: 'Services',
    images: [
      'https://images.unsplash.com/photo-1626785774573-4b799315345d?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'macbook',
    owner: 'swapper',
    title: 'MacBook Pro 2015 (Retina, 256GB)',
    description: '8GB RAM, 256GB SSD. Works perfectly for coding and coursework. Minor scratches.',
    price: 180000,
    type: 'sell',
    status: 'active',
    location: 'Fagunwa Hall, UNILAG',
    category: 'Electronics',
    images: [
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'textbook',
    owner: 'swapper',
    title: 'Engineering Mathematics by K.A. Stroud (7th Ed.)',
    description: 'Clean copy, no missing pages. Swap for an engineering drawing board or sell.',
    price: 10000,
    swapPreference: 'Engineering Drawing Board & T-Square',
    type: 'swap',
    status: 'active',
    location: 'Fagunwa Hall, UNILAG',
    category: 'Textbooks',
    images: [
      'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=800',
    ],
  },
  {
    key: 'controller',
    owner: 'swapper',
    title: 'PS4 DualShock 4 Controller',
    description: 'Original controller with good analog sticks. Swap for a newer game.',
    price: 12000,
    swapPreference: 'FIFA 24 or Spider-Man 2 (PS4)',
    type: 'swap',
    status: 'active',
    location: 'Fagunwa Hall, UNILAG',
    category: 'Gaming',
    images: [
      'https://images.unsplash.com/photo-1526509867162-5b0c0d1b4b33?auto=format&fit=crop&q=80&w=800',
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed / reset
// ---------------------------------------------------------------------------

async function upsertUsers(passwordHash) {
  const byKey = {};

  for (const user of USERS) {
    const { key, ...fields } = user;
    const doc = await User.findOneAndUpdate(
      { email: fields.email },
      {
        $set: fields,
        $setOnInsert: { password: passwordHash },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    byKey[key] = doc;
  }

  return byKey;
}

async function upsertItems(users) {
  const byKey = {};

  for (const item of ITEMS) {
    const { key, owner, ...fields } = item;
    const sellerId = users[owner]._id;
    const doc = await Item.findOneAndUpdate(
      { sellerId, title: fields.title },
      { $set: { ...fields, sellerId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    byKey[key] = doc;
  }

  return byKey;
}

async function upsertOffers(users, items) {
  const offers = [
    {
      proposerId: users.buyer._id,
      receiverId: users.seller._id,
      targetItemId: items.fan._id,
      offeredItemId: items.cleaning._id,
      cashTopUp: 10000,
      status: 'pending',
    },
    {
      proposerId: users.swapper._id,
      receiverId: users.seller._id,
      targetItemId: items.fridge._id,
      offeredItemId: items.controller._id,
      cashTopUp: 12000,
      status: 'pending',
    },
  ];

  for (const offer of offers) {
    await Offer.findOneAndUpdate(
      {
        proposerId: offer.proposerId,
        targetItemId: offer.targetItemId,
        offeredItemId: offer.offeredItemId,
      },
      { $setOnInsert: offer },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

async function upsertTransactions(users, items) {
  const transactions = [
    {
      paymentReference: `${SEED_TX_PREFIX}held-001`,
      buyerId: users.buyer._id,
      sellerId: users.seller._id,
      itemId: items.lamp._id,
      amount: 4500,
      itemPrice: 4500,
      deliveryFee: 0,
      escrowFee: 0,
      deliveryMethod: 'pickup',
      status: 'held_in_escrow',
    },
    {
      paymentReference: `${SEED_TX_PREFIX}released-001`,
      buyerId: users.buyer._id,
      sellerId: users.seller._id,
      itemId: items.extension._id,
      amount: 3000,
      itemPrice: 3000,
      deliveryFee: 0,
      escrowFee: 0,
      deliveryMethod: 'pickup',
      status: 'released',
    },
    {
      paymentReference: `${SEED_TX_PREFIX}disputed-001`,
      buyerId: users.swapper._id,
      sellerId: users.seller._id,
      itemId: items.speaker._id,
      amount: 8000,
      itemPrice: 8000,
      deliveryFee: 0,
      escrowFee: 0,
      deliveryMethod: 'pickup',
      status: 'disputed',
    },
  ];

  for (const transaction of transactions) {
    await Transaction.findOneAndUpdate(
      { paymentReference: transaction.paymentReference },
      { $setOnInsert: transaction },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

async function upsertChat(participants, item, messages) {
  // Find the conversation by its exact participant set (order-independent).
  let chat = await Chat.findOne({
    participants: { $all: participants, $size: participants.length },
  });

  if (!chat) {
    chat = await Chat.create({ participants, item });
  }

  let lastMessage = null;
  for (const message of messages) {
    const doc = await Message.findOneAndUpdate(
      { chatId: chat._id, sender: message.sender, content: message.content },
      {
        $setOnInsert: {
          chatId: chat._id,
          sender: message.sender,
          content: message.content,
          type: 'text',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    lastMessage = doc;
  }

  if (lastMessage) {
    chat.lastMessage = lastMessage._id;
    // Keep the conversation ordered by its real last message.
    chat.updatedAt = lastMessage.createdAt || new Date();
    await chat.save();
  }

  return chat;
}

async function upsertChats(users, items) {
  await upsertChat(
    [users.buyer._id, users.seller._id],
    items.lamp._id,
    [
      { sender: users.buyer._id, content: 'Hi, is the reading lamp still available?' },
      { sender: users.seller._id, content: 'Yes it is. I am in Moremi Hall.' },
      { sender: users.buyer._id, content: 'Great, can I pick it up tomorrow afternoon?' },
      { sender: users.seller._id, content: 'Sure, any time after 4pm works for me.' },
    ],
  );

  await upsertChat(
    [users.swapper._id, users.seller._id],
    items.fridge._id,
    [
      {
        sender: users.swapper._id,
        content: 'Hey, would you swap the mini fridge for my PS4 controller?',
      },
      { sender: users.seller._id, content: 'The controller is nice, but add 12k and it is a deal.' },
    ],
  );
}

async function upsertReferenceData() {
  for (const category of CATEGORIES) {
    await Category.findOneAndUpdate(
      { name: category.name },
      { $set: category },
      { upsert: true, new: true },
    );
  }

  for (const setting of SETTINGS) {
    await Setting.findOneAndUpdate(
      { key: setting.key },
      { $set: { value: setting.value } },
      { upsert: true, new: true },
    );
  }
}

async function resetSeedData() {
  const users = await User.find({ email: { $in: SEED_EMAILS } }).select('_id');
  const userIds = users.map((user) => user._id);

  if (!userIds.length) {
    console.log('Nothing to reset: no seeded users found.');
    return;
  }

  const chats = await Chat.find({ participants: { $in: userIds } }).select('_id');
  const chatIds = chats.map((chat) => chat._id);

  const messages = await Message.deleteMany({ chatId: { $in: chatIds } });
  const deletedChats = await Chat.deleteMany({ _id: { $in: chatIds } });
  const offers = await Offer.deleteMany({
    $or: [{ proposerId: { $in: userIds } }, { receiverId: { $in: userIds } }],
  });
  const transactions = await Transaction.deleteMany({
    paymentReference: { $regex: `^${SEED_TX_PREFIX}` },
  });
  const items = await Item.deleteMany({ sellerId: { $in: userIds } });
  const deletedUsers = await User.deleteMany({ _id: { $in: userIds } });

  console.log(
    `Reset: ${deletedUsers.deletedCount} users, ${items.deletedCount} items, ` +
      `${offers.deletedCount} offers, ${transactions.deletedCount} transactions, ` +
      `${deletedChats.deletedCount} chats, ${messages.deletedCount} messages.`,
  );
}

async function main() {
  loadEnvFile();

  const flags = new Set(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  assertSafeTarget(uri, flags);

  await mongoose.connect(uri);
  console.log('Connected.');

  if (flags.has('--reset')) {
    await resetSeedData();
  }

  await upsertReferenceData();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const users = await upsertUsers(passwordHash);
  const items = await upsertItems(users);
  await upsertOffers(users, items);
  await upsertTransactions(users, items);
  await upsertChats(users, items);

  console.log('\n✔ Seed complete (idempotent — safe to run again).\n');
  console.log('Demo accounts (all use the same password):');
  console.log('  Seller  seller@barter.test   / password123');
  console.log('  Buyer   buyer@barter.test    / password123');
  console.log('  Swapper swapper@barter.test  / password123');
  console.log('  Admin   admin@barter.test    / password123');
  console.log('\nSeeded content:');
  console.log(`  ${USERS.length} users, ${ITEMS.length} listings (sell/swap/service),`);
  console.log('  2 pending swap offers, 3 escrows (held / released / disputed),');
  console.log('  2 conversations with real message history, categories and settings.');
  console.log('\nAdmin sign-in: any seeded account works with the same credentials.\n');
}

main()
  .catch((error) => {
    console.error('\n✖ Seed failed:', error.message);
    if (error.stack && process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
