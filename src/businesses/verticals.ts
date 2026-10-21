import { BusinessVertical } from './schemas/business.schema';

/**
 * The business types we actually support, as one list.
 *
 * The signup form, the template mapping and the owner's navigation all read from here.
 * Keeping it in one place is the difference between "we support seven kinds of student
 * business" being true and it drifting into three slightly different lists.
 */
export interface VerticalOption {
  id: BusinessVertical;
  label: string;
  /** One line, read by an applicant deciding whether this is them. */
  blurb: string;
  /** What they will commonly sell, so the choice is concrete rather than abstract. */
  examples: string[];
  templateId: string;
  /** The category stored on the business; keeps older category-based filters working. */
  category: string;
}

export const VERTICAL_CATALOG: VerticalOption[] = [
  {
    id: BusinessVertical.FUMIGATION,
    label: 'Fumigation and pest control',
    blurb: 'Treating rooms and hostels for pests. Your page leads with safety.',
    examples: ['Room fumigation', 'Cockroach and rodent control', 'Bedbug treatment'],
    templateId: 'fumigation',
    category: 'fumigation',
  },
  {
    id: BusinessVertical.BAKERY,
    label: 'Bakery and pastries',
    blurb: 'Cakes, parfaits, small chops and anything baked to order.',
    examples: ['Birthday cakes', 'Parfait cups', 'Cookies and small chops'],
    templateId: 'bites',
    category: 'bakery',
  },
  {
    id: BusinessVertical.JEWELRY,
    label: 'Jewelry and accessories',
    blurb: 'Handmade or curated pieces: beads, rings, perfume, accessories.',
    examples: ['Waist beads', 'Handmade earrings', 'Perfume and oils'],
    templateId: 'craft',
    category: 'jewelry',
  },
  {
    id: BusinessVertical.BARBER,
    label: 'Barbing and grooming',
    blurb: 'Cutting hair. Your page is built around the chair and the appointment.',
    examples: ['Haircut', 'Beard trim', 'Home service barbing'],
    templateId: 'barber',
    category: 'barbing',
  },
  {
    id: BusinessVertical.NAILS,
    label: 'Nail tech and beauty',
    blurb: 'Nails, lashes and makeup, booked by appointment.',
    examples: ['Gel nails', 'Press-ons', 'Lash extensions'],
    templateId: 'glam',
    category: 'nail tech',
  },
  {
    id: BusinessVertical.THRIFT,
    label: 'Thrift and pre-loved',
    blurb: 'One-of-a-kind clothing drops where each piece is a single item.',
    examples: ['Thrift shirts', 'Pre-loved shoes', 'Vintage denim'],
    templateId: 'thrift',
    category: 'thrift',
  },
  {
    id: BusinessVertical.TUTOR,
    label: 'Tutoring and study resources',
    blurb: 'Classes and past questions. Your notes stay locked to your own students.',
    examples: ['Course tutorials', 'JAMB and post-UTME prep', 'Past questions and notes'],
    templateId: 'academy',
    category: 'tutorial',
  },
  {
    id: BusinessVertical.FOOD,
    label: 'Food and small chops',
    blurb: 'Cooking to order, from hostel meals to snacks and drinks.',
    examples: ['Jollof and stew', 'Smoothies and juice', 'Meal prep'],
    templateId: 'bites',
    category: 'food',
  },
  {
    id: BusinessVertical.CLEANING,
    label: 'Cleaning services',
    blurb: 'Cleaning rooms, hostels and shared spaces on a schedule.',
    examples: ['Room deep clean', 'Hostel cleaning', 'Post-party clean-up'],
    templateId: 'fresh',
    category: 'cleaning',
  },
  {
    id: BusinessVertical.LAUNDRY,
    label: 'Laundry and ironing',
    blurb: 'Washing, drying and ironing, with pickup and delivery.',
    examples: ['Wash and fold', 'Ironing only', 'Express same-day wash'],
    templateId: 'fresh',
    category: 'laundry',
  },
  {
    id: BusinessVertical.TECH,
    label: 'Phone and laptop repair',
    blurb: 'Screens, batteries, software and accessories.',
    examples: ['Screen replacement', 'Battery swap', 'Software reinstall'],
    templateId: 'techfix',
    category: 'tech repair',
  },
  {
    id: BusinessVertical.GENERAL,
    label: 'Something else',
    blurb: 'A hustle that does not fit the list above. You can change this later.',
    examples: ['Moving help', 'Printing', 'Errands'],
    templateId: 'minimal',
    category: 'services',
  },
];

/** Resolves a submitted vertical id, tolerating legacy category strings. */
export const resolveVertical = (value: unknown): VerticalOption | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const exact = VERTICAL_CATALOG.find((option) => option.id === raw);
  if (exact) return exact;

  // Older clients send a free-text category; match it to the nearest supported type.
  const byCategory = VERTICAL_CATALOG.find((option) => option.category === raw);
  if (byCategory) return byCategory;

  return null;
};
