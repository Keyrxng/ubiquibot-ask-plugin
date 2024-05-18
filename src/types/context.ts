export type SupportedEvents = "issue_comment.created";

import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { ResearchSettings } from "./plugin-input";
import { Env } from "./env";

export interface Logger {
  fatal: (message: unknown, ...optionalParams: unknown[]) => void;
  error: (message: unknown, ...optionalParams: unknown[]) => void;
  warn: (message: unknown, ...optionalParams: unknown[]) => void;
  info: (message: unknown, ...optionalParams: unknown[]) => void;
  debug: (message: unknown, ...optionalParams: unknown[]) => void;
}

export interface Context<T extends WebhookEventName = SupportedEvents> {
  eventName: T;
  payload: WebhookEvent<T>["payload"];
  octokit: InstanceType<typeof Octokit>;
  config: ResearchSettings;
  env: Env;
  logger: Logger;
}
