# Frontend frame: design system, shell, auth (owner: TJ / C3)

## Run it

```bash
cd frontend
cp .env.example .env.local   # mock auth is ON, so you can sign in without the backend
npm install
npm run dev                  # http://localhost:3000, design reference at /styleguide
```

## Your page gets the shell for free

Create `frontend/app/<your-section>/page.tsx` (`hub`, `streamers`, `captions`, `trends`).
It's wrapped in the sidebar/bottom-tab shell and protected by sign-in automatically,
so you don't need a layout or auth check. Routes are listed in `lib/routes.ts` (`APP_NAV`).
To add a section, add it there.

```tsx
import { Button, PageHeader, Panel } from "@/components/ui";

export default function HubPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Clip hub" title="Ready to post" actions={<Button>Post selected</Button>} />
      <Panel>…</Panel>
    </div>
  );
}
```

## Imports

| From | What |
|---|---|
| `@/components/ui` | `Button` (`variant`: primary/secondary/ghost/danger, `size`, `loading`, `href`), `Panel` (`tone`, `padding`, `interactive`), `PageHeader`, `Ledger`, `Badge`, `Field`, `Icon`, `Logo`, `AuthFrame`, `AuthShowcase` |
| `@/components/effects` | `AuroraBackground`, `RevealOnScroll`, `FeatureCloud`, `Tape`, `RuleWall`, `CurveDivider`, `Watermark`, `FieldsReveal` |
| `@/lib/auth` | `useAuth()` → `{ user, status, login, register, logout }` |
| `@/lib/api` | `api<T>(path, { method, body })`: calls the backend with the bearer token attached. Plain objects are sent as JSON, `FormData` as-is (font upload). Throws `ApiError` with FastAPI's `detail`. |

## Rules

- **No colour literals.** Use role utilities only: `bg-paper`, `bg-surface`, `bg-surface-sunken`,
  `text-ink`, `text-ink-muted`, `text-ink-faint`, `border-line`, `border-line-strong`,
  `bg-brand`, `bg-brand-strong`, `bg-brand-soft`, `bg-brand-subtle`, `text-on-brand`, plus
  `success` / `warning` / `danger` (and `-subtle`) for **state only** (posted, failed, processing).
  Tailwind's default palette is disabled, so `bg-blue-500` produces nothing. `npm run lint` fails on any hex/rgb/hsl colour.
- **Sizing floor (brief §4b).** `text-xs` and `text-sm` don't exist. Body copy is `text-base` (17px);
  the smallest content size is `text-meta` (15px); `text-fine` (14px) is for tiny badges / legal only.
  Buttons are 48px (44px for `size="sm"`), inputs 56px, and icons are `size-5` or larger. `npm run lint` fails on violations.
  Be generous: on a desktop page, prefer `text-lg`/`text-xl` for card copy and `text-4xl`+ for headings.
  The root font size grows with screen width, so everything rem-based scales up on big monitors. Sizes may grow
  at `lg:`, but never shrink on phones.
- Radii: `rounded-sm|md|lg|xl|full`. Depth: `shadow-glow`, `shadow-glow-strong`; there are no black drop shadows.
- Clickable things: `Button`, or add the `tactile` class (hover lift + press squeeze).
- Keep working screens calm. Save the effects for the landing page, auth and showcase moments.

## Tokens

All values live in `frontend/theme.ts`. `themeToCss()` writes them onto `:root`, and
`app/globals.css` maps them to Tailwind utilities. Change a value in one place and the whole app re-skins.
Colours marked `TODO(brand)` are placeholders until the final brand values go in.

## Auth contract (for docs/CONTRACT.md)

Proposed so frontend and backend agree. The backend side (`backend/api/auth.py`) gets built once the `users` table is in.

```
POST /auth/register   { "email": str, "password": str (min 8) }
POST /auth/login      { "email": str, "password": str }
→ 200 { "access_token": "<jwt>", "token_type": "bearer", "user": { "id": ..., "email": "..." } }
→ 4xx { "detail": "human-readable message" }   (shown directly in the form)

Every other route: Authorization: Bearer <jwt>  → 401 if missing or expired
```

The frontend keeps the token in the `ch_session` cookie (read by `middleware.ts` for route
gating) and sends it as a bearer header. The backend needs CORS enabled for `http://localhost:3000`.
