export function parseArguments(argv: string[]) {
  const args = {
    body: "",
    issueNumber: 0,
    sender: "",
    repo: "",
    org: "",
  };

  argv.forEach((val) => {
    if (val.startsWith("--body=")) {
      args.body = val.split("=")[1];
    } else if (val.startsWith("--issueNumber=")) {
      args.issueNumber = parseInt(val.split("=")[1], 10);
    } else if (val.startsWith("--sender=")) {
      args.sender = val.split("=")[1];
    } else if (val.startsWith("--repo=")) {
      args.repo = val.split("=")[1];
    } else if (val.startsWith("--org=")) {
      args.org = val.split("=")[1];
    }
  });

  return args;
}
