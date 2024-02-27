import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { generateConfiguration, BotConfig } from "../../lib/@ubiquibot-configuration/src";
import { GitHubContext } from "../../lib/@ubiquibot-kernel/src/github/github-context";
import { errorDiff } from "../utils/errorDiff";
import OpenAI from "openai";

export async function askForAPermit(event: GitHubContext<"issue_comment.created">) {
  const logger = console;
  const config: BotConfig = await generateConfiguration(event);

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
