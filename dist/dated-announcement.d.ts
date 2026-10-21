import type { ReleaseKitConfig } from './config';
import { type DiscordFetch } from './announcement';
/** Wire as a deliveryEvent sink on the deployed checkout, after health verification. No paid AI call. */
export declare function announceDatedReleaseToDiscord(options: {
    config: Pick<ReleaseKitConfig, 'productName' | 'rootDir' | 'paths' | 'history'>;
    event: {
        event: string;
        status: string;
    };
    env?: NodeJS.ProcessEnv;
    fetch?: DiscordFetch;
    stateFile?: string;
}): Promise<{
    posted: boolean;
    reason?: string;
    url?: string;
}>;
