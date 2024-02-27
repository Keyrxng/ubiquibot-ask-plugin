/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import { Octokit } from "octokit";
import { Comment, StreamlinedComment, UserType } from "../types/response";

export function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function checkRateLimitGit(headers: { "x-ratelimit-remaining"?: string; "x-ratelimit-reset"?: string }) {
  // Check the remaining limit
  const remainingRequests = headers["x-ratelimit-remaining"] ? parseInt(headers["x-ratelimit-remaining"]) : 0;

  // If there are no more remaining requests for this hour, we wait for the reset time
  if (remainingRequests === 0) {
    // const resetTime = new Date(parseInt(headers["x-ratelimit-reset"]! || "0") * 1000);
    const resetTime = new Date((headers["x-ratelimit-reset"] ? parseInt(headers["x-ratelimit-reset"]) : 0) * 1000);
    const now = new Date();
    const timeToWait = resetTime.getTime() - now.getTime();
    console.log(`No remaining requests. Waiting for ${timeToWait}ms...`);
    await wait(timeToWait);
  }

  return remainingRequests;
}

export async function getAllIssueComments(
  octokit: Octokit,
  repo: string,
  owner: string,
  issueNumber: number,
  format: "raw" | "html" | "text" | "full" = "raw"
): Promise<Comment[]> {
  if (!octokit) {
    throw new Error("No octokit provided");
  }

  const result: Comment[] = [];
  let shouldFetch = true;
  let pageNumber = 1;
  try {
    while (shouldFetch) {
      const response = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
        page: pageNumber,
        mediaType: {
          format,
        },
      });

      if (response?.data?.length > 0) {
        response.data.forEach((item: unknown) => {
          result.push(item as Comment);
        });
        pageNumber++;
      } else {
        shouldFetch = false;
      }
    }
  } catch (e: unknown) {
    shouldFetch = false;
  }

  return result;
}

export async function getIssueByNumber(octokit: Octokit, repo: string, owner: string, issueNumber: number) {
  const logger = console;
  try {
    const { data: _issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return _issue;
  } catch (e: unknown) {
    logger.debug(`Fetching issue failed! reason: ${e}`);
    return;
  }
}

export async function getPullByNumber(octokit: Octokit, repo: string, owner: string, pullNumber: number) {
  const logger = console;

  try {
    const { data: pull } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return pull;
  } catch (error) {
    logger.debug(`Fetching pull failed! reason: ${error}`);
    return;
  }
}

// Strips out all links from the body of an issue or pull request and fetches the conversational context from each linked issue or pull request
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function getAllLinkedIssuesAndPullsInBody(octokit: Octokit, repo: string, owner: string, issueNumber: number) {
  const logger = console;

  const issue = await getIssueByNumber(octokit, repo, owner, issueNumber);

  if (!issue) {
    return `Failed to fetch using issueNumber: ${issueNumber}`;
  }

  if (!issue.body) {
    return `No body found for issue: ${issueNumber}`;
  }

  const body = issue.body;
  const linkedPRStreamlined: StreamlinedComment[] = [];
  const linkedIssueStreamlined: StreamlinedComment[] = [];

  const regex = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+)/gi;
  const matches = body.match(regex);

  if (matches) {
    try {
      const linkedIssues: number[] = [];
      const linkedPrs: number[] = [];

      // this finds refs via all patterns: #<issue number>, full url or [#25](url.to.issue)
      const issueRef = issue.body.match(/(#(\d+)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+))/gi);

      // if they exist, strip out the # or the url and push them to their arrays
      if (issueRef) {
        issueRef.forEach((issue) => {
          if (issue.includes("#")) {
            linkedIssues.push(Number(issue.slice(1)));
          } else {
            if (issue.split("/")[5] == "pull") {
              linkedPrs.push(Number(issue.split("/")[6]));
            } else linkedIssues.push(Number(issue.split("/")[6]));
          }
        });
      } else {
        logger.info(`No linked issues or prs found`);
      }

      if (linkedPrs.length > 0) {
        for (let i = 0; i < linkedPrs.length; i++) {
          const pr = await getPullByNumber(octokit, repo, owner, linkedPrs[i]);
          if (pr) {
            linkedPRStreamlined.push({
              login: "system",
              body: `=============== Pull Request #${pr.number}: ${pr.title} + ===============\n ${pr.body}}`,
            });
            const prComments = await getAllIssueComments(octokit, repo, owner, linkedPrs[i]);
            const prCommentsRaw = await getAllIssueComments(octokit, repo, owner, linkedPrs[i], "raw");
            prComments.forEach(async (comment, i) => {
              if (comment.user.type == UserType.User || prCommentsRaw[i].body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
                linkedPRStreamlined.push({
                  login: comment.user.login,
                  body: comment.body,
                });
              }
            });
          }
        }
      }

      if (linkedIssues.length > 0) {
        for (let i = 0; i < linkedIssues.length; i++) {
          const issue = await getIssueByNumber(octokit, repo, owner, linkedIssues[i]);
          if (issue) {
            linkedIssueStreamlined.push({
              login: "system",
              body: `=============== Issue #${issue.number}: ${issue.title} + ===============\n ${issue.body} `,
            });
            const issueComments = await getAllIssueComments(octokit, repo, owner, linkedIssues[i]);
            const issueCommentsRaw = await getAllIssueComments(octokit, repo, owner, linkedIssues[i], "raw");
            issueComments.forEach(async (comment, i) => {
              if (comment.user.type == UserType.User || issueCommentsRaw[i].body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
                linkedIssueStreamlined.push({
                  login: comment.user.login,
                  body: comment.body,
                });
              }
            });
          }
        }
      }

      return {
        linkedIssues: linkedIssueStreamlined,
        linkedPrs: linkedPRStreamlined,
      };
    } catch (error) {
      logger.info(`Error getting linked issues or prs: ${error}`);
      return `Error getting linked issues or prs: ${error}`;
    }
  } else {
    logger.info(`No matches found`);
    return {
      linkedIssues: [],
      linkedPrs: [],
    };
  }
}
