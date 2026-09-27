# web/

React 19 + TypeScript + Vite SPA, installable PWA, iPad-landscape first. Talks only
to the gateway through `src/api/client.ts`. Contract: `../docs/api-contract.md`.

## Layout

| Path | Owns |
|---|---|
| `src/api/` | `client.ts` (only network code, typed `ApiError` with kind `unpaired | unreachable | unauthorized | api`), `types.ts` (contract mirror) |
| `src/lib/` | `async.ts` (`AsyncState`, `useAsync`, `useMutation`), `pairing.ts`, `draft.ts` (Song → Create hand-off), `format.ts`, `theme.ts` |
| `src/components/` | Shared presentational pieces: `AsyncView`, `LoadingState`, `ErrorState`, `EmptyState` |
| `src/app/` | Shell, tab bar, hash router (`#/create`, `#/queue`, `#/library`, `#/songs/:id`, `#/server`) |
| `src/features/<name>/` | One folder per screen: screen component, its hooks, its sub-components, its tests |
| `src/styles/` | `tokens.css` (Eklavya, copied — do not edit roles without mirroring both grounds), `base.css` (recipes) |

Features import from `api`, `lib`, `components` — never from another feature, except
`player` (`usePlayer`) and `queue` (`useActiveJobCount`), which are app-wide.

## State pattern (mandatory)

```tsx
const [songs, reload] = useAsync(() => api.listSongs({ q }), [q])
return (
  <AsyncView state={songs} onRetry={reload} label="songs"
    isEmpty={d => d.items.length === 0} empty={<EmptyState title="No songs yet" />}>
    {d => <SongList items={d.items} />}
  </AsyncView>
)
```

Mutations use `useMutation`; disable the trigger while `loading`, show the error
inline next to it. Never `catch {}` silently.

## Design (Eklavya)

Classes in `base.css`: `.btn(--brand|--ghost|--danger|--icon|--sm)`, `.chip[aria-pressed]`,
`.seg`, `.card`, `.field/.input/.select/.textarea`, `.label`, `.badge`, `.dot`, `.code`,
`.state`, `.banner`. One `--brand` button per band. Lucide icons (`lucide-react`),
16px in buttons. Display type Archivo 900, micro-labels mono uppercase.

## Checks

`npm run typecheck && npm run lint && npm test && npm run build`
