/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import dotenv from "dotenv";
dotenv.config();

import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { errorDiff } from "./utils/errorDiff";
import { askGPT, decideContextGPT, sysMsg } from "./gpt/ask";
import { StreamlinedComment, UserType } from "./types/response";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "./utils/getIssueComments";
import { Octokit } from "octokit";

/**
 * @notice Limiting what the action needs to send so I'm rebuilding the event and octokit
 *         if all plugins are hosted at @ubiquity then they'll share the same action and repo secrets
 *         I'm assuming that this is how things will work
 * 
 *          [kernel].pluginDispatch() -> action workflow (in ubq hosted repo) -> setup > workflow invokes action.yml -> tsx src/index.ts -> ask()
 *          create_comment() <- ... <- next `uses` <- output <- ask()

* @param body The question to ask
 * @param issueNumber The issue number
 * @param repo The repository name
 * @param org The organization name
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function ask(body: string, issueNumber: number, sender: string, repo: string, org: string) {
  const logger = console;
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || "",
  });

  if (!octokit) {
    return "Error getting octokit";
  }

  const issue = await octokit.rest.issues
    .get({
      owner: org,
      repo,
      issue_number: issueNumber,
    })
    .then((res) => res.data)
    .catch((e) => {
      throw new Error(`Error getting issue: ${e}`);
    });

  if (!body) {
    return `Please ask a question`;
  }

  if (!issue.id) {
    return `This command can only be used on issues`;
  }

  const chatHistory: CreateChatCompletionRequestMessage[] = [];
  const streamlined: StreamlinedComment[] = [];
  let linkedPRStreamlined: StreamlinedComment[] = [];
  let linkedIssueStreamlined: StreamlinedComment[] = [];

  const regex = /^\/research\s(.+)$/;
  const matches = body.match(regex);

  if (matches) {
    const [, body] = matches;

    // standard comments
    const comments = await getAllIssueComments(octokit, repo, org, issueNumber);
    // raw so we can grab the <!--- { 'UbiquityAI': 'answer' } ---> tag
    const commentsRaw = await getAllIssueComments(octokit, repo, org, issueNumber, "raw");

    if (!comments) {
      logger.info(`Error getting issue comments`);
      return errorDiff(`Error getting issue comments`);
    }

    // add the first comment of the issue/pull request
    streamlined.push({
      login: issue.user?.login,
      body: body ?? "",
    });

    // add the rest
    comments.forEach(async (comment, i) => {
      if (comment.user.type == UserType.User || commentsRaw[i].body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
        streamlined.push({
          login: comment.user.login,
          body: comment.body,
        });
      }
    });

    // returns the conversational context from all linked issues and prs
    const links = await getAllLinkedIssuesAndPullsInBody(octokit, repo, org, issue.number);

    if (typeof links === "string") {
      logger.info(`Error getting linked issues or prs: ${links}`);
    } else {
      linkedIssueStreamlined = links.linkedIssues;
      linkedPRStreamlined = links.linkedPrs;
    }

    // let chatgpt deduce what is the most relevant context
    const gptDecidedContext = await decideContextGPT(octokit, issue, chatHistory, streamlined, linkedPRStreamlined, linkedIssueStreamlined);

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
          name: sender,
        }
      );
    } else {
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

    const gptResponse = await askGPT(octokit, org, repo, chatHistory);

    if (typeof gptResponse === "string") {
      return gptResponse;
    } else if (gptResponse.answer) {
      return gptResponse.answer;
    } else {
      return errorDiff(`Error getting response from GPT`);
    }
  } else {
    return "Invalid syntax for ask \n usage: '/ask What is pi?";
  }
}

export interface SlimEvent {
  issue: {
    id: number;
    number: number;
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
  sender: {
    login: string;
  };
  comment: {
    body: string;
  };
  organization: {
    login: string;
  };
  octokit: Octokit;
}
