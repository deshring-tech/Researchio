import Link from 'next/link';

import { AddSectionForm } from '@/components/workspace/AddSectionForm';
import { SectionCard } from '@/components/workspace/SectionCard';
import { EmptyState } from '@/components/ui/Feedback';
import { requireUser } from '@/server/auth/session';
import { getProject } from '@/server/services/project.service';
import {
  buildChecklist,
  toCitationView,
  type ChecklistSeverity,
} from '@/server/services/document.service';
import { toClaimReportView } from '@/server/services/verification.service';
import { aiEnabled } from '@/server/ai/provider';
import { countDisputedClaims, type ClaimCheckTarget } from '@/lib/domain/claims';
import { wordCount } from '@/lib/format';
import { citedOrdinals, countBrokenCitations } from '@/lib/text/citations';

/**
 * The Living Document.
 *
 * The Document/Checklist split is driven by a search param rather than client
 * state, so each view is server-rendered, linkable and survives a reload.
 */
export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ projectId }, { tab }] = await Promise.all([params, searchParams]);

  const user = await requireUser();
  const project = await getProject(projectId, user.id);

  const sections = (project.document?.sections ?? []).map((section) => {
    // Each report is judged against the exact stored text it would annotate.
    const reportFor = (target: ClaimCheckTarget, text: string | null) => {
      const row = section.claimReports.find((report) => report.target === target);
      return row && text ? toClaimReportView(row, text) : null;
    };

    return {
      ...section,
      citationViews: section.citations.flatMap((row) => {
        const view = toCitationView(row);
        return view ? [view] : [];
      }),
      claimReportViews: {
        document: reportFor('document', section.userContent),
        draft: reportFor('draft', section.aiContent),
      },
    };
  });

  const showChecklist = tab === 'checklist';

  const checklist = buildChecklist({
    sections: sections.map((section) => {
      const content = section.userContent ?? '';
      const accepted = new Set(
        section.citationViews
          .filter((citation) => citation.status === 'accepted')
          .map((citation) => citation.ordinal),
      );

      return {
        id: section.id,
        title: section.title,
        userContent: section.userContent,
        status: section.status,
        _citationCount: citedOrdinals(content).filter((ordinal) => accepted.has(ordinal)).length,
        _brokenCitationCount: countBrokenCitations(content, accepted),
        _disputedClaimCount: countDisputedClaims(section.claimReportViews.document),
      };
    }),
    paperCount: project.papers.length,
    noteCount: project.notes.length,
  });

  const totalWords = sections.reduce(
    (sum, section) => sum + wordCount(section.userContent ?? ''),
    0,
  );

  const base = `/p/${projectId}/document`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="h1">{project.document?.type ?? 'Living Document'}</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {project.name} · {totalWords.toLocaleString()} words across {sections.length}{' '}
            sections
          </p>
        </div>

        <a className="btn btn-secondary" href={`/api/projects/${projectId}/export`}>
          Export as Markdown
        </a>
      </header>

      <nav
        className="row"
        style={{
          gap: 'var(--spacing-4)',
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 'var(--spacing-5)',
        }}
        aria-label="Document views"
      >
        <TabLink href={base} active={!showChecklist}>
          Document
        </TabLink>
        <TabLink href={`${base}?tab=checklist`} active={showChecklist}>
          Completion checklist
          {checklist.length > 0 ? (
            <span className="pill pill-warning" style={{ marginLeft: 'var(--spacing-2)' }}>
              {checklist.length}
            </span>
          ) : null}
        </TabLink>
      </nav>

      {showChecklist ? (
        <Checklist items={checklist} projectId={projectId} />
      ) : (
        <div className="stack">
          {sections.length === 0 ? (
            <EmptyState title="This document has no sections">
              Add a section below to begin.
            </EmptyState>
          ) : (
            sections.map((section, index) => (
              <SectionCard
                key={section.id}
                index={index}
                total={sections.length}
                aiEnabled={aiEnabled()}
                section={{
                  id: section.id,
                  title: section.title,
                  position: section.position,
                  userContent: section.userContent,
                  aiContent: section.aiContent,
                  status: section.status,
                  citations: section.citationViews,
                  claimReports: section.claimReportViews,
                }}
              />
            ))
          )}

          <section className="card">
            <h2 className="h3">Add a section</h2>
            <AddSectionForm projectId={projectId} />
          </section>
        </div>
      )}
    </>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: 'var(--spacing-2) 0',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: `2px solid ${active ? 'var(--accent-blue)' : 'transparent'}`,
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  );
}

const SEVERITY_BORDER: Record<ChecklistSeverity, string> = {
  error: 'var(--error)',
  warning: 'var(--warning)',
  info: 'var(--text-tertiary)',
};

function Checklist({
  items,
  projectId,
}: {
  items: ReturnType<typeof buildChecklist>;
  projectId: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing outstanding">
        Every section has content and linked sources.
      </EmptyState>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: '720px' }}>
      {items.map((item) => (
        <div
          key={item.id}
          className="card card-tight"
          style={{ borderLeft: `4px solid ${SEVERITY_BORDER[item.severity]}` }}
        >
          <h3 className="h3" style={{ marginBottom: 'var(--spacing-1)' }}>
            {item.title}
          </h3>
          <p className="text-sm muted" style={{ margin: 0 }}>
            {item.detail}
          </p>

          {item.sectionId ? (
            <Link
              className="text-sm"
              href={`/p/${projectId}/document#section-${item.sectionId}`}
              style={{ display: 'inline-block', marginTop: 'var(--spacing-3)' }}
            >
              Go to section
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}
