# Decisions

## D-001: Use Markdown link destinations for exact markers

Status: Accepted

### Evidence

- Linear displays HTML comments literally in SDD-5, while Markdown
  link destinations are searchable source but render as a short label.

### Options

1. Keep HTML comments.
2. Render machine metadata as visible code.
3. Put exact markers in Markdown link destinations.

### Chosen approach

Use option 3 for Linear only. The visible labels are concise, while exact
feature and attempt markers remain in the stored description source.

### Trade-offs and risks

Marker parsing becomes provider-specific, but visible output is
  clean without weakening exact recovery.

### Verification

Assert readable labels, the absence of raw visible metadata, exact destination
markers, and lost-response convergence without a second create.

## D-002: Migrate only exact known legacy forms

Status: Accepted

### Evidence

- Existing Linear issues contain deterministic start/body/end blocks.
- A fresh local attachment can have a different bind key from the original
  remote create attempt.

### Options

1. Apply broad regular-expression cleanup.
2. Leave old issues unchanged.
3. Migrate exactly one validated legacy projection and recovery block.

### Chosen approach

Use option 3. Parse and preserve the digest from one matching legacy recovery
block rather than deriving it from the current local binding.

### Trade-offs and risks

Odd manual edits fail closed and require operator cleanup rather
  than risking deletion of human-authored content.

### Verification

Preserve surrounding text and the original digest; reject mixed, duplicate,
malformed, and unbalanced markers before any update.
