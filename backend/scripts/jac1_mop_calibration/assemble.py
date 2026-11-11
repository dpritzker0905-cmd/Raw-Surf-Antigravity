import sys
D=sys.argv[1]
t=open(D+'/tables.md',encoding='utf8').read().strip().split('\n\n')
tpl=open(D+'/scripts/template.md',encoding='utf8').read()
t2='\n'.join(l for l in t[2].split('\n') if l.startswith('|') or not l.strip()=='')
t2='\n'.join(('\n**'+l.split(' ')[0]+'**\n') if not l.startswith('|') else l for l in t[2].split('\n'))
out=tpl.replace('@@T0@@',t[0]).replace('@@T1@@',t[1]).replace('@@T2@@',t2).replace('@@T3@@',t[3])
open(D+'/RESULTS.md','w',encoding='utf8').write(out)
