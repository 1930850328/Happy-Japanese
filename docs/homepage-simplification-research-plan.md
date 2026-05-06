# Homepage Simplification Research Plan

Date: 2026-05-06

## Goal

Redesign the homepage around one clear user question:

> What should I continue learning now?

The current page still feels noisy because it tries to explain the product, report progress, expose version/status metadata, show learning stats, and preview lesson content in the same first viewport. The next iteration should remove that competition instead of polishing every existing card.

## Research Inputs

- Apple Human Interface Guidelines: hierarchy, layout, accessibility, typography, color, and feedback guidance.
- Material Design layout guidance: prefer whitespace over splitting the interface into too many framed regions; use cards only when grouping needs more separation than whitespace/dividers.
- FluentU: video-first language learning positioning with one clear value proposition and one primary action.
- Lingopie: real-world video content, dual subtitles, and review are the core loop; the product story stays anchored to watching content.
- Language Reactor: learning controls live around the video experience, not as unrelated dashboard widgets.
- Radix UI Primitives: unstyled, accessible React primitives that fit CSS Modules and custom design systems.
- Motion for React: production-grade UI animation, useful for restrained transitions.
- TanStack Virtual and Embla Carousel: useful later for long feeds or horizontal queues, but not necessary for the first simplification pass.

## What We Learned

- A learning homepage should not behave like a dashboard by default. Dashboards are useful after the user asks for progress detail; the first screen should be a continuation surface.
- The first viewport needs one visual protagonist. For this app, that protagonist should be the current lesson/video card, not progress stats, version badges, nav chrome, or explanatory paragraphs.
- Text should be progressive. Start with a short action label and one sentence of context; reveal grammar, transcript, tags, status, and progress only after the user opens a detail layer.
- Cards should be scarce. If everything is framed, nothing is important. Use one hero/focus card and let secondary items become rows or quiet text links.
- Open-source libraries should solve behavior and accessibility, not impose a visual style. This repo already uses CSS Modules, so headless primitives are safer than a pre-styled kit.

## Current Homepage Diagnosis

- Above the fold currently includes version chips, a long H1, a long explanatory paragraph, a mode chip, a secondary CTA, a stats panel, side progress, and navigation. That is too many competing entry points.
- The hero explains implementation details like player kernel, timeline, volume, speed, fullscreen, and picture-in-picture. Users do not need those details before starting a lesson.
- Progress appears as a large sidebar card and a mobile header percentage, but progress is not the main task on a video-learning homepage.
- The right stats panel repeats placeholder/summary information and pulls attention away from the video card.
- Lesson cards show theme, difficulty, duration, favorite/delete actions, title, description, first sentence, knowledge point cards, actions, tags, and credit line all at once.
- Version/build labels are product-maintenance metadata. They should not be visible in the primary learning path.

## Target Information Architecture

### Homepage

Primary purpose: continue the next lesson.

- Minimal app header: brand, compact daily progress, and one entry to settings/import if needed.
- Main focus card: current lesson cover/video poster, short title, one sentence or one Japanese line, and one primary action.
- Below focus card: a quiet "next up" queue with compact rows.
- Optional secondary action: open immersive mode, shown as a lower-priority icon/text button.
- No version chips, no implementation paragraph, no full progress dashboard, no multiple stats cards above the fold.

### Lesson Details

Primary purpose: reveal learning support only when requested.

- Knowledge points move into a drawer/sheet or post-play state.
- Tags, source credit, and delete/favorite actions become secondary menu items.
- Transcript preview should be one highlighted sentence, not a full mini lesson card.

### Profile / Import

Primary purpose: manage slicing, imports, settings, and progress detail.

- Keep slicing/import controls out of the homepage.
- Keep detailed goal metrics here or behind a progress detail drawer.

## Design System Direction

- Visual mode: calm media-learning surface, not dashboard, not glass-card playground.
- Background: mostly quiet and structural; avoid decorative blobs and repeated floating cards.
- Typography: CJK-first, stable, limited scale; avoid rounded Japanese-first fonts for Chinese UI labels.
- Layout: one main column on mobile; on desktop, central content remains dominant and side navigation is visually quiet.
- Color: one functional accent for primary action/progress; muted neutrals for everything else.
- Motion: only for focus transitions, drawer open/close, and lesson completion feedback; no decorative animations.

## Open-Source Library Plan

### Adopt

- `@fontsource/noto-sans-sc` and `@fontsource/noto-sans-jp`
  Reason: self-host stable CJK fonts and reduce browser-dependent glyph mismatch.

- `@radix-ui/react-dialog`
  Reason: accessible focus management for lesson details, knowledge-point drawer, and destructive delete confirmation.

- `@radix-ui/react-progress`
  Reason: accessible compact progress indicator without custom ARIA plumbing.

- `sonner`
  Reason: lightweight completion/import feedback; better than building custom toast behavior.

### Adopt Only If Needed

- `motion`
  Use for restrained layout transitions if CSS transitions cannot cover the focus-card/detail transitions cleanly.

- `@radix-ui/react-tabs`
  Use only if Profile/Import needs segmented sections after the homepage simplification.

- `@tanstack/react-virtual`
  Defer until lesson feeds become large enough to justify virtualization.

- `embla-carousel-react`
  Defer unless we replace vertical feed with a horizontal "next up" carousel. Native scroll-snap may be enough.

### Avoid For Now

- MUI, Ant Design, Chakra, Mantine: too visually opinionated or too broad for this small custom app surface.
- shadcn/ui as a wholesale adoption: good ideas, but it would pull the project toward Tailwind and a copied component style.
- Aceternity-style effect libraries: likely to add decoration while the real problem is information hierarchy.

## Refactor Plan

### Phase 1: Design Contract

- Create a short homepage design contract in docs:
  - Above-the-fold visible copy budget.
  - Allowed primary elements.
  - Do-not-add list: version chips, implementation details, duplicate stats, decorative cards.
- Generate or sketch one concrete homepage concept before coding, then implement against it.

### Phase 2: Component Architecture

- Add a small UI layer under `src/components/ui`:
  - `Button`
  - `ProgressPill` or `DailyProgress`
  - `FocusCard`
  - `LessonRow`
  - `Sheet/Dialog` wrapper around Radix primitives
  - `ToastProvider` if `sonner` is adopted
- Keep styling in CSS Modules and global tokens. Do not introduce a full external visual system.

### Phase 3: Homepage Cutdown

- Replace the current hero with `ContinueLessonPanel`.
- Remove version/build chips from the homepage.
- Replace the long hero paragraph with a short empty-state/help sentence only when no lesson exists.
- Remove `heroStats` from the first viewport; move detailed progress behind compact progress.
- Reduce `LessonCard` visible fields to:
  - media/poster
  - lesson title
  - one sentence preview
  - primary action
  - one secondary menu/detail action
- Move tags, source credits, knowledge points, favorite/delete into details.

### Phase 4: Navigation Simplification

- Desktop: reduce side rail weight; consider icon-first rail with labels, no large brand/progress cards.
- Mobile: keep bottom nav, but make the current lesson card the first visual anchor.
- Move import/slicing entry to Profile or a single header action, not homepage hero copy.

### Phase 5: Details And Feedback

- Use Radix Dialog/Sheet for knowledge points and delete confirmation.
- Use `sonner` for successful import, lesson completion, and review-added feedback.
- Use compact accessible progress for daily target.

### Phase 6: Verification

- Browser/IAB visual check on:
  - mobile narrow viewport
  - desktop 1440px viewport
  - empty state
  - at least one imported lesson state
- Copy budget check:
  - first viewport has one headline
  - one primary CTA
  - no implementation-status paragraph
  - no more than two visible metadata chips
- Interaction check:
  - start lesson
  - open details
  - add review
  - favorite/delete path
  - import/slicing entry remains discoverable

## Acceptance Criteria

- The user's eye lands on the current lesson/video card within one second.
- Visible first-viewport copy is reduced by at least 60%.
- The homepage has one high-emphasis card, not a board of competing cards.
- Progress is visible but not dominant.
- Version/build metadata is removed from the learning path.
- Knowledge points are discoverable but not competing with the video before the user asks for them.
- The implementation remains CSS Modules friendly, accessible, and easy for future AI agents to extend.

## Implementation Status

Completed on 2026-05-06:

- Homepage first viewport now centers on a single continue-learning stage.
- Version/build chips and implementation-detail copy were removed from the learning path.
- The old stats panel and full lesson feed were replaced by a focus card plus a compact next-up queue.
- Knowledge points remain available through a Radix Dialog detail layer instead of competing with the video card.
- Daily progress in the desktop rail now uses Radix Progress in a compact secondary position.
- CJK fonts are self-hosted through `@fontsource/noto-sans-sc` and `@fontsource/noto-sans-jp`.
- Completion/favorite/review feedback now uses `sonner` toasts.
- Verified with `npm run build` and browser screenshots at 1440px desktop and 390px mobile widths.

## References

- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- Apple Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Material Layout Structure: https://m1.material.io/layout/structure.html
- Material Accessibility Hierarchy: https://m1.material.io/usability/accessibility.html
- FluentU: https://www.fluentu.com/
- Lingopie: https://lingopie.com/
- Language Reactor review: https://www.classcentral.com/report/review-language-reactor/
- Radix Primitives: https://www.radix-ui.com/primitives/docs/overview/introduction
- Radix Styling: https://www.radix-ui.com/primitives/docs/guides/styling
- Motion for React: https://motion.dev/react
- TanStack Virtual: https://tanstack.com/virtual/v3/docs
- Embla Carousel: https://www.embla-carousel.com/docs
