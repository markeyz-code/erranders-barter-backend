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
 * Templates are written with the business's own name injected at apply time, so a preview
 * reads like a real page rather than lorem ipsum.
 */
export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'glam',
    name: 'Glam Studio',
    description: 'Vibrant, visual & appointment-first. Built for nail techs, barbers, braiders, lash artists and makeup pros.',
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#D946EF',
    swatch: ['#D946EF', '#FDF4FF', '#1E1B4B'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Flawless campus looks. Book your chair in seconds — zero lecture clashes.', ctaLabel: 'Book appointment', ctaHref: '#services' } },
      { type: PageBlockType.SERVICES, props: { title: 'Services & Styles', note: 'Transparent pricing with student-friendly rates.' } },
      { type: PageBlockType.GALLERY, props: { title: 'Recent Looks & Sets', images: [] } },
      { type: PageBlockType.PRODUCTS, props: { title: 'Care Products & Add-ons', note: 'Oils, press-ons, and maintenance kits.' } },
      { type: PageBlockType.HOURS, props: { title: 'Studio / Hostel Hours', rows: [ { day: 'Monday – Friday', hours: '10:00 — 20:00' }, { day: 'Saturday', hours: '9:00 — 19:00' }, { day: 'Sunday', hours: 'By appointment' } ] } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'Campus Reviews', items: [] } },
      { type: PageBlockType.CTA, props: { headline: 'Get your set done today', body: 'Slots fill up quickly on weekends. Lock your time now.', buttonLabel: 'Reserve slot', buttonHref: '#services' } },
    ],
  },
  {
    id: 'craft',
    name: 'Boutique & Jewelry',
    description: 'Picture-first aesthetic for handmade jewelry, beads, thrift fashion, perfumes & accessories.',
    suits: [BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#D97706',
    swatch: ['#D97706', '#FFFBEB', '#1E293B'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Handcrafted campus pieces, unique drops, delivered to your hostel doorstep.', ctaLabel: 'Explore the drop', ctaHref: '#products' } },
      { type: PageBlockType.PRODUCTS, props: { title: 'Available Pieces', note: 'Limited stock per drop. Once gone, it’s gone.' } },
      { type: PageBlockType.GALLERY, props: { title: 'Campus Lookbook', images: [] } },
      { type: PageBlockType.ABOUT, props: { title: 'Behind the Craft', body: '{{description}}' } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'Customer Love', items: [] } },
      { type: PageBlockType.CTA, props: { headline: 'Want custom orders?', body: 'Message us your design ideas and wrist/ring measurements.', buttonLabel: 'Order custom piece', buttonHref: '#contact' } },
    ],
  },
  {
    id: 'academy',
    name: 'Academy & Tutoring',
    description: 'Built for tutorial centers, exam prep, course summaries, past questions & academic mentorship.',
    suits: [BusinessType.TUTORIAL, BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#2563EB',
    swatch: ['#2563EB', '#EFF6FF', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Clear explanations, past questions, and high-yield notes taught by senior students who aced the course.', ctaLabel: 'Join tutorial class', ctaHref: '#services' } },
      { type: PageBlockType.ABOUT, props: { title: 'How we help you ace exams', body: '{{description}}' } },
      { type: PageBlockType.SERVICES, props: { title: 'Classes & Courses', note: 'Interactive group sessions and private 1-on-1 tutoring available.' } },
      { type: PageBlockType.HOURS, props: { title: 'Lecture & Class Schedule', rows: [ { day: 'Monday & Wednesday', hours: '16:00 — 18:30' }, { day: 'Friday', hours: '15:00 — 17:30' }, { day: 'Saturday Revision', hours: '10:00 — 14:00' } ] } },
      { type: PageBlockType.FAQ, props: { title: 'Frequently Asked Questions', items: [
        { q: 'Where do classes take place?', a: 'Classes are held in designated campus lecture theaters and online via live video rooms.' },
        { q: 'How do I access lecture notes & past questions?', a: 'All enrolled students get instant access to the digital resource vault watermarked for your account.' },
        { q: 'Can I join mid-semester?', a: 'Yes! You get catch-up notes and recorded session links.' }
      ] } },
      { type: PageBlockType.CONTACT, props: { title: 'Join our Student WhatsApp Group' } },
    ],
  },
  {
    id: 'techfix',
    name: 'Tech & Gadget Lab',
    description: 'Fast, trustworthy gadget repair, screen replacements, accessories & laptop servicing.',
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#0284C7',
    swatch: ['#0284C7', '#F0F9FF', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Same-day campus phone & laptop fixes. Transparent diagnostics with zero stories.', ctaLabel: 'Get diagnostic quote', ctaHref: '#services' } },
      { type: PageBlockType.SERVICES, props: { title: 'Repair Services', note: 'Screens, batteries, charging ports, OS re-installation, cleaning.' } },
      { type: PageBlockType.PRODUCTS, props: { title: 'Accessories & Parts', note: 'Fast chargers, durable cables, tempered glass, cases.' } },
      { type: PageBlockType.ABOUT, props: { title: 'Warranty & Quality Promise', body: 'Every repair comes with our 30-day student warranty. We test your device together before payment.' } },
      { type: PageBlockType.CONTACT, props: { title: 'Hostel Drop-off Points' } },
    ],
  },
  {
    id: 'bites',
    name: 'Campus Bites & Bakery',
    description: 'Fresh hostel treats, cakes, parfaits, cookies and dorm meal prep deliveries.',
    suits: [BusinessType.PRODUCT, BusinessType.HYBRID],
    accentColor: '#EA580C',
    swatch: ['#EA580C', '#FFF7ED', '#1C1917'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Freshly baked, deliciously packed, delivered straight to your hall room.', ctaLabel: 'Order treats', ctaHref: '#products' } },
      { type: PageBlockType.PRODUCTS, props: { title: 'Today’s Fresh Menu', note: 'Baked daily in small batches with premium ingredients.' } },
      { type: PageBlockType.GALLERY, props: { title: 'Past Orders & Celebrations', images: [] } },
      { type: PageBlockType.ABOUT, props: { title: 'Custom Birthday & Event Cakes', body: '{{description}}' } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'Hostel Foodies Say', items: [] } },
      { type: PageBlockType.CTA, props: { headline: 'Pre-order for your birthday or special week', body: 'Order at least 48 hours in advance for customized celebration boxes.', buttonLabel: 'Pre-order now', buttonHref: '#contact' } },
    ],
  },
  {
    id: 'fresh',
    name: 'Fresh & Logistics',
    description: 'Clean and calm. Good for cleaning, laundry, moving porters and room fumigation.',
    suits: [BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#0F766E',
    swatch: ['#0F766E', '#F0FDFA', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Reliable campus operations, on time, and priced for students.', ctaLabel: 'Book service', ctaHref: '#services' } },
      { type: PageBlockType.SERVICES, props: { title: 'What we do', note: 'Fixed rates with no hidden fees.' } },
      { type: PageBlockType.ABOUT, props: { title: 'About our team', body: '{{description}}' } },
      { type: PageBlockType.HOURS, props: { title: 'Operation Hours', rows: [ { day: 'Monday – Friday', hours: '8:00 — 18:00' }, { day: 'Saturday', hours: '9:00 — 16:00' }, { day: 'Sunday', hours: 'Closed' } ] } },
      { type: PageBlockType.CONTACT, props: { title: 'Book or Contact' } },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials. Fast to load, easy to read, perfect for any campus hustle.',
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.TUTORIAL, BusinessType.HYBRID],
    accentColor: '#0F172A',
    swatch: ['#0F172A', '#F8FAFC', '#64748B'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: '{{description}}', ctaLabel: 'Get in touch', ctaHref: '#contact' } },
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
      isVisible: true,
      props: fill(block.props) as Record<string, unknown>,
    })),
  };
};
