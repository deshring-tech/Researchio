/**
 * MODULE: lib/format
 *
 * Purpose
 *   Presentation helpers shared across views.
 *
 * Dependencies: none. Safe on both server and client.
 */

const UNITS: Array<{ limitSeconds: number; seconds: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limitSeconds: 60, seconds: 1, unit: 'second' },
  { limitSeconds: 3_600, seconds: 60, unit: 'minute' },
  { limitSeconds: 86_400, seconds: 3_600, unit: 'hour' },
  { limitSeconds: 604_800, seconds: 86_400, unit: 'day' },
  { limitSeconds: 2_629_800, seconds: 604_800, unit: 'week' },
  { limitSeconds: 31_557_600, seconds: 2_629_800, unit: 'month' },
  { limitSeconds: Number.POSITIVE_INFINITY, seconds: 31_557_600, unit: 'year' },
];

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Renders a timestamp as "3 hours ago". */
export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const elapsedSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(elapsedSeconds);

  if (magnitude < 45) {
    return 'just now';
  }

  const match = UNITS.find((entry) => magnitude < entry.limitSeconds) ?? UNITS[UNITS.length - 1];
  return relativeFormatter.format(Math.round(elapsedSeconds / match.seconds), match.unit);
}

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

export function formatDate(value: Date | string): string {
  return dateFormatter.format(value instanceof Date ? value : new Date(value));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

export function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
