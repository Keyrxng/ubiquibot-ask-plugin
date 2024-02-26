import { ask } from "./plugin";
import { parseArguments } from "./utils/parseArgv";

(async () => {
  const args = parseArguments(process.argv);
  const result = await ask(args.body, args.issueNumber, args.sender, args.repo, args.org);
  console.log(result);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
