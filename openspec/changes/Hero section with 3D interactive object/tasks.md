# Tasks: Hero section with 3D interactive object

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Foundation

- [ ] 1.1 Add `"framer-motion": "^12.6.0"` to `client/package.json` dependencies; run `npm install`
- [ ] 1.2 Add `--hero-orb-{1..4}` CSS vars to `:root` (dark) and `:root[data-theme="light"]` in `client/src/styles.css`
- [ ] 1.3 Add `.hero-shell` (fixed fullscreen), `.hero-card` (centered, z-index above), and `.hero-orb-*` classes in `client/src/styles.css`
- [ ] 1.4 Add `@media (max-width: 720px)` responsive overrides for `.hero-shell` and `.hero-card` in `client/src/styles.css`

## Phase 2: Core Implementation

- [ ] 2.1 Create `client/src/components/HeroScene.tsx` with `OrbConfig` interface, 4 orb definitions, and mobile detection via `window.matchMedia("(max-width: 720px)")`
- [ ] 2.2 Implement orb `motion.div` render with spring idle animation (`{ stiffness: 100, damping: 20 }`) reading gradient colors from `var(--hero-orb-*)` CSS vars
- [ ] 2.3 Add mouse parallax: `onMouseMove` → cursor ratio state → `useSpring` mapped to orb `x`/`y` translation; disable below 720px
- [ ] 2.4 Handle `prefers-reduced-motion`: skip spring animations, render orbs as static `<div>` elements
- [ ] 2.5 Conditionally render 2 orbs (mobile) vs 4 orbs (desktop) based on `matchMedia` result

## Phase 3: Integration

- [ ] 3.1 In `client/src/App.tsx`, replace the `.auth-shell` centered wrapper with `<div className="hero-shell">` containing `<HeroScene />` + `<motion.div className="hero-card">` wrapping existing auth form JSX
- [ ] 3.2 Wrap auth card `<motion.div>` with spring entrance animation: `initial={{ scale: 0.9, opacity: 0 }}` → `animate={{ scale: 1, opacity: 1 }}`; respect reduced-motion guard
- [ ] 3.3 Verify all existing auth form bindings (`authMode`, `authForm`, `handleAuthSubmit`, `setAuthMode`, `setAuthForm`, `error`) pass through unchanged

## Phase 4: Verification

- [ ] 4.1 Run `npx tsc --noEmit` — confirm zero TypeScript errors
- [ ] 4.2 Run `npm run build` — confirm bundle builds successfully
- [ ] 4.3 Manual check: toggle dark/light theme — orb colors must update without re-render
- [ ] 4.4 Manual check: resize to <720px — 2 orbs shown, no parallax; >=720px — 4 orbs with parallax
- [ ] 4.5 Manual check: enable `prefers-reduced-motion: reduce` — all animations static, card renders at full opacity/scale
