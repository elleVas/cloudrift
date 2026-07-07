package main

import rego.v1

test_denies_over_budget if {
	count(deny) > 0 with input as {"totalWasteMonthlyUsd": 100}
}

test_allows_under_budget if {
	count(deny) == 0 with input as {"totalWasteMonthlyUsd": 10}
}

test_allows_exactly_at_budget if {
	count(deny) == 0 with input as {"totalWasteMonthlyUsd": 50}
}

test_denies_whole_dollar_amount_without_format_glitch if {
	deny == {"total monthly waste $100 exceeds budget $50"} with input as {"totalWasteMonthlyUsd": 100}
}
