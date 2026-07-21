import { Fragment } from 'react';

/**
 * MODULE: components/workspace/ProseWithCitations
 *
 * Purpose
 *   Render generated prose with its inline `[S1]` source markers styled as
 *   superscript references.
 *
 * Why render them rather than strip them
 *   The markers are the visible evidence that a passage is grounded. Removing
 *   them would leave text that reads as unattributed authorship, which is
 *   exactly the failure this product exists to prevent.
 */

/** Captures the marker so `split` keeps it in the output array. */
const MARKER_PATTERN = /(\[S\d+\])/g;

export function ProseWithCitations({ text }: { text: string }) {
  const segments = text.split(MARKER_PATTERN);

  return (
    <>
      {segments.map((segment, index) => {
        if (/^\[S\d+\]$/.test(segment)) {
          return (
            <sup key={index} className="citation-marker">
              {segment.slice(1, -1)}
            </sup>
          );
        }

        return <Fragment key={index}>{segment}</Fragment>;
      })}
    </>
  );
}
