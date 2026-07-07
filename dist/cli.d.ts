#!/usr/bin/env node
/**
 * `release-kit` CLI — 7 verbs matching rouge's npm scripts:
 * note | notes(preview) | bump | publish | cut | check | hygiene.
 */
import type { ReleaseKitConfig } from './config';
interface ParsedArgs {
    verb: string;
    rootDir?: string;
    version: string;
    date: string;
    kind: string;
    slug: string;
    summary: string;
    commit: string;
    base: string;
    force: boolean;
    allowEmpty: boolean;
    help: boolean;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export interface CliRunOptions {
    cwd?: string;
    /** Bypass config-file loading (mainly for tests / programmatic use). */
    config?: ReleaseKitConfig;
}
export declare function run(argv?: string[], stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, options?: CliRunOptions): number;
export {};
