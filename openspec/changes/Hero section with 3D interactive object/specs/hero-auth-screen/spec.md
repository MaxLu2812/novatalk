# Hero Auth Screen Specification

## Purpose

The hero auth screen replaces the plain centered auth layout with a fullscreen animated backdrop of 3D-feel gradient orbs, mouse-driven parallax, and a spring-entrance auth card -- creating visual impact for first-time visitors without WebGL overhead.

## Requirements

### Requirement: Fullscreen Hero Layout

The system MUST render the auth screen as a full-bleed hero container (`position: fixed`, 100vw x 100vh) with the auth card centered above the animated background.

#### Scenario: Hero replaces auth-shell

- GIVEN the user navigates to the auth/landing route
- WHEN the page renders
- THEN the layout uses a fullscreen hero container instead of the previous `.auth-shell` centered wrapper
- AND the auth card is positioned centered with `z-index` above the hero background

### Requirement: Animated Gradient Orbs

The system MUST render 3-4 `motion.div` gradient orbs with spring-based slow-float idle animation behind the auth card.

#### Scenario: Orbs render with idle animation

- GIVEN the hero screen is active
- WHEN the background renders
- THEN 3-4 gradient orbs are visible with CSS blur and translucent colors
- AND each orb animates with a spring-based slow float (no linear or tween animation)

#### Scenario: Reduced motion

- GIVEN the user's system has `prefers-reduced-motion: reduce` set
- WHEN the hero screen renders
- THEN orbs render as static elements with zero animation
- AND no spring motion is applied

### Requirement: Mouse Parallax

The system SHOULD translate orb positions in response to mouse movement using spring physics on non-mobile viewports.

#### Scenario: Cursor drives parallax offset

- GIVEN the viewport width is >= 720px
- WHEN the user moves the mouse over the hero
- THEN each orb translates by a fraction of the cursor delta from center
- AND the translation applies spring-damped easing (no direct mapping)

#### Scenario: Parallax disabled on mobile

- GIVEN the viewport width is < 720px
- WHEN the user touches or drags on the screen
- THEN orbs do NOT respond with parallax motion

### Requirement: Auth Card Entrance Animation

The system MUST animate the auth card's entrance with spring-driven scale (0.9 to 1.0) and opacity (0 to 1) on mount.

#### Scenario: Card springs into view

- GIVEN the auth route loads
- WHEN the card mounts
- THEN it scales from 0.9 to 1.0 with spring easing
- AND its opacity transitions from 0 to 1 in parallel

#### Scenario: Reduced motion skips entrance

- GIVEN `prefers-reduced-motion: reduce` is set
- WHEN the card mounts
- THEN it renders at full opacity and scale immediately (no entrance animation)

### Requirement: Theme Support via CSS Custom Properties

The system MUST derive orb gradient colors from CSS custom properties so dark and light themes are supported without JS color logic.

#### Scenario: Dark theme colors

- GIVEN the active theme is dark
- WHEN orbs render
- THEN their gradient colors use CSS var values defined for dark mode

#### Scenario: Light theme colors

- GIVEN the active theme is light
- WHEN orbs render
- THEN their gradient colors use CSS var values defined for light mode

### Requirement: Auth Form Unchanged

The auth form MUST retain all existing register/login functionality, validation, and submission behavior.

#### Scenario: Registration works through hero layout

- GIVEN the user is on the hero auth screen
- WHEN they complete and submit the registration form
- THEN the existing register flow executes identically to the pre-hero layout

#### Scenario: Login works through hero layout

- GIVEN the user is on the hero auth screen
- WHEN they complete and submit the login form
- THEN the existing login flow executes identically to the pre-hero layout

### Requirement: Mobile Animation Reduction

The system MUST reduce animation complexity below 720px viewport width.

#### Scenario: Reduced orbs on mobile

- GIVEN the viewport width is < 720px
- WHEN the hero screen renders
- THEN the orb count SHOULD be 1-2 (reduced from 3-4)
- AND no parallax is applied
- AND orb idle animation SHOULD use minimal spring intensity or be static
