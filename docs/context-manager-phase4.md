# DSH Context Manager — Phase 4: Native compaction history

The **上下文管理 → 压缩历史** tab reconstructs compression indexes from DSH
Session's append-only persisted event log, including cold sessions after
restart. It does not store duplicate transcripts or modify Session histories.

Only valid and completely closed `compaction/start`,
`compaction/summary`, immediately adjacent source-tagged checkpoint
`user/message` replacement, and `compaction/end` count as successes.
Failed, aborted, missing-source and malformed transactions are excluded.
Replaced source nodes are identified by `shadowedSeqs` and
`sourceEventSeqs`, not by numeric sequence intervals.

Summaries can be listed, filtered and explicitly opened. Original source
events are retrieved **only on deliberate user action**, default five and
maximum ten at a time with a current-log revision check. Source content is
limited to 1,600 characters of text blocks from user, assistant and tool
result events. Other event types are not expanded. The index is rebuilt from
the durable log, so restoring the DSH_HOME volume restores this history.

## Security boundary

DSH's generic Web Connection RPC is not the per-Peer resource-authorized
Typert Gateway. The legacy extension has no reliable per-session caller
principal, and direct `remoteAccess.allows()` outside a Remote invocation
would authorize by default. Accordingly **history reading is OFF by default**.

Only an exclusively single-owner admin deployment may explicitly set:

```yaml
DSH_CONTEXT_MANAGER_HISTORY_READ: "owner-only"
```

Do NOT enable in multiuser, shared, guest or live-share deployments. The
enabled RPC can inspect local sessions. Migrating this API to a native
principal/resource-authorized Typert endpoint is a future requirement.

Methods: `history-capabilities` (no content), `history-sessions`,
`history-index`, `history-summary`, `history-originals`. All content
methods require opt-in and accept bounded, validated arguments. DSH native
`sessionController.inspect` handles both live and cold persisted Sessions.
Max 100k events, 512 completed compactions and 2,500 cited sources each.
Large logs fail explicitly rather than returning a truncated success.

## Remaining boundary

This feature is read-only. The Phase-3 tiered engine is not mounted and the
settings UI still truthfully shows `runtime.applied=false`. Automatic
model-facing retrieval, a separate full-text index and multiuser authorization
are not yet included. If the original Session log is deleted, history cannot
be reconstructed from the plugin alone.
