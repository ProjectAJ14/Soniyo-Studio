---
paths:
  - "docs/api-contract.md"
  - "gateway/src/soniyo_gateway/schemas.py"
  - "web/src/api/**"
---
# Contract rules

- The three files above are one unit: a field added, renamed or removed in one is
  changed in all three in the same commit.
- snake_case on the wire and in TS types; no client-side renaming layer.
- Errors are only `{"error": {code, message, retryable}}`; add new codes to the table.
- Additive changes only within `/api/v1`; a breaking change needs `/api/v2`.
