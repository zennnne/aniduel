# PROTOTYPE — Top Studios layout (#89)

Throwaway. Never merged into main. It answered one question: what the Top Studios result page looks like.
The decisions are in the comment on issue #89. Screenshots are in `screenshots/`.

## What's here

- `template.html`: the last round (page states), with every earlier verdict baked in. Data is injected at build time.
- `rounds/round-N.html`: the template as it stood in each grilling round (5 designs per round, switched with ←/→).
- `export.py`: runs the v2.7 scoring from `../prototype.py` on the cached lists and writes `data3.json`
  (ranked studios, watchlist, gate, per-title z / W / leave-one-out delta, the user's average vote).
- `covers.py`: fetches `coverImage` and `bannerImage` for those titles from AniList into `covers.json`.
- `build.py`: puts both into `template.html` → `top-studios-proto.html`.

## Run

The caches (`../list_*.json`, `../favs_*.json`) hold other people's lists and are gitignored, so are
`data3.json`, `covers.json` and the built HTML. Never commit them.

```
python export.py .. zennnne ManMode Keennaja data3.json
python -I covers.py
python build.py          # → top-studios-proto.html, open it in a browser
```

To build an earlier round, copy `rounds/round-N.html` over `template.html` first.
