import { EmptyState } from '@/components/ui/Feedback';
import { listEvents } from '@/server/services/timeline.service';
import { formatRelativeTime } from '@/lib/format';
import type { TimelineEventType } from '@/lib/domain/constants';

/**
 * MODULE: components/workspace/Timeline
 *
 * Purpose
 *   Show real project activity, read from the `TimelineEvent` table.
 *
 * Note
 *   The previous version rendered a hardcoded array of four fabricated events
 *   while the table it should have been reading sat unused.
 */

/** Groups event types into a visual treatment for the rail marker. */
function markerKind(type: string): 'ai' | 'error' | 'default' {
  const aiEvents: TimelineEventType[] = ['SECTION_DRAFTED', 'PAPER_READY'];
  const errorEvents: TimelineEventType[] = ['PAPER_FAILED'];

  if (aiEvents.includes(type as TimelineEventType)) {
    return 'ai';
  }
  if (errorEvents.includes(type as TimelineEventType)) {
    return 'error';
  }
  return 'default';
}

export async function Timeline({ projectId }: { projectId: string }) {
  const events = await listEvents(projectId, 25);

  if (events.length === 0) {
    return <EmptyState title="No activity yet">Actions you take appear here.</EmptyState>;
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="timeline-item">
            <div className="timeline-rail">
              <span className="timeline-dot" data-kind={markerKind(event.type)} aria-hidden="true" />
              {!isLast ? <span className="timeline-line" aria-hidden="true" /> : null}
            </div>

            <div style={{ paddingBottom: isLast ? 0 : 'var(--spacing-4)', minWidth: 0 }}>
              <p className="text-sm" style={{ margin: 0, fontWeight: 500 }}>
                {event.description}
              </p>
              <time className="text-xs muted" dateTime={event.createdAt.toISOString()}>
                {formatRelativeTime(event.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
