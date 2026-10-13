# B25 → B26 rollback boundary, permanent negative evidence

B25 is a three-replica LOCAL SQLite synthetic vote design. In the authoritative
B25 source `test_two_rolledback_replicas_remain_not_certified` explicitly
removes two voter journals and permits the same proposal to secure two freshly
signed votes. **This is a demonstrated failure of global antirollback.**

B26 adds a required separately pinned witness boundary and blocks the same
replay while its local witness state remains intact. However, the B26
`SyntheticWitness` is also on the same machine and can be destroyed. The
permanent test `test_witness_loss_and_two_voter_rollbacks_still_break_simulated_antirollback`
confirms that deleting that database plus the same two voter journals
reinstates the replay attack. This is NOT a FIX for independently controlled
cross-host storage, and it must not be relabelled as certified durability.

When a real external authority exists, require: provider-owned append-once
sequence/nonce records in a separate security trust domain; hard fail on
unavailability/ambiguity; independent identity and key rotation; proof of
cross-host rollback resistance with destructive failover and revocation; and
fresh provider-certified $0 usage envelope. NO live provider send in B26.
