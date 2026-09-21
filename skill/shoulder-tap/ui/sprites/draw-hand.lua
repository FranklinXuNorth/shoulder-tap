-- Run with Aseprite --batch --script draw-hand.lua
-- Native pixel drawing: black / white / transparent, no antialiasing.
local out = app.fs.filePath(debug.getinfo(1, 'S').source:sub(2))
local s = Sprite(96, 80, ColorMode.RGB)
s.layers[1].name = 'Hand - black and white'
local hand = s.layers[1]
local marks = s:newLayer(); marks.name = 'Tap - contact strokes'
local edge = s:newLayer(); edge.name = 'Screen edge - reference'
local black = app.pixelColor.rgba(0,0,0,255)
local white = app.pixelColor.rgba(255,255,255,255)
local function line(img,x0,y0,x1,y1,c)
 local dx,dy=math.abs(x1-x0),-math.abs(y1-y0)
 local sx,sy=x0<x1 and 1 or -1,y0<y1 and 1 or -1
 local err=dx+dy
 while true do
  img:drawPixel(x0,y0,c)
  if x0==x1 and y0==y1 then break end
  local e=2*err
  if e>=dy then err=err+dy;x0=x0+sx end
  if e<=dx then err=err+dx;y0=y0+sy end
 end
end
local function path(img,pts,c,closed)
 for i=1,#pts-1 do line(img,pts[i][1],pts[i][2],pts[i+1][1],pts[i+1][2],c) end
 if closed then line(img,pts[#pts][1],pts[#pts][2],pts[1][1],pts[1][2],c) end
end
local function polygon(img,p)
 for y=0,79 do for x=0,95 do
  local inside=false;local j=#p
  for i=1,#p do
   local a,b=p[i],p[j]
   if ((a[2]>y)~=(b[2]>y)) and x<(b[1]-a[1])*(y-a[2])/(b[2]-a[2])+a[1] then inside=not inside end
   j=i
  end
  if inside then img:drawPixel(x,y,white) end
 end end
 path(img,p,black,true)
end
local base=Image(96,80,ColorMode.RGB)
polygon(base,{{12,57},{21,42},{26,36},{34,31},{42,24},{47,22},{84,22},{87,23},{88,25},{88,27},{86,29},{53,29},{52,33},{61,33},{64,35},{64,38},{62,40},{65,42},{65,46},{62,48},{63,51},{62,55},{58,57},{51,57},{46,61},{39,63},{31,63},{25,70}})
path(base,{{52,33},{46,33},{43,35},{43,38},{46,40},{62,40}},black)
path(base,{{49,40},{47,42},{47,45},{50,47},{62,48}},black)
path(base,{{51,48},{49,50},{49,53},{52,55},{58,57}},black)
path(base,{{27,47},{32,44},{37,39},{39,36}},black)
path(base,{{16,51},{30,65}},black)
local shifts={0,2,4,0,2,4,0,4,0}
local times={250,90,90,150,90,90,150,90,300}
for f=1,#shifts do
 if f>1 then s:newEmptyFrame() end
 s.frames[f].duration=times[f]/1000
 local img=Image(96,80,ColorMode.RGB)
 img:drawImage(base,Point(shifts[f],0))
 s:newCel(hand,f,img,Point(0,0))
 local hit=Image(96,80,ColorMode.RGB)
 if shifts[f]==4 then
  path(hit,{{84,16},{82,14}},black)
  path(hit,{{89,13},{89,10}},black)
  path(hit,{{85,34},{83,36}},black)
 end
 s:newCel(marks,f,hit,Point(0,0))
 local border=Image(96,80,ColorMode.RGB)
 line(border,93,17,93,36,black)
 s:newCel(edge,f,border,Point(0,0))
end
local tag=s:newTag(1,#shifts);tag.name='tap-tap-tap'
local palette=Palette(3)
palette:setColor(0,Color{r=0,g=0,b=0,a=0})
palette:setColor(1,Color{r=0,g=0,b=0,a=255})
palette:setColor(2,Color{r=255,g=255,b=255,a=255})
s:setPalette(palette)
app.activeFrame=s.frames[1]
s:saveAs(out..'/tap-hand.aseprite')
-- Static asset: hand only. Reference edge is not baked into production exports.
base:saveAs(out..'/tap-hand.png')
edge.isVisible=false
local sheet=Image(96*#shifts,80,ColorMode.RGB)
for f=1,#shifts do
 local flattened=Image(96,80,ColorMode.RGB)
 flattened:drawSprite(s,f)
 sheet:drawImage(flattened,Point((f-1)*96,0))
end
sheet:saveAs(out..'/tap-hand-sheet.png')
print('Created editable 96x80 hand with 9 frames, black/white/transparent.')
