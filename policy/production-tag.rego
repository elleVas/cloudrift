package main

import rego.v1

# Denies any *waste* finding (never *optimization* — that's a savings
# opportunity, not money being wasted right now) tagged Environment:
# production. This is the kind of rule the native budget gate can't express:
# it only ever looks at the grand total, never at individual findings or
# their tags.
deny contains msg if {
	some finding in input.findings
	finding.category == "waste"
	finding.tags.Environment == "production"
	msg := sprintf(
		# `%v`, not `%.2f` — see the comment in waste-budget.rego.
		"%s (%s) in production is wasting $%v/month: %s",
		[finding.kind, finding.id, finding.monthlyCostUsd, finding.wasteReason],
	)
}
