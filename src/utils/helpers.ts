/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error no types for this package
import yaml from "js-yaml";
import { UbiquiBotConfig } from "../types/response";
import { Octokit } from "octokit";

export async function getUbiquiBotConfig(octokit: Octokit, owner: string, repo: string): Promise<UbiquiBotConfig> {
  const responses = {
    repositoryConfig: null as UbiquiBotConfig | null,
    organizationConfig: null as UbiquiBotConfig | null,
  };

  try {
    responses.repositoryConfig = await fetchConfig(octokit, owner, repo);
  } catch (error) {
    console.error(error);
  }

  try {
    responses.organizationConfig = await fetchConfig(octokit, owner, `.ubiquibot-config`);
  } catch (error) {
    console.error(error);
  }

  // Merge the two configs
  return {
    ...(responses.organizationConfig || {}),
    ...(responses.repositoryConfig || {}),
  } as UbiquiBotConfig;
}

async function fetchConfig(octokit: Octokit, owner: string, repo: string): Promise<UbiquiBotConfig | null> {
  const response = await octokit.rest.repos
    .getContent({
      owner,
      repo,
      path: ".github/ubiquibot-config.yml",
    })
    .catch((error) => {
      throw new Error(`Error fetching config: ${error}`);
    });

  // Check if the response data is a file and has a content property
  if ("content" in response.data && typeof response.data.content === "string") {
    // Convert the content from Base64 to string and parse the YAML content
    const content = atob(response.data.content).toString();
    return yaml.load(content) as UbiquiBotConfig;
  } else {
    return null;
  }
}
