import { PageBlockType, BusinessType, BusinessVertical } from './schemas/business.schema';

/**
 * Page templates.
 *
 * A new business should not face a blank canvas. Each template is a complete, good-looking
 * page — headline copy, section order, accent colour — chosen to suit the kind of business
 * it is. Applying one replaces the design immediately, and the owner can then edit anything
 * about it.
 *
 * The definitions live here so the portal and the public site cannot disagree about what a
 * template contains.
 */

export interface TemplateBlock {
  type: PageBlockType;
  props: Record<string, unknown>;
  /**
   * Hidden until the owner supplies real content for it.
   *
   * A testimonials section with invented reviews is worse than no section: the owner
   * publishes it as-is and the business is making claims about customers it never had.
   */
  hidden?: boolean;
}

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  /** The vertical this template is written for. Drives template choice and navigation. */
  vertical?: BusinessVertical;
  /** Which business types this template is designed for. */
  suits: BusinessType[];
  accentColor: string;
  /** Preview swatch colours, in order. */
  swatch: string[];
  blocks: TemplateBlock[];
}

/**
 * Photography shipped with the app, so a new business has a real-looking page on day one
 * instead of empty grey boxes. Paths are relative to the storefront origin, which keeps
 * them working on every business subdomain without hard-coding a hostname.
 */
const PHOTO = {
  hair: '/img/nigerian_hair_braiding_1790990545939.jpg',
  laptop: '/img/nigerian_laptop_repair_1790990557474.jpg',
  cleaning: '/img/nigerian_room_cleaning_1790990576715.jpg',
  payment: '/img/nigerian_student_phone_payment_1790990486294.jpg',
  product: '/img/nigerian_student_snapping_item_1790990467827.jpg',
  campus: '/img/nigerian_students_campus_1790990496794.jpg',
  handover: '/img/nigerian_students_exchanging_1790990477525.jpg',
  moving: '/img/nigerian_students_packing_hostel_1790990458873.jpg',
  tutoring: '/img/nigerian_tutoring_1790990568804.jpg',
  desk: '/img/student_business_auth.jpg',
};

/**
 * Templates are written with the business's own name injected at apply time, so a preview
 * reads like a real page rather than lorem ipsum.
 *
 * Every template is a complete page: a hero with a real photograph, an argument for why
 * the customer should care, the offerings, proof of how to find and trust the business,
 * and a close. Empty sections are hidden rather than shipped blank.
 */
export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'glam',
    name: 'Glam Studio',
    description: 'Vibrant, appointment-first. Built for nail techs, barbers, braiders, lash artists and makeup pros.',
    vertical: BusinessVertical.NAILS,
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#DB2777',
    swatch: ['#DB2777', '#FDF2F8', '#1E1B4B'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Flawless campus looks, booked around your timetable. No queues, no lecture clashes.',
          ctaLabel: 'Book your chair',
          ctaHref: '#services',
          image: PHOTO.hair,
        },
      },
      {
        type: PageBlockType.SERVICES,
        props: { title: 'Services and styles', note: 'Student rates, listed upfront. No haggling at the chair.' },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Recent sets', images: [PHOTO.hair, PHOTO.product, PHOTO.handover] },
      },
      {
        type: PageBlockType.PRODUCTS,
        props: { title: 'Care products', note: 'Oils, press-ons and maintenance kits you can take home.' },
      },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'Studio hours',
          rows: [
            { day: 'Monday to Friday', hours: '10:00 — 20:00' },
            { day: 'Saturday', hours: '9:00 — 19:00' },
            { day: 'Sunday', hours: 'By appointment' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What clients say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Weekend slots go fast',
          body: 'Book now and we will hold your time. Payment on the day is fine.',
          buttonLabel: 'Reserve a slot',
          buttonHref: '#services',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Find the studio' } },
    ],
  },
  {
    id: 'craft',
    name: 'Boutique and Jewelry',
    description: 'Picture-first. For handmade jewelry, beads, thrift fashion, perfume and accessories.',
    vertical: BusinessVertical.JEWELRY,
    suits: [BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#B45309',
    swatch: ['#B45309', '#FFFBEB', '#1E293B'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Handmade pieces, small drops, delivered to your hostel door.',
          ctaLabel: 'Shop the drop',
          ctaHref: '#shop',
          image: PHOTO.product,
        },
      },
      {
        type: PageBlockType.PRODUCTS,
        props: { title: 'Available now', note: 'Made in small batches. When a piece is gone, it is gone.' },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Lookbook', images: [PHOTO.product, PHOTO.handover, PHOTO.campus] },
      },
      { type: PageBlockType.ABOUT, props: { title: 'Made on campus', body: '{{description}}' } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'Customer love', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Want something custom?',
          body: 'Send your design idea and measurements. We will tell you what is possible and what it costs.',
          buttonLabel: 'Start a custom order',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Order or ask a question' } },
    ],
  },
  {
    id: 'academy',
    name: 'Academy and Tutoring',
    description: 'Built for tutorial centres, exam prep, course summaries, past questions and academic mentoring.',
    vertical: BusinessVertical.TUTOR,
    suits: [BusinessType.TUTORIAL, BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#1D4ED8',
    swatch: ['#1D4ED8', '#EFF6FF', '#0F172A'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Clear explanations, past questions and high-yield notes, taught by students who aced the course.',
          ctaLabel: 'Join a class',
          ctaHref: '#services',
          image: PHOTO.tutoring,
        },
      },
      { type: PageBlockType.ABOUT, props: { title: 'How we help you pass', body: '{{description}}' } },
      {
        type: PageBlockType.SERVICES,
        props: { title: 'Classes and courses', note: 'Group sessions and private one-on-one tutoring.' },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Inside a session', images: [PHOTO.campus, PHOTO.tutoring, PHOTO.handover] },
      },
      { type: PageBlockType.RESOURCES, props: { title: 'Student resource vault' } },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'Class schedule',
          rows: [
            { day: 'Monday and Wednesday', hours: '16:00 — 18:30' },
            { day: 'Friday', hours: '15:00 — 17:30' },
            { day: 'Saturday revision', hours: '10:00 — 14:00' },
            { day: 'Sunday', hours: 'Closed' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What students say', items: [] }, hidden: true },
      {
        type: PageBlockType.FAQ,
        props: {
          title: 'Common questions',
          items: [
            { q: 'Where do classes hold?', a: 'On campus. We share the exact room when you book, along with directions.' },
            { q: 'Can I pay per session?', a: 'Yes. Each class is booked and paid for individually, so you are not tied into a full term upfront.' },
            { q: 'What if I have to miss a class?', a: 'Message us at least two hours before and we will move you into another group that week.' },
          ],
        },
      },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Not sure which class you need?',
          body: 'Send your course code and your current score. We will tell you honestly whether we can help.',
          buttonLabel: 'Get in touch',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Find us' } },
    ],
  },
  {
    id: 'techfix',
    name: 'Tech and Gadget Lab',
    description: 'For repairs, screen replacements, accessories and laptop servicing.',
    vertical: BusinessVertical.TECH,
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#0369A1',
    swatch: ['#0369A1', '#F0F9FF', '#0F172A'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Same-day phone and laptop repairs on campus. A diagnosis first, no guessing.',
          ctaLabel: 'Get a quote',
          ctaHref: '#services',
          image: PHOTO.laptop,
        },
      },
      {
        type: PageBlockType.SERVICES,
        props: { title: 'Repairs we do', note: 'Screens, batteries, charging ports, software and cleaning.' },
      },
      {
        type: PageBlockType.PRODUCTS,
        props: { title: 'Parts and accessories', note: 'Chargers, cables, tempered glass and cases, in stock.' },
      },
      { type: PageBlockType.ABOUT, props: { title: 'Our promise', body: '{{description}}' } },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'When you can drop off',
          rows: [
            { day: 'Monday to Friday', hours: '9:00 — 19:00' },
            { day: 'Saturday', hours: '10:00 — 17:00' },
            { day: 'Sunday', hours: 'Closed' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What customers say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Not sure what is wrong with it?',
          body: 'Send a photo and what it is doing. We will tell you what it likely costs before you come in.',
          buttonLabel: 'Ask an engineer',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Drop-off points' } },
    ],
  },
  {
    id: 'bites',
    name: 'Campus Bites and Bakery',
    description: 'For hostel treats, cakes, parfaits, cookies and meal prep deliveries.',
    vertical: BusinessVertical.BAKERY,
    suits: [BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#C2410C',
    swatch: ['#C2410C', '#FFF7ED', '#1C1917'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Baked fresh, packed properly, delivered to your hall.',
          ctaLabel: 'See the menu',
          ctaHref: '#shop',
          image: PHOTO.product,
        },
      },
      {
        type: PageBlockType.PRODUCTS,
        props: { title: 'On the menu today', note: 'Baked in small batches. Tell us allergies when you order.' },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Orders and celebrations', images: [PHOTO.product, PHOTO.moving, PHOTO.handover] },
      },
      { type: PageBlockType.ABOUT, props: { title: 'Cakes for the occasion', body: '{{description}}' } },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'Order windows',
          rows: [
            { day: 'Monday to Friday', hours: 'Orders close 4:00 pm' },
            { day: 'Saturday', hours: 'Orders close 2:00 pm' },
            { day: 'Sunday', hours: 'Closed' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What people order again', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Celebrating something?',
          body: 'Birthday boxes and event trays need 48 hours notice so we can do them properly.',
          buttonLabel: 'Pre-order',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Order here' } },
    ],
  },
  {
    id: 'fresh',
    name: 'Cleaning, Laundry and Moving',
    description: 'Calm and practical. For cleaning, laundry, moving porters, fumigation and hostel services.',
    vertical: BusinessVertical.CLEANING,
    suits: [BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#0F766E',
    swatch: ['#0F766E', '#F0FDFA', '#0F172A'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Turn up to a clean room. Book a service and get on with your day.',
          ctaLabel: 'Book a service',
          ctaHref: '#services',
          image: PHOTO.cleaning,
        },
      },
      { type: PageBlockType.SERVICES, props: { title: 'What we do', note: 'Fixed rates. What we quote is what you pay.' } },
      { type: PageBlockType.ABOUT, props: { title: 'How we work', body: '{{description}}' } },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Our work', images: [PHOTO.cleaning, PHOTO.moving, PHOTO.campus] },
      },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'When we operate',
          rows: [
            { day: 'Monday to Friday', hours: '8:00 — 18:00' },
            { day: 'Saturday', hours: '9:00 — 16:00' },
            { day: 'Sunday', hours: 'Closed' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What customers say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Need a slot this week?',
          body: 'Tell us the date and the room. Most jobs can be done the next day.',
          buttonLabel: 'Book now',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Book or contact' } },
    ],
  },
  {
    id: 'fumigation',
    name: 'Pest Control & Fumigation',
    description: 'Trust-first. For fumigation, pest control and disinfection crews. Leads with safety and certification, because nobody lets a stranger treat their room on price alone.',
    vertical: BusinessVertical.FUMIGATION,
    suits: [BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#15803D',
    swatch: ['#15803D', '#F0FDF4', '#0F172A'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Safe, certified pest control for hostels and off-campus rooms. Treat it once, properly.',
          ctaLabel: 'Book an inspection',
          ctaHref: '#services',
          image: PHOTO.cleaning,
        },
      },
      {
        type: PageBlockType.SERVICES,
        props: { title: 'Treatments', note: 'Priced per room or per building, quoted before we start.' },
      },
      {
        type: PageBlockType.ABOUT,
        props: {
          title: 'What we use, and why it matters',
          body: '{{description}}\n\nWe tell you exactly which chemical we are using, how long to stay out of the room, and what to do afterwards. If a treatment needs a second visit, that visit is free.',
        },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Recent jobs', images: [PHOTO.cleaning, PHOTO.moving, PHOTO.campus] },
      },
      {
        type: PageBlockType.FAQ,
        props: {
          title: 'Before you book',
          items: [
            { q: 'How long do I need to leave the room?', a: 'Most treatments need four to six hours. We tell you the exact window for the chemical used, and plan around your lectures where possible.' },
            { q: 'Is it safe for my roommate or pets?', a: 'Tell us before booking. Some treatments are not suitable with pets or with anyone pregnant or asthmatic in the room, and we will recommend something else.' },
            { q: 'What if nothing changes?', a: 'A follow-up within two weeks is included. If the infestation is not resolved, we retreat without charging again.' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What customers say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Seen something you cannot identify?',
          body: 'Send a photo. We will tell you what it is and what it costs to treat, before you commit.',
          buttonLabel: 'Get a quote',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Book or ask' } },
    ],
  },
  {
    id: 'barber',
    name: 'Barbering & Grooming',
    description: 'Chair-first. For barbers and grooming services where the appointment, not a product list, is what the customer came for.',
    vertical: BusinessVertical.BARBER,
    suits: [BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#1E293B',
    swatch: ['#1E293B', '#F8FAFC', '#EA580C'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Sharp cuts between lectures. Book a chair, walk in, walk out.',
          ctaLabel: 'Book a chair',
          ctaHref: '#services',
          image: PHOTO.hair,
        },
      },
      {
        type: PageBlockType.SERVICES,
        props: { title: 'The chair list', note: 'Prices are for a standard cut. Tell us what you want and we will keep it simple.' },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'Recent cuts', images: [PHOTO.hair, PHOTO.product, PHOTO.handover] },
      },
      {
        type: PageBlockType.HOURS,
        props: {
          title: 'Chair hours',
          rows: [
            { day: 'Monday to Friday', hours: '11:00 — 20:00' },
            { day: 'Saturday', hours: '9:00 — 20:00' },
            { day: 'Sunday', hours: 'Walk-ins only' },
          ],
        },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What clients say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Busy week? Reserve ahead',
          body: 'Weekend slots fill by Thursday. Hold a time and we will keep it for you.',
          buttonLabel: 'Reserve a slot',
          buttonHref: '#services',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Where to find the chair' } },
    ],
  },
  {
    id: 'thrift',
    name: 'Thrift & Pre-loved',
    description: 'Drop-driven. For thrift and pre-loved clothing, where stock turns over fast and the photograph sells the item.',
    vertical: BusinessVertical.THRIFT,
    suits: [BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#7C3AED',
    swatch: ['#7C3AED', '#F5F3FF', '#1E1B4B'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: 'Hand-picked pre-loved pieces, one of each. When it is gone, it is gone.',
          ctaLabel: 'Shop the drop',
          ctaHref: '#shop',
          image: PHOTO.product,
        },
      },
      {
        type: PageBlockType.PRODUCTS,
        props: { title: 'This week’s drop', note: 'Every piece is a single item. Ask for measurements before you commit.' },
      },
      {
        type: PageBlockType.ABOUT,
        props: {
          title: 'How the drops work',
          body: '{{description}}\n\nNew pieces go up on Fridays. Items are held for two hours after you message, then released to the next person. If something does not fit, tell us within a day and we will exchange it for another piece.',
        },
      },
      {
        type: PageBlockType.GALLERY,
        props: { title: 'How pieces look worn', images: [PHOTO.product, PHOTO.handover, PHOTO.campus] },
      },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What buyers say', items: [] }, hidden: true },
      {
        type: PageBlockType.CTA,
        props: {
          headline: 'Looking for something specific?',
          body: 'Tell us your size and what you are after. We will message you when something close comes in.',
          buttonLabel: 'Send a request',
          buttonHref: '#contact',
        },
      },
      { type: PageBlockType.CONTACT, props: { title: 'Ask about a piece' } },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials. Fast to load and easy to read, for any campus hustle.',
    vertical: BusinessVertical.GENERAL,
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.TUTORIAL, BusinessType.HYBRID],
    accentColor: '#0F172A',
    swatch: ['#0F172A', '#F8FAFC', '#64748B'],
    blocks: [
      {
        type: PageBlockType.HERO,
        props: {
          headline: '{{name}}',
          subheadline: '{{description}}',
          ctaLabel: 'Get in touch',
          ctaHref: '#contact',
          image: PHOTO.campus,
        },
      },
      { type: PageBlockType.SERVICES, props: { title: 'Services' } },
      { type: PageBlockType.PRODUCTS, props: { title: 'Products' } },
      { type: PageBlockType.CONTACT, props: { title: 'Contact' } },
    ],
  },
];

/**
 * What kind of business this is, inferred from what the owner typed at signup.
 *
 * The vertical decides two things at once: which template they start from, and which
 * tools appear in their sidebar. Getting it wrong at signup is recoverable — the owner
 * can change it in settings.
 */
export const verticalFor = (categoryOrType: string, type?: string): BusinessVertical => {
  const norm = String(categoryOrType || '').toLowerCase();
  const has = (...words: string[]) => words.some((word) => norm.includes(word));

  if (has('fumigat', 'pest', 'rodent', 'cockroach', 'disinfect', 'bedbug')) return BusinessVertical.FUMIGATION;
  if (has('barber', 'barbing', 'haircut', 'shave', 'grooming')) return BusinessVertical.BARBER;
  if (has('nail', 'lash', 'makeup', 'beauty', 'pedicure', 'manicure')) return BusinessVertical.NAILS;
  if (has('thrift', 'pre-loved', 'preloved', 'secondhand', 'okrika', 'bend down')) return BusinessVertical.THRIFT;
  if (has('jewel', 'jewelry', 'bead', 'perfume', 'accessor', 'craft', 'handmade')) return BusinessVertical.JEWELRY;
  if (has('bak', 'cake', 'pastr', 'cookie', 'parfait', 'bites', 'confection')) return BusinessVertical.BAKERY;
  if (has('food', 'meal', 'cook', 'kitchen', 'snack', 'smoothie', 'juice')) return BusinessVertical.FOOD;
  if (has('tutor', 'tutorial', 'lesson', 'exam', 'prep', 'academic', 'notes', 'past question') || type === BusinessType.TUTORIAL) {
    return BusinessVertical.TUTOR;
  }
  if (has('laundry', 'wash', 'ironing')) return BusinessVertical.LAUNDRY;
  if (has('clean', 'fumigat', 'move', 'logistic', 'porter')) return BusinessVertical.CLEANING;
  if (has('phone', 'laptop', 'repair', 'gadget', 'screen', 'tech')) return BusinessVertical.TECH;

  return BusinessVertical.GENERAL;
};

/** The template a vertical starts with. */
const TEMPLATE_BY_VERTICAL: Record<BusinessVertical, string> = {
  [BusinessVertical.FUMIGATION]: 'fumigation',
  [BusinessVertical.BARBER]: 'barber',
  [BusinessVertical.NAILS]: 'glam',
  [BusinessVertical.THRIFT]: 'thrift',
  [BusinessVertical.JEWELRY]: 'craft',
  [BusinessVertical.BAKERY]: 'bites',
  [BusinessVertical.FOOD]: 'bites',
  [BusinessVertical.TUTOR]: 'academy',
  [BusinessVertical.LAUNDRY]: 'fresh',
  [BusinessVertical.CLEANING]: 'fresh',
  [BusinessVertical.TECH]: 'techfix',
  [BusinessVertical.GENERAL]: 'minimal',
};

export const defaultTemplateFor = (categoryOrType: string, type?: string): string =>
  TEMPLATE_BY_VERTICAL[verticalFor(categoryOrType, type)] || 'minimal';

/**
 * Turns a template into concrete blocks for one business.
 *
 * `{{name}}` and `{{description}}` are replaced so the page reads like theirs immediately,
 * rather than shipping placeholder copy they have to notice and fix.
 */
export const materialiseTemplate = (
  template: PageTemplate,
  business: { name: string; description?: string },
) => {
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(/\{\{name\}\}/g, business.name)
        .replace(/\{\{description\}\}/g, business.description || '');
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fill(entry)]));
    }
    return value;
  };

  return {
    accentColor: template.accentColor,
    blocks: template.blocks.map((block, index) => ({
      id: `${template.id}-${block.type}-${index}`,
      type: block.type,
      isVisible: !block.hidden,
      props: fill(block.props) as Record<string, unknown>,
    })),
  };
};
