# hxf-yuri.cn Visual Audit

Audit date: 2026-05-06

## Problems Observed

- Font rendering was inconsistent for Chinese UI text. The previous UI stack started with `M PLUS Rounded 1c`, which is friendly for Japanese kana but can make Chinese glyphs such as `复` look mismatched or fallback-heavy.
- The page used many warm glass cards, large radii, and heavy shadows at once. This made the interface feel cute but busy, and weakened the learning content hierarchy.
- The desktop first screen had three competing columns: side progress, hero copy, and a large right stats card. The eye did not get a clean reading path.
- The title was too large for the available center column, while supporting text and chips were also visually loud. The result felt crowded rather than calm.
- Repeated pill chips and floating white blocks made metadata feel more important than the video and sentence-learning content.
- The peach/cream background and decorative blobs made the app feel less crisp and introduced visual noise around the main cards.

## Optimization Direction

- Use a stable CJK-first sans-serif stack so Chinese and Japanese text render consistently across macOS, Windows, and common Android browsers.
- Move from heavy warm glassmorphism to a quieter editorial/product style: softer neutral green background, lower shadows, smaller radii, and simpler cards.
- Keep the homepage hierarchy focused on: daily promise, current lesson context, then video card.
- Let accent colors support state and navigation instead of dominating every card.
- Keep changes token-driven in `src/index.css` so future pages can inherit the visual system without one-off restyling.

## Implemented Changes

- Updated global color, radius, shadow, button, chip, and font tokens in `src/index.css`.
- Removed the decorative floating orb treatment and replaced it with a subtle structured background grid.
- Simplified sidebar card density, progress widgets, navigation active state, and mobile bars in `src/components/AppShell.module.css`.
- Rebalanced homepage hero columns, reduced title scale, simplified stats panel, and quieted the video card treatment in `src/pages/HomePage.module.css`.

## Follow-Up Ideas

- Treat the first CSS polish pass as a temporary improvement only. The deeper issue is homepage information architecture, so the next step is the simplification plan in `docs/homepage-simplification-research-plan.md`.
- Add a lightweight visual regression screenshot for the homepage once the design stabilizes.
- Review `NotesPage`, `ReviewPage`, `VocabPage`, and `ProfilePage` against the same tokens so secondary pages stay consistent.
- If stronger brand expression is needed later, add one deliberate illustration or cover system instead of many decorative card effects.

## Verification Notes

- Checked the live site first at `https://hxf-yuri.cn/` to identify the current visual issues.
- Verified the updated homepage locally with Vite at `http://127.0.0.1:5173/` on a narrow mobile-like viewport.
- Verified a 1440px desktop viewport and adjusted the homepage grid so the right stats panel no longer stretches to match the sidebar height.
