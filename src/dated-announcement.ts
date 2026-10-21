import type { ReleaseKitConfig } from './config';
import { resolvePaths } from './config';
import { buildReleaseNotification, readDatedReleaseNotes } from './release-history';
import { hasAnnouncedVersion, recordAnnouncedVersion, resolveAnnouncementStatePath } from './announced';
import { buildDiscordReleasePayload, postReleaseToDiscord, type DiscordFetch } from './announcement';

/** Wire as a deliveryEvent sink on the deployed checkout, after health verification. No paid AI call. */
export async function announceDatedReleaseToDiscord(options: {
  config: Pick<ReleaseKitConfig, 'productName' | 'rootDir' | 'paths' | 'history'>;
  event: { event: string; status: string };
  env?: NodeJS.ProcessEnv;
  fetch?: DiscordFetch;
  stateFile?: string;
}): Promise<{ posted: boolean; reason?: string; url?: string }> {
  if (options.event.event !== 'deployment' || options.event.status !== 'succeeded') {
    return { posted: false, reason: 'deployment-not-succeeded' };
  }
  const { config } = options;
  if (!config.history) throw new Error('Release history is not configured.');
  const webhookUrl = (options.env ?? process.env).DISCORD_RELEASE_WEBHOOK;
  if (!webhookUrl) return { posted: false, reason: 'webhook-unconfigured' };
  const record = readDatedReleaseNotes({ directory: resolvePaths(config).releasesDir,
    repository: config.history.repository, product: config.productName })[0];
  if (!record) return { posted: false, reason: 'no-release-notes' };
  const notification = buildReleaseNotification(record, config.history.notesBaseUrl);
  const statePath = resolveAnnouncementStatePath(config, { stateFile: options.stateFile }).path;
  if (hasAnnouncedVersion(statePath, record.id, record.repository)) {
    return { posted: false, reason: 'already-announced', url: notification.url };
  }
  const payload = buildDiscordReleasePayload(config, { itemCount: 0, groups: [] }, {
    version: record.version, aiSummary: notification.summary, releaseUrl: notification.url,
  });
  await postReleaseToDiscord({ webhookUrl, payload, fetch: options.fetch });
  recordAnnouncedVersion(statePath, record.id, record.repository);
  return { posted: true, url: notification.url };
}
