#!/usr/bin/env node
/**
 * The one and only Barter database seed.
 *
 * This is the ONLY place in the repository that is allowed to contain sample
 * content. Application code never invents users, listings, offers, escrows,
 * messages, services, availability windows or bookings — it reads them from the
 * API, which reads them from the database.
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
  'barber@barter.test',
  'tutor@barter.test',
  'nailtech@barter.test',
  'photographer@barter.test',
  'mover@barter.test',
  'fumigpro@barter.test',
  'fumigcrew@barter.test',
  'freshfold@barter.test',
  'laundrystaff@barter.test',
  'campusmove@barter.test',
];
const SEED_TX_PREFIX = 'seed-escrow-';
// Exceptions are re-created on every run because their dates are relative to today; the
// note prefix is how a previous run's rows are recognised and replaced.
const SEED_EXCEPTION_PREFIX = 'Seed:';

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
    isAdmin: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
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
    // Services marketplace profile (mirrors src/users/schemas/user.schema.ts).
    isServiceProvider: { type: Boolean, default: false },
    providerProfile: {
      type: new mongoose.Schema(
        {
          headline: String,
          bio: String,
          skills: [String],
          serviceArea: String,
          isAcceptingBookings: { type: Boolean, default: true },
          rating: { type: Number, default: 0 },
          totalReviews: { type: Number, default: 0 },
          totalBookings: { type: Number, default: 0 },
        },
        { _id: false },
      ),
    },
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
    isActive: { type: Boolean, default: true },
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

// --- Services marketplace (mirrors src/services, src/availability, src/bookings) ---------

const ServiceSchema = new mongoose.Schema(
  {
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: String,
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    priceType: { type: String, enum: ['fixed', 'hourly', 'per_minute', 'negotiable'], default: 'fixed' },
    price: { type: Number, default: 0 },
    durationMinutes: { type: Number, required: true },
    bufferMinutes: { type: Number, default: 0 },
    images: [String],
    location: String,
    isRemote: { type: Boolean, default: false },
    tags: [String],
    isActive: { type: Boolean, default: true },
    rating: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const ProviderAvailabilitySchema = new mongoose.Schema(
  {
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const AvailabilityExceptionSchema = new mongoose.Schema(
  {
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    isBlocked: { type: Boolean, default: false },
    startTime: String,
    endTime: String,
    note: String,
  },
  { timestamps: true },
);

const BookingSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    bufferMinutes: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show'],
      default: 'pending',
    },
    notes: String,
    meetingUrl: String,
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    cancelledBy: String,
    cancellationReason: String,
    // Payment state the business earnings ledger reports per completed booking.
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'commitment_paid', 'fully_paid'],
      default: 'unpaid',
    },
    payoutReleased: { type: Boolean, default: false },
    // Internal double-booking guard, same as src/bookings/schemas/booking.schema.ts.
    blocksSlot: { type: Boolean, default: true },
    slotKeys: [String],
  },
  { timestamps: true },
);

// --- Business accounts (mirrors src/businesses/schemas/business.schema.ts) ---------------

const BusinessSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    category: { type: String, required: true },
    description: String,
    logo: String,
    banner: String,
    phone: String,
    email: String,
    address: String,
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    commissionRate: { type: Number, default: 0, min: 0, max: 50 },
    // `userId` links a staff member to a platform account; that is the join the earnings
    // ledger attributes their completed bookings through.
    staff: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, required: true },
        role: { type: String, required: true },
        phone: String,
        isActive: { type: Boolean, default: true },
      },
    ],
    openings: [
      {
        title: { type: String, required: true },
        description: String,
        type: { type: String, enum: ['full_time', 'part_time', 'contract'], default: 'full_time' },
        pay: Number,
        isOpen: { type: Boolean, default: true },
      },
    ],
    rating: { type: Number, default: 0 },
    totalJobs: { type: Number, default: 0 },
  },
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
const Service = mongoose.model('Service', ServiceSchema);
const ProviderAvailability = mongoose.model('ProviderAvailability', ProviderAvailabilitySchema);
const AvailabilityException = mongoose.model('AvailabilityException', AvailabilityExceptionSchema);
const Booking = mongoose.model('Booking', BookingSchema);
const Business = mongoose.model('Business', BusinessSchema);

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
  // Default commission a newly applied business starts on; admins override it per business.
  { key: 'service_business_commission_percentage', value: 15 },
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
    isAdmin: true,
    isActive: true,
    whatsappNumber: '08090000000',
    university: 'UNILAG',
    hostel: 'Staff Quarters',
    level: 'Staff',
    rating: 0,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Barter+Admin&background=0F172A&color=fff',
  },
  // --- Service providers: normal users with `isServiceProvider` and a providerProfile -----
  {
    key: 'barber',
    firstName: 'Tunde',
    lastName: 'Bakare',
    email: 'barber@barter.test',
    isVerified: true,
    whatsappNumber: '08034567890',
    university: 'UNILAG',
    hostel: 'Biobaku Hall',
    level: '400L',
    rating: 4.8,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Tunde+Bakare&background=0D9488&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'Mobile barber — campus wide',
      bio: 'Final-year student and licensed barber. I bring my clippers, cape and sanitised kit to your hall. Fades, line-ups, beard shaping and kids cuts — weekdays after lectures and all day Saturday.',
      skills: ['Fades', 'Beard trims', 'Line-ups', 'Kids cuts'],
      serviceArea: 'All UNILAG halls, Akoka and Yaba',
      isAcceptingBookings: true,
      rating: 4.8,
      totalReviews: 31,
      totalBookings: 42,
    },
  },
  {
    key: 'tutor',
    firstName: 'Ngozi',
    lastName: 'Eze',
    email: 'tutor@barter.test',
    isVerified: true,
    whatsappNumber: '08145678901',
    university: 'UNILAG',
    hostel: 'Moremi Hall',
    level: '500L',
    rating: 4.9,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Ngozi+Eze&background=7C3AED&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'Maths & physics tutor for 100–300 level',
      bio: 'I tutor MTH101, MTH102, PHY101 and engineering maths. Past questions, worked examples and a study plan you can actually keep up with. Online or in the library.',
      skills: ['Mathematics', 'Physics', 'Exam prep', 'Past questions'],
      serviceArea: 'UNILAG library, Moremi Hall and online',
      isAcceptingBookings: true,
      rating: 4.9,
      totalReviews: 48,
      totalBookings: 63,
    },
  },
  {
    key: 'nailtech',
    firstName: 'Blessing',
    lastName: 'Afolabi',
    email: 'nailtech@barter.test',
    isVerified: true,
    whatsappNumber: '07061234567',
    university: 'UNILAG',
    hostel: 'Fagunwa Hall',
    level: '300L',
    rating: 4.7,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Blessing+Afolabi&background=DB2777&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'Nail tech — gel, acrylics and spa pedicures',
      bio: 'Certified nail technician working from my room in Fagunwa. Proper prep, no shortcuts, and a fresh set of tools for every client. Bring inspo or pick from my album.',
      skills: ['Gel manicure', 'Acrylic nails', 'Spa pedicure', 'Nail art'],
      serviceArea: 'Fagunwa Hall and nearby hostels',
      isAcceptingBookings: true,
      rating: 4.7,
      totalReviews: 26,
      totalBookings: 34,
    },
  },
  {
    key: 'photographer',
    firstName: 'Kelechi',
    lastName: 'Obi',
    email: 'photographer@barter.test',
    isVerified: true,
    whatsappNumber: '08178901234',
    university: 'UNILAG',
    hostel: 'Jaja Hall',
    level: '400L',
    rating: 4.6,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Kelechi+Obi&background=EA580C&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'Portrait & graduation photographer',
      bio: 'I shoot graduations, matriculation, portraits and small brand content around campus. Edited gallery delivered in 48 hours. Remote retouching and product editing also available.',
      skills: ['Portrait photography', 'Graduation shoots', 'Photo editing', 'Lightroom'],
      serviceArea: 'UNILAG campus and Lagos mainland',
      isAcceptingBookings: true,
      rating: 4.6,
      totalReviews: 19,
      totalBookings: 27,
    },
  },
  {
    key: 'mover',
    firstName: 'Chidi',
    lastName: 'Okonkwo',
    email: 'mover@barter.test',
    isVerified: true,
    whatsappNumber: '08031122334',
    university: 'UNILAG',
    hostel: 'New Hall',
    level: '400L',
    rating: 4.9,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Chidi+Okonkwo&background=2563EB&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'Campus Hostel Movement & Heavy Lifting Specialist',
      bio: 'Experienced student mover & room prep pro. I help students pack, carry heavy stuff (fridges, beds, boxes), deep clean rooms for hall clearance/handover, and safely store luggage during holidays. Reliable, fast, and no broken items.',
      skills: [
        'Hostel Packing',
        'Heavy Lifting & Loading',
        'Room Deep Cleaning',
        'Holiday Luggage Storage',
        'Fridge Defrost & Prep',
        'Electronics Dismantling',
      ],
      serviceArea: 'All UNILAG Hostels, Akoka & Yaba',
      isAcceptingBookings: true,
      rating: 4.9,
      totalReviews: 38,
      totalBookings: 52,
    },
  },
  // --- Business accounts: one owner account per business, plus staff accounts the business
  // links to so its earnings ledger has real attributable work. A business owner is still a
  // normal user account: `Service.providerId` points at a user, not at a business.
  {
    key: 'fumigpro',
    firstName: 'Ifeanyi',
    lastName: 'Obi',
    email: 'fumigpro@barter.test',
    isVerified: true,
    whatsappNumber: '08034567812',
    university: 'UNILAG',
    hostel: 'Akoka',
    level: 'Staff',
    rating: 4.8,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Ifeanyi+Obi&background=0F766E&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'FumigPro Services — hostel fumigation & pest control',
      bio: 'Licensed fumigation and pest-control crew working across UNILAG halls and the Akoka/Yaba axis. Room fumigation, bed bug treatment and post-treatment cleaning, with a treatment note and a 30-day re-treatment guarantee.',
      skills: ['Room fumigation', 'Bed bug treatment', 'Cockroach control', 'Post-treatment cleaning'],
      serviceArea: 'All UNILAG halls, Akoka and Yaba',
      isAcceptingBookings: true,
      rating: 4.8,
      totalReviews: 44,
      totalBookings: 51,
    },
  },
  {
    key: 'fumigcrew',
    firstName: 'Emeka',
    lastName: 'Nwankwo',
    email: 'fumigcrew@barter.test',
    isVerified: true,
    whatsappNumber: '08034567813',
    university: 'UNILAG',
    hostel: 'Akoka',
    level: 'Staff',
    rating: 4.7,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Emeka+Nwankwo&background=0F766E&color=fff',
  },
  {
    key: 'freshfold',
    firstName: 'Grace',
    lastName: 'Adebayo',
    email: 'freshfold@barter.test',
    isVerified: true,
    whatsappNumber: '08055667788',
    university: 'UNILAG',
    hostel: 'Akoka',
    level: 'Staff',
    rating: 4.6,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Grace+Adebayo&background=1D4ED8&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'FreshFold Laundry — wash, iron and duvet care',
      bio: 'Pickup and delivery laundry for students. Your items are washed separately, ironed and returned within 48 hours; duvets and blankets get a proper deep wash and air dry.',
      skills: ['Wash & iron', 'Duvet cleaning', 'Pickup & delivery', 'Express service'],
      serviceArea: 'UNILAG halls and Akoka',
      isAcceptingBookings: true,
      rating: 4.6,
      totalReviews: 33,
      totalBookings: 40,
    },
  },
  {
    key: 'laundrystaff',
    firstName: 'Blessing',
    lastName: 'Okoro',
    email: 'laundrystaff@barter.test',
    isVerified: true,
    whatsappNumber: '07099887766',
    university: 'UNILAG',
    hostel: 'Akoka',
    level: 'Staff',
    rating: 4.5,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Blessing+Okoro&background=1D4ED8&color=fff',
  },
  {
    key: 'campusmove',
    firstName: 'Chinedu',
    lastName: 'Eze',
    email: 'campusmove@barter.test',
    isVerified: true,
    whatsappNumber: '08133445566',
    university: 'UNILAG',
    hostel: 'Akoka',
    level: 'Staff',
    rating: 4.7,
    totalTrades: 0,
    walletBalance: 0,
    avatar: 'https://ui-avatars.com/api/?name=Chinedu+Eze&background=EA580C&color=fff',
    isServiceProvider: true,
    providerProfile: {
      headline: 'CampusMove Logistics — van moves and holiday storage',
      bio: 'Hostel moves with a van and two loaders, plus secure holiday storage for trunks and boxes. We wrap mattresses and fridges before they leave your room.',
      skills: ['Hostel moves', 'Van & loaders', 'Holiday storage', 'Furniture wrapping'],
      serviceArea: 'UNILAG, Akoka and Yaba',
      isAcceptingBookings: true,
      rating: 4.7,
      totalReviews: 21,
      totalBookings: 26,
    },
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
// Services marketplace dataset
// ---------------------------------------------------------------------------

// `provider` refers to a USERS key; `category` is a seeded category name.
const SERVICES = [
  {
    key: 'barber-fade',
    provider: 'barber',
    title: 'Student Fade Haircut (Mobile)',
    description:
      'Clean fade with a sharp line-up, done in your hall or anywhere on campus. I bring clippers, cape, mirror and sanitised tools. Allow 45 minutes including setup and cleanup.',
    category: 'Beauty & Personal Care',
    priceType: 'fixed',
    price: 2500,
    durationMinutes: 45,
    bufferMinutes: 15,
    location: 'Mobile — your hall, UNILAG',
    isRemote: false,
    tags: ['barber', 'fade', 'mobile', 'haircut'],
    images: [
      'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.8,
    totalBookings: 18,
  },
  {
    key: 'barber-beard',
    provider: 'barber',
    title: 'Beard Trim & Line-Up',
    description:
      'Shape, trim and line up your beard with a hot towel finish. Add it to a haircut or book it on its own — 30 minutes.',
    category: 'Beauty & Personal Care',
    priceType: 'fixed',
    price: 1500,
    durationMinutes: 30,
    bufferMinutes: 10,
    location: 'Mobile — your hall, UNILAG',
    isRemote: false,
    tags: ['barber', 'beard', 'line-up'],
    images: [
      'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 9,
  },
  {
    key: 'tutor-maths',
    provider: 'tutor',
    title: 'One-on-One Mathematics Tutorial',
    description:
      'MTH101, MTH102 or engineering maths, at your pace. We work through past questions and build a revision plan after the first session. Bring your course outline.',
    category: 'Services',
    priceType: 'hourly',
    price: 3000,
    durationMinutes: 60,
    bufferMinutes: 5,
    location: 'UNILAG Main Library',
    isRemote: false,
    tags: ['tutor', 'mathematics', 'exam prep', '100 level'],
    images: [
      'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.9,
    totalBookings: 24,
  },
  {
    key: 'tutor-online',
    provider: 'tutor',
    title: 'Online Physics Coaching (Video Call)',
    description:
      'PHY101/PHY102 coaching over a video call. I share a whiteboard, worked solutions and a recording of the session so you can revise later.',
    category: 'Services',
    priceType: 'hourly',
    price: 3500,
    durationMinutes: 60,
    bufferMinutes: 10,
    location: 'Online',
    isRemote: true,
    tags: ['tutor', 'physics', 'online', 'video'],
    images: [
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.8,
    totalBookings: 15,
  },
  {
    key: 'nail-gel',
    provider: 'nailtech',
    title: 'Gel Manicure with Nail Art',
    description:
      'Full prep, cuticle care, gel colour and simple nail art. Fresh tools per client and a lamp cure that actually lasts. Choose your colour when you arrive.',
    category: 'Beauty & Personal Care',
    priceType: 'fixed',
    price: 4000,
    durationMinutes: 60,
    bufferMinutes: 15,
    location: 'Fagunwa Hall, UNILAG',
    isRemote: false,
    tags: ['nails', 'gel', 'manicure', 'nail art'],
    images: [
      'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 21,
  },
  {
    key: 'nail-pedicure',
    provider: 'nailtech',
    title: 'Spa Pedicure',
    description:
      'Soak, scrub, callus treatment, massage and polish. A proper reset for your feet after weeks of trekking across campus.',
    category: 'Beauty & Personal Care',
    priceType: 'fixed',
    price: 5000,
    durationMinutes: 75,
    bufferMinutes: 15,
    location: 'Fagunwa Hall, UNILAG',
    isRemote: false,
    tags: ['nails', 'pedicure', 'spa'],
    images: [
      'https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.6,
    totalBookings: 8,
  },
  {
    key: 'photographer-portrait',
    provider: 'photographer',
    title: 'Graduation & Portrait Session',
    description:
      'A 90-minute campus shoot with 25 edited photos delivered in 48 hours. I scout two or three locations around UNILAG and bring a reflector and a second lens.',
    category: 'Services',
    priceType: 'hourly',
    price: 8000,
    durationMinutes: 90,
    bufferMinutes: 30,
    location: 'UNILAG campus',
    isRemote: false,
    tags: ['photography', 'graduation', 'portrait', 'campus'],
    images: [
      'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.6,
    totalBookings: 12,
  },
  {
    key: 'photographer-editing',
    provider: 'photographer',
    title: 'Remote Product Photo Editing',
    description:
      'Send raw product or portrait shots and get back clean, colour-corrected images sized for Instagram and for a store listing. Delivered over a shared folder.',
    category: 'Services',
    priceType: 'fixed',
    price: 3500,
    durationMinutes: 60,
    bufferMinutes: 0,
    location: 'Online',
    isRemote: true,
    tags: ['photo editing', 'lightroom', 'online', 'product photos'],
    images: [
      'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 6,
  },
  {
    key: 'mover-heavy-lifting',
    provider: 'mover',
    title: 'Hostel Moving & Heavy Lifting Assistance',
    description:
      'Moving out of your room or changing halls? I help carry heavy fridges, mattresses, storage trunks, and cartons down the stairs and load them directly into your cab or bus. Strong, careful handling so nothing breaks.',
    category: 'Services',
    priceType: 'fixed',
    price: 3500,
    durationMinutes: 60,
    bufferMinutes: 15,
    location: 'All UNILAG Hostels (New Hall, Jaja, Moremi, Fagunwa, Biobaku, Eni Njoku)',
    isRemote: false,
    tags: ['moving', 'hostel movement', 'heavy lifting', 'packout', 'campus mover'],
    images: [
      'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.9,
    totalBookings: 32,
  },
  {
    key: 'mover-deep-cleaning',
    provider: 'mover',
    title: 'Hostel Room Deep Clean & Clearance Handover Prep',
    description:
      'Avoid hostel penalty fees and get your hall clearance stamped fast. Complete sweeping, cobweb removal, tile scrubbing, wardrobe wiping, and bathroom disinfection before you hand your room keys back to the porter.',
    category: 'Services',
    priceType: 'fixed',
    price: 4500,
    durationMinutes: 90,
    bufferMinutes: 20,
    location: 'Your Hostel Room (On-Campus)',
    isRemote: false,
    tags: ['cleaning', 'room deep clean', 'hostel clearance', 'handover', 'sanitisation'],
    images: [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.9,
    totalBookings: 28,
  },
  {
    key: 'mover-holiday-storage',
    provider: 'mover',
    title: 'Holiday Luggage & Trunk Safe Storage',
    description:
      'Traveling home for the semester break? Do not pay costly interstate bus baggage fees. Store your packed boxes, trunks, reading lamps, and appliances securely in a gated off-campus apartment with 24/7 security until resumption.',
    category: 'Services',
    priceType: 'fixed',
    price: 5000,
    durationMinutes: 30,
    bufferMinutes: 15,
    location: 'Akoka / Yaba Secure Storage',
    isRemote: false,
    tags: ['storage', 'holiday storage', 'luggage safe keeping', 'semester break'],
    images: [
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.8,
    totalBookings: 19,
  },
  {
    key: 'mover-fridge-appliance',
    provider: 'mover',
    title: 'Mini-Fridge Defrost, Clean & Transport Prep',
    description:
      'Properly defrosting, draining, wiping down, and securing your mini-fridge and standing fan before you pack or store them so they do not grow mold or leak dirty water in transit.',
    category: 'Services',
    priceType: 'fixed',
    price: 2500,
    durationMinutes: 45,
    bufferMinutes: 15,
    location: 'Your Hostel Room',
    isRemote: false,
    tags: ['fridge defrost', 'appliances', 'cleaning', 'packing prep'],
    images: [
      'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 14,
  },
  // --- Business-owned services. The provider is the business owner's user account; the
  // business page and its earnings ledger are what group these under the company.
  {
    key: 'fumigpro-room',
    provider: 'fumigpro',
    title: 'Hostel Room Fumigation (Single Room)',
    description:
      'Full room fumigation for bed bugs, cockroaches and mosquitoes. We cover mattresses, wardrobes, corners and the bathroom, then air the room and leave a treatment note. One re-treatment within 30 days is included.',
    category: 'Services',
    priceType: 'fixed',
    price: 12000,
    durationMinutes: 90,
    bufferMinutes: 30,
    location: 'Your hostel room, UNILAG',
    isRemote: false,
    tags: ['fumigation', 'pest control', 'bed bugs', 'cockroach', 'hostel'],
    images: [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.8,
    totalBookings: 36,
  },
  {
    key: 'fumigpro-bedbugs',
    provider: 'fumigpro',
    title: 'Bed Bug Treatment — Mattress & Bed Frame',
    description:
      'Targeted bed bug treatment for the mattress, frame and surrounding skirting. Includes a follow-up inspection after two weeks and safe re-entry guidance.',
    category: 'Services',
    priceType: 'fixed',
    price: 15000,
    durationMinutes: 90,
    bufferMinutes: 30,
    location: 'Your hostel room, UNILAG',
    isRemote: false,
    tags: ['fumigation', 'bed bugs', 'mattress', 'pest control'],
    images: [
      'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.9,
    totalBookings: 18,
  },
  {
    key: 'fumigpro-deepclean',
    provider: 'fumigpro',
    title: 'Post-Fumigation Deep Cleaning',
    description:
      'The clean-up after a treatment: surfaces wiped, floors scrubbed, cobwebs cleared and the room aired so it is ready to move back into the same day.',
    category: 'Services',
    priceType: 'fixed',
    price: 8000,
    durationMinutes: 120,
    bufferMinutes: 20,
    location: 'Your hostel room, UNILAG',
    isRemote: false,
    tags: ['cleaning', 'fumigation', 'deep clean', 'post treatment'],
    images: [
      'https://images.unsplash.com/photo-1581578949510-fa7315c4c350?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 12,
  },
  {
    key: 'freshfold-wash',
    provider: 'freshfold',
    title: 'Weekly Wash & Iron (Up to 10 Items)',
    description:
      'Pickup from your hall, wash and iron, delivery back within 48 hours. Your items are washed separately from other customers and returned folded or on hangers.',
    category: 'Services',
    priceType: 'fixed',
    price: 4500,
    durationMinutes: 240,
    bufferMinutes: 60,
    location: 'Pickup at your hall, UNILAG',
    isRemote: false,
    tags: ['laundry', 'wash and iron', 'pickup', 'delivery'],
    images: [
      'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.6,
    totalBookings: 29,
  },
  {
    key: 'freshfold-duvet',
    provider: 'freshfold',
    title: 'Duvet & Blanket Deep Wash',
    description:
      'Industrial deep wash and air dry for duvets, blankets and heavy bed sheets. Dust mites and stains handled; delivered back sealed in a clean bag.',
    category: 'Services',
    priceType: 'fixed',
    price: 3000,
    durationMinutes: 180,
    bufferMinutes: 60,
    location: 'Pickup at your hall, UNILAG',
    isRemote: false,
    tags: ['laundry', 'duvet', 'blanket', 'deep wash'],
    images: [
      'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 15,
  },
  {
    key: 'campusmove-van',
    provider: 'campusmove',
    title: 'Hostel Move — Van + Two Loaders',
    description:
      'A van, a driver and two loaders for your hall-to-hall or hall-to-off-campus move. Mattresses and fridges wrapped before loading, everything carried down and placed in the new room.',
    category: 'Services',
    priceType: 'fixed',
    price: 20000,
    durationMinutes: 180,
    bufferMinutes: 30,
    location: 'UNILAG halls and Lagos mainland',
    isRemote: false,
    tags: ['logistics', 'moving', 'van', 'loaders', 'hostel'],
    images: [
      'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.7,
    totalBookings: 19,
  },
  {
    key: 'campusmove-storage',
    provider: 'campusmove',
    title: 'Holiday Storage — 2 Boxes for 4 Weeks',
    description:
      'Secure holiday storage for two packed boxes or trunks in a gated store with 24/7 security. Drop-off and collection at the store; we can arrange pickup for an extra fee.',
    category: 'Services',
    priceType: 'fixed',
    price: 7000,
    durationMinutes: 30,
    bufferMinutes: 15,
    location: 'Akoka secure store, Lagos',
    isRemote: false,
    tags: ['logistics', 'storage', 'holiday', 'trunks'],
    images: [
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=800',
    ],
    rating: 4.6,
    totalBookings: 7,
  },
];

// Weekly windows per provider. dayOfWeek: 0 = Sunday … 6 = Saturday.
const AVAILABILITY = [
  {
    provider: 'barber',
    windows: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 1, startTime: '15:00', endTime: '18:00' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 2, startTime: '15:00', endTime: '18:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 3, startTime: '15:00', endTime: '18:00' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 4, startTime: '15:00', endTime: '18:00' },
      { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 5, startTime: '15:00', endTime: '18:00' },
      { dayOfWeek: 6, startTime: '10:00', endTime: '16:00' },
    ],
    exceptions: [
      {
        daysFromNow: 7,
        isBlocked: true,
        note: 'Seed: Campus career fair — no bookings',
      },
      {
        daysFromNow: 3,
        isBlocked: true,
        startTime: '12:00',
        endTime: '14:00',
        note: 'Seed: Restocking clipper supplies',
      },
    ],
  },
  {
    provider: 'tutor',
    windows: [
      { dayOfWeek: 1, startTime: '16:00', endTime: '21:00' },
      { dayOfWeek: 3, startTime: '16:00', endTime: '21:00' },
      { dayOfWeek: 5, startTime: '16:00', endTime: '21:00' },
      { dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
      { dayOfWeek: 0, startTime: '14:00', endTime: '18:00' },
    ],
    exceptions: [
      {
        daysFromNow: 5,
        isBlocked: true,
        startTime: '18:00',
        endTime: '19:00',
        note: 'Seed: Departmental seminar',
      },
    ],
  },
  {
    provider: 'nailtech',
    windows: [
      { dayOfWeek: 2, startTime: '11:00', endTime: '19:00' },
      { dayOfWeek: 3, startTime: '11:00', endTime: '19:00' },
      { dayOfWeek: 4, startTime: '11:00', endTime: '19:00' },
      { dayOfWeek: 5, startTime: '11:00', endTime: '19:00' },
      { dayOfWeek: 6, startTime: '11:00', endTime: '19:00' },
      { dayOfWeek: 0, startTime: '12:00', endTime: '17:00' },
    ],
    exceptions: [
      {
        daysFromNow: 3,
        isBlocked: true,
        startTime: '13:00',
        endTime: '15:00',
        note: 'Seed: Supplier delivery',
      },
      {
        daysFromNow: 10,
        isBlocked: true,
        note: 'Seed: Travelling home for the weekend',
      },
    ],
  },
  {
    provider: 'photographer',
    windows: [
      { dayOfWeek: 3, startTime: '10:00', endTime: '18:00' },
      { dayOfWeek: 4, startTime: '10:00', endTime: '18:00' },
      { dayOfWeek: 5, startTime: '10:00', endTime: '18:00' },
      { dayOfWeek: 6, startTime: '10:00', endTime: '18:00' },
      { dayOfWeek: 0, startTime: '10:00', endTime: '18:00' },
    ],
    exceptions: [
      {
        daysFromNow: 6,
        isBlocked: true,
        startTime: '15:00',
        endTime: '17:00',
        note: 'Seed: Equipment servicing',
      },
    ],
  },
  {
    provider: 'mover',
    windows: [
      { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 3, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 4, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 5, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 6, startTime: '08:00', endTime: '19:00' },
      { dayOfWeek: 0, startTime: '09:00', endTime: '17:00' },
    ],
    exceptions: [],
  },
  {
    provider: 'fumigpro',
    windows: [
      { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 3, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 4, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 5, startTime: '08:00', endTime: '18:00' },
      { dayOfWeek: 6, startTime: '09:00', endTime: '16:00' },
    ],
    exceptions: [
      {
        daysFromNow: 4,
        isBlocked: true,
        note: 'Seed: Chemical restock and equipment service',
      },
    ],
  },
  {
    provider: 'freshfold',
    windows: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '19:00' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '19:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '19:00' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '19:00' },
      { dayOfWeek: 5, startTime: '09:00', endTime: '19:00' },
      { dayOfWeek: 6, startTime: '10:00', endTime: '16:00' },
    ],
    exceptions: [],
  },
  {
    provider: 'campusmove',
    windows: [
      { dayOfWeek: 0, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 1, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 2, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 3, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 4, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 5, startTime: '07:00', endTime: '19:00' },
      { dayOfWeek: 6, startTime: '07:00', endTime: '19:00' },
    ],
    exceptions: [
      {
        daysFromNow: 9,
        isBlocked: true,
        note: 'Seed: Van servicing',
      },
    ],
  },
];

// Relative dates keep the demo usable no matter when the seed is run. Bookings are matched
// on { serviceId, customerId } so re-running updates the same rows instead of duplicating.
const BOOKINGS = [
  {
    key: 'pending-fade',
    service: 'barber-fade',
    customer: 'buyer',
    date: { nextWeekday: [1, 2, 3, 4, 5] },
    startTime: '10:30',
    status: 'pending',
    notes: 'Low fade, keep the top a little long. I am in Jaja Hall, ground floor.',
  },
  {
    key: 'confirmed-online',
    service: 'tutor-online',
    customer: 'swapper',
    date: { nextWeekday: [1, 3, 5] },
    startTime: '17:00',
    status: 'confirmed',
    notes: 'PHY101 past questions — chapters 3 and 4. Please send the whiteboard notes after.',
    chat: [
      {
        sender: 'swapper',
        content: 'Hi Ngozi, I just booked the online physics session for 5pm. Can we focus on circuits?',
      },
      {
        sender: 'tutor',
        content: 'No problem. Bring your PHY101 past questions and I will share the whiteboard link before we start.',
      },
    ],
  },
  {
    key: 'completed-portrait',
    service: 'photographer-portrait',
    customer: 'seller',
    date: { previousWeekday: [0, 3, 4, 5, 6], daysAgo: 10 },
    startTime: '11:30',
    status: 'completed',
    notes: 'Graduation portraits for me and my sister. Delivered and paid — great session.',
  },
  {
    key: 'confirmed-moving',
    service: 'mover-heavy-lifting',
    customer: 'buyer',
    date: { nextWeekday: [1, 2, 3, 4, 5, 6] },
    startTime: '10:00',
    status: 'confirmed',
    notes: 'Moving from Moremi Hall 3rd floor down to cab at gate. Have a mini-fridge and 2 big trunks.',
    chat: [
      {
        sender: 'buyer',
        content: 'Hi Chidi, I just booked you for 10am to help carry my fridge and boxes down from Moremi Hall 3rd floor.',
      },
      {
        sender: 'mover',
        content: 'Got it! I will bring strapping belts so we can safely move the fridge down without any scratch.',
      },
    ],
  },
  // --- Completed and upcoming work for the seeded businesses, so the earnings ledger, the
  // commission breakdown and the admin counts have real rows on a fresh database.
  {
    key: 'completed-fumigation-room',
    service: 'fumigpro-room',
    customer: 'buyer',
    date: { previousWeekday: [0, 1, 2, 3, 4, 5, 6], daysAgo: 12 },
    startTime: '10:00',
    status: 'completed',
    notes: 'Room treated for cockroaches before resumption. Treatment note received.',
  },
  {
    key: 'completed-fumigation-bugs',
    service: 'fumigpro-bedbugs',
    customer: 'swapper',
    date: { previousWeekday: [0, 1, 2, 3, 4, 5, 6], daysAgo: 6 },
    startTime: '14:00',
    status: 'completed',
    notes: 'Mattress and frame treated; follow-up inspection done after two weeks.',
  },
  {
    key: 'completed-fumigation-clean',
    service: 'fumigpro-deepclean',
    customer: 'seller',
    date: { previousWeekday: [0, 1, 2, 3, 4, 5, 6], daysAgo: 21 },
    startTime: '09:00',
    status: 'completed',
    notes: 'Post-fumigation clean with the room ready for handover.',
  },
  {
    key: 'confirmed-fumigation-room',
    service: 'fumigpro-room',
    customer: 'swapper',
    date: { nextWeekday: [1, 2, 3, 4, 5, 6] },
    startTime: '11:00',
    status: 'confirmed',
    notes: 'Second room in the same hall — please bring the mattress cover.',
  },
  {
    key: 'completed-laundry-wash',
    service: 'freshfold-wash',
    customer: 'buyer',
    date: { previousWeekday: [0, 1, 2, 3, 4, 5, 6], daysAgo: 9 },
    startTime: '11:00',
    status: 'completed',
    notes: 'Ten items washed and ironed, delivered back to Jaja Hall.',
  },
  {
    key: 'confirmed-laundry-duvet',
    service: 'freshfold-duvet',
    customer: 'seller',
    date: { nextWeekday: [1, 2, 3, 4, 5, 6] },
    startTime: '13:00',
    status: 'confirmed',
    notes: 'One duvet and two blankets for the weekend.',
  },
  {
    key: 'completed-campusmove-van',
    service: 'campusmove-van',
    customer: 'swapper',
    date: { previousWeekday: [0, 1, 2, 3, 4, 5, 6], daysAgo: 18 },
    startTime: '08:00',
    status: 'completed',
    notes: 'Move from Fagunwa Hall to an off-campus flat in Akoka.',
  },
];

// ---------------------------------------------------------------------------
// Business accounts dataset
// ---------------------------------------------------------------------------

// `owner` is a USERS key. `commissionRate` is the percent Erranders keeps (admin-set in the
// app); `staff[].user`, when present, links that person to a seeded account — the link the
// earnings ledger attributes their completed bookings through.
const BUSINESSES = [
  {
    key: 'fumigpro',
    owner: 'fumigpro',
    name: 'FumigPro Services',
    slug: 'fumigpro',
    category: 'fumigation',
    description:
      'Licensed fumigation and pest-control crew serving UNILAG halls and the Akoka/Yaba axis. Room fumigation, bed bug treatment, post-treatment cleaning and a 30-day re-treatment guarantee. Same-day appointments before 2pm.',
    logo: 'https://ui-avatars.com/api/?name=FumigPro+Services&background=0F766E&color=fff',
    banner:
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=1600',
    phone: '08034567812',
    email: 'hello@fumigpro.ng',
    address: '12 Ogunlana Drive, Akoka, Lagos',
    isActive: true,
    isVerified: true,
    commissionRate: 15,
    rating: 4.8,
    staff: [
      {
        user: 'fumigcrew',
        name: 'Emeka Nwankwo',
        role: 'Crew lead',
        phone: '08034567813',
        isActive: true,
      },
      { name: 'Ngozi Umeh', role: 'Fumigation technician', phone: '08122334455', isActive: true },
      { name: 'Sadiq Bello', role: 'Technician assistant', phone: '07011223344', isActive: true },
      { name: 'Halima Yusuf', role: 'Bookings & support', phone: '08199887766', isActive: false },
    ],
    openings: [
      {
        title: 'Fumigation Technician',
        description:
          'Run room and mattress treatments with the crew lead. We provide the chemicals, PPE and training; you bring a valid ID and a clean driving record is a plus. Full-time, Monday to Saturday.',
        type: 'full_time',
        pay: 120000,
        isOpen: true,
      },
      {
        title: 'Weekend Crew Assistant',
        description:
          'Saturdays and Sundays, 9am to 4pm: help carry equipment, prep rooms and clean up after treatment. Perfect for a student who wants steady weekend work.',
        type: 'part_time',
        pay: 45000,
        isOpen: true,
      },
      {
        title: 'Sales & Bookings Agent',
        description:
          'Follow up on hall bookings and manage the business WhatsApp line. Closed for now — we filled the role in January.',
        type: 'contract',
        pay: 80000,
        isOpen: false,
      },
    ],
  },
  {
    key: 'freshfold',
    owner: 'freshfold',
    name: 'FreshFold Laundry',
    slug: 'freshfold',
    category: 'laundry',
    description:
      'Student laundry with pickup and delivery across UNILAG halls. Wash and iron, duvet deep washes and express 24-hour turnaround. Every order is washed separately and returned within 48 hours.',
    logo: 'https://ui-avatars.com/api/?name=FreshFold+Laundry&background=1D4ED8&color=fff',
    banner:
      'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&q=80&w=1600',
    phone: '08055667788',
    email: 'orders@freshfold.ng',
    address: '8 St. Finbarrs Road, Akoka, Lagos',
    isActive: true,
    isVerified: true,
    commissionRate: 12,
    rating: 4.6,
    staff: [
      {
        user: 'laundrystaff',
        name: 'Blessing Okoro',
        role: 'Laundry attendant',
        phone: '07099887766',
        isActive: true,
      },
      { name: 'Tayo Ajayi', role: 'Pickup rider', phone: '08177665544', isActive: true },
      { name: 'Ify Nnaji', role: 'Ironing & packaging', phone: '08066554433', isActive: true },
    ],
    openings: [
      {
        title: 'Pickup Rider',
        description:
          'Collect laundry bags from halls and return finished orders. You need your own bike and a smartphone for the order list. Part-time, weekday evenings and Saturday mornings.',
        type: 'part_time',
        pay: 50000,
        isOpen: true,
      },
      {
        title: 'Laundry Attendant',
        description:
          'Wash, dry and iron student orders at our Akoka shop. Full-time with one day off; experience with delicates is an advantage but we train.',
        type: 'full_time',
        pay: 95000,
        isOpen: true,
      },
    ],
  },
  {
    key: 'campusmove',
    owner: 'campusmove',
    name: 'CampusMove Logistics',
    slug: 'campusmove',
    category: 'logistics',
    description:
      'Hostel moves with a van and two loaders, plus secure holiday storage for trunks and boxes. We wrap mattresses and fridges before loading and place everything in your new room.',
    logo: 'https://ui-avatars.com/api/?name=CampusMove+Logistics&background=EA580C&color=fff',
    banner:
      'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&q=80&w=1600',
    phone: '08133445566',
    email: 'moves@campusmove.ng',
    address: '24 University Road, Yaba, Lagos',
    isActive: true,
    isVerified: false,
    commissionRate: 10,
    rating: 4.7,
    staff: [
      { name: 'Yusuf Bello', role: 'Driver', phone: '08022334455', isActive: true },
      { name: 'Peter Okafor', role: 'Loader', phone: '07033445566', isActive: true },
      { name: 'Musa Danjuma', role: 'Loader', phone: '08144556677', isActive: false },
    ],
    openings: [
      {
        title: 'Driver (Van)',
        description:
          'Drive our 14-seater van on hostel move days across Lagos mainland. Valid driver licence and at least two years driving experience required. Contract, paid per move plus a retainer.',
        type: 'contract',
        pay: 150000,
        isOpen: true,
      },
      {
        title: 'Weekend Loader',
        description:
          'Help carry trunks, mattresses and fridges during move weekends. No experience needed, just reliability. Paid per move.',
        type: 'part_time',
        pay: 60000,
        isOpen: false,
      },
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

// --- Services marketplace ---------------------------------------------------------------

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateFromOffset(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return formatLocalDate(date);
}

function nextWeekdayDate(daysOfWeek, minDaysAhead = 1) {
  for (let offset = minDaysAhead; offset <= minDaysAhead + 14; offset++) {
    const candidate = new Date();
    candidate.setDate(candidate.getDate() + offset);
    if (daysOfWeek.includes(candidate.getDay())) return formatLocalDate(candidate);
  }
  throw new Error(`No matching weekday found for ${daysOfWeek.join(', ')}`);
}

function previousWeekdayDate(daysOfWeek, minDaysAgo = 7) {
  for (let offset = minDaysAgo; offset <= minDaysAgo + 14; offset++) {
    const candidate = new Date();
    candidate.setDate(candidate.getDate() - offset);
    if (daysOfWeek.includes(candidate.getDay())) return formatLocalDate(candidate);
  }
  throw new Error(`No matching weekday found for ${daysOfWeek.join(', ')}`);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// Mirrors src/availability/slot-math.ts buildSlotKeys: one key per occupied minute, the
// buffer included, so seeded rows and API-created rows use the same uniqueness scheme.
function buildSlotKeys(providerId, date, startTime, durationMinutes, bufferMinutes) {
  const start = timeToMinutes(startTime);
  const span = durationMinutes + (bufferMinutes || 0);
  const keys = [];
  for (let minute = start; minute < Math.min(start + span, 24 * 60); minute++) {
    keys.push(`${providerId}:${date}:${minutesToTime(minute)}`);
  }
  return keys;
}

async function upsertServices(users) {
  const byKey = {};

  for (const service of SERVICES) {
    const { key, provider, category, ...fields } = service;
    const providerId = users[provider]._id;
    const categoryDoc = await Category.findOne({ name: category });
    if (!categoryDoc) throw new Error(`Seed category "${category}" does not exist`);

    const doc = await Service.findOneAndUpdate(
      { providerId, title: fields.title },
      { $set: { ...fields, providerId, category: categoryDoc._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    byKey[key] = doc;
  }

  return byKey;
}

async function upsertAvailability(users) {
  for (const entry of AVAILABILITY) {
    const providerId = users[entry.provider]._id;

    // The windows are fully owned by the seed, so replacing them is the simplest way to stay
    // in sync with this file. No other provider's rows are touched.
    await ProviderAvailability.deleteMany({ providerId });
    if (entry.windows.length) {
      await ProviderAvailability.insertMany(
        entry.windows.map((window) => ({ ...window, providerId, isActive: true })),
      );
    }

    // Exceptions are dated relative to today, so last run's rows are replaced (matched by the
    // "Seed:" note prefix) instead of accumulating a new date on every run.
    await AvailabilityException.deleteMany({
      providerId,
      note: { $regex: `^${SEED_EXCEPTION_PREFIX}` },
    });
    const exceptions = entry.exceptions.map((exception) => ({
      providerId,
      date: dateFromOffset(exception.daysFromNow),
      isBlocked: exception.isBlocked,
      note: exception.note,
      ...(exception.startTime
        ? { startTime: exception.startTime, endTime: exception.endTime }
        : {}),
    }));
    if (exceptions.length) await AvailabilityException.insertMany(exceptions);
  }
}

async function upsertBookings(users, services) {
  const byKey = {};

  for (const booking of BOOKINGS) {
    const serviceDoc = services[booking.service];
    if (!serviceDoc) throw new Error(`Seed service "${booking.service}" does not exist`);

    const customerId = users[booking.customer]._id;
    const providerId = serviceDoc.providerId;
    const date = booking.date.nextWeekday
      ? nextWeekdayDate(booking.date.nextWeekday)
      : previousWeekdayDate(booking.date.previousWeekday, booking.date.daysAgo);

    const durationMinutes = serviceDoc.durationMinutes;
    const bufferMinutes = serviceDoc.bufferMinutes || 0;
    const endTime = minutesToTime(timeToMinutes(booking.startTime) + durationMinutes);

    let chatId;
    if (booking.chat && booking.chat.length) {
      const chat = await upsertChat(
        [customerId, providerId],
        undefined,
        booking.chat.map((message) => ({
          sender: users[message.sender]._id,
          content: message.content,
        })),
      );
      chatId = chat._id;
    }

    const doc = await Booking.findOneAndUpdate(
      // One seeded booking per customer+service: stable even when the date or status changes.
      { serviceId: serviceDoc._id, customerId },
      {
        $set: {
          serviceId: serviceDoc._id,
          providerId,
          customerId,
          date,
          startTime: booking.startTime,
          endTime,
          durationMinutes,
          bufferMinutes,
          amount: serviceDoc.price || 0,
          status: booking.status,
          notes: booking.notes,
          // Completed work is paid out; anything pending or confirmed has only the
          // commitment fee recorded. The earnings ledger reports both fields per payout.
          paymentStatus: booking.status === 'completed' ? 'fully_paid' : 'commitment_paid',
          payoutReleased: booking.status === 'completed',
          blocksSlot: true,
          slotKeys: buildSlotKeys(
            providerId.toString(),
            date,
            booking.startTime,
            durationMinutes,
            bufferMinutes,
          ),
          ...(chatId ? { chatId } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // The room is derived from the booking id, exactly like BookingsService.accept does.
    if (serviceDoc.isRemote && booking.status === 'confirmed') {
      doc.meetingUrl = `https://meet.jit.si/barter-${doc._id.toString()}`;
      await doc.save();
    }

    byKey[booking.key] = doc;
  }

  return byKey;
}

async function upsertBusinesses(users) {
  const byKey = {};

  for (const business of BUSINESSES) {
    const { key, owner, ...fields } = business;
    const ownerId = users[owner]._id;

    // `user` is a USERS key in this file only; the stored staff member holds `userId`.
    const staff = (fields.staff || []).map(({ user, ...member }) => ({
      ...member,
      ...(user ? { userId: users[user]._id } : {}),
    }));

    // Matched on ownerId, not slug, so the business keeps its identity when a slug is edited.
    // Staff and openings are fully owned by this file, so they are replaced on every run.
    const doc = await Business.findOneAndUpdate(
      { ownerId },
      { $set: { ...fields, ownerId, staff } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    byKey[key] = doc;
  }

  return byKey;
}

// The stored counter is derived from the same attribution the earnings endpoint uses: the
// owner account plus every linked staff account. Recomputing it on each seed run keeps the
// profile card and the ledger consistent instead of drifting apart.
async function syncBusinessJobCounters(businesses) {
  for (const business of Object.values(businesses)) {
    const partyIds = [
      business.ownerId,
      ...business.staff.filter((member) => member.userId).map((member) => member.userId),
    ];
    const totalJobs = await Booking.countDocuments({ providerId: { $in: partyIds } });
    await Business.updateOne({ _id: business._id }, { $set: { totalJobs } });
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
  const bookings = await Booking.deleteMany({
    $or: [{ providerId: { $in: userIds } }, { customerId: { $in: userIds } }],
  });
  const services = await Service.deleteMany({ providerId: { $in: userIds } });
  const availability = await ProviderAvailability.deleteMany({ providerId: { $in: userIds } });
  const exceptions = await AvailabilityException.deleteMany({ providerId: { $in: userIds } });
  const businesses = await Business.deleteMany({ ownerId: { $in: userIds } });
  const items = await Item.deleteMany({ sellerId: { $in: userIds } });
  const deletedUsers = await User.deleteMany({ _id: { $in: userIds } });

  console.log(
    `Reset: ${deletedUsers.deletedCount} users, ${items.deletedCount} items, ` +
      `${offers.deletedCount} offers, ${transactions.deletedCount} transactions, ` +
      `${deletedChats.deletedCount} chats, ${messages.deletedCount} messages, ` +
      `${services.deletedCount} services, ${bookings.deletedCount} bookings, ` +
      `${availability.deletedCount} availability windows, ${exceptions.deletedCount} exceptions, ` +
      `${businesses.deletedCount} businesses.`,
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
  const services = await upsertServices(users);
  await upsertAvailability(users);
  await upsertBookings(users, services);
  const businesses = await upsertBusinesses(users);
  await syncBusinessJobCounters(businesses);

  console.log('\n✔ Seed complete (idempotent — safe to run again).\n');
  console.log('Demo accounts (all use the same password):');
  console.log('  Seller   seller@barter.test       / password123');
  console.log('  Buyer    buyer@barter.test        / password123');
  console.log('  Swapper  swapper@barter.test      / password123');
  console.log('  Admin    admin@barter.test        / password123');
  console.log('\nService provider accounts (all use the same password):');
  console.log('  Barber       barber@barter.test       / password123');
  console.log('  Tutor        tutor@barter.test        / password123');
  console.log('  Nail tech    nailtech@barter.test     / password123');
  console.log('  Photographer photographer@barter.test / password123');
  console.log('  Hostel Mover mover@barter.test        / password123');
  console.log('\nBusiness accounts (owner logins, same password):');
  for (const business of BUSINESSES) {
    console.log(
      `  ${business.name.padEnd(21)} ${users[business.owner].email.padEnd(24)} / password123`,
    );
  }
  console.log('  Staff accounts: fumigcrew@barter.test, laundrystaff@barter.test');
  console.log('\nSeeded content:');
  console.log(`  ${USERS.length} users, ${ITEMS.length} listings (sell/swap/service),`);
  console.log('  2 pending swap offers, 3 escrows (held / released / disputed),');
  console.log('  2 conversations with real message history, categories and settings.');
  console.log(
    `  ${SERVICES.length} bookable services from ${new Set(SERVICES.map((s) => s.provider)).size} providers, ` +
      `${AVAILABILITY.reduce((total, entry) => total + entry.windows.length, 0)} weekly availability windows,`,
  );
  console.log(
    `  ${AVAILABILITY.reduce((total, entry) => total + entry.exceptions.length, 0)} date exceptions, ` +
      `${BOOKINGS.length} bookings (pending / confirmed with video room / completed).`,
  );
  console.log(
    `  ${BUSINESSES.length} businesses with ` +
      `${BUSINESSES.reduce((total, entry) => total + entry.staff.length, 0)} staff, ` +
      `${BUSINESSES.reduce((total, entry) => total + entry.openings.length, 0)} openings and ` +
      `commission rates of ${BUSINESSES.map((entry) => `${entry.commissionRate}%`).join(' / ')} ` +
      '(completed work included).',
  );
  console.log('\nAdmin sign-in: admin@barter.test has isAdmin set on the account.\n');
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
