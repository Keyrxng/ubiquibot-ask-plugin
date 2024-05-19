# `@ubiquibot-plugins/research`

This plugin integrates OpenAi's GPT-4 into any issue or pull_request in a repository where your Ubiquibot is installed. It allows you to ask questions and get answers from the GPT-4 model.

## Usage

To use this plugin, an end user must invoke the `/research` command. Any text following the command will be considered the question context for the LLM. In addition to the direct question context, the LLM is provided with all conversational context from the current issue/pull_request as well as any linked issues/pull_requests. This enables a highly context aware response from the LLM.

![alt text](invokePreview.png)

## [Configuration](/src/plugin-config.yml)

To configure your Ubiquibot to run this plugin, you must add the following to your [`.ubiquibot-config.yml`](./.github/.ubiquibot-config.yml) file at the organization level, this is due to the need for an OpenAi API key and your organization configuration should be private.

```yaml
plugins:
  issue_comment.created:
    - uses:
        - plugin: ubiquibot-plugins/ubiquibot-ask-plugin:compute.yml@development
          name: Research
          id: research-command
          type: github
          description: "Integrate a highly context-aware GPT LLM embedded directly into your issues and pull requests."
          command: "/research"
          example: "/research The spec for this issue is unclear. Can you explain it in simpler terms?"
          with:
            keys:
              openAi: "" # this is a secret, so only install this plugin config in your private org config repo
            disabledCommands: []
```
