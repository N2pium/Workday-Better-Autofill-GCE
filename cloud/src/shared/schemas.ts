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

export const profileData = z
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
        usCitizen: z.boolean(),
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
    /** User-chosen label ("Fintech"), for the Insights flow chart. */
    industry: z.string().trim().max(60).optional(),
  })
  .strict();

export const updateApplicationBody = z
  .object({
    company: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200),
    status: z.enum(APPLICATION_STATUSES),
    notes: z.string().max(2000),
    /** Empty string clears it. */
    industry: z.string().trim().max(60),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/** Application IDs are sortable: 20261122T153000Z-1a2b3c4d */
export const applicationId = z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/, 'Invalid application id');

export const deleteAccountBody = z.object({ confirm: z.literal('DELETE') }).strict();

// ------------------------------------------------------------------ Answer Library (F11)

export const ANSWER_CATEGORIES = [
  'why-company', 'why-role', 'challenge', 'leadership', 'teamwork', 'conflict',
  'strength', 'weakness', 'career-goals', 'custom',
] as const;

const answerFields = {
  category: z.enum(ANSWER_CATEGORIES),
  question: z.string().trim().min(1).max(1000),
  text: z.string().trim().min(1).max(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
};

export const createAnswerBody = z
  .object({ ...answerFields, tags: answerFields.tags.default([]) })
  .strict();

export const updateAnswerBody = z
  .object(answerFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

export const answerId = z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/, 'Invalid answer id');

// ------------------------------------------------------------------ AI (F04)

/** What the model may see of the profile: work, education, skills. No contact details, no self-ID. */
export const aiProfile = profileData.pick({ workExperience: true, education: true, skills: true }).partial();

const job = z
  .object({
    company: z.string().trim().max(200).optional(),
    role: z.string().trim().max(200).optional(),
    description: z.string().max(15000).optional(),
  })
  .strict();

const maxChars = z.number().int().min(50).max(5000).default(1500);

export const aiAnswerBody = z
  .object({ question: z.string().trim().min(3).max(1000), maxChars, job: job.default({}), profile: aiProfile.default({}) })
  .strict();

export const aiAdaptBody = z
  .object({
    question: z.string().trim().min(3).max(1000),
    savedAnswer: z.string().trim().min(1).max(5000),
    maxChars,
    job: job.default({}),
  })
  .strict();

export const aiMatchBody = z
  .object({ job: job.extend({ description: z.string().min(50).max(15000) }), profile: aiProfile })
  .strict();

export const aiCategoriseBody = z.object({ question: z.string().trim().min(3).max(1000) }).strict();

// ------------------------------------------------------------------ Resume Vault (F02)

export const RESUME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_RESUMES = 10;

export const createResumeBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.enum(RESUME_TYPES),
    size: z.number().int().min(1).max(MAX_RESUME_BYTES),
  })
  .strict();

export const renameResumeBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();

export const resumeId = z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/, 'Invalid resume id');

/** Drops self-ID keys anywhere in the value. Used before anything reaches a model. */
export function stripSelfId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSelfId);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => !SELF_ID_KEY.test(k)).map(([k, v]) => [k, stripSelfId(v)]),
  );
}
