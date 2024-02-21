import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { errorDiff } from "./utils/errorDiff";
import { askGPT, decideContextGPT, sysMsg } from "./gpt/ask";
import { GitHubContext } from "ubiquibot-kernel";
import { StreamlinedComment, UserType } from "./types/response";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "./utils/getIssueComments";

/**
 * @param body The question to ask
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function ask(event: GitHubContext<"issue_comment.created">) {
  const { payload } = event;
  const logger = console;

  const sender = payload.sender.login;
  const issue = payload.issue;
  const body = payload.comment.body;

  if (!body) {
    return `Please ask a question`;
  }

  if (!issue) {
    return `This command can only be used on issues`;
  }

  const chatHistory: CreateChatCompletionRequestMessage[] = [];
  const streamlined: StreamlinedComment[] = [];
  let linkedPRStreamlined: StreamlinedComment[] = [];
  let linkedIssueStreamlined: StreamlinedComment[] = [];

  const regex = /^\/ask\s(.+)$/;
  const matches = body.match(regex);

  if (matches) {
    const [, body] = matches;

    // standard comments
    const comments = await getAllIssueComments(event, issue.number);
    // raw so we can grab the <!--- { 'UbiquityAI': 'answer' } ---> tag
    const commentsRaw = await getAllIssueComments(event, issue.number, "raw");

    if (!comments) {
      logger.info(`Error getting issue comments`);
      return errorDiff(`Error getting issue comments`);
    }

    // add the first comment of the issue/pull request
    streamlined.push({
      login: issue.user.login,
      body: issue.body ?? "",
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
    const links = await getAllLinkedIssuesAndPullsInBody(event, issue.number);

    if (typeof links === "string") {
      logger.info(`Error getting linked issues or prs: ${links}`);
    } else {
      linkedIssueStreamlined = links.linkedIssues;
      linkedPRStreamlined = links.linkedPrs;
    }

    // let chatgpt deduce what is the most relevant context
    const gptDecidedContext = await decideContextGPT(event, chatHistory, streamlined, linkedPRStreamlined, linkedIssueStreamlined);

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

    const gptResponse = await askGPT(body, chatHistory);

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
