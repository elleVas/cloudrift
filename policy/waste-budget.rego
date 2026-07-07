package main

import rego.v1

# The one line to edit: your monthly waste budget in USD.
budget_usd := 50

# This mirrors the gate cloudrift already enforces natively via
# `costAlertThresholdUsd` (apps/cli/src/commands/analyze-waste.command.ts,
# `applyCostGate`) — same rule, written in Rego, as the starting point before
# writing something more specific than "total waste vs. one number".
deny contains msg if {
	input.totalWasteMonthlyUsd > budget_usd
	msg := sprintf(
		# `%v`, not `%.2f`: cloudrift's JSON serializes a whole-dollar cost
		# (e.g. exactly $50) without a decimal point, and Rego's `%f` verb
		# panics on a bare integer — `%v` prints either shape safely.
		"total monthly waste $%v exceeds budget $%v",
		[input.totalWasteMonthlyUsd, budget_usd],
	)
}
