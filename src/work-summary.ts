/**
 * Structured release-work summaries. The markdown release note remains the
 * human-facing artifact; this module exposes the same fragment information in
 * a transport-neutral shape for release dashboards, notifications, and APIs.
 */

import type { ReleaseKitConfig } from './config';
import { normalizeFragmentBody, type Fragment } from './fragments';

export interface ReleaseWorkItem {
  kind: string;
  summary: string;
  description: string;
  fileName: string;
}

export interface ReleaseWorkGroup {
  kind: string;
  heading: string;
  items: ReleaseWorkItem[];
}

export interface ReleaseWorkSummary {
  itemCount: number;
  groups: ReleaseWorkGroup[];
}

/**
 * Returns the work represented by a release's fragments in configured kind
 * order. Empty configured kinds are omitted, and fragment descriptions use
 * the same normalized text rendered in markdown release notes.
 */
export function summarizeReleaseWork(config: ReleaseKitConfig, fragments: Fragment[]): ReleaseWorkSummary {
  const groups = config.kinds
    .map(({ id: kind, heading }) => {
      const items = fragments
        .filter((fragment) => fragment.kind === kind)
        .map((fragment) => ({
          kind,
          summary: fragment.summary,
          description: normalizeFragmentBody(fragment.body),
          fileName: fragment.fileName,
        }));
      return { kind, heading, items };
    })
    .filter((group) => group.items.length > 0);

  return { itemCount: fragments.length, groups };
}
