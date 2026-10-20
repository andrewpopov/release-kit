"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announceDatedReleaseToDiscord = announceDatedReleaseToDiscord;
const config_1 = require("./config");
const release_history_1 = require("./release-history");
const announced_1 = require("./announced");
const announcement_1 = require("./announcement");
/** Wire as a deliveryEvent sink on the deployed checkout, after health verification. No paid AI call. */
async function announceDatedReleaseToDiscord(options) {
    if (options.event.event !== 'deployment' || options.event.status !== 'succeeded') {
        return { posted: false, reason: 'deployment-not-succeeded' };
    }
    const { config } = options;
    if (!config.history)
        throw new Error('Release history is not configured.');
    const webhookUrl = (options.env ?? process.env).DISCORD_RELEASE_WEBHOOK;
    if (!webhookUrl)
        return { posted: false, reason: 'webhook-unconfigured' };
    const record = (0, release_history_1.readDatedReleaseNotes)({ directory: (0, config_1.resolvePaths)(config).releasesDir,
        repository: config.history.repository, product: config.productName })[0];
    if (!record)
        return { posted: false, reason: 'no-release-notes' };
    const notification = (0, release_history_1.buildReleaseNotification)(record, config.history.notesBaseUrl);
    const statePath = (0, announced_1.resolveAnnouncementStatePath)(config, { stateFile: options.stateFile }).path;
    if ((0, announced_1.hasAnnouncedVersion)(statePath, record.id, record.repository)) {
        return { posted: false, reason: 'already-announced', url: notification.url };
    }
    const payload = (0, announcement_1.buildDiscordReleasePayload)(config, { itemCount: 0, groups: [] }, {
        version: record.version, aiSummary: notification.summary, releaseUrl: notification.url,
    });
    await (0, announcement_1.postReleaseToDiscord)({ webhookUrl, payload, fetch: options.fetch });
    (0, announced_1.recordAnnouncedVersion)(statePath, record.id, record.repository);
    return { posted: true, url: notification.url };
}
