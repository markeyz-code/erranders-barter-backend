/**
 * The student-facing storefront URL.
 *
 * There are two domains, one letter apart: `decluttered.erranders.org` is the site, and `declutter.erranders.org`
 * answers with something else entirely. A link to the wrong one looks fine in a message and lands the reader on a
 * page that is not the marketplace, so the known-wrong value is corrected here rather than trusted.
 */
export const CORRECT_STOREFRONT = 'https://decluttered.erranders.org';

export const storefrontUrl = (): string => {
  const raw = (process.env.STOREFRONT_URL || '').trim();

  if (!raw) return CORRECT_STOREFRONT;

  const normalised = raw
    .replace(/^https?:\/\/declutter\.erranders\.org/i, CORRECT_STOREFRONT)
    .replace(/\/+$/, '');

  return normalised || CORRECT_STOREFRONT;
};
