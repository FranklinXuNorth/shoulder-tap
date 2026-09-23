-- Run with Aseprite --batch --script draw-glove.lua
-- Native pixel drawing: black / white / transparent, no antialiasing.
local out = app.fs.filePath(debug.getinfo(1, 'S').source:sub(2))
local s = Sprite(96, 80, ColorMode.RGB)
s.layers[1].name = 'Side-view glove - extended fingers and raised palm'
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
  img:drawPixel(x0+1,y0,c)
  img:drawPixel(x0,y0+1,c)
  img:drawPixel(x0+1,y0+1,c)
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
-- Reference pose: fingers together and extended, edge-on view; thumb opens below.
-- Keep the tap glove's 2px contour, rounded tips and rolled cuff.
polygon(base,{{24,59},{28,49},{34,40},{41,34},{50,24},{66,10},{74,6},{80,6},{85,9},{87,13},{87,17},{84,22},{74,32},{66,43},{61,49},{57,54},{61,52},{69,45},{75,42},{79,42},{83,45},{83,49},{80,53},{70,61},{62,68},{54,71},{43,72},{34,69}})
-- Two slim overlapping finger edges: four fingers read as one relaxed blade.
path(base,{{40,35},{51,25},{68,10},{74,8}},black)
path(base,{{47,37},{58,27},{74,12}},black)
-- Tiny fold at the front finger joint; no clenched-fist curls.
path(base,{{73,24},{77,27}},black)
-- Thumb web stays open, palm remains lifted behind the contact.
path(base,{{57,54},{52,58},{48,59}},black)
-- Familiar glove stitching, small enough for the side view.
path(base,{{34,47},{37,43}},black)
path(base,{{39,51},{42,47}},black)
path(base,{{44,55},{47,51}},black)
polygon(base,{{24,57},{29,58},{43,66},{44,70},{40,75},{35,77},{17,66},{17,62},{20,58}})
path(base,{{20,60},{24,61},{40,70}},black)
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
  path(hit,{{84,3},{82,1}},black)
  path(hit,{{90,4},{90,1}},black)
  path(hit,{{88,27},{86,29}},black)
 end
 s:newCel(marks,f,hit,Point(0,0))
 local border=Image(96,80,ColorMode.RGB)
 line(border,93,7,93,29,black)
 s:newCel(edge,f,border,Point(0,0))
end
local tag=s:newTag(1,#shifts);tag.name='knuckle-knock'
local palette=Palette(3)
palette:setColor(0,Color{r=0,g=0,b=0,a=0})
palette:setColor(1,Color{r=0,g=0,b=0,a=255})
palette:setColor(2,Color{r=255,g=255,b=255,a=255})
s:setPalette(palette)
app.activeFrame=s.frames[1]
s:saveAs(out..'/completion-hand.aseprite')
-- Static asset: hand only. Reference edge is not baked into production exports.
base:saveAs(out..'/completion-hand.png')
edge.isVisible=false
local sheet=Image(96*#shifts,80,ColorMode.RGB)
for f=1,#shifts do
 local flattened=Image(96,80,ColorMode.RGB)
 flattened:drawSprite(s,f)
 sheet:drawImage(flattened,Point((f-1)*96,0))
end
sheet:saveAs(out..'/completion-hand-sheet.png')
-- White presentation background only for the enlarged review image.
local preview=Image(96,80,ColorMode.RGB)
preview:clear(white)
preview:drawImage(base,Point(0,0))
preview:resize{width=576,height=480}
preview:saveAs(out..'/completion-hand-preview.png')
print('Created editable 96x80 hand with 9 frames, black/white/transparent.')
