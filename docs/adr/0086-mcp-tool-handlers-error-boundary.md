# ADR-0086: MCP tool handlers wrapped in a shared error boundary

- **Status:** Accepted (2026-07-26)

## Context

The 2026-07-25 code review (`docs/todo/code-review-2026-07-25.md`) flagged that `mcp.command.ts`'s three registered tool handlers (`analyze_cloudrift`, `get_resource_types`, `get_required_iam_permissions`) had no `try`/`catch`. `analyze_cloudrift` already handles the *expected* failure path — `deps.runAggregateAnalysis` returns `Result<..., Error>`, and `if (!result.ok) return errorResult(result.error.message)` turns a domain-level failure into the same structured `isError` `CallToolResult` every other failure in the file uses (see [ADR-0082](0082-mcp-server-second-input-adapter.md)'s "Partial-failure handling mirrors `scanErrors`" note in `architecture.md`).

What none of the three handlers cover is an *unexpected* throw: a bug in `deps` composition, a rejected promise instead of a returned `Result.fail`, a future change that adds a call which can throw. Handlers run inside the MCP SDK's own request dispatch, outside any `try`/`catch` `mcp.command.ts` provides — an uncaught throw there surfaces to the client as a raw JSON-RPC error, a different (and less informative) shape than the `isError` `CallToolResult` every other failure path already produces.

## Decision

A single `withErrorBoundary(handler)` function in `mcp.command.ts` wraps a `(...args) => Promise<CallToolResult>` handler and returns an equivalent function that catches any throw and converts it to `errorResult(err instanceof Error ? err.message : String(err))`. All three `server.registerTool(...)` calls pass their handler through it:

```typescript
withErrorBoundary(async (args) => {
  const result = await deps.runAggregateAnalysis(args);
  if (!result.ok) return errorResult(result.error.message);
  return jsonResult(result.value);
}),
```

`get_resource_types` and `get_required_iam_permissions` are wrapped too, even though both are static today (no `deps` call, nothing that can currently throw) — the boundary is applied uniformly to every registered tool rather than only to the one handler observed to need it, so a future change to either (e.g. reading from a file, calling a port) is covered without anyone having to remember to add the wrap at that point.

## Alternatives Considered

- **Inline `try`/`catch` in each handler.** Rejected: three near-identical catch blocks for the same `errorResult(...)` conversion: `withErrorBoundary` is the same amount of code written once instead of three times, with no loss of clarity at the call site.
- **A `try`/`catch` around `server.connect(...)` in `mcpCommand()`, one level up.** Rejected: by the time an exception reaches there, the MCP SDK has already decided how to represent the failed tool call to the client (likely already as a raw protocol-level error) — wrapping at the handler level is the only place that can still produce the same `isError` `CallToolResult` shape as the `Result.fail` path.
- **Have the MCP SDK's own error handling take care of it.** Rejected without adopting: the SDK does not document a guarantee that an uncaught throw inside a registered tool's handler is turned into a client-visible `isError` result rather than, say, closing the connection — safer to make the contract explicit in this codebase than to rely on unverified SDK behavior.

## Consequences

Zero behavior change for the already-covered `Result.fail` path. Two new tests in `mcp.command.spec.ts` cover the previously-untested branch: a handler that throws an `Error`, and one that throws a non-`Error` value (exercising the `String(err)` fallback) — both now resolve to `isError: true` with the thrown value's message in `content[0].text`, instead of the test (and, in production, the real client) observing an unhandled rejection.
