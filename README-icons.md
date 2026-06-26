## Restoring the app icon

`index.html` ships without the app icons embedded, to keep the file small and
easy for AI tools to work with. The icon code is saved separately in this
repo so you don't have to re-convert anything:

- `icons/icon-snippet.html` — the two icon `<link>` tags, already converted
  to base64, exactly as they were in the original file

### How to restore it

1. Open `icons/icon-snippet.html` in this repo.
2. Copy its entire contents.
3. Open `index.html` and paste it into the `<head>` section (anywhere
   between `<head>` and `</head>` is fine).
4. Save.

That's it — no conversion needed, it's the exact original `<link>` tags with
the base64 data already inside. Note this adds ~190KB back to `index.html`.

