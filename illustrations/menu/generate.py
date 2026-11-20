import sys, os
out = sys.argv[1]
W,H = 300,420  # tile
PAD = 60
CW,CH = W+PAD*2, H+PAD*2

def blob(pts, t=0.5):
    """smooth closed path via catmull-rom"""
    n=len(pts); d=f"M{pts[0][0]},{pts[0][1]}"
    for i in range(n):
        p0=pts[i-1]; p1=pts[i]; p2=pts[(i+1)%n]; p3=pts[(i+2)%n]
        c1=(p1[0]+(p2[0]-p0[0])*t/3, p1[1]+(p2[1]-p0[1])*t/3)
        c2=(p2[0]-(p3[0]-p1[0])*t/3, p2[1]-(p3[1]-p1[1])*t/3)
        d+=f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]},{p2[1]}"
    return d+"Z"

def line(pts, t=0.5):
    n=len(pts); d=f"M{pts[0][0]},{pts[0][1]}"
    for i in range(n-1):
        p0=pts[max(i-1,0)]; p1=pts[i]; p2=pts[i+1]; p3=pts[min(i+2,n-1)]
        c1=(p1[0]+(p2[0]-p0[0])*t/3, p1[1]+(p2[1]-p0[1])*t/3)
        c2=(p2[0]-(p3[0]-p1[0])*t/3, p2[1]-(p3[1]-p1[1])*t/3)
        d+=f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]},{p2[1]}"
    return d

W_,B_='#fff','#111'
def P(d,fill=W_): return f'<path d="{d}" fill="{fill}"/>'
def S(d,w,col=W_): return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
def C(x,y,r,fill=W_): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>'
def E(x,y,rx,ry,rot=0,fill=W_): return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" transform="rotate({rot} {x} {y})" fill="{fill}"/>'

def svg(body, inverted=False, seed=3):
    bg = W_ if inverted else B_
    frame = f'<rect x="0" y="0" width="{W}" height="{H}" fill="{bg}"/>'
    if inverted: frame += f'<rect x="3" y="3" width="{W-6}" height="{H-6}" fill="none" stroke="{B_}" stroke-width="7"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CW}" height="{CH}" viewBox="0 0 {CW} {CH}">
<defs>
 <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="{seed}" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="{seed+7}" result="g"/>
  <feDisplacementMap in="d" in2="g" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
 </filter>
 <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="9"/>
  <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0"/></filter>
 <clipPath id="clip"><rect x="0" y="0" width="{W}" height="{H}"/></clipPath>
</defs>
<rect width="{CW}" height="{CH}" fill="#f4f2ec"/>
<g transform="translate({PAD},{PAD})" filter="url(#rough)">
 {frame}
 <g clip-path="url(#clip)">{body}</g>
</g>
<rect width="{CW}" height="{CH}" filter="url(#grain)" opacity="0.18" style="mix-blend-mode:multiply"/>
</svg>'''

dishes = {}

# 1 Sando platter: tamago + tuna watercress, platter bar
dishes['01-sando-platter'] = (svg(
  # platter bar
  P(blob([(18,352),(150,346),(282,352),(284,372),(150,378),(16,372)],0.3)) +
  # tamago sando (left, standing cut face) bread
  P(blob([(30,120),(80,96),(132,118),(134,320),(82,326),(28,318)],0.6)) +
  # yolk-y egg slab cut-out (black) with soft white yolk blob
  P(blob([(40,190),(82,180),(124,192),(124,252),(82,262),(40,250)],0.6),B_) +
  P(blob([(62,206),(98,200),(108,226),(88,244),(60,236)],0.8)) +
  # tuna sando (right, triangle) 
  P(blob([(160,326),(176,130),(196,118),(274,318),(270,330),(166,334)],0.25)) +
  # filling band
  P(line([(180,170),(196,200),(186,240),(200,280),(190,322)])+" L222,322 "+line([(222,322),(236,280),(222,240),(232,200),(204,160)])[1:]+"Z",B_) +
  # watercress leaves (white specks inside band)
  E(200,214,7,12,-20)+E(212,256,6,11,25)+E(204,296,6,10,-15)+E(196,180,5,8,10) +
  # chopstick-ish garnish leaf top
  P(blob([(214,40),(244,58),(236,82),(208,70)],0.7))
, seed=3), 'Sando platter for 2 — tamago + tuna watercress')

# 2 Coffee
dishes['02-coffee'] = (svg(
  # saucer
  C(148,268,104) + C(148,268,92,B_) +
  # cup rim (top view)
  C(148,268,74) + C(148,268,60,B_) +
  # latte art leaf
  P(blob([(148,224),(176,254),(170,292),(148,308),(126,292),(120,254)],0.7)) +
  S(line([(148,232),(148,300)]),5,B_) +
  S(line([(130,258),(148,270),(166,258)]),4,B_) + S(line([(132,280),(148,290),(164,280)]),4,B_) +
  # handle
  P(blob([(212,240),(236,232),(244,250),(220,260)],0.6)) +
  # steam squiggles
  S(line([(120,140),(134,112),(116,84),(130,54)]),12) +
  S(line([(172,140),(160,112),(180,84),(166,54)]),12) +
  # beans
  E(52,90,15,22,-30)+S(line([(46,76),(56,90),(50,104)]),3,B_) +
  E(250,370,13,19,40)+S(line([(256,358),(246,370),(252,382)]),3,B_)
, seed=5), 'Coffee of choice')

# 3 Chicken wings
def wing(cx,cy,rot,s=1):
    g = f'<g transform="translate({cx},{cy}) rotate({rot}) scale({s})">'
    g += P(blob([(-34,-60),(0,-74),(34,-58),(38,-6),(16,30),(8,62),(-8,62),(-16,30),(-38,-6)],0.7))
    g += C(-10,74,14)+C(10,74,14)   # bone knob
    g += S(line([(-18,-40),(-4,-20),(-10,4)]),5,B_)  # crispy streak
    return g+'</g>'
dishes['03-chicken-wings'] = (svg(
  wing(90,130,-25) + wing(210,170,30,0.95) + wing(130,300,-70,0.9) +
  # lemon wedge
  P(blob([(222,300),(278,318),(262,360),(232,352)],0.3)) +
  S(line([(232,314),(254,340)]),3,B_)+S(line([(246,312),(260,338)]),3,B_)
, seed=11), 'Oven baked chicken wings')

# 4 Mushroom pot pie (inverted tile, black shapes)
dishes['04-mushroom-pot-pie'] = (svg(
  # ramekin
  P(blob([(40,250),(150,240),(260,250),(250,360),(150,372),(50,360)],0.5),B_) +
  S(line([(70,280),(70,340)]),8,W_)+S(line([(110,280),(110,350)]),8,W_)+S(line([(150,280),(150,352)]),8,W_)+S(line([(190,280),(190,350)]),8,W_)+S(line([(230,280),(230,340)]),8,W_) +
  # puff crust dome
  P(blob([(26,250),(60,170),(150,130),(240,170),(274,250),(150,268)],0.7),B_) +
  # vent slits
  S(line([(110,200),(124,184)]),9,W_)+S(line([(144,190),(150,172)]),9,W_)+S(line([(178,200),(186,184)]),9,W_) +
  # little mushroom on top
  P(blob([(118,96),(150,66),(184,96),(150,104)],0.7),B_) + P(blob([(140,100),(160,100),(162,128),(138,128)],0.5),B_)
, inverted=True, seed=13), 'Mushroom pot pie')

# 5 Kimchi jar
dishes['05-kimchi'] = (svg(
  # lid
  P(blob([(84,60),(216,60),(220,96),(80,96)],0.2)) +
  # jar
  P(blob([(70,110),(230,110),(250,170),(246,350),(150,372),(54,350),(50,170)],0.6)) +
  # cabbage leaves – wavy black ribbons
  S(line([(76,170),(120,150),(150,190),(196,160),(232,186)]),16,B_) +
  S(line([(70,240),(110,214),(140,252),(190,224),(236,256)]),16,B_) +
  S(line([(72,310),(116,288),(150,322),(196,296),(230,320)]),16,B_) +
  # chili flecks
  C(100,192,5,B_)+C(176,206,4,B_)+C(126,272,5,B_)+C(208,278,4,B_)+C(160,346,4,B_)+C(92,346,3,B_)
, seed=17), 'Homemade kimchi')

# 6 Caprese with burrata
def tomato(x,y,r):
    import math
    o=C(x,y,r)
    for i in range(4):
        a=math.radians(i*90+45); px=x+math.cos(a)*r*0.45; py=y+math.sin(a)*r*0.45
        o+=E(px,py,r*0.26,r*0.16,i*90+45,B_)
    return o
dishes['06-caprese-burrata'] = (svg(
  tomato(72,90,40)+tomato(232,112,38)+tomato(70,330,38)+tomato(236,330,40) +
  # burrata
  P(blob([(100,190),(150,152),(206,176),(218,238),(176,278),(110,272),(84,232)],0.8)) +
  # torn opening
  P(blob([(132,210),(170,198),(184,226),(160,248),(130,240)],0.9),B_) +
  P(blob([(146,218),(166,214),(170,232),(150,238)],0.9)) +
  # basil leaves
  P(blob([(230,190),(274,214),(284,256),(246,238)],0.6)) + S(line([(236,196),(278,250)]),3,B_) +
  P(blob([(40,180),(66,222),(52,262),(26,222)],0.6)) + S(line([(42,186),(46,256)]),3,B_) +
  # oil drops
  C(150,110,6)+C(126,128,4)+C(176,306,5)
, seed=21), 'Caprese salad with burrata')

# 7 Cheesy garlic croissant bake
def croissant(x,y,rot,s=1):
    g=f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
    segs=[(-54,18,16,11,-60),(-34,-6,22,18,-35),(0,-16,28,24,0),(34,-6,22,18,35),(54,18,16,11,60)]
    for (a,b,rx,ry,r) in segs: g+=E(a,b,rx,ry,r)
    for (a,b) in [(-46,6),(-20,-10),(20,-10),(46,6)]:
        g+=S(line([(a-2*(1 if a<0 else -1),b-12),(a+2*(1 if a<0 else -1),b+12)]),5,B_)
    return g+'</g>'
dishes['07-cheesy-garlic-croissant-bake'] = (svg(
  # baking dish rim
  P(blob([(24,120),(150,108),(276,120),(282,350),(150,362),(18,350)],0.3)) +
  P(blob([(44,140),(150,130),(256,140),(260,330),(150,340),(40,330)],0.3),B_) +
  croissant(104,206,-12,0.9)+croissant(202,222,14,0.9)+croissant(150,300,0,1.0) +
  # cheese drips
  C(150,240,8)+C(70,262,6)+C(232,276,7)+C(80,318,5) +
  # garlic bulb on top
  P(blob([(150,30),(176,62),(170,92),(150,98),(130,92),(124,62)],0.7)) +
  S(line([(150,50),(150,94)]),3,B_)+S(line([(140,62),(136,92)]),3,B_)+S(line([(160,62),(164,92)]),3,B_) +
  S(line([(150,32),(150,14)]),5)
, seed=27), 'Cheesy garlic croissant bake')

for k,(s,_) in dishes.items():
    open(os.path.join(out,k+'.svg'),'w').write(s)
print("ok")
