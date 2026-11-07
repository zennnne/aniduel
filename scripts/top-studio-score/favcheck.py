"""Favourite-studio check for Top Studio Score (spec §14). AniList favourite studios are never an input, so they are
held-out answers: for each user in fav_studios.json, each favourite studio that is a main studio of a counted entry
gets its rank (unranked: last + 1; producers with no entry are skipped). Prints the mean rank and how many are top 5.
usage: python -I favcheck.py [prototype flags, e.g. --franchise-p=0 --k=20]
fav_studios.json ({user: {"favStudios": [...]}}, the owner's AniList social list) and the list caches are gitignored.
Biased toward studios the user watched a lot (favourites have more votes), so it can't tune k (§14).

With --by=director (#101, docs/research/top-director-score.md) it checks Directors instead, against each cached user's
AniList favourite staff (favs_<user>.json) who are a Director of at least one counted title, and adds a matched check
that the vote-count bias can't reach: each favourite against every non-favourite Director of the same user with the
same number of Votes (±1), counting how often the favourite scores higher (0.5 = no signal)."""
import glob, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")


def prototype(user):
    return json.loads(subprocess.run([sys.executable, "-I", os.path.join(HERE, "prototype.py"), user, "--json", *sys.argv[1:]],
                                     capture_output=True, text=True, encoding="utf-8", check=True).stdout)


if "--by=director" not in sys.argv:
    favs = json.load(open(os.path.join(HERE, "fav_studios.json"), encoding="utf-8"))
    ranks = []
    for user, v in favs.items():
        if not v.get("favStudios") or not os.path.exists(os.path.join(HERE, f"list_{user}.json")): continue
        r = prototype(user)
        if "ranked" not in r: continue
        ranked = [s["name"] for s in r["ranked"]]
        ranks += [ranked.index(f) + 1 if f in ranked else len(ranked) + 1 for f in v["favStudios"] if f in r["counted"]]
    print(f"{len(ranks)} favourite studios: mean rank {sum(ranks) / len(ranks):.2f}, {sum(k <= 5 for k in ranks)} in top 5")
    sys.exit()

VERBOSE = "--verbose" in sys.argv
sys.argv = [a for a in sys.argv if a != "--verbose"]
ranks, wins, pairs, staff_total, users_with = [], 0.0, 0, 0, set()
for path in sorted(glob.glob(os.path.join(HERE, "list_*.json"))):
    user = os.path.basename(path)[5:-5]
    fav_staff = {s["id"]: s["name"]["full"] for s in json.load(open(os.path.join(HERE, f"favs_{user}.json"), encoding="utf-8"))["staff"]}
    staff_total += len(fav_staff)
    r = prototype(user)
    if "ranked" not in r: continue
    every = {sid: (S, n) for sid, S, n in r["every"]}
    ranked = [d["id"] for d in r["ranked"]]
    for f, name in fav_staff.items():
        if f not in every: continue  # not a Director of any counted title: a voice actor, writer, composer, ...
        users_with.add(user)
        rank = ranked.index(f) + 1 if f in ranked else len(ranked) + 1
        ranks.append(rank)
        S, n = every[f]
        rivals = [s for sid, (s, m) in every.items() if sid not in fav_staff and abs(m - n) <= 1]
        wins += sum(1.0 if S > s else 0.5 if S == s else 0.0 for s in rivals); pairs += len(rivals)
        if VERBOSE: print(f"{user:16} {name:24} votes {n:3}  rank {rank:3} of {len(ranked)}  S {S:+.2f}")
print(f"{staff_total} favourite staff across the lists; {len(ranks)} direct a counted title, from {len(users_with)} users")
if ranks:
    print(f"favourite Directors: mean rank {sum(ranks) / len(ranks):.2f}, {sum(k <= 5 for k in ranks)} in top 5, "
          f"{sum(k <= 10 for k in ranks)} in top 10; matched (same Votes ±1) win rate {wins / pairs:.3f} over {pairs} pairs")
