import { randomBytes } from 'node:crypto';

/** 2026-11-22T15:30:00.123Z -> 20261122T153000Z-<8 hex>. Sorts by time; newest-first with ScanIndexForward=false. */
export function newSortableId(now: Date): string {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${ts}-${randomBytes(4).toString('hex')}`;
}

export const SORTABLE_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
