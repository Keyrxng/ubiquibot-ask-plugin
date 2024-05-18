import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { SupportedEvents } from "./context";
import { StaticDecode, Type as T } from "@sinclair/typebox";

export interface PluginInputs<T extends WebhookEventName = SupportedEvents> {
  stateId: string;
  eventName: T;
  eventPayload: WebhookEvent<T>["payload"];
  settings: ResearchSettings;
  authToken: string;
  ref: string;
}

export const researchSettingsSchema = T.Object({
  keys: T.Object({
    openAi: T.String(),
  }),
  disabledCommands: T.Array(T.String()),
});

export type ResearchSettings = StaticDecode<typeof researchSettingsSchema>;
