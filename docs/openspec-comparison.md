# Empirical 0.25 compared with OpenSpec

Empirical adopts OpenSpec's repository-native change contracts and explicit
deltas from current behavior. It adds an executable, resumable trust protocol
for autonomous coding agents.

| Capability | OpenSpec | Empirical 0.25 |
| --- | --- | --- |
| Change contract | Proposal/spec/design/tasks | Spec/design/plan, impact manifest, observable criteria |
| Behavior change | ADDED/MODIFIED/REMOVED deltas | Frozen deltas, shared claims, base replay, independent integration |
| Discovery | Team-selected process | Durable five-pass interview and approval |
| Execution | Agent follows tasks | Exact revisioned Fast or Complex workflow; normal or bounded YOLO |
| Verification | Defined by the change | Immutable executed/collected receipts tied to criteria and source |
| Completion | Convention | Derived implemented/verified/integrated/delivered/published levels |
| Parallel work | Multiple change directories | One feature per checkout plus approved Git worktrees and common-dir claims |
| Current behavior | Specs remain artifacts | Reviewed deltas transactionally update living capabilities |
| Delivery | External process | Protected two-PR GitHub delivery; explicit immutable publication |
| Diagnostics | Artifact inspection | Read-only Doctor across schema, journals, policy, evidence, Git, and tools |

Empirical is a stronger fit when an agent must resume safely across sessions,
prove what it ran, coordinate across worktrees, and report exact completion
without overstating external effects. OpenSpec remains simpler when a team wants
a lightweight artifact convention without a runtime, evidence, Git, or delivery
protocol.
