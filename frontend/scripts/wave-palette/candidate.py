"""Conservative anchor study; retains the original metre anchor positions and theme families."""
from metrics import color, MODELS

HEIGHTS = [1.2, 1.8, 2.4, 3, 3.6, 4.2, 5]

def rgb(h, anchors):
    hs = [0, .6, 1.2, 2.4, 5, 10]
    for i in range(len(hs)-1):
        if h <= hs[i+1]:
            t = (h-hs[i])/(hs[i+1]-hs[i])
            return [round(a+(b-a)*t) for a,b in zip(anchors[i],anchors[i+1])]
    return anchors[-1]

def score(anchors):
    return min(color(rgb(a,anchors),k,m).delta_e(color(rgb(b,anchors),k,m),method='2000') for a,b in zip(HEIGHTS,HEIGHTS[1:]) for k,m in MODELS)

beach = [[5,97,89],[13,166,148],[250,187,110],[230,95,49],[107,25,34],[255,242,230]]
light = [[199,222,240],[26,166,138],[31,125,224],[87,31,138],[242,84,144],[255,255,255]]
for theme,anchors in [('beach',beach),('light',light)]:
    print(theme,round(score(anchors),3),anchors)
    for a,b in zip(HEIGHTS,HEIGHTS[1:]):
        print(a,b,{k:round(color(rgb(a,anchors),k,m).delta_e(color(rgb(b,anchors),k,m),method='2000'),2) for k,m in MODELS})
