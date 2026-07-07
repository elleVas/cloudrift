package main

import rego.v1

test_denies_too_many if {
	count(deny) > 0 with input as {"findings": [
		{"id": "a", "kind": "ebs-volume"},
		{"id": "b", "kind": "ebs-volume"},
		{"id": "c", "kind": "ebs-volume"},
	]}
}

test_allows_within_limit if {
	count(deny) == 0 with input as {"findings": [
		{"id": "a", "kind": "ebs-volume"},
		{"id": "b", "kind": "ebs-volume"},
	]}
}

test_ignores_other_kinds if {
	count(deny) == 0 with input as {"findings": [
		{"id": "a", "kind": "elastic-ip"},
		{"id": "b", "kind": "elastic-ip"},
		{"id": "c", "kind": "elastic-ip"},
	]}
}
