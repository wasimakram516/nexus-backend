/** Inquiry types accepted by the public contact form (mirrors the frontend list). */
export const CONTACT_INQUIRY_TYPES = Object.freeze([
  'Request a Demo',
  'Pricing Question',
  'Technical Support',
  'Partnership',
  'General Question',
  'Other',
] as const);

export type ContactInquiryType = (typeof CONTACT_INQUIRY_TYPES)[number];
