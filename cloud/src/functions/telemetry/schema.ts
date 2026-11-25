import { z } from 'zod';

/*
 * Telemetry payload v1 (plan/Phase 3 Contracts.md §2). Everything is an
 * allowlist or a tight pattern, so free text (labels, answers, names, job
 * titles, URLs) cannot get through even if a client tried to send it.
 *
 * STEPS mirrors STEPS in the extension's cloud-telemetry.js (test/telemetry.test.ts
 * checks they are identical): the extension's own step names from content.js
 * `step('...')` calls, grouped by `traceSection`. Self-identification steps
 * (gender, Hispanic/Latino, race, veteran, disability) are left out on purpose:
 * even "skipped" would say whether a self-ID answer is saved.
 */
export const STEPS: Readonly<Record<string, readonly string[]>> = {
  'My Information': ['First name', 'Last name', 'Phone', 'Phone device type', 'Email',
    'Address line 1', 'City', 'Postal code', 'Country', 'State'],
  'Social Network URLs': ['LinkedIn'],
  Websites: ['Website', 'Websites section'],
  'Work Experience': ['Work experience'],
  Education: ['Education'],
  Skills: ['Skills'],
  Languages: ['Language', 'Language proficiency'],
  Resume: ['Resume file'],
  'Application Questions': ['How did you hear about us', 'U.S. citizen'],
  'Voluntary Disclosures': ['18 or older', 'Signature name'],
  Terms: ['Terms checkbox'],
};

export const REASONS = ['not_saved', 'not_found', 'no_option', 'did_not_change', 'no_add_button', 'other'] as const;
export const KINDS = ['text', 'dropdown', 'checkbox', 'radio', 'date', 'file', 'other'] as const;

/** Workday tenant hosts (*.myworkdayjobs.com) and Greenhouse board hosts. Hostname only. */
export const WORKDAY_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,3}myworkdayjobs\.com$/;
export const GREENHOUSE_HOST = /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/;

/** formField-<id> suffix. GUID-like ids are per-tenant noise and are dropped by the client too. */
export const FIELD_ID = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;
export const GUID_LIKE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}|[0-9a-f]{20,}/i;

export const MAX_EVENTS = 50;
export const MAX_BODY_BYTES = 8 * 1024;

const stepEvent = z
  .object({
    type: z.literal('step'),
    section: z.string().max(40),
    field: z.string().max(40),
    status: z.enum(['failed', 'skipped']),
    reason: z.enum(REASONS),
  })
  .strict()
  .refine((e) => (STEPS[e.section] ?? []).includes(e.field), {
    message: 'section/field is not one of the extension step names',
    path: ['field'],
  });

const emptyEvent = z
  .object({
    type: z.literal('empty_required'),
    fieldId: z.string().regex(FIELD_ID).refine((id) => !GUID_LIKE.test(id), 'GUID-like ids are not accepted'),
    kind: z.enum(KINDS),
  })
  .strict();

export const telemetryPayload = z
  .object({
    v: z.literal(1),
    ats: z.enum(['workday', 'greenhouse']),
    tenant: z.string().max(120),
    build: z.string().regex(/^\d{4}-\d{2}-\d{2}[a-z]{0,2}$/),
    pack: z.number().int().min(0).max(1_000_000).optional(),
    events: z.array(z.union([stepEvent, emptyEvent])).min(1).max(MAX_EVENTS),
  })
  .strict()
  .refine((p) => (p.ats === 'workday' ? WORKDAY_HOST : GREENHOUSE_HOST).test(p.tenant), {
    message: 'tenant must be a Workday or Greenhouse hostname matching ats',
    path: ['tenant'],
  });

export type TelemetryPayload = z.infer<typeof telemetryPayload>;
