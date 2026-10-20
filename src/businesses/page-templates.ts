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
    id: 'fresh',
    name: 'Fresh',
    description: 'Clean and calm. Good for services like cleaning, laundry and repairs.',
    suits: [BusinessType.SERVICE, BusinessType.HYBRID],
    accentColor: '#0F766E',
    swatch: ['#0F766E', '#F8FAFC', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Reliable, on time, and priced for students.', ctaLabel: 'Book a slot', ctaHref: '/services' } },
      { type: PageBlockType.SERVICES, props: { title: 'What we offer', note: 'Prices update live from our listings.' } },
      { type: PageBlockType.ABOUT, props: { title: 'About us', body: '{{description}}' } },
      { type: PageBlockType.HOURS, props: { title: 'When we are open', rows: [ { day: 'Monday – Friday', hours: '8:00 — 18:00' }, { day: 'Saturday', hours: '9:00 — 16:00' }, { day: 'Sunday', hours: 'Closed' } ] } },
      { type: PageBlockType.CONTACT, props: { title: 'Get in touch' } },
    ],
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Dark and confident. Good for barbers, nail techs and photographers.',
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT],
    accentColor: '#EA580C',
    swatch: ['#0F172A', '#EA580C', '#FFFFFF'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Book in seconds. Look sharp all week.', ctaLabel: 'Book me', ctaHref: '/services' } },
      { type: PageBlockType.GALLERY, props: { title: 'Recent work', images: [] } },
      { type: PageBlockType.SERVICES, props: { title: 'Prices', note: 'No surprises at the chair.' } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'What clients say', items: [] } },
      { type: PageBlockType.CTA, props: { headline: 'Ready when you are', body: 'Pick a time that works around your lectures.', buttonLabel: 'Book now', buttonHref: '/services' } },
    ],
  },
  {
    id: 'academy',
    name: 'Academy',
    description: 'Built for tutorial centres: what you teach, hours and common questions.',
    suits: [BusinessType.TUTORIAL, BusinessType.HYBRID],
    accentColor: '#1D4ED8',
    swatch: ['#1D4ED8', '#EFF6FF', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Small classes, real results, taught by students who just passed it.', ctaLabel: 'See classes', ctaHref: '/services' } },
      { type: PageBlockType.ABOUT, props: { title: 'How we teach', body: '{{description}}' } },
      { type: PageBlockType.SERVICES, props: { title: 'Classes', note: 'Group and one-on-one sessions available.' } },
      { type: PageBlockType.HOURS, props: { title: 'Class times', rows: [ { day: 'Mon / Wed / Fri', hours: '16:00 — 20:00' }, { day: 'Saturday', hours: '9:00 — 14:00' }, { day: 'Sunday', hours: 'Revision only' } ] } },
      { type: PageBlockType.FAQ, props: { title: 'Common questions', items: [
        { q: 'Do I need my own materials?', a: 'We provide past questions and notes. Bring a notebook.' },
        { q: 'Can I join mid-session?', a: 'Yes — we run a catch-up session for late joiners.' },
      ] } },
      { type: PageBlockType.CONTACT, props: { title: 'Talk to us' } },
    ],
  },
  {
    id: 'boutique',
    name: 'Boutique',
    description: 'Picture-first. Good for jewellery, clothing and anything visual.',
    suits: [BusinessType.PRODUCT],
    accentColor: '#9D174D',
    swatch: ['#9D174D', '#FDF2F8', '#0F172A'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: 'Handpicked pieces, delivered on campus.', ctaLabel: 'Shop the collection', ctaHref: '/services' } },
      { type: PageBlockType.GALLERY, props: { title: 'The collection', images: [] } },
      { type: PageBlockType.ABOUT, props: { title: 'Our story', body: '{{description}}' } },
      { type: PageBlockType.TESTIMONIALS, props: { title: 'Happy customers', items: [] } },
      { type: PageBlockType.CTA, props: { headline: 'New drops weekly', body: 'Message us to reserve a piece before it sells out.', buttonLabel: 'Enquire', buttonHref: '/services' } },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials. Fast to load, easy to read.',
    suits: [BusinessType.SERVICE, BusinessType.PRODUCT, BusinessType.TUTORIAL, BusinessType.HYBRID],
    accentColor: '#0F172A',
    swatch: ['#0F172A', '#F8FAFC', '#64748B'],
    blocks: [
      { type: PageBlockType.HERO, props: { headline: '{{name}}', subheadline: '{{description}}', ctaLabel: 'Get in touch', ctaHref: '#contact' } },
      { type: PageBlockType.SERVICES, props: { title: 'Services' } },
      { type: PageBlockType.CONTACT, props: { title: 'Contact' } },
    ],
  },
];

/** The template that best fits a business type when none has been chosen. */
export const defaultTemplateFor = (type: string): string => {
  switch (type) {
    case BusinessType.TUTORIAL:
      return 'academy';
    case BusinessType.PRODUCT:
      return 'boutique';
    case BusinessType.HYBRID:
      return 'fresh';
    default:
      return 'fresh';
  }
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
