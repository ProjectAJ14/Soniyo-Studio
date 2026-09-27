---
paths:
  - "web/src/**"
---
# Web rules

- Data flows `api/client.ts` → feature hook → component. Components never `fetch`.
- Every remote value is an `AsyncState<T>` (`lib/async.ts`) rendered through
  `<AsyncView>` so loading, empty, error (with Retry) and loaded are all handled.
- Distinguish `unreachable` (Mac/Tailscale down) from API errors; unreachable shows
  the Tailscale banner, not "network error".
- Styling: Eklavya design system — role tokens only (`--ink`, `--spot`, `--line`),
  square chrome, hairlines not shadows, Lucide icons, no emoji, sentence case.
  `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|--vd-' src --include='*.css' --include='*.tsx'`
  must hit only `styles/tokens.css`.
- Touch targets ≥ 44px, every control labelled, `:focus-visible` ring kept.
