# 2026-04-23 wordpack migration

This update replaces the old built-in JSON location packs with repo-root plain-text wordpacks.

## Layout

Supported shapes:

- single-file wordpack: `wordpacks/HP.txt`
- multilingual directory wordpack: `wordpacks/Spyfall1/<lang>.txt`

Current built-in packs:

- `wordpacks/Spyfall1/`
- `wordpacks/Spyfall2/`

Each text file is newline-separated and contains only the main words. Built-in pack roles are no longer used at runtime.

## Locale fallback

Directory wordpacks use this lookup order per player:

1. exact locale, for example `es-MX.txt`
2. base locale, for example `es.txt`
3. English fallback, `en.txt`

Single-file wordpacks are language-neutral and are shown as-is for every player.

## Important authoring rule

For multilingual directory wordpacks, every localized file must stay line-aligned with `en.txt`.

- line 1 in every language must describe the same canonical word
- blank lines are ignored
- misaligned locale files are skipped and the runtime falls back to English

Because the canonical ID is the line index, reordering one language file without reordering the others will break translation mapping.

## Runtime behavior

- built-in wordpacks now behave like packaged custom-word lists
- non-spies see the chosen word
- spies do not see the chosen word
- non-spy pack roles are no longer assigned or displayed
- spy guesses are matched by canonical word ID, so different players can see localized labels for the same hidden answer
