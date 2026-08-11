## MODIFIED Requirements

### Requirement: Progress projection is exact and configurable

Empirical SHALL normalize its phases and stop conditions into documented
progress states, then resolve those states only through the project's explicit
provider mapping. Every projection MUST carry one provider-owned marker and the
feature, phase, workflow status, revision, highest completion level, and any
bounded blocked or awaiting-human summary. The effective target and complete
state mapping MUST participate in synchronization acknowledgment so a
same-target mapping change invalidates the same-revision fast path and
reprojects the committed state. Human-authored provider content outside the
exact owned marker or provider-owned property MUST be preserved. Linear SHALL
render its managed projection and create-recovery reference as compact readable
Markdown: exact machine identifiers MAY remain in link destinations but raw
HTML comment delimiters, create-attempt prose, and digest values MUST NOT appear
as visible description text. Synchronization MUST migrate exactly one balanced
legacy Linear projection and create marker to the readable form, and MUST fail
closed on duplicate, mixed, malformed, or unbalanced marker ownership.

#### Scenario: Verification requires human input

- **WHEN** the feature commits an `awaiting_human` Verify revision
- **THEN** the configured remote state is selected deterministically
- **AND** the remote Empirical marker identifies the exact Verify revision and gate

#### Scenario: A state mapping changes without a new local revision

- **WHEN** the target is unchanged but the configured state identifier differs
  from the last acknowledged projection policy
- **THEN** synchronization projects the committed revision using the new mapping
- **AND** acknowledges the new mapping only after the provider update succeeds

#### Scenario: Human text coexists with the managed projection

- **WHEN** a Linear description surrounds one balanced Empirical marker or a
  Jira issue has a user-authored description alongside the Empirical property
- **THEN** projection replaces only the Linear managed block or Jira managed property
- **AND** preserves the human-authored description

#### Scenario: Linear renders machine-owned metadata readably

- **WHEN** Empirical creates or synchronizes a Linear issue
- **THEN** the rendered description shows a compact human-readable progress summary
- **AND** exact projection and recovery identifiers remain searchable only in
  Markdown link destinations rather than visible raw metadata

#### Scenario: Linear migrates a legacy managed description

- **WHEN** one balanced legacy HTML projection and create-attempt block exists
- **THEN** synchronization replaces each with its readable Markdown equivalent
- **AND** preserves the original exact recovery key and all surrounding human text

#### Scenario: Linear marker ownership is ambiguous

- **WHEN** legacy and readable markers are duplicated, mixed, malformed, or unbalanced
- **THEN** synchronization fails before updating the issue description
- **AND** the existing description and recovery evidence remain unchanged
