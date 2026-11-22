import { z } from 'zod';

/*
 * Shapes mirror what popup.js stores in chrome.storage.local.
 *
 * PRIVACY RULE (PRIVACY_POLICY.md): voluntary self-identification answers are
 * never synced. The top level is an allowlist, so `demographics` (and the
 * base64 `resume`, which belongs in S3 in phase 2) are rejected, and every
 * object is also scanned for self-ID key names in case they turn up nested.
 */

const text = (max = 500) => z.string().max(max);
const scalar = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]);
const monthYear = z.object({ month: text(20), year: text(10) }).partial().catchall(scalar);

export const SELF_ID_KEY = /^(demographics?|gender|race|ethnicity|hispanic.*|veteran.*|disabilit.*|selfid.*|self_id.*)$/i;

const profileData = z
  .object({
    personalInfo: z
      .object({
        firstName: text(100), lastName: text(100), phone: text(40), email: text(254),
        linkedinUrl: text(500), websiteUrl: text(500),
      })
      .partial()
      .catchall(scalar),
    address: z
      .object({ street: text(200), city: text(100), state: text(100), zip: text(20), country: text(100) })
      .partial()
      .catchall(scalar),
    education: z
      .array(
        z
          .object({
            school: text(200), degree: text(200), fieldOfStudy: text(200), gpa: text(20),
            startDate: monthYear, endDate: monthYear,
          })
          .partial()
          .catchall(scalar),
      )
      .max(20),
    workExperience: z
      .array(
        z
          .object({
            company: text(200), title: text(200), location: text(200), description: text(5000),
            startDate: monthYear, endDate: monthYear, isCurrentRole: z.boolean(),
          })
          .partial()
          .catchall(scalar),
      )
      .max(30),
    skills: z.array(text(100)).max(200),
    language: z.object({ name: text(100), isNative: z.boolean() }).partial().catchall(scalar),
    jobPreferences: z
      .object({
        isAtLeast18: z.boolean(), formerEmployee: z.boolean(), authorizedToWork: z.boolean(),
        requiresSponsorship: z.boolean(), sourceReferral: text(200), autoDisclosures: z.boolean(),
      })
      .partial()
      .catchall(scalar),
  })
  .partial()
  .strict();

/** Every object key anywhere in the value that looks like a self-ID field. */
export function findSelfIdKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSelfIdKeys(v, [...path, String(i)]));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(SELF_ID_KEY.test(k) ? [[...path, k].join('.')] : []),
    ...findSelfIdKeys(v, [...path, k]),
  ]);
}

export const profileId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes, max 40');

export const putProfileBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    data: profileData,
    /** Omit to create; send the version you last read to update (optimistic locking). */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

export const APPLICATION_STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'] as const;

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(2000);

export const createApplicationBody = z
  .object({
    company: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200),
    url: httpsUrl,
    site: z.enum(['workday', 'greenhouse', 'lever', 'ashby', 'other']).default('other'),
    status: z.enum(APPLICATION_STATUSES).default('applied'),
    appliedAt: z.iso.datetime().optional(),
    profileId: profileId.optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const updateApplicationBody = z
  .object({
    company: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200),
    status: z.enum(APPLICATION_STATUSES),
    notes: z.string().max(2000),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/** Application IDs are sortable: 20261122T153000Z-1a2b3c4d */
export const applicationId = z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/, 'Invalid application id');

export const deleteAccountBody = z.object({ confirm: z.literal('DELETE') }).strict();
