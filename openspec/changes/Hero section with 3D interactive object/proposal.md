# Proposal: Hero section with 3D interactive object

## Intent

Auth screen lacks visual impact for first-time visitors. Animated hero with interactive 3D-feel shapes creates a compelling first impression matching the brand ("softer motion, sharper flow") without full WebGL overhead.

## Scope

### In Scope
- Animated gradient orbs and geometric shapes behind auth card
- Mouse parallax (shapes follow cursor via spring physics)
- Auth card spring entrance animation (Framer Motion)
- Fullscreen hero layout replacing centered `.auth-shell`
- Dark/light theme via CSS custom properties
- Mobile: reduced animation complexity below 720px
- Add `framer-motion` to `client/package.json`

### Out of Scope
- True WebGL/Three.js 3D — deferred to future iteration
- 3D logo or branded mascot — abstract shapes only
- Lazy loading / code splitting — separate change
- Animations outside auth/landing screen
- Layout beyond existing breakpoints

## Capabilities

### New Capabilities
- `hero-auth-screen`: Animated hero with abstract 3D-feel shapes on auth/landing screen

### Modified Capabilities
None

## Approach

Add `framer-motion`. Create `HeroScene.tsx` with 3-4 `motion.div` gradient orbs. Idle animation: spring-based slow float. Parallax: `onMouseMove` maps cursor position to shape translation offsets. Auth card wraps in `motion.div` with spring entrance (scale + opacity). CSS: `position: fixed` hero container, auth card centered with `z-index` above. Mobile: disable parallax, reduce shape count, respect `prefers-reduced-motion`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `client/package.json` | Modified | Add `framer-motion` dependency |
| `client/src/App.tsx:967-1027` | Modified | Replace auth render with hero layout + HeroScene |
| `client/src/styles.css` | Modified | Auth CSS → hero layout styles |
| `client/src/components/HeroScene.tsx` | New | Abstract shapes + parallax component |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| framer-motion adds ~32KB to bundle | High | Acceptable for auth screen; future code splitting can gate it |
| CSS specificity conflicts with existing auth classes | Low | New classes, old ones removed/replaced |
| Mobile performance jank | Med | Respect `prefers-reduced-motion`, disable parallax, reduce shapes |
| Theme mismatch in animation colors | Low | Use CSS vars in gradient definitions |

## Rollback Plan

1. Remove `framer-motion` from `client/package.json`
2. Delete `client/src/components/HeroScene.tsx`
3. Revert `App.tsx` lines 967-1027 to original `.auth-shell` JSX
4. Revert `styles.css` auth sections to original classes
5. Run `npm install && npm run build` to verify clean state

## Dependencies

- `framer-motion` (latest v12.x)

## Success Criteria

- [ ] Animated hero shapes render behind auth card
- [ ] Shapes follow mouse with smooth spring parallax
- [ ] Auth card springs in (no abrupt appearance)
- [ ] Works in both dark and light themes
- [ ] Mobile: reduced animations, no jank below 720px
- [ ] Build passes with zero TypeScript errors (`npm run build`)
