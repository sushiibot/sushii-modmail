export interface SourceArg {
  path: string;
  applicationId: string;
}

/**
 * Parses repeated `--source <path>:<applicationId>` flags, shared by
 * merge-bot-dbs.ts and verify-merged-db.ts.
 */
export function parseSourceArgs(argv: string[]): {
  sources: SourceArg[];
  rest: string[];
} {
  const sources: SourceArg[] = [];
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--source") {
      const value = argv[++i];
      const lastColon = value.lastIndexOf(":");
      if (lastColon === -1) {
        throw new Error(
          `Invalid --source value "${value}", expected <path>:<applicationId>`
        );
      }
      sources.push({
        path: value.slice(0, lastColon),
        applicationId: value.slice(lastColon + 1),
      });
    } else {
      rest.push(arg);
    }
  }

  if (sources.length === 0) {
    throw new Error("At least one --source is required");
  }

  return { sources, rest };
}
