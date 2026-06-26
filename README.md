# HTML Tools

A growing collection of free, privacy-friendly browser tools. No sign-up, no
tracking — everything runs locally in the browser. Pure HTML/CSS/JS, no build
step.

**Live site:** https://ccrbd.github.io/HTML-Tools/

## Structure

```
/
├── index.html              # Homepage — lists all tools
├── assets/
│   ├── style.css           # Shared styles (light/dark via CSS variables)
│   └── theme.js            # Shared dark/light toggle (remembers choice)
├── tools/
│   └── word-counter/
│       └── index.html      # One folder per tool
├── .nojekyll               # Tell GitHub Pages to serve files as-is
└── README.md
```

## Conventions

- **Responsive + mobile-friendly** with light/dark mode on every page.
- **Remember the user's last choice** (theme, and tool input where useful)
  using `localStorage`. Keys are namespaced `html-tools-*`.
- **Relative paths only** so the site works under `/HTML-Tools/`.

## Adding a new tool

1. Create a folder: `tools/<tool-name>/index.html`.
2. Copy an existing tool page as a starting point. It should:
   - Link the shared stylesheet: `../../assets/style.css`
   - Link the shared theme script: `../../assets/theme.js`
   - Include the anti-flash inline snippet in `<head>` (copy from any page).
3. Register it on the homepage — add one object to the `TOOLS` array in
   `index.html`:

   ```js
   {
     name: "My Tool",
     desc: "What it does, in one line.",
     icon: "🛠️",
     href: "tools/my-tool/",
     keywords: "extra search terms"
   }
   ```

4. Commit and push — GitHub Pages redeploys automatically.

## Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## License

Free to use. Built for fun.
