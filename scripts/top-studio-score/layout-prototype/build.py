import json
t=open('template.html',encoding='utf-8').read()
d=json.load(open('data3.json',encoding='utf-8')); c=json.load(open('covers.json'))
for u in d.values():
    for r in u['ranked']+u['watch']:
        for x in r['titles']:
            cv=c.get(str(x['id']))
            if cv: x['c'],x['col'],x['b']=cv
open('top-studios-proto.html','w',encoding='utf-8').write(t.replace('/*DATA*/',json.dumps(d,ensure_ascii=False,separators=(',',':'))))
