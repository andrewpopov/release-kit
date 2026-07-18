import { describe, expect, test } from 'vitest';
import { summarizeReleaseWork } from '../work-summary';
import { makeRougeConfig } from './fixtures/rougeConfig';

describe('summarizeReleaseWork', () => {
  test('groups released work in configured order and normalizes descriptions', () => {
    const summary = summarizeReleaseWork(makeRougeConfig('/unused'), [
      {
        filePath: '/unused/ops-release-process.md',
        fileName: 'ops-release-process.md',
        kind: 'ops',
        summary: 'Release process',
        body: 'Documented the release flow.\n\n- Added a final validation step.',
      },
      {
        filePath: '/unused/gameplay-town-pacing.md',
        fileName: 'gameplay-town-pacing.md',
        kind: 'gameplay',
        summary: 'Town pacing',
        body: 'Improved the handoff after combat.',
      },
    ]);

    expect(summary).toEqual({
      itemCount: 2,
      groups: [
        {
          kind: 'gameplay',
          heading: 'Gameplay',
          items: [
            {
              kind: 'gameplay',
              summary: 'Town pacing',
              description: 'Improved the handoff after combat.',
              fileName: 'gameplay-town-pacing.md',
            },
          ],
        },
        {
          kind: 'ops',
          heading: 'Operations',
          items: [
            {
              kind: 'ops',
              summary: 'Release process',
              description: 'Documented the release flow. Added a final validation step.',
              fileName: 'ops-release-process.md',
            },
          ],
        },
      ],
    });
  });

  test('returns no groups for an empty release', () => {
    expect(summarizeReleaseWork(makeRougeConfig('/unused'), [])).toEqual({ itemCount: 0, groups: [] });
  });
});
