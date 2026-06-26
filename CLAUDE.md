# CLAUDE.md — build guide for HTML Tools

This repo is a collection of small, independent, client-side browser tools with
a shared homepage. Static HTML/CSS/JS, no build step, hosted free on GitHub
Pages at https://ccrbd.github.io/HTML-Tools/ (served from repo root under
`/HTML-Tools/`, so **relative paths only**).

## Workflow for adding a new tool (do all of these)

1. **Create the page** at `tools/<slug>/index.html` (`<slug>` is kebab-case).
2. **Match the existing style.** Reuse the shared stylesheet and theme script:
   - `<link rel="stylesheet" href="../../assets/style.css">`
   - `<script src="../../assets/theme.js"></script>`
   - Include the anti-flash theme snippet in `<head>` (copy from any tool page).
   - Use the shared header (brand link to `../../`) and a `← All tools` back link.
   - If a tool needs its own rich UI (like the RAID Calculator), it may be
     self-contained, but it must still: be responsive, support light/dark using
     `data-theme` on `<html>`, and share the theme via the key below.
3. **Be responsive + mobile-friendly** with good UX, and **light/dark mode** on
   every page.
4. **Remember the user's last choice.** Persist tool state in `localStorage`
   under a namespaced key `html-tools-<slug>`. Theme is shared site-wide under
   the key `html-tools-theme` (never use a per-tool theme key).
5. **Register on the homepage.** Add one object to the `TOOLS` array in
   `index.html`:
   ```js
   { name: "My Tool", desc: "One line.", icon: "🛠️",
     href: "tools/my-tool/", keywords: "search terms" }
   ```
6. **Reusable UI bits** live in `assets/style.css` — e.g. `.panel`, `.btn`,
   `.stats`, `.howto`. Prefer these over inventing new styles. Add a
   `How to use` block (`.howto`) with brief steps when it helps.
7. **Test before declaring done:**
   - `python3 -m http.server` and confirm the homepage + new tool return 200.
   - Confirm the homepage lists the tool and its links resolve.
   - Confirm theme toggle persists across pages.
   - If the tool has non-trivial logic/math, write or run a quick test.
8. **Deploy.** Finish by giving the user the git command:
   ```bash
   git add -A && git commit -m "Add <tool>" && git push
   ```
   (Pushing happens on the user's machine — this environment has no GitHub access.)

## Structure

```
index.html              # Homepage; TOOLS array drives the grid + search
assets/style.css        # Shared styles + theme variables (light/dark)
assets/theme.js         # Shared dark/light toggle (key: html-tools-theme)
tools/<slug>/index.html # One folder per tool
.nojekyll               # Serve files as-is on GitHub Pages
```

## Conventions

- Theme: `data-theme="light|dark"` on `<html>`; colors via CSS variables.
- Storage keys: `html-tools-theme` (shared) and `html-tools-<slug>` (per tool).
- Keep tools self-contained and dependency-free where possible; no trackers,
  no external calls — everything runs locally in the browser.
- Public repo: never commit anything private.
