# Design: Hero section with 3D interactive object

## Technical Approach

Replace the plain `.auth-shell` inline block in `App.tsx` (lines 967–1027) with a fullscreen hero container wrapping a new `HeroScene` background component and the existing auth form JSX. `framer-motion` drives spring-based orb float, mouse parallax, and card entrance animations. Gradient colors derive from CSS custom properties so theme switching works without JS.

## Architecture Decisions

### Decision: Auth form stays inline

**Choice**: Keep the existing auth form JSX inside `App.tsx`. Do not extract.
**Alternatives**: Extract into `AuthForm.tsx` with props for `authMode`, `authForm`, `handleAuthSubmit`, `setAuthMode`, `setAuthForm`, `error`.
**Rationale**: The form is ~60 lines with 7 tight bindings to `App.tsx` state. Extracting creates a 10-prop interface with zero reuse — the form only renders in this one place. The hero change touches layout, not form logic; extraction is a separate refactor with its own risk.

### Decision: CSS custom properties for orb colors

**Choice**: Define `--hero-orb-{1..4}` variables on `:root` and `:root[data-theme="light"]`.
**Alternatives**: Compute colors in JS via `getComputedStyle` or a theme context.
**Rationale**: CSS vars react instantly to theme changes without re-renders. The `HeroScene` component reads them from inline `style` attributes as `var(--hero-orb-1)`, so `framer-motion` never needs to know about theme.

### Decision: Mobile detection via JS `matchMedia`

**Choice**: Use `window.matchMedia("(max-width: 720px)")` in `HeroScene` to reduce orb count and disable parallax. CSS `@media` for layout changes (padding, card width). `prefers-reduced-motion` uses its own `matchMedia` query.
**Alternatives**: Pure CSS `@media` for all animation control.
**Rationale**: CSS can't dynamically change the number of rendered React elements. `HeroScene` needs to conditionally render 1–2 vs 3–4 orbs. Parallax is already JS-driven (onMouseMove). Keeping both in JS avoids split logic.

### Decision: Single `HeroScene` component, no sub-components

**Choice**: One `HeroScene.tsx` component managing all orbs, parallax, and motion config.
**Alternatives**: `Orb.tsx` sub-component + `useParallax` hook.
**Rationale**: Three orbs sharing nearly identical motion config doesn't justify a component / hook split at this scale. If later iterations add 3D objects or WebGL, extract then.

## Data Flow

```
App.tsx
  └── if (!token || !bootstrap)
        └── <div className="hero-shell">          ← fullscreen fixed container
              ├── <HeroScene />                   ← 3-4 gradient orbs + parallax
              └── <motion.div className="hero-card"> ← spring entrance wrapper
                    └── [existing auth form JSX]  ← unchanged, inline
```

Parallax flow: `onMouseMove` → `useState` cursor ratio → `useSpring` value → `motion.div` `style={{ x, y }}`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `client/package.json` | Modify | Add `"framer-motion": "^12.6.0"` to dependencies |
| `client/src/components/HeroScene.tsx` | Create | Orb background component with parallax and mobile reduction |
| `client/src/App.tsx` | Modify | Replace auth container JSX with hero layout |
| `client/src/styles.css` | Modify | Add `.hero-shell`, `.hero-card`, `.hero-orb-*` and `--hero-orb-*` CSS vars |

## Interfaces / Contracts

```typescript
// HeroScene.tsx — no props, all configuration is internal
// Orb configuration:
interface OrbConfig {
  size: number;           // px diameter
  gradient: string;       // CSS radial-gradient value using var()
  initialX: number;       // initial position offset %
  initialY: number;
  floatAmplitude: number; // spring float range in px
}
```

## CSS Custom Properties Added

| Variable | Dark (default) | Light |
|----------|----------------|-------|
| `--hero-orb-1` | `rgba(255,255,255,0.08)` → `rgba(255,255,255,0.02)` | `rgba(15,23,42,0.06)` → `rgba(15,23,42,0.02)` |
| `--hero-orb-2` | `rgba(99,102,241,0.10)` → `transparent` | `rgba(99,102,241,0.06)` → `transparent` |
| `--hero-orb-3` | `rgba(236,72,153,0.08)` → `transparent` | `rgba(236,72,153,0.04)` → `transparent` |
| `--hero-orb-4` | `rgba(251,191,36,0.06)` → `transparent` | `rgba(251,191,36,0.03)` → `transparent` |

## Testing Strategy

Testing infrastructure is not configured (no test runner). Verification relies on:

| Layer | What to Test | Approach |
|-------|-------------|----------|
| TypeScript | All new files | `npx tsc --noEmit` — must pass with zero errors |
| Build | Bundle integrity | `npm run build` — must succeed |
| Manual | Visual regression | Check dark/light theme, mobile 720px, reduced-motion, parallax cursor tracking |

## Migration / Rollout

No migration required. The hero layout replaces the auth shell in-place. Rollback per proposal: revert `App.tsx`, `styles.css`, delete `HeroScene.tsx`, remove `framer-motion`.

## Open Questions

- [ ] Confirm orb gradient density — current proposal uses 4 orbs, spec says 3–4. Finalize at 4 with mobile reducing to 2.
- [ ] Verify `spring` stiffness/damping values for orb float and card entrance — start with `{ stiffness: 100, damping: 20 }` and tune during implementation.
