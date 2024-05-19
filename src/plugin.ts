import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { askGPT, decideContextGPT, sysMsg } from "./gpt/research";
import { StreamlinedComment, UserType } from "./types/response";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "./utils/getIssueComments";
import { errorDiff } from "./utils/errorDiff";

import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";
import { PluginInputs, researchSettingsSchema } from "./types/plugin-input";
import { Context } from "./types/context";
import { envSchema } from "./types/env";
import { Value } from "@sinclair/typebox/value";
import { addCommentToIssue } from "./utils/addComment";

export async function run() {
  const payload = github.context.payload.inputs;

  const env = Value.Decode(envSchema, process.env);
  const settings = Value.Decode(researchSettingsSchema, JSON.parse(payload.settings));

  const inputs: PluginInputs = {
    stateId: payload.stateId,
    eventName: payload.eventName,
    eventPayload: JSON.parse(payload.eventPayload),
    settings,
    authToken: env.GITHUB_TOKEN,
    ref: payload.ref,
  };

  const octokit = new Octokit({ auth: inputs.authToken });

  const context: Context = {
    eventName: inputs.eventName,
    payload: inputs.eventPayload,
    config: inputs.settings,
    octokit,
    env,
    logger: {
      debug(message: unknown, ...optionalParams: unknown[]) {
        console.debug(message, ...optionalParams);
      },
      info(message: unknown, ...optionalParams: unknown[]) {
        console.log(message, ...optionalParams);
      },
      warn(message: unknown, ...optionalParams: unknown[]) {
        console.warn(message, ...optionalParams);
      },
      error(message: unknown, ...optionalParams: unknown[]) {
        console.error(message, ...optionalParams);
      },
      fatal(message: unknown, ...optionalParams: unknown[]) {
        console.error(message, ...optionalParams);
      },
    },
  };

  if (inputs.eventName !== "issue_comment.created") {
    console.error(`Unsupported event: ${inputs.eventName}`);
    return;
  }

  const { disabledCommands } = context.config;
  const isCommandDisabled = disabledCommands.some((command: string) => command === "research");
  if (isCommandDisabled) {
    context.logger.info(`/research is disabled in this repository: ${inputs.eventPayload.repository.full_name}`);
    await addCommentToIssue(context, "```diff\n# The /research command is disabled in this repository\n```");
    return;
  }

  const comment = await research(context);

  await addCommentToIssue(context, comment);

  return null;
}

async function research(context: Context) {
  const { payload, config } = context;
  const sender = payload.sender;

  const issue = payload.issue as (typeof payload)["issue"];
  const body = payload.comment.body;
  const repository = payload.repository;

  const chatHistory: CreateChatCompletionRequestMessage[] = [];
  const streamlined: StreamlinedComment[] = [];
  const linkedPRStreamlined: StreamlinedComment[] = [];
  const linkedIssueStreamlined: StreamlinedComment[] = [];

  const regex = /^\/research\s(.+)$/;
  const matches = body?.match(regex);

  if (matches) {
    return await processComment(context, repository, issue, sender, chatHistory, streamlined, linkedPRStreamlined, linkedIssueStreamlined, config, matches);
  } else {
    return "Invalid syntax for research \n usage: '/research What is pi?";
  }
}

async function processComment(
  context: Context,
  repository: Context["payload"]["repository"],
  issue: Context["payload"]["issue"],
  sender: Context["payload"]["sender"],
  chatHistory: CreateChatCompletionRequestMessage[],
  streamlined: StreamlinedComment[],
  linkedPRStreamlined: StreamlinedComment[],
  linkedIssueStreamlined: StreamlinedComment[],
  config: PluginInputs["settings"],
  matches: RegExpMatchArray
) {
  const { logger } = context;
  const [, body] = matches;
  // standard comments
  // raw so we can grab the <!--- { 'UbiquityAI': 'answer' } ---> tag
  const comments = await getAllIssueComments(context, repository, issue.number, "raw");

  if (!comments) {
    logger.info(`Error getting issue comments`);
  }

  // add the first comment of the issue/pull request
  streamlined.push({
    login: issue.user.login,
    body: body ?? "",
  });

  // add the rest
  comments?.forEach(async (comment) => {
    if (comment.user.type == UserType.User || comment.body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
      streamlined.push({
        login: comment.user.login,
        body: comment.body,
      });
    }
  });

  // returns the conversational context from all linked issues and prs
  const links = await getAllLinkedIssuesAndPullsInBody(context, repository, issue.number);

  if (typeof links === "string" || !links) {
    logger.info(`Error getting linked issues or prs: ${links}`);
  } else {
    linkedIssueStreamlined = links.linkedIssues;
    linkedPRStreamlined = links.linkedPrs;
  }

  if (linkedIssueStreamlined.length == 0 && linkedPRStreamlined.length == 0) {
    // No external context to add
    chatHistory.push(
      {
        role: "system",
        content: sysMsg,
        name: "UbiquityAI",
      },
      {
        role: "user",
        content: body,
        name: sender.login,
      }
    );
  } else {
    const gptDecidedContext = await decideContextGPT(context, repository, issue, chatHistory, streamlined, linkedPRStreamlined, linkedIssueStreamlined);

    chatHistory.push(
      {
        role: "system",
        content: sysMsg,
        name: "UbiquityAI",
      },
      {
        role: "system",
        content: "Original Context: " + JSON.stringify(gptDecidedContext), // provide the context
        name: "system",
      },
      {
        role: "user",
        content: "Question: " + JSON.stringify(body), // provide the question
        name: "user",
      }
    );
  }

  const gptResponse = await askGPT(context, body, chatHistory);

  if (typeof gptResponse === "string") {
    return gptResponse;
  } else if (gptResponse.answer) {
    return gptResponse.answer;
  } else {
    return errorDiff(`Error getting response from GPT`);
  }
}
