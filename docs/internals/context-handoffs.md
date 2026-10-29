# Context handoffs

Portable provider and fork handoffs carry app history. They do not claim native provider context parity.

Provider handoffs use the full eligible app history or the delta since the target last participated.
`ContextHandoffServiceV2` selects historical messages within a token budget; delivery also accounts
for the target's remaining capacity. History is injected when supported or included as text in the
target prompt, with coverage and omission information.

Fork merge-back handoffs summarize eligible delta items from the child. Their `compactText` collapses
whitespace and limits each text-bearing item to 240 characters; file changes carry the filename and
checkpoints carry the file count. Neither path reconstructs provider-native session state, tool state,
approvals, or omitted text.

Legacy v1 continuation uses a separate algorithm. It considers only user and assistant messages,
walks backward from the newest message, and builds a transcript suffix within a 32,000-character
budget. Do not describe that migration budget as the limit for portable handoffs, and do not describe
the 240-character prefix as a migration rule.
