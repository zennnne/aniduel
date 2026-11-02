# Exports v2.7 results as JSON for the layout prototype (throwaway).
import sys, json, math
sys.argv = [sys.argv[0]] + sys.argv[1:]
PROTO = sys.argv[1]; users = sys.argv[2:-1]; OUT = sys.argv[-1]
sys.path.insert(0, PROTO)
import prototype as P
from collections import defaultdict

def export(user):
    es = [e for e in P.cached(f"list_{user}.json", None) if e["status"] != "PLANNING"]
    favs = P.cached(f"favs_{user}.json", None)
    fav_ids = {a["id"] for a in favs["anime"]}
    scored = [e["score"] for e in es if e["score"] > 0]
    use_z = len(scored) >= P.MIN_SCORED
    mu = sum(scored)/len(scored); sd = max(math.sqrt(sum((s-mu)**2 for s in scored)/len(scored)), P.SD_FLOOR)
    for e in es:
        m, st = e["media"], e["status"]
        rep = max(e["repeat"] or 0, 1 if st == "REPEATING" else 0)
        e["rep"] = rep
        e["has_score"] = use_z and e["score"] > 0
        if e["has_score"]:
            z = (e["score"]-mu)/sd
            if st == "DROPPED": z = min(z, -0.5)
        else:
            z = -1.0 if st == "DROPPED" else (0.5 if rep else 0.0)
        e["fav"] = e["mediaId"] in fav_ids
        if e["fav"]: z += P.FAV_BONUS
        eps = m["episodes"] or max(e["progress"] or 1, 1)
        if st == "DROPPED": eps = min(max(e["progress"] or 1, 1), eps)
        w = math.log(1 + eps*(m["duration"] or 24)/24) * min(1+0.5*rep, 2)
        if st in ("CURRENT", "PAUSED"): w *= min((e["progress"] or 0)/eps, 1)
        if abs(z) < P.MID_BAND: w *= P.MID_W
        if not e["has_score"] and not e["fav"]:
            if st == "DROPPED": w *= P.DROP_W
            elif not rep: w = 0.0
        e["z"], e["w"] = z, w
    groups = defaultdict(list)
    for e in es:
        if e["w"] > 0:
            for s in P.main_studios(e): groups[s].append([e])
    allW = [math.sqrt(sum(x["w"] for x in g)) for gs in groups.values() for g in gs]
    scale = len(allW)/sum(allW)
    ZW = {s: ([P.lse([x["z"] for x in g], [x["w"] for x in g]) for g in gs],
              [math.sqrt(sum(x["w"] for x in g))*scale for g in gs]) for s, gs in groups.items()}
    k = P.K_FIXED
    num = sum(w*math.exp(z) for Z, W in ZW.values() for z, w in zip(Z, W))
    u_bar = num/sum(w for _, W in ZW.values() for w in W); base = math.log(u_bar)
    def S_of(Z, W, gs):
        return P.lse(Z, W, k, u_bar) - base + P.GAMMA*math.log(1+P.love_count(gs, Z))
    rows = []
    for s, gs in groups.items():
        Z, W = ZW[s]; n = len(gs); S = S_of(Z, W, gs)
        tot = sum(w*math.exp(z) for z, w in zip(Z, W)) + k*u_bar
        titles = []
        for i, (z, w, g) in enumerate(zip(Z, W, gs)):
            x = g[0]
            loo = S - S_of(Z[:i]+Z[i+1:], W[:i]+W[i+1:], gs[:i]+gs[i+1:])
            titles.append(dict(id=x["mediaId"], t=P.title(x), score=x["score"] if x["has_score"] else None, status=x["status"],
                fav=x["fav"], rep=x["rep"], prog=x["progress"], eps=x["media"]["episodes"],
                z=round(z,3), W=round(w,3), share=round(w*math.exp(z)/tot,4), delta=round(loo,4)))
        titles.sort(key=lambda t: -t["delta"])
        rows.append(dict(name=s, S=round(S,4), n=n,
            hit=sum(z >= P.HIT_Z for z in Z)/n, flop=sum(z <= P.FLOP_Z for z in Z)/n, titles=titles))
    rows.sort(key=lambda r: -r["S"])
    gate = P.MIN_N
    while gate > P.MIN_N_FLOOR and sum(r["n"] >= gate for r in rows) < 10: gate -= 1
    watch = [r for r in rows if r["n"] < gate][:5]
    ranked = [r for r in rows if r["n"] >= gate]
    top = ranked[:20]; N = sum(r["n"] for r in top)
    mh = sum(r["hit"]*r["n"] for r in top)/N; mf = sum(r["flop"]*r["n"] for r in top)/N
    for r in ranked + watch:
        hi, fl = r["hit"] > mh+P.LABEL_MARGIN, r["flop"] > mf+P.LABEL_MARGIN
        r["label"] = {(1,0):"elite",(1,1):"bold",(0,0):"reliable",(0,1):"meh"}[(hi,fl)]
    counted = sum(1 for e in es if e["w"] > 0)
    scored_counted = sum(1 for e in es if e["w"] > 0 and e["has_score"])
    return dict(user=user, gate=gate, entries=len(es), scored=len(scored), mean=round(mu,2),
        scoredFrac=round(len(scored)/len(es),3), countedScoredFrac=round(scored_counted/counted,3),
        baseHit=round(mh,3), base=round(base,5), k=k, baseFlop=round(mf,3), ranked=ranked, watch=watch, rankedCount=len(ranked))

out = {u: export(u) for u in users}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
for u, d in out.items():
    print(u, "gate", d["gate"], "ranked", d["rankedCount"], "scoredFrac", d["scoredFrac"], d["countedScoredFrac"], "top:", [ (r["name"], round(r["S"],2), r["label"]) for r in d["ranked"][:5]])
