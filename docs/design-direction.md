# Two identities, three useful pages

Design review · September 6, 2026

## The direction

Raj's clip collection has its own identity. The public Cliplink template belongs with Cliplink's product page. Forcing all three into one brand would make the starter feel personal to someone else.

The approved personal collection uses Bricolage Grotesque, mist and cobalt, an oversized “Raj’s clips” masthead, and framed tiles. Search, RSS, and the half-circle theme control sit in its header. There is no view switch or visible clip count. Its footer SHA is centered across the page. This version shipped as `27c3cac`.

The public pair takes a brighter stationery direction: warm white, mulberry, butter yellow, and Gabarito. The paperclip mark, font, and paired light/dark colors match between the template and landing. Their layouts serve different jobs: a flowing feed with a narrow date margin in the template, and a broad yellow introduction with a flat folder-tab example on the landing page. Neither repeats the personal collection’s masthead or tile grid.

| Role       | Light     | Dark      |
| ---------- | --------- | --------- |
| Page       | `#FFFDF6` | `#261F24` |
| Text       | `#392E33` | `#FAF4E6` |
| Accent     | `#9D274B` | `#F0A5BC` |
| Muted text | `#716269` | `#C4B5BC` |
| Rule       | `#DBD2C3` | `#58464F` |

Yellow is a broad introduction surface on the landing and a small filter accent in the template. The landing headline is intentionally larger than the template’s title. Content, buttons, and controls share the same typographic character without forcing every page into one layout.

This is a design judgment, not a claim that one palette converts better than another.

## What the references contributed

- [Inspora’s Web collection](https://www.inspora.design/?category=Web), especially [its folder-component example](https://www.inspora.design/posts/1-13), prompted a useful filing interaction: switch between a link and a note, then mark the example as clipped. The implementation uses flat tabs and a small bookmark instead of reproducing the reference’s treatment.
- [Playdate](https://play.date/) was a reference for friendly, direct product presentation and a confident yellow surface. No product imagery, console shapes, or copy were reused.
- [Naipe Foundry’s Gabarito](https://github.com/naipefoundry/gabarito) gives the public pair a rounder, compact voice distinct from the personal collection’s Bricolage. The Latin variable font and its OFL notice are included locally.
- [Jakub Krehel's interface details](https://jakub.kr/writing/details-that-make-interfaces-feel-better) informed short, local feedback: a copy confirmation that keeps its footprint, a small pressed state, and reduced-motion support. There are no delayed reading surfaces or repeat-on-navigation entrances.
- [Elaya's landing-page design skill](https://github.com/elayadesign/ai-design-skills) was useful for clarifying the audience, action, and evidence. The implementation uses a working illustrative clip instead of invented testimonials or statistics. Its more elaborate visual recipes weren't a fit for this brief.
- [shadcn's theming guidance](https://ui.shadcn.com/docs/theming) informed paired surface/foreground variables. No component library is needed to implement those principles.
- [beUI](https://www.beui.dev/), [Rare UI](https://www.rareui.com/), and [Transitions](https://transitions.dev/) were interaction references, not dependencies. The stationery motif and brief button feedback are original CSS/SVG; no registry components or paid recipes were copied.
- `beautifului.dev` could not be reliably accessed during this research. It was not used as evidence.

## Product correctness matters as much as styling

The source audit found hardcoded personal identity in the public template, a missing general-purpose site configuration, and root-relative assets that would break under a GitHub Pages project path. The template now has a single configuration file and base-aware rendering, feeds, social images, and Markdown assets.

The CLI audit found that remote mode resolved a local workspace before choosing its publisher. Cliplink 0.2.0 chooses the mode first; regression tests cover remote publishing without a checkout and existing local modes. Onboarding keeps a clone step for customizing the site.

Setup also separates repository creation from hosting. `clip init` creates a public repository; the reader still selects GitHub Actions in Pages and pushes configuration. This follows [GitHub's custom-workflow model](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), rather than implying the CLI configures hosting itself.

## Boundaries

Saved content, schema, asset paths, and existing permalinks are preserved. The template's fictional examples stay outside the real collection, RSS, and search index. The site doesn't claim to download videos or archive whole articles.

Unused React effects were removed from the two Astro sites. Neither feed needs an animation library. The landing is static HTML/CSS with small scripts, not another app framework. Gabarito is self-hosted in the public pair; Bricolage is self-hosted in the personal collection. Their OFL notices stay alongside the font files. No license has been invented for the Cliplink CLI.

The personal collection is deployed, and the public template and landing have passed review. The landing now targets `https://cliplink.dev/`; domain and Pages setup still need verification during launch. Publishing the landing doesn't publish an npm version. Release steps are documented in [the landing-page guide](site.md).
