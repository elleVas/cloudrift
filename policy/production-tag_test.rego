package main

import rego.v1

test_denies_production_waste if {
	count(deny) > 0 with input as {"findings": [{
		"id": "vol-1", "kind": "ebs-volume", "category": "waste",
		"monthlyCostUsd": 40, "wasteReason": "unattached for 12 days",
		"tags": {"Environment": "production"},
	}]}
}

test_allows_staging_waste if {
	count(deny) == 0 with input as {"findings": [{
		"id": "vol-2", "kind": "ebs-volume", "category": "waste",
		"monthlyCostUsd": 40, "wasteReason": "unattached for 12 days",
		"tags": {"Environment": "staging"},
	}]}
}

test_allows_production_optimization if {
	count(deny) == 0 with input as {"findings": [{
		"id": "vol-3", "kind": "ebs-gp2-upgrade", "category": "optimization",
		"monthlyCostUsd": 5, "wasteReason": "gp2 upgradeable to gp3",
		"tags": {"Environment": "production"},
	}]}
}

test_denies_whole_dollar_amount_without_format_glitch if {
	deny == {"ebs-volume (vol-5) in production is wasting $40/month: unattached for 12 days"} with input as {"findings": [{
		"id": "vol-5", "kind": "ebs-volume", "category": "waste",
		"monthlyCostUsd": 40, "wasteReason": "unattached for 12 days",
		"tags": {"Environment": "production"},
	}]}
}

test_allows_untagged_waste if {
	count(deny) == 0 with input as {"findings": [{
		"id": "vol-4", "kind": "ebs-volume", "category": "waste",
		"monthlyCostUsd": 40, "wasteReason": "unattached for 12 days",
		"tags": {},
	}]}
}
