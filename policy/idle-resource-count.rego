package main

import rego.v1

# The one line to edit: how many unattached EBS volumes you're willing to
# tolerate before it's worth a person looking at what keeps creating them.
max_idle_ebs_volumes := 2

deny contains msg if {
	count(idle_ebs_volume_ids) > max_idle_ebs_volumes
	msg := sprintf(
		"%d unattached EBS volumes found, more than the %d allowed",
		[count(idle_ebs_volume_ids), max_idle_ebs_volumes],
	)
}

idle_ebs_volume_ids contains finding.id if {
	some finding in input.findings
	finding.kind == "ebs-volume"
}
