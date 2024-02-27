export function parseArguments(argv: string[]) {
  return {
    body: argv[2],
    issueNumber: argv[3],
    sender: argv[4],
    repo: argv[5],
    org: argv[6],
  };
}
