import { GithubEventWebHookEvents } from "../../lib/@ubiquibot-kernel-keyrxng/src/github/types/webhook-events";

export type StreamlinedComment = {
  login?: string;
  body?: string;
};
export type GPTResponse = {
  answer?: string;
  tokenUsage?: {
    output?: number;
    input?: number;
    total?: number;
  };
};

export type Comment = {
  url: string;
  html_url: string;
  issue_url: string;
  id: number;
  node_id: string;
  user: User;
  created_at: string;
  updated_at: string;
  author_association: string;
  body: string;
  body_html?: string;
  body_text?: string;
};

export type User = {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
};

export enum UserType {
  User = "User",
  Bot = "Bot",
  Organization = "Organization",
}

// brought over the new config needed for plugins
export type UbiquiBotConfig = {
  keys: {
    evmPrivateEncrypted: string;
    openAi: string;
  };
  features: {
    assistivePricing: boolean;
    publicAccessControl: unknown;
  };
  payments: {
    evmNetworkId: 1 | 100;
    basePriceMultiplier: number;
    issueCreatorMultiplier: number;
    maxPermitPrice: number;
  };
  timers: {
    reviewDelayTolerance: string;
    taskStaleTimeoutDuration: string;
    taskFollowUpDuration: string;
    taskDisqualifyDuration: string;
  };
  miscellaneous: {
    promotionComment: string;
    maxConcurrentTasks: number;
    registerWalletWithVerification: boolean;
  };
  disabledCommands: string[];
  incentives: { comment: unknown };
  labels: { time: string[]; priority: string[] };
  plugins: Plugins;
};

type Plugins = {
  event: GithubEventWebHookEvents[keyof GithubEventWebHookEvents];
  plugins: Plugin[];
}[];

export interface Plugin {
  name: string;
  description: string;
  command?: string;
  example?: string;
  uses: string[];
  with?: string[];
}
