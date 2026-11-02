import json, time, urllib.request
d = json.load(open('data3.json', encoding='utf-8'))
ids = sorted({t['id'] for u in d.values() for r in u['ranked'] + u['watch'] for t in r['titles']})
print(len(ids), 'ids')
out = {}
Q = "query($ids:[Int],$p:Int){Page(page:$p,perPage:50){media(id_in:$ids){id coverImage{medium large color} bannerImage}}}"
for i in range(0, len(ids), 50):
    body = json.dumps({"query": Q, "variables": {"ids": ids[i:i+50], "p": 1}}).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request("https://graphql.anilist.co", data=body, headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "aniduel-proto/1"})
            res = json.load(urllib.request.urlopen(req, timeout=60)); break
        except Exception as e:
            print('retry', e); time.sleep(15)
    for m in res["data"]["Page"]["media"]:
        out[m["id"]] = [m["coverImage"]["large"], m["coverImage"]["color"], m["bannerImage"]]
    time.sleep(2.2)
json.dump(out, open('covers.json', 'w'), separators=(',', ':'))
print(len(out), 'covers')
