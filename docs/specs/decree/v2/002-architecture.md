---
title: Architecture v2
version: 0.1.0
last_updated: 2026-02-15
status: draft
---

# Architecture v2

## Overview

This document defines the target architecture for the decree control plane after the v2 redesign. It
is the primary reference for all migration work — component specs describe individual modules in
detail, but this document defines the boundaries, contracts, and invariants that all components must
respect.

The redesign introduces four structural changes:

1. **Provider abstraction.** The engine operates on normalized domain types, not GitHub-specific
   types. GitHub becomes one provider implementation behind interfaces.
2. **Broker boundary.** All external mutations flow through a CommandExecutor backed by a policy
   layer. No component bypasses this boundary.
3. **Handler-based dispatch.** Workflow logic is organized as handler functions with a consistent
   shape, replacing scattered dispatch code.
4. **Artifact-based runtime interface.** Agent execution produces structured artifacts. The engine
   programs against this contract; the runtime implementation is pluggable.

### Relationship to other documents

- `001-plan.md` — captures the decisions that led to this architecture.
- Migration plan (phase 2) — sequences the incremental refactors to reach this target state.
- Component specs — define individual modules in detail; updated as each migration step completes.

## Domain Model

The engine operates on three domain concepts. These are provider-agnostic — the engine never imports
provider-specific types.

### WorkItem

A unit of work tracked by the system. Normalized from issues, tickets, or equivalent work-tracking
entities.

```
WorkItem {
  id:             number
  title:          string
  status:         WorkItemStatus
  priority:       Priority | null
  complexity:     string | null
  createdAt:      string                  // ISO 8601
  linkedRevision: number | null           // Revision id, if one exists
}
```

`WorkItemStatus` is the domain-level status, normalized from provider-specific representations (e.g.
GitHub status labels):

```
WorkItemStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'review'
  | 'approved'
  | 'needs-refinement'
  | 'blocked'
```

`Priority`:

```
Priority = 'high' | 'medium' | 'low'
```

### Revision

A proposed code change associated with a WorkItem. Normalized from pull requests, merge requests, or
equivalent.

```
Revision {
  id:             number
  title:          string
  url:            string
  headSHA:        string
  headRef:        string                  // branch name
  author:         string
  body:           string
  isDraft:        boolean
  workItemID:     number | null           // linked WorkItem, if detected
  pipelineStatus: PipelineStatus | null
}
```

`PipelineStatus`:

```
PipelineStatus = 'pending' | 'success' | 'failure'
```

### Spec

A specification document tracked by the system. Lightweight compared to WorkItem and Revision — the
engine needs only enough information to detect changes and drive planning.

```
Spec {
  filePath:           string
  blobSHA:            string
  frontmatterStatus:  string
}
```

### Domain Events

Events are the primary input to the engine. Pollers produce them by comparing provider state against
the canonical store. Other sources (agent completion, user actions) also produce events.

```
WorkItemChanged {
  type:       'workItemChanged'
  workItemID: number
  title:      string
  oldStatus:  WorkItemStatus | null       // null on first detection
  newStatus:  WorkItemStatus | null       // null on removal
  priority:   Priority | null
  isRecovery: boolean                     // true when synthetic from crash recovery
}

RevisionChanged {
  type:             'revisionChanged'
  revisionID:       number
  workItemID:       number | null
  oldPipelineStatus: PipelineStatus | null
  newPipelineStatus: PipelineStatus | null
}

SpecChanged {
  type:              'specChanged'
  filePath:          string
  frontmatterStatus: string
  changeType:        'added' | 'modified'
  commitSHA:         string
}

AgentStarted {
  type:        'agentStarted'
  role:        AgentRole
  workItemID:  number | null              // present for Implementor, Reviewer
  specPaths:   string[]                   // present for Planner
  sessionID:   string
  branchName:  string | null
  logFilePath: string | null
}

AgentCompleted {
  type:        'agentCompleted'
  role:        AgentRole
  workItemID:  number | null
  specPaths:   string[]
  sessionID:   string
  result:      AgentResult
  logFilePath: string | null
}

AgentFailed {
  type:        'agentFailed'
  role:        AgentRole
  workItemID:  number | null
  specPaths:   string[]
  error:       string
  sessionID:   string
  branchName:  string | null
  logFilePath: string | null
}

EngineEvent =
  | WorkItemChanged
  | RevisionChanged
  | SpecChanged
  | AgentStarted
  | AgentCompleted
  | AgentFailed
```

Notes:

- `PRLinkedEvent` and `CIStatusChangedEvent` from v1 are replaced by `RevisionChanged`. Revision
  detection and pipeline status changes are both expressed as revision state changes.
- `AgentType` is renamed to `AgentRole` to reinforce that these are domain roles, not runtime types.

### AgentRole

```
AgentRole = 'planner' | 'implementor' | 'reviewer'
```

### Domain Commands

Commands are the output of handlers. They express intent in domain terms. The CommandExecutor
translates them into provider operations.

```
TransitionWorkItemStatus {
  command:    'transitionWorkItemStatus'
  workItemID: number
  newStatus:  WorkItemStatus
}

RequestAgentRun {
  command:    'requestAgentRun'
  role:       AgentRole
  workItemID: number | null               // null for Planner (operates on specs)
  specPaths:  string[]                    // populated for Planner
}

CancelAgentRun {
  command:    'cancelAgentRun'
  role:       AgentRole
  workItemID: number | null
}

AnnotateRevision {
  command:    'annotateRevision'
  revisionID: number
  annotation: string                      // review comment, status update, etc.
}

Shutdown {
  command:    'shutdown'
}

EngineCommand =
  | TransitionWorkItemStatus
  | RequestAgentRun
  | CancelAgentRun
  | AnnotateRevision
  | Shutdown
```

### AgentResult

Structured output from an agent run. The engine processes these artifacts — it does not rely on
agents having performed side effects.

```
AgentResult {
  patch:       string | null              // git-format patch, if code was produced
  issues:      AgentIssue[]               // work items to create (Planner output)
  review:      AgentReview | null         // structured review verdict (Reviewer output)
  annotations: string[]                   // general-purpose notes or comments
}
```

```
AgentIssue {
  title:       string
  body:        string
  labels:      string[]
}

AgentReview {
  verdict:     'approve' | 'request-changes'
  summary:     string
  comments:    AgentReviewComment[]
}

AgentReviewComment {
  path:        string
  line:        number | null
  body:        string
}
```

[Component Architecture — to be drafted]

[Agent Role Contracts — to be drafted]

[TUI Contract — to be drafted]

[Error Handling — to be drafted]

[Recovery — to be drafted]

[Future Extensions — to be drafted]
