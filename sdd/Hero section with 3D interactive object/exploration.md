## Exploration: Hero section with 3D interactive object

### Current State

The landing/auth screen is a **monolithic inline conditional render** inside `App.tsx` (lines 967-1027). When `!token || !bootstrap`, it renders a centered `.auth-shell` containing a single `.auth-card` with a glassmorphism floating card (`backdrop-filter: blur(22px)`). The card has a **2-column grid** layout (1.1fr copy / 0.9fr form), showing:

- **Left column** (`.auth-copy`): An eyebrow "VladikLox", heading "Cleaner messenger, softer motion, sharper flow.", and a paragraph describing features.
- **Right column** (`.auth-form`): Register/Login toggle segment, form fields (display name for register, username, password), submit button, error feedback.

The app is NOT lazy-loaded — the entire 1577-line `App()` component and all sub-components (`Avatar`, `VoiceMessage`, `VideoTile`, `IconButton`, `CropDraft`) are bundled into a single Vite build entry. No React Router, no code splitting.

**Dependencies** (from `client/package.json`):
- `react`, `react-dom` (both v19.1.0)
- `socket.io-client` (v4.8.1)
- Dev: `vite` (v7), `typescript` (v5.8), `@vitejs/plugin-react`

**No Framer Motion**, **no Three.js**, **no react-three-fiber** — the lockfile confirms zero animation or 3D libraries.

**CSS architecture**: Dark theme via `:root` CSS custom properties (light theme swaps with `[data-theme="light"]`). Uses `--bg`, `--bg-soft`, `--panel`, `--panel-strong`, `--surface`, `--surface-strong`, `--line`, `--text`, `--muted`, `--accent`, `--danger`, `--accept`, `--amber`, `--shadow`. Transitions at 180ms ease on interactive elements. `backdrop-filter: blur(22px)` on `.floating` panels.

**Media queries**: 1180px (shell-app grid adjustment), 900px (auth-card → single column), 720px (tighter padding, stacked layouts).

**Performance considerations**: Zero. The entire app is one component, one bundle. No React.lazy, no Suspense, no dynamic imports.

### Affected Areas

- `client/src/App.tsx` — The auth screen render block (lines 967-1027). This is where the hero would replace or wrap the existing `.auth-shell/.auth-card`.
- `client/src/styles.css` — The entire auth layout CSS: `.auth-shell`, `.auth-card`, `.auth-copy`, `.auth-form`, `.eyebrow`, media queries at 900px. Needs major restructuring for a fullscreen hero layout.
- `client/package.json` — New dependencies required (framer-motion, three.js or react-three-fiber).
- `client/src/App.tsx` (header imports) — API module imports and types are already clean. New component imports needed.
- `client/vite.config.ts` — Potentially needs a `define` or build config if heavy 3D bundles need optimization.

### Approaches

1. **Framer Motion + Canvas-based 3D (Three.js via react-three-fiber)** — Full 3D interactive object rendered in a `<Canvas>` behind/alongside the auth card. Use `@react-three/fiber` for declarative Three.js and `@react-three/drei` for helpers (OrbitControls, Float, etc.). Wrap the auth card with Framer Motion `motion.div` for entrance animations.
   - Pros: Rich visual impact, highly interactive, the "3D object" can respond to mouse/tilt/scroll
   - Pros: `@react-three/fiber` is React-idiomatic, component composition, no imperative Three.js
   - Pros: Framer Motion handles entrance/exit animations, layout transitions, and gesture-driven parallax
   - Cons: Adds ~180KB to bundle (three ~130KB, fiber ~30KB, drei ~20KB) — significant for a landing page
   - Cons: Not lazy-loaded currently; would need code-splitting to avoid loading 3D on every app navigation
   - Cons: WebGL can cause jank on low-end devices; mobile battery impact
   - Effort: **High** — new dependencies, new component tree, refactor auth layout, add lazy loading infrastructure

2. **Pure CSS/Canvas 3D with Framer Motion** — Use a simple `<canvas>` element or CSS 3D transforms for a pseudo-3D effect (floating geometric shapes, parallax layers, gradient orbs) animated with Framer Motion. No Three.js.
   - Pros: Lightweight — only needs framer-motion as a new dependency (~32KB)
   - Pros: No WebGL overhead, works on all devices, battery-friendly
   - Pros: Matches the app's existing aesthetic (glassmorphism, soft motion, subtle gradients)
   - Cons: Not "true 3D" — limited to CSS 3D transforms and canvas 2D drawing
   - Cons: Less impressive than a true 3D object; can't do rotation/orbit of a 3D model
   - Effort: **Low-Medium** — add framer-motion, create a `HeroScene` component with animated CSS/canvas elements, restructure auth layout

3. **Three.js via Script Tag (no framework)** — Embed Three.js directly as a script import in the component, imperatively creating a scene. Skip react-three-fiber.
   - Pros: Smaller API surface to learn, direct control over WebGL
   - Pros: Slightly lighter than react-three-fiber + drei combo
   - Cons: Imperative code in a React app is an anti-pattern — lifecycle management, cleanup, resize handling all manual
   - Cons: No declarative component composition, harder to maintain
   - Cons: Still carries Three.js weight (~130KB)
   - Effort: **Medium** — lighter than full R3F setup but imperative code is harder to maintain

### Recommendation

**Approach 2: Pure CSS/Canvas 3D with Framer Motion** for now.

Rationale:
- This is a **messaging app landing page**, not a 3D portfolio. The existing brand is "softer motion, sharper flow" — subtle animated gradients, floating glass cards, and parallax shapes fit perfectly.
- The project is **already performance-naive** (zero code splitting, monolithic component). Adding a full WebGL/Three.js bundle before establishing basic performance hygiene (lazy loading, code splitting) is putting the cart before the horse.
- The auth screen is a **gate** — users spend seconds there before entering the app. Loading 180KB+ of 3D for a transient view is wasteful.
- Framer Motion's `motion.div`, `useScroll`, `useSpring`, and layout animations can create a stunning hero without WebGL: floating blurred orbs with `scale`/`translate` animations, CSS gradient meshes, the auth card entering with spring physics.
- If later the product needs a true 3D interactive object (e.g., a 3D logo/mascot), the Framer Motion hero layout is a clean foundation to swap in react-three-fiber later — it's just replacing the canvas element.

### Risks

- **No code splitting exists** — Adding a large component to the auth screen increases the initial bundle. Even Approach 2 (framer-motion) adds ~32KB to every page load. The app SHOULD `React.lazy()` the main App shell and keep the auth screen as a small standalone chunk, but that's a significant refactor of the current monolithic structure.
- **Auth card state is local to App** — `authMode`, `authForm`, `handleAuthSubmit` are all in the same component. Extracting the hero and auth card into separate components requires prop drilling or a small context refactor.
- **Theme awareness** — The hero must respond to `data-theme="light"` changes. CSS vars handle this automatically for colors, but any programmatic animation colors need to react to theme changes.
- **Mobile layout** — At 900px the auth card collapses to single-column. The hero background needs to adapt gracefully without overwhelming small viewports (could reduce animation complexity on mobile).
- **Existing CSS specificity** — The auth CSS uses `.auth-shell`, `.auth-card`, `.auth-copy`, `.auth-form` class names. A fullscreen hero needs new layout classes that play nicely with these.

### Ready for Proposal

**No** — the orchestrator should start with a **proposal** phase. Key decision needed first: is this a "true 3D" feature (Three.js) or a "3D-feel" feature (CSS/Framer Motion)? That decision cascades into dependency choice, effort estimate, and delivery strategy. The proposal should also decide whether code-splitting the app is a prerequisite or deferred.
