# Frontend frame: design system, shell, auth (owner: TJ / C3)

## Run it

```bash
# Backend (needs Python 3.11+)
cd backend
py -3.11 -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
cp .env.example .env         # then set JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(48))"
.venv/Scripts/uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
cp .env.example .env.local   # real auth against the backend; set NEXT_PUBLIC_AUTH_MOCK=true to work without it
npm install
npm run dev                  # http://localhost:3000, design reference at /styleguide
```

If port 8000 is taken, run uvicorn on another port and set `NEXT_PUBLIC_API_URL` to match.
The backend only accepts requests from origins in `CORS_ORIGINS` (default `http://localhost:3000`).

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
| `@/components/ui` | `Button` (`variant`: primary/secondary/ghost/danger, plus inverse/ghostInverse for brand backgrounds; `size`, `loading`, `href`), `Panel` (`tone`, `padding`, `interactive`), `PageHeader`, `Ledger`, `Badge`, `Field`, `Icon`, `Logo` (`inverse`), `ThemeSwitch`, `AuthFrame`, `AuthShowcase` |
| `@/components/ui` (editorial) | `Em` (bold-italic headline emphasis), `SectionLabel` (`// LABEL`), `EditorialSection` (label rail + content), `StatStrip`, `Timeline`, `ToneSteps`, `QuoteBanner` |
| `@/components/effects` | `SkyBackground` (brand night-to-day sky, put `text-on-brand` in its top two-thirds), `HalftoneHorizon` (rotating dotted planet), `AuroraBackground`, `RevealOnScroll`, `FeatureCloud`, `Tape`, `RuleWall`, `CurveDivider`, `Watermark`, `FieldsReveal` |
| `@/lib/theme-mode` | `useThemeMode()` → `{ mode, setMode, toggle }`. You rarely need it: role tokens switch automatically. |
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
  Buttons are 56px (48px for `size="sm"`), inputs 56px, and icons are `size-5` or larger. `npm run lint` fails on violations.
  Be generous: on a desktop page, prefer `text-lg`/`text-xl` for card copy and `text-4xl`+ for headings.
  The root font size grows with screen width, so everything rem-based scales up on big monitors. Sizes may grow
  at `lg:`, but never shrink on phones.
- Radii: `rounded-sm|md|lg|xl|full`. Depth: `shadow-glow`, `shadow-glow-strong`; there are no black drop shadows.
- Clickable things: `Button`, or add the `tactile` class (hover lift + press squeeze).
- **Dark mode is automatic** if you use role tokens: every role has a dark value in `theme.ts` (`darkColors`). Check your page in both with the switch in the sidebar.
- Keep working screens calm. Save the effects for the landing page, auth and showcase moments.

## Tokens

All values live in `frontend/theme.ts`. `themeToCss()` writes them onto `:root`, and
`app/globals.css` maps them to Tailwind utilities. Change a value in one place and the whole app re-skins.
Colours marked `TODO(brand)` are placeholders until the final brand values go in.

## Auth (live)

Implemented in `backend/app/api/auth.py`, mounted under `/api` (bcrypt password hashing, JWT via `JWT_SECRET`).
Protect your own backend routes with the `CurrentUser` dependency:

```python
from app.api.deps import CurrentUser, DbSession

@router.get("/streamers")
def list_streamers(user: CurrentUser, db: DbSession): ...
```

Register your router in `backend/app/main.py` with `app.include_router(...)`.

```
POST /api/auth/register   { "email": str, "password": str (min 8) }
POST /api/auth/login      { "email": str, "password": str }
→ 200 { "access_token": "<jwt>", "token_type": "bearer", "user": { "id": ..., "email": "..." } }
→ 4xx { "detail": "human-readable message" }   (shown directly in the form)

GET  /api/auth/me          → 200 { "id", "email", "created_at" }   (the frontend checks this on load)

Every other route: Authorization: Bearer <jwt>  → 401 if missing or expired
```

The frontend keeps the token in the `ch_session` cookie (read by `middleware.ts` for route
gating) and sends it as a bearer header. The backend needs CORS enabled for `http://localhost:3000`.
