import { PageBlockType, BusinessType } from './schemas/business.schema';

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
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials. Fast to load and easy to read, for any campus hustle.',
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
 * Intelligently picks the best template based on category keyword and business type.
 */
export const defaultTemplateFor = (categoryOrType: string, type?: string): string => {
  const norm = String(categoryOrType || '').toLowerCase();

  // Beauty, nails, hair, grooming
  if (norm.includes('nail') || norm.includes('barber') || norm.includes('hair') || norm.includes('braid') || norm.includes('lash') || norm.includes('beauty') || norm.includes('makeup') || norm.includes('salon')) {
    return 'glam';
  }

  // Jewelry, beads, fashion, thrift
  if (norm.includes('jewelry') || norm.includes('jewel') || norm.includes('bead') || norm.includes('perfume') || norm.includes('thrift') || norm.includes('craft') || norm.includes('fashion') || norm.includes('clothing') || norm.includes('accessories')) {
    return 'craft';
  }

  // Tutorial, academic, exam prep
  if (norm.includes('tutorial') || norm.includes('tutor') || norm.includes('exam') || norm.includes('prep') || norm.includes('class') || norm.includes('lesson') || norm.includes('academic') || norm.includes('notes') || type === BusinessType.TUTORIAL) {
    return 'academy';
  }

  // Tech, repairs, gadgets
  if (norm.includes('phone') || norm.includes('laptop') || norm.includes('repair') || norm.includes('tech') || norm.includes('gadget') || norm.includes('screen') || norm.includes('fix')) {
    return 'techfix';
  }

  // Food, cakes, baking
  if (norm.includes('bake') || norm.includes('cake') || norm.includes('food') || norm.includes('bites') || norm.includes('parfait') || norm.includes('snack') || norm.includes('cook') || norm.includes('meal')) {
    return 'bites';
  }

  // Logistics, movers, fumigation, laundry
  if (norm.includes('move') || norm.includes('logistics') || norm.includes('fumigat') || norm.includes('clean') || norm.includes('laundry')) {
    return 'fresh';
  }

  if (type === BusinessType.PRODUCT) return 'craft';
  if (type === BusinessType.SERVICE) return 'glam';

  return 'fresh';
};

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
