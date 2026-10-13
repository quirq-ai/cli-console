# cli console

**Your command-line tools, in one local workspace.**

cli console turns installed CLIs into a browser interface: command families in the sidebar, subcommands across the top, flags as forms, and real output from your machine. Pick a tool and its console is generated on demand from local help or man pages. No hand-maintained command catalog or AI key is required.

## What it does

| Feature | Behavior |
| --- | --- |
| Tool discovery | Search executable programs already available on your `PATH`. |
| Generated consoles | Extract command families, subcommands, options, and descriptions from local references. |
| Nested navigation | Collect deeper command help as you open it. |
| Command builder | Edit flag fields, positional arguments, standard input, and working directory with a live preview. |
| Local execution | Review an immutable preview, then explicitly confirm the process you want to run. |
| Results | Inspect structured JSON, tables, raw stdout, stderr, duration, and exit status. |
| History and cancellation | Reopen recent results or stop a running local process. |
| Reference import | Generate a command builder from pasted help when a local reference is unavailable. |
| Optional AI enrichment | Improve titles and descriptions without allowing AI to change commands or authorize execution. |

## Quick start

Requires **Node.js 22 or later**, npm, and the CLI tools you want to use on `PATH`. Tested on macOS; the application is intended for a local macOS or Linux environment.

```sh
git clone https://github.com/quirq-ai/cli-console.git
cd cli-console
npm ci
npm run dev
```

Open [http://127.0.0.1:4320](http://127.0.0.1:4320). Keep the server running while using the console.

For an optimized production build:

```sh
npm run build
npm start
```

Both commands bind the app to loopback. The Next.js server runs on the same machine as your CLIs and uses their existing local configuration and authentication.

## Using the console

1. Open the tool picker above the sidebar and choose an installed program.
2. Select a command family, then a subcommand. Missing references are collected and cached as you navigate.
3. Fill the documented flag fields. Put each positional argument on its own line; spaces inside a line remain part of that argument.
4. Set an existing absolute working directory. Optionally provide standard input.
5. Choose **Review & run**, inspect the exact command and directory, then choose **Confirm and run**.
6. View results in **Output**, **Raw**, or **Stderr**. Use **History** to reopen a run, or **Stop command** to cancel an active process.

When `gh` is installed, the initial view opens `gh pr list`. It does not execute the command automatically. Set the working directory to a checkout or use gh's repository flag before running repository commands.

Interactive programs and recognized credential or script-running operations provide a copyable command for your terminal.

## How generation works

```text
Installed programs on PATH
         ↓
Local CLI help or man page
         ↓
Parsed and validated command schema
         ↓
Cached reference → React command workspace
         ↓
Reviewed preview → local process → results
```

The parser supports common Cobra, argparse, Click/clap-style command tables, npm inventories, pnpm command groups, and man-page option blocks. It collects a selected command's reference instead of traversing every installed tool at startup.

Common tools with known help conventions are probed through help arguments. Other programs are read through local man pages without starting the program: some utilities interpret `--help` as a filename or action.

Generated references live in the ignored `.cache/catalog/` directory. The cache invalidates when the executable path, modification time, or size changes. **Regenerate** explicitly refreshes the current reference. The cache can be deleted while the server is stopped.

If a reference is missing or has an unsupported format, use **Import reference** to paste help or man text. Imported references produce forms and a terminal handoff until live help can verify the command.

## Optional AI enrichment

The app works entirely through local parsing by default. To improve generated titles and descriptions:

```sh
cp .env.example .env.local
```

Set the following values in `.env.local`, then restart the server:

```dotenv
AI_GATEWAY_API_KEY=your-gateway-key
AI_MODEL=provider/model
```

Choose a model available through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Selected help text is sent to the model, which returns two validated text fields. AI cannot add command names, change flags, generate executable UI code, or approve a run. If enrichment fails, the parser still supplies the console. The AI Gateway key is excluded from spawned CLI environments.

## Execution limits

This is a **local, single-user command runner**. A confirmed command can modify local files or remote services through your CLI's existing permissions.

- Every run needs an explicitly confirmed preview. Previews expire after two minutes and can be consumed once.
- Processes receive argument arrays and run without a shell. Flag fields must match the selected reference; positional arguments cannot introduce extra options.
- The API checks loopback hosts, request origins, fetch-site headers, and JSON body size.
- Up to four processes run concurrently. Each run is limited to two minutes and 512 KiB of captured output.
- Cancellation stops the local process group. It does not undo completed work or necessarily cancel a remote operation.
- The last 30 runs are kept in server memory. History disappears when the server stops.
- Recognized interpreters, project-script runners, credential operations, and interactive commands use a terminal handoff. Interactive behavior cannot be detected perfectly for arbitrary programs.

Deploying the frontend to Vercel alone will not give it access to CLIs on your laptop. Hosted access would require a separately authenticated local agent.

## Current limitations

Help formats are not universal, so extraction is not exhaustive for every CLI. Repeated flags, bare optional-value flags, mutually exclusive arguments, and shell pipelines are not modeled. Consult the displayed source reference and use your terminal for those cases. Windows support has not been verified.

## Development

Built with Next.js App Router, React, TypeScript, Zod, and the Vercel AI SDK. Help collection and execution use Node.js child processes.

```text
src/app/                  App shell, styles, and Next.js entry points
src/app/api/console/      Local API for discovery, generation, previews, and runs
src/components/           Generated command interface
src/lib/catalog.ts        PATH inventory, help collection, enrichment, and cache
src/lib/parser.ts         Reference parsing and command argument construction
src/lib/runner.ts         Immutable previews, execution, cancellation, and history
src/lib/boundary.ts        Loopback and HTTP request checks
src/lib/schema.ts          Shared validated command schema
src/lib/process.ts         Bounded help collection and CLI environment
test/                     Parser, boundary, runner, and integration checks
```

Run the checks:

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

The integration tests also require **Git, GitHub CLI (`gh`), and pnpm** on `PATH`; no GitHub login is needed to collect help. Tests cover parsing, cache reuse, optional-value syntax, argument boundaries, request checks, preview confirmation and replay prevention, terminal handoffs, cancellation, and help timeout/output limits. Unknown executables are checked to ensure discovery never starts them.

Validated on 2026-10-14: all 15 tests, TypeScript checks, and the production build passed. Browser verification covered generated gh navigation, Git man-page forms, a confirmed read-only Git status run, first-use curl generation, and layouts at 390, 768, and 1440 pixels. Optional AI enrichment was not exercised without a configured key.

## License

[MIT](LICENSE).
