/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { errorDiff } from "./utils/errorDiff";
import { askGPT, decideContextGPT, sysMsg } from "./gpt/ask";
import { GitHubContext } from "ubiquibot-kernel";
import { StreamlinedComment, UserType } from "./types/response";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "./utils/getIssueComments";
import { BotConfig, configGenerator } from "@ubiquibot/configuration";
import OpenAI from "openai";
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
    auth: process.env.GITHUB_TOKEN,
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

  // rebuilding the event but only what I need for my plugin to limit the required args

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

  const regex = /^\/ask\s(.+)$/;
  const matches = body.match(regex);

  if (matches) {
    const [, body] = matches;

    // standard comments
    const comments = await getAllIssueComments(issue, issue.number);
    // raw so we can grab the <!--- { 'UbiquityAI': 'answer' } ---> tag
    const commentsRaw = await getAllIssueComments(issue, issue.number, "raw");

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
    const links = await getAllLinkedIssuesAndPullsInBody(issue, issue.number);

    if (typeof links === "string") {
      logger.info(`Error getting linked issues or prs: ${links}`);
    } else {
      linkedIssueStreamlined = links.linkedIssues;
      linkedPRStreamlined = links.linkedPrs;
    }

    // let chatgpt deduce what is the most relevant context
    const gptDecidedContext = await decideContextGPT(issue, chatHistory, streamlined, linkedPRStreamlined, linkedIssueStreamlined);

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

export async function askForAPermit(event: GitHubContext<"issue_comment.created">) {
  const logger = console;
  const config: BotConfig = await configGenerator();

  if (!config.keys.openAi) {
    logger.info(`No OpenAI API Key provided`);
    return errorDiff("You must configure the `openai-api-key` property in the bot configuration in order to use AI powered features.");
  }

  const openAI = new OpenAI({
    apiKey: config.keys.openAi,
  });

  const permitPayoutSysMsg = `You are the UbiquityAI, designed to generate permit2 payout permits. \n
  You will be need to generate a permit for a either an ERC20 or an ERC721.\n
  
  # Functions \n
  - generate_erc20_permit \n
  - generate_nft_permit \n


  An ERC20 permit requires the following input: \n
  - amount: Amount permitted to spend \n
  - address: The ethereum address that is permitted to spend the token \n
  
  An NFT permit requires the following input: \n
  - username: The username that is permitted to claim the nft \n
  - address: The ethereum address that is permitted to claim the nft \n
  
  Expected output: \n
  - Just the arguments needed to pass into the respective function. \n
`;

  const chatHistory: CreateChatCompletionRequestMessage[] = [
    {
      role: "system",
      content: permitPayoutSysMsg,
      name: "UbiquityAI",
    },
    {
      role: "user",
      content: event.payload.comment.body,
      name: event.payload.sender.login,
    },
  ];
  const res: OpenAI.Chat.Completions.ChatCompletion = await openAI.chat.completions.create({
    messages: chatHistory,
    model: "gpt-3.5-turbo-16k",
    temperature: 0,
    tool_choice: "auto",
    tools: [
      {
        type: "function",
        function: {
          name: "generate_erc20_permit",
          description: "Generate an ERC20 permit with and address and amount.",
          parameters: {
            type: "object",
            properties: {
              amount: {
                type: "string",
                description: "Amount permitted to spend",
              },
              address: {
                type: "string",
                description: "The ethereum address that is permitted to spend the token",
              },
            },
            required: ["address, amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "generate_nft_permit",
          description: "Generate an NFT permit with a username and address.",
          parameters: {
            type: "object",
            properties: {
              address: {
                type: "string",
                description: "The ethereum address that is permitted to spend the token",
              },
              username: {
                type: "string",
                description: "The github username that is permitted to spend the token",
              },
            },
            required: ["address, username"],
          },
        },
      },
    ],
  });

  const resMsg = res.choices[0].message;

  const toolCalls = resMsg.tool_calls;
  const availableFunctions = {
    generate_erc20_permit: (e: object) => fetch("https://ubiquibot-worker.keyrxng7749.workers.dev", e),
    generate_nft_permit: (e: object) => fetch("https://ubiquibot-worker.keyrxng7749.workers.dev", e),
  };

  if (toolCalls) {
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === "generate_erc20_permit") {
        const functionName = toolCall.function.name;
        const functionToCall = availableFunctions[functionName];
        const functionArgs = JSON.parse(toolCall.function.arguments);

        const functionResponse = await functionToCall({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: functionArgs.amount,
            beneficiary: functionArgs.address,
            issueId: event.payload.issue.id.toString(),
            userId: event.payload.sender.id.toString(),
            // is userId supposed to be the spender or
          }),
        });

        const response = await functionResponse.json();

        const txData = response.signature;

        const base64encodedTxData = Buffer.from(JSON.stringify([txData])).toString("base64");

        const claimUrl = `http://localhost:8080/?claim=${base64encodedTxData}`;

        return `[Claim Permit](${claimUrl})`;
      }

      if (toolCall.function.name === "generate_nft_permit") {
        const functionName = toolCall.function.name;
        const functionToCall = availableFunctions[functionName];
        const functionArgs = JSON.parse(toolCall.function.arguments);

        const body = {
          networkId: config.payments.evmNetworkId,
          organizationName: event.payload.repository.owner.login,
          repositoryName: event.payload.repository.name,
          issueNumber: event.payload.issue.number.toString(),
          issueId: event.payload.issue.id.toString(),
          beneficiary: functionArgs.address,
          username: functionArgs.username, // ofc this is the spender
          userId: event.payload.sender.id.toString(),
          // is userId supposed to be the spender or
          // the person invoking the command i.e an admin/reviewer?
          contributionType: "issue",
        };

        const functionResponse = await functionToCall({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const response = await functionResponse.json();

        const txData = response.signature;

        const base64encodedTxData = Buffer.from(JSON.stringify([txData])).toString("base64");

        const claimUrl = `http://localhost:8080/?claim=${base64encodedTxData}`;

        return `[Claim Permit](${claimUrl})`;
      }
    }
  }

  console.log(resMsg);
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
