# Self-hosted fonts

Both files are the **variable** builds from Google Fonts, latin subset — one file
per family covering every weight the app uses, rather than five and two static
cuts.

| file | family | axis | used at |
|---|---|---|---|
| `PlusJakartaSans-Variable.woff2` | Plus Jakarta Sans | `wght 200–800` | 400, 500, 600, 700, 800 |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono | `wght 100–800` | 400, 500 |

Fetched from `fonts.gstatic.com` on 9 September 2026:

    plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2
    jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2

## Why they are in the repo rather than fetched at build time

`next/font/google` downloads from Google at **build time**, so the build needs
network access to a third party and fails without it. That happened here — a
build failed with `Failed to fetch 'Plus Jakarta Sans' from Google Fonts` and
then passed on retry with nothing changed, which is a check reporting on the
weather rather than on the code.

It matters more than an occasional retry. CI cannot be a merge gate while a
red run might mean somebody else's CDN was slow: a gate that blocks on the
weather is the shape that gets a gate switched off. Self-hosting removes the
dependency entirely — the build reads two files that are in the tree.

## Licence

Both are SIL Open Font License 1.1, which permits embedding and redistribution
and requires the licence to travel with the font. `PlusJakartaSans-OFL.txt` and
`JetBrainsMono-OFL.txt` are the upstream texts, kept separately because the
copyright lines differ.

## Updating

Take the `latin` `@font-face` block from the Google CSS API with a modern
browser user-agent, which yields woff2 rather than ttf:

    https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800
    https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800

Replace the file, keep the version in the table above current, and check the
first four bytes are `wOF2` before trusting the download.
