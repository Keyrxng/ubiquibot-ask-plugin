import OpenAI from "openai";
import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { errorDiff } from "../utils/errorDiff";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "../utils/getIssueComments";
import { StreamlinedComment, UserType } from "../types/response";
import { Issue } from "@octokit/webhooks-types";
import { Context } from "../types/context";
import { addCommentToIssue } from "../utils/addComment";

export const sysMsg = `You are the UbiquityAI, designed to provide accurate technical answers. \n
Whenever appropriate, format your response using GitHub Flavored Markdown. Utilize tables, lists, and code blocks for clear and organized answers. \n
Do not make up answers. If you are unsure, say so. \n
Original Context exists only to provide you with additional information to the current question, use it to formulate answers. \n
Infer the context of the question from the Original Context using your best judgement. \n
All replies MUST end with "\n\n <!--- { 'UbiquityAI': 'answer' } ---> ".\n
`;

const gptContextTemplate = `
You are the UbiquityAI, designed to review and analyze pull requests.
You have been provided with the spec of the issue and all linked issues or pull requests.
Using this full context, Reply in pure JSON format, with the following structure omitting irrelevant information pertaining to the specification.
You MUST provide the following structure, but you may add additional information if you deem it relevant.
Example:[
  {
    "source": "issue #123"
    "spec": "This is the issue spec"
    "relevant": [
      {
        "login": "user",
        "body": "This is the relevant context"
        "relevancy": "Why is this relevant to the spec?"
      },
      {
        "login": "other_user",
        "body": "This is other relevant context"
        "relevancy": "Why is this relevant to the spec?"
      }
    ]
  },
  {
    "source": "Pull #456"
    "spec": "This is the pull request spec"
    "relevant": [
      {
        "login": "user",
        "body": "This is the relevant context"
        "relevancy": "Why is this relevant to the spec?"
      },
      {
        "login": "other_user",
        "body": "This is other relevant context"
        "relevancy": "Why is this relevant to the spec?"
      }
    ]
  }
]
`;

/**
 * @notice best used alongside getAllLinkedIssuesAndPullsInBody() in helpers/issue
 * @param chatHistory the conversational context to provide to GPT
 * @param streamlined an array of comments in the form of { login: string, body: string }
 * @param linkedPRStreamlined an array of comments in the form of { login: string, body: string }
 * @param linkedIssueStreamlined an array of comments in the form of { login: string, body: string }
 */
export async function decideContextGPT(
  context: Context,
  repository: Context["payload"]["repository"],
  issue: Context["payload"]["issue"] | Issue | undefined,
  chatHistory: CreateChatCompletionRequestMessage[],
  streamlined: StreamlinedComment[],
  linkedPRStreamlined: StreamlinedComment[],
  linkedIssueStreamlined: StreamlinedComment[]
) {
  const logger = console;
  if (!issue) {
    logger.info(`Error getting issue or pr`);
    return;
  }

  // standard comments
  const comments = await getAllIssueComments(context, repository, issue.number);

  if (!comments) {
    logger.info(`Error getting issue comments`);
    return;
  }

  // add the first comment of the issue/pull request
  streamlined.push({
    login: issue.user.login,
    body: issue.body ?? "",
  });

  // add the rest
  comments.forEach(async (comment) => {
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
  }

  linkedIssueStreamlined = links.linkedIssues;
  linkedPRStreamlined = links.linkedPrs;

  chatHistory.push(
    {
      role: "system",
      content: gptContextTemplate,
      name: "UbiquityAI",
    },
    {
      role: "user",
      content: "This issue/Pr context: \n" + JSON.stringify(streamlined),
      name: "UbiquityAI",
    },
    {
      role: "user",
      content: "Linked issue(s) context: \n" + JSON.stringify(linkedIssueStreamlined),
      name: "UbiquityAI",
    },
    {
      role: "user",
      content: "Linked Pr(s) context: \n" + JSON.stringify(linkedPRStreamlined),
      name: "UbiquityAI",
    }
  );

  // we'll use the first response to determine the context of future calls
  return await askGPT(context, "", chatHistory);
}

/**
 * @notice base askGPT function
 * @param question the question to ask
 * @param chatHistory the conversational context to provide to GPT
 */
export async function askGPT(context: Context, question: string, chatHistory: CreateChatCompletionRequestMessage[]) {
  const {
    logger,
    config: {
      keys: { openAi },
    },
  } = context;
  if (!openAi) {
    logger.error(`No OpenAI API Key provided`);
    await addCommentToIssue(context, errorDiff("No OpenAI API Key provided to the /reseach plugin."));
    return;
  }

  const openAI = new OpenAI({
    apiKey: openAi,
  });

  const res: OpenAI.Chat.Completions.ChatCompletion = await openAI.chat.completions.create({
    messages: chatHistory,
    model: "gpt-3.5-turbo-16k",
    temperature: 0,
  });

  const answer = res.choices[0].message.content;

  const tokenUsage = {
    output: res.usage?.completion_tokens,
    input: res.usage?.prompt_tokens,
    total: res.usage?.total_tokens,
  };

  if (!res) {
    console.info(`No answer found for question: ${question}`);
  }

  return { answer, tokenUsage };
}
