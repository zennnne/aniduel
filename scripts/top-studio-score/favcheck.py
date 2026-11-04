"""Favourite-studio check for Top Studio Score (spec §14). AniList favourite studios are never an input, so they are
held-out answers: for each user in fav_studios.json, each favourite studio that is a main studio of a counted entry
gets its rank (unranked: last + 1; producers with no entry are skipped). Prints the mean rank and how many are top 5.
usage: python -I favcheck.py [prototype flags, e.g. --franchise-p=0 --k=20]
fav_studios.json ({user: {"favStudios": [...]}}, the owner's AniList social list) and the list caches are gitignored.
Biased toward studios the user watched a lot (favourites have more votes), so it can't tune k (§14)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
favs = json.load(open(os.path.join(HERE, "fav_studios.json"), encoding="utf-8"))
ranks = []
for user, v in favs.items():
    if not v.get("favStudios") or not os.path.exists(os.path.join(HERE, f"list_{user}.json")): continue
    r = json.loads(subprocess.run([sys.executable, "-I", os.path.join(HERE, "prototype.py"), user, "--json", *sys.argv[1:]],
                                  capture_output=True, text=True, encoding="utf-8", check=True).stdout)
    if "ranked" not in r: continue
    ranked = [s["name"] for s in r["ranked"]]
    ranks += [ranked.index(f) + 1 if f in ranked else len(ranked) + 1 for f in v["favStudios"] if f in r["counted"]]
print(f"{len(ranks)} favourite studios: mean rank {sum(ranks) / len(ranks):.2f}, {sum(k <= 5 for k in ranks)} in top 5")
