"""Top Studio Score v2.8 (Python prototype). Spec: docs/research/top-studio-score.md
usage: python -I prototype.py <user> [--detail | --compact | --json] [--alpha=1.0] [--gamma=0.1]
       [--staff] [--prior=user|zero] [--k=<number>|est] [--franchise-p=0.3] [--cache=<dir>]
  --staff         add the fav-staff pseudo-vote (off by default; first fetch ~10 min)
  --prior=zero    v2.3 rule: put the k pseudo-votes at Z=0, not at the user's average entry (default since v2.4)
  --k=est         estimate k per user from within/between-studio variance
  --franchise-p=  v2.8: every entry of an n-entry franchise weighs n^-p (0 = v2.7)
  --json          print every ranked and watchlist studio at full precision, one JSON object per user
                  (read by scripts/top-studio-parity.ts)
  --cache=<dir>   read and write the caches there instead of next to this file
  --by=director   rank Directors instead of main studios (Top Directors, #101; docs/research/top-director-score.md).
                  Same formula; a title counts for each of its Directors. First run fetches directors_<user>.json.
  --gate=<n> --gate-floor=<n> --gate-target=<n> --label-top=<n> --margin=<x>
                  override the Gate (start, floor, how many must rank) and the Label base (top n, margin) of the mode
Caches AniList responses as list_/favs_/staff_/directors_<user>.json next to this file (gitignore them)."""
import json, math, os, re, sys, time, urllib.request, urllib.error
from collections import defaultdict, Counter
from statistics import median

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DETAIL = "--detail" in sys.argv
BY = next((a.split("=")[1] for a in sys.argv if a.startswith("--by=")), "studio")
assert BY in ("studio", "director"), f"--by={BY}: studio or director"
def flag(name, default, cast=float): return next((cast(a.split("=")[1]) for a in sys.argv if a.startswith(f"--{name}=")), default)
ALPHA = next((float(a.split("=")[1]) for a in sys.argv if a.startswith("--alpha=")), 1.0)
SD_FLOOR, MIN_SCORED = 0.5, 10
FAV_BONUS, MID_BAND, MID_W = 0.5, 0.5, 0.5
STAFF_Z = 1.0
GAMMA = next((float(a.split("=")[1]) for a in sys.argv if a.startswith("--gamma=")), 0.1)
LOVE_Z = 0.9  # "liked" entry (≈ 8+ on the owner's scale) for the love-count term
LOVE_SOFT = 0.15  # soft edge of the love count: sigmoid((Z - LOVE_Z) / LOVE_SOFT), no cliff at LOVE_Z
USE_STAFF = "--staff" in sys.argv
PRIOR = next((a.split("=")[1] for a in sys.argv if a.startswith("--prior=")), "user")
# Per-mode numbers (#101). Directors: option B, chosen by the owner on 2026-11-07 (docs/research/top-director-score.md §5):
# Gate 4 stepping to 3 until 10 rank, k 6, labels against the top 20 with a ±10-point margin.
MODE = {"studio": dict(k=13.1, gate=6, floor=4, target=10, top=20, margin=0.06),
        "director": dict(k=6.0, gate=4, floor=3, target=10, top=20, margin=0.10)}[BY]
K_FIXED = MODE["k"]  # pseudo-votes at the prior: "a studio needs this much evidence"; same for every user.
# v2.3 had 10.8 franchise votes; v2.5 counts entries, × 1.21 (owner's entries per franchise)
K_MODE = next((a.split("=")[1] for a in sys.argv if a.startswith("--k=")), str(K_FIXED))
K_EST_RANGE = (2.0, 8.0)
HIT_Z, FLOP_Z = 1.2, -1.0
# v2.8: an n-entry franchise (SEQUEL/PREQUEL chain inside the studio) weighs each entry × n^-p, whatever its order.
# One rule for every franchise; the gate still counts entries in full.
FRANCHISE_P = next((float(a.split("=")[1]) for a in sys.argv if a.startswith("--franchise-p=")), 0.3)
LABEL_MARGIN = flag("margin", MODE["margin"])  # hit/flop rate counts as high only if > baseline + 6 points (v2.4: 4 on franchises, v2.6: 6 on entries); 1 title shouldn't flip a label
MIN_N = flag("gate", MODE["gate"], int)  # entries a studio needs to be ranked (v2.4: 5 franchises × 1.21)
MIN_N_FLOOR = flag("gate-floor", MODE["floor"], int)  # v2.6: a small list lowers the gate one step at a time until 10 studios rank, never below this
GATE_TARGET = flag("gate-target", MODE["target"], int)
LABEL_TOP = flag("label-top", MODE["top"], int)
DROP_W = 0.5  # weight of an unscored drop (v2.5)
ROLE_W = {"Director": 3, "Chief Director": 3,
          "Series Composition": 2, "Storyboard": 2, "Key Animation": 2, "Episode Director": 2,
          "Script": 2, "Animation Director": 2, "Chief Animation Director": 2,
          "Character Design": 1, "Music": 1, "Art Director": 1}
HERE = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--cache=")), os.path.dirname(os.path.abspath(__file__)))
_last = [0.0]


def gql(q, v):
    body = json.dumps({"query": q, "variables": v}).encode()
    for attempt in range(8):
        wait = 2.1 - (time.time() - _last[0])
        if wait > 0: time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request("https://graphql.anilist.co", data=body, headers={
            "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "topstudio-script/2.0"})
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))["data"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(int(e.headers.get("Retry-After") or 10) + 1); continue
            raise
    raise RuntimeError("too many retries")


def cached(name, fn):
    p = os.path.join(HERE, name)
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    d = fn(); json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False); return d


LQ = """query($u:String,$c:Int){ MediaListCollection(userName:$u,type:ANIME,chunk:$c,perChunk:500){
 hasNextChunk lists{ entries{ mediaId status progress repeat score(format:POINT_10_DECIMAL)
  media{ id episodes duration title{romaji english}
   studios{edges{isMain node{id name}}}
   relations{edges{relationType node{id}}} } } } } }"""


def fetch_list(user):
    out, c = {}, 1
    while True:
        d = gql(LQ, {"u": user, "c": c})["MediaListCollection"]
        for l in d["lists"]:
            for e in l["entries"]: out[e["mediaId"]] = e
        if not d["hasNextChunk"]: return list(out.values())
        c += 1


def fetch_favs(user):
    res = {}
    for kind, sel in (("anime", "id"), ("staff", "id name{full}")):
        res[kind], p = [], 1
        while True:
            x = gql(f"query($u:String,$p:Int){{User(name:$u){{favourites{{{kind}(page:$p,perPage:25){{pageInfo{{hasNextPage}} nodes{{{sel}}}}}}}}}}}",
                    {"u": user, "p": p})["User"]["favourites"][kind]
            res[kind] += x["nodes"]
            if not x["pageInfo"]["hasNextPage"]: break
            p += 1
    return res


SQ = """query($id:Int,$p:Int){Staff(id:$id){staffMedia(type:ANIME,page:$p,perPage:50){pageInfo{hasNextPage}
 edges{staffRole node{id}}}}}"""


def fetch_staff_credits(staff):
    out = {}
    for i, s in enumerate(staff, 1):
        cr, p = [], 1
        while p <= 8:
            d = gql(SQ, {"id": s["id"], "p": p})["Staff"]["staffMedia"]
            cr += [[e["node"]["id"], e["staffRole"]] for e in d["edges"]]
            if not d["pageInfo"]["hasNextPage"]: break
            p += 1
        out[str(s["id"])] = cr
        print(f"  staff {i}/{len(staff)} {s['name']['full']}: {len(cr)} credits", file=sys.stderr)
    return out


# #101: staff credits for Top Directors. Flat: staff sits on the list query itself (held at 500 entries per chunk on
# the largest list, IustinMakihige), first page only, sorted by RELEVANCE, where a title's Directors come first (on a
# 150-title sample every title had its Director in the first 25; the credits past 25 were OP/ED directors and two
# part-season chief directors). Titles that left the list since list_<user>.json was cached are filled in by a paged
# Media query by id with the same staff selection. Only credits whose role mentions "irector" are kept.
DLQ = """query($u:String,$c:Int){ MediaListCollection(userName:$u,type:ANIME,chunk:$c,perChunk:500){
 hasNextChunk lists{ entries{ mediaId media{ staff(sort:[RELEVANCE],perPage:25){ edges{ role node{ id name{full} } } } } } } } }"""
DMQ = """query($ids:[Int],$p:Int){ Page(page:$p,perPage:50){ pageInfo{hasNextPage}
 media(id_in:$ids,type:ANIME){ id staff(sort:[RELEVANCE],perPage:25){ edges{ role node{ id name{full} } } } } } }"""


def keep_credits(staff):
    return [[e["node"]["id"], e["node"]["name"]["full"], e["role"]] for e in staff["edges"] if "irector" in e["role"]]


def fetch_directors(user, ids):
    out, c = {}, 1
    while True:
        d = gql(DLQ, {"u": user, "c": c})["MediaListCollection"]
        for l in d["lists"]:
            for e in l["entries"]: out[str(e["mediaId"])] = keep_credits(e["media"]["staff"])
        if not d["hasNextChunk"]: break
        c += 1
    missing = [i for i in ids if str(i) not in out]
    for b in range(0, len(missing), 50):
        for m in gql(DMQ, {"ids": missing[b:b + 50], "p": 1})["Page"]["media"]: out[str(m["id"])] = keep_credits(m["staff"])
    print(f"  {user}: {c} list chunk(s), {len(missing)} titles by id", file=sys.stderr)
    return {str(i): out.get(str(i), []) for i in ids}


def lse(zs, ws, k=0.0, prior_u=1.0):
    """Entropic mean of z with k pseudo-votes of utility prior_u (= e^(αZ) of the prior)."""
    return math.log((sum(w * math.exp(ALPHA * z) for z, w in zip(zs, ws)) + k * prior_u) / (sum(ws) + k)) / ALPHA


def sigmoid(x): return 1 / (1 + math.exp(-x))


def estimate_k(groups_zw):
    """Empirical-Bayes k = σ²_within / τ²_between over studios with ≥ 3 entries, clamped."""
    means, within = [], []
    for Z, W in groups_zw:
        if len(Z) < 3: continue
        sw = sum(W); m = sum(w * z for z, w in zip(Z, W)) / sw
        means.append((m, sw)); within.append((sum(w * (z - m) ** 2 for z, w in zip(Z, W)) / sw, sw))
    if len(means) < 3: return K_EST_RANGE[1]
    s2 = sum(v * w for v, w in within) / sum(w for _, w in within)
    gm = sum(m * w for m, w in means) / sum(w for _, w in means)
    vb = sum((m - gm) ** 2 for m, _ in means) / len(means)
    tau2 = vb - s2 * sum(1 / w for _, w in means) / len(means)
    k = s2 / tau2 if tau2 > 0 else K_EST_RANGE[1]
    return min(max(k, K_EST_RANGE[0]), K_EST_RANGE[1])


def franchise_roots(gs):
    """Index of each entry's franchise: entries of one studio joined by SEQUEL/PREQUEL."""
    ents = [g[0] for g in gs]
    ids = {x["mediaId"]: i for i, x in enumerate(ents)}
    par = list(range(len(ents)))
    def root(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i, x in enumerate(ents):
        for ed in x["media"]["relations"]["edges"]:
            if ed["relationType"] in ("SEQUEL", "PREQUEL") and ed["node"]["id"] in ids:
                par[root(i)] = root(ids[ed["node"]["id"]])
    return [root(i) for i in range(len(ents))]


def franchise_factors(gs):
    """v2.8: n^-p for every entry of an n-entry franchise."""
    roots = franchise_roots(gs)
    size = Counter(roots)
    return [size[r] ** -FRANCHISE_P for r in roots]


def love_count(gs, Z):
    """v2.7: soft count of loved *works*, not entries. Entries joined by SEQUEL/PREQUEL inside the studio
    are one franchise worth at most 1 (its best entry). Fav split (v2.1): in a franchise with ≥ 2 fav
    entries, each fav counts on its own; the non-fav rest stays one."""
    ents = [g[0] for g in gs]
    roots = franchise_roots(gs)
    favs = Counter(roots[i] for i, x in enumerate(ents) if x["fav"])
    best = {}
    for i, z in enumerate(Z):
        key = ("fav", i) if ents[i]["fav"] and favs[roots[i]] >= 2 else roots[i]
        best[key] = max(best.get(key, 0.0), sigmoid((z - LOVE_Z) / LOVE_SOFT))
    return sum(best.values())


def title(x): return x["media"]["title"]["english"] or x["media"]["title"]["romaji"]
def main_studios(e): return [ed["node"]["name"] for ed in e["media"]["studios"]["edges"] if ed["isMain"]]


DIRECTOR_ROLES = ("Director", "Chief Director", "Series Director")
# An opening or ending named in the parenthesis: OP, ED, OP2, ED1-ED3, "Opening", "Ending" (owner, #101)
OP_ED = re.compile(r"\b(?:OP|ED)\d*\b|\b(?i:opening|ending)s?\b")


def is_director(role):
    """#101: the role before any parenthesis is exactly one of DIRECTOR_ROLES ("Director (eps 1-6)" counts),
    and the parenthesis doesn't name an opening or ending ("Director (OP)", "Director (ED1, ED2)" don't)."""
    head, _, paren = role.partition("(")
    return head.strip() in DIRECTOR_ROLES and not OP_ED.search(paren)


def directors_of(credits):
    """Director keys of one title from its cached credits [[staff id, name, role], ...]: each person once, in credit
    order. The key is the name, or "name (id)" when two Directors on the list share a name (see run)."""
    seen = []
    for sid, _, role in credits:
        if is_director(role) and sid not in seen: seen.append(sid)
    return seen


def run(user):
    es = [e for e in cached(f"list_{user}.json", lambda: fetch_list(user)) if e["status"] != "PLANNING"]
    favs = cached(f"favs_{user}.json", lambda: fetch_favs(user))
    credits = cached(f"staff_{user}.json", lambda: fetch_staff_credits(favs["staff"])) if USE_STAFF and BY == "studio" else {}
    owners, ids_of = main_studios, {}
    if BY == "director":  # who a title counts for: its Directors, keyed by name ("name (id)" if two share a name)
        dcred = cached(f"directors_{user}.json", lambda: fetch_directors(user, [e["mediaId"] for e in es]))
        name_of = {sid: nm for cr in dcred.values() for sid, nm, _ in cr}
        director_ids = {sid for cr in dcred.values() for sid in directors_of(cr)}
        per_name = Counter(name_of[sid] for sid in director_ids)
        key = {sid: nm if per_name[nm] == 1 else f"{nm} ({sid})" for sid, nm in name_of.items()}
        # Only Directors: a non-Director credit can share a Director's name and key (#103's parity found one).
        ids_of = {key[sid]: sid for sid in director_ids}
        owners = lambda e: [key[sid] for sid in directors_of(dcred.get(str(e["mediaId"]), []))]
    fav_ids = {a["id"] for a in favs["anime"]}
    staff_name = {str(s["id"]): s["name"]["full"] for s in favs["staff"]}

    # ---- per-entry z, w
    scored = [e["score"] for e in es if e["score"] > 0]
    use_z = len(scored) >= MIN_SCORED
    if not use_z:  # too little to rank, as the app says (#91)
        if "--json" in sys.argv: print(json.dumps(dict(user=user, too_few_scored=len(scored))))
        else: print(f"\n## {user}: only {len(scored)} scored titles (needs {MIN_SCORED}), too little to rank")
        return
    mu = sum(scored) / len(scored) if scored else 0
    sd = max(math.sqrt(sum((s - mu) ** 2 for s in scored) / len(scored)), SD_FLOOR) if scored else 1
    for e in es:
        m, st = e["media"], e["status"]
        rep = max(e["repeat"] or 0, 1 if st == "REPEATING" else 0)
        e["has_score"] = use_z and e["score"] > 0
        if e["has_score"]:
            z = (e["score"] - mu) / sd
            if st == "DROPPED": z = min(z, -0.5)
        else:
            z = -1.0 if st == "DROPPED" else (0.5 if rep else 0.0)
        e["fav"] = e["mediaId"] in fav_ids
        if e["fav"]: z += FAV_BONUS
        eps = m["episodes"] or max(e["progress"] or 1, 1)
        if st == "DROPPED":  # a drop weighs what was actually watched (≥ 1 episode), not the whole show
            eps = min(max(e["progress"] or 1, 1), eps)
        w = math.log(1 + eps * (m["duration"] or 24) / 24) * min(1 + 0.5 * rep, 2)
        if st in ("CURRENT", "PAUSED"): w *= min((e["progress"] or 0) / eps, 1)
        if abs(z) < MID_BAND: w *= MID_W
        if not e["has_score"] and not e["fav"]:  # v2.5: an unscored entry counts only through a drop or a rewatch
            if st == "DROPPED": w *= DROP_W
            elif not rep: w = 0.0
        e["z"], e["w"] = z, w

    # ---- staff affinity (in-list works, production roles)
    by_id = {e["mediaId"]: e for e in es}
    A, A_who = defaultdict(float), defaultdict(Counter)
    for sid, cr in credits.items():
        per = defaultdict(float)
        for mid, role in cr:
            rw = ROLE_W.get(role.split(" (")[0].strip(), 0)
            if rw and mid in by_id:
                for s in owners(by_id[mid]): per[s] += rw
        tot = sum(per.values())
        for s, v in per.items():
            A[s] += v / tot; A_who[s][staff_name[sid]] += v / tot

    # ---- votes per studio: every entry is its own vote (v2.5), summaries and sequels included
    groups = defaultdict(list)
    for e in es:
        if e["w"] > 0:
            for s in owners(e): groups[s].append([e])
    allW = [math.sqrt(sum(x["w"] for x in g)) for gs in groups.values() for g in gs]
    scale = len(allW) / sum(allW)  # before the franchise factor: k stays "k average entries", not discounted ones
    FF = {s: franchise_factors(gs) for s, gs in groups.items()}
    ZW = {s: ([lse([x["z"] for x in g], [x["w"] for x in g]) for g in gs],
              [math.sqrt(sum(x["w"] for x in g)) * scale * f for g, f in zip(gs, FF[s])]) for s, gs in groups.items()}
    # v2.8: hit and flop rates are weighted by W without the mid-band halving (a neutral entry is still one watch)
    RW = {s: [w / math.sqrt(MID_W) if abs(g[0]["z"]) < MID_BAND else w for w, g in zip(ZW[s][1], gs)]
          for s, gs in groups.items()}

    if K_MODE == "est": k = estimate_k(ZW.values())
    else: k = float(K_MODE)
    if PRIOR == "user":  # average entry utility of this user; S = 0 means "an average studio for them"
        num = sum(w * math.exp(ALPHA * z) for Z, W in ZW.values() for z, w in zip(Z, W))
        u_bar = num / sum(w for _, W in ZW.values() for w in W)
    else:
        u_bar = 1.0
    base = math.log(u_bar) / ALPHA

    rows = []
    for s, gs in groups.items():
        Z, W = ZW[s]
        zs, ws = Z + ([STAFF_Z] if A[s] else []), W + ([A[s]] if A[s] else [])
        n_love = love_count(gs, Z)
        S = lse(zs, ws, k, u_bar) - base + GAMMA * math.log(1 + n_love)
        n = len(gs)
        rw = RW[s]
        items = [x for g in gs for x in g]
        sc = [x["score"] for x in items if x["has_score"]]
        rows.append(dict(S=S, name=s, n=n, ne=len(items), mean=(sum(sc) / len(sc) if sc else None),
                         hit=sum(r for z, r in zip(Z, rw) if z >= HIT_Z) / sum(rw),
                         flop=sum(r for z, r in zip(Z, rw) if z <= FLOP_Z) / sum(rw), rw=sum(rw),
                         fav=sum(x["fav"] for x in items), A=A[s], who=A_who[s],
                         best=max(items, key=lambda x: (x["z"], x["w"])),
                         parts=sorted(zip(Z, W, gs), key=lambda t: -t[1] * math.exp(ALPHA * t[0]))))
    rows.sort(key=lambda r: -r["S"])
    every = [(ids_of.get(r["name"]), r["S"], r["n"]) for r in rows]  # director mode: favcheck's matched check
    gate = MIN_N  # v2.6: lowered only for a user who would otherwise rank fewer than 10 studios
    while gate > MIN_N_FLOOR and sum(r["n"] >= gate for r in rows) < GATE_TARGET: gate -= 1
    watch = [r for r in rows if r["n"] < gate][:5]
    rows = [r for r in rows if r["n"] >= gate]
    top = rows[:LABEL_TOP]  # label baseline = pooled rates among top-20 eligible studios
    N = sum(r["rw"] for r in top)  # no ranked studio: baseline 0, as the app does
    mh, mf = (sum(r["hit"] * r["rw"] for r in top) / N, sum(r["flop"] * r["rw"] for r in top) / N) if N else (0.0, 0.0)
    for r in rows + watch:
        hi, fl = r["hit"] > mh + LABEL_MARGIN, r["flop"] > mf + LABEL_MARGIN
        r["tag"] = {(1, 0): "💎 Elite", (1, 1): "🎲 Bold", (0, 0): "🛡️ Reliable", (0, 1): "💤 Meh"}[(hi, fl)]

    if "--json" in sys.argv:
        studio = lambda r: dict(name=r["name"], S=r["S"], n=r["n"], hit=r["hit"], flop=r["flop"], tag=r["tag"].split()[1],
                                **({"id": ids_of[r["name"]]} if BY == "director" else {}))
        print(json.dumps(dict(user=user, gate=gate, u_bar=u_bar, counted=sorted(groups), ranked=[studio(r) for r in rows],
                              watchlist=[studio(r) for r in watch],
                              **({"every": every} if BY == "director" else {})), ensure_ascii=False))
        return
    if "--compact" in sys.argv:
        print(f"\n### {user}" + (f" (gate {gate})" if gate != MIN_N else ""))
        top_n = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--top=")), 10)
        for i, r in enumerate(rows[:top_n], 1):
            its = sorted([x for _, _, g in r["parts"] for x in g if x["has_score"]],
                         key=lambda x: (-x["score"], -x["z"]))[:3]
            ts = ", ".join(f"{title(x)} {x['score']:g}" for x in its)
            print(f"{i}. **{r['name']}** {r['S']:+.2f} {r['tag'].split()[0]} ({ts})")
        return
    print(f"\n## {user}  (entries={len(es)}, scored={len(scored)}, mean={mu:.2f}, sd={sd:.2f}, "
          f"gate={gate}, k={k:.1f} ({K_MODE}), prior={PRIOR} ln Ū={base:+.2f}, alpha={ALPHA}, gamma={GAMMA}, fav anime={len(fav_ids)}, fav staff={len(credits)}, "
          f"top{LABEL_TOP} baseline hit={mh:.0%} flop={mf:.0%})\n")
    print(f"| # | {BY.title()} | S | entries | mean | hit% | flop% | fav | staff A | type | best |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows[:10], 1):
        b = r["best"]
        print(f"| {i} | {r['name']} | {r['S']:+.2f} | {r['n']} | "
              f"{(format(r['mean'], '.1f') if r['mean'] is not None else '-')} | {r['hit']:.0%} | {r['flop']:.0%} | {r['fav']} | {r['A']:.2f} | {r['tag']} | "
              f"{title(b)} ({b['score'] or '-'}) |")
    print(f"\n🌱 น่าจับตา (< {gate} entries): " + " · ".join(f"{r['name']} {r['S']:+.2f} ({r['n']}, {r['tag']})" for r in watch))
    if DETAIL:
        for i, r in enumerate(rows[:10], 1):
            num = sum(W * math.exp(ALPHA * Z) for Z, W, _ in r["parts"])
            sn = r["A"] * math.exp(ALPHA * STAFF_Z)
            print(f"\n### {i}. {r['name']}  S={r['S']:+.2f}  {r['tag']}")
            if r["A"]:
                who = ", ".join(f"{n} {v:.2f}" for n, v in r["who"].most_common(5))
                print(f"- STAFF pseudo W={r['A']:.2f} share={sn / (num + sn + k * u_bar) * 100:4.1f}% :: {who}")
            for Z, W, g in r["parts"]:
                sh = W * math.exp(ALPHA * Z) / (num + sn + k * u_bar) * 100
                names = ", ".join(f"{title(x)} [{x['score'] or '-'}{'★' if x['fav'] else ''}"
                                  f"{'/D' if x['status'] == 'DROPPED' else ''} z{x['z']:+.1f}]"
                                  for x in sorted(g, key=lambda x: -x["z"]))
                print(f"- Z={Z:+.2f} W={W:.2f} share={sh:4.1f}% :: {names}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(encoding="utf-8")
    for u in ARGS: run(u)
