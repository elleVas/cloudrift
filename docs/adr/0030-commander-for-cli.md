# ADR-0030: Commander.js for CLI parsing

- **Status:** Accepted

## Context

Needed argument parsing, automatic help generation, and async command handlers for a single-command CLI.

## Decision

Commander.js, using `parseAsync` for the async handler.

## Alternatives Considered

- **yargs.** Not adopted: comparable feature set, no concrete advantage identified over Commander's simpler, more declarative API for this CLI's needs.
- **oclif.** Rejected: a plugin/multi-command-oriented framework, which is overkill for a single-command CLI today.
- **Hand-rolled `process.argv` parsing.** Rejected: would mean reimplementing help text, validation, and async handling that Commander already provides.

## Consequences

Low-friction CLI definition. Would need re-evaluation only if the CLI grows multiple subcommand "plugins" the way oclif specializes in.
