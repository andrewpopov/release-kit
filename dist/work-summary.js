"use strict";
/**
 * Structured release-work summaries. The markdown release note remains the
 * human-facing artifact; this module exposes the same fragment information in
 * a transport-neutral shape for release dashboards, notifications, and APIs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeReleaseWork = summarizeReleaseWork;
const fragments_1 = require("./fragments");
/**
 * Returns the work represented by a release's fragments in configured kind
 * order. Empty configured kinds are omitted, and fragment descriptions use
 * the same normalized text rendered in markdown release notes.
 */
function summarizeReleaseWork(config, fragments) {
    const groups = config.kinds
        .map(({ id: kind, heading }) => {
        const items = fragments
            .filter((fragment) => fragment.kind === kind)
            .map((fragment) => ({
            kind,
            summary: fragment.summary,
            description: (0, fragments_1.normalizeFragmentBody)(fragment.body),
            fileName: fragment.fileName,
        }));
        return { kind, heading, items };
    })
        .filter((group) => group.items.length > 0);
    return { itemCount: fragments.length, groups };
}
