-- Run with Aseprite --batch --script draw-glove.lua
-- Native pixel drawing: black / white / transparent, no antialiasing.
local out = app.fs.filePath(debug.getinfo(1, 'S').source:sub(2))
local s = Sprite(96, 80, ColorMode.RGB)
s.layers[1].name = 'Pointer glove - bold black and white'
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
-- Four-finger cartoon glove: broad index, two curled fingers, raised thumb.
polygon(base,{{27,60},{23,52},{15,44},{12,39},{12,34},{16,30},{21,30},{26,33},{33,40},{34,30},{37,25},{43,21},{81,21},{85,23},{87,26},{87,30},{85,33},{81,35},{60,35},{64,37},{67,41},{67,45},{65,48},{66,52},{64,57},{60,60},{55,64},{47,66},{36,66}})
-- Curled fingers, with generous white space instead of anatomical creases.
path(base,{{60,35},{53,35},{50,38},{50,42},{53,45},{65,48}},black)
path(base,{{53,46},{50,49},{50,53},{54,57},{61,58}},black)
-- Three short classic glove stitches on the back of the hand.
path(base,{{31,48},{34,53}},black)
path(base,{{37,45},{40,51}},black)
path(base,{{43,44},{45,49}},black)
-- Puffy, oversized cuff with a rolled lip.
polygon(base,{{24,56},{29,57},{42,65},{43,69},{39,74},{35,76},{17,65},{17,61},{20,57}})
path(base,{{20,59},{24,60},{39,69}},black)
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
  path(hit,{{84,15},{82,13}},black)
  path(hit,{{89,12},{89,9}},black)
  path(hit,{{85,39},{83,41}},black)
 end
 s:newCel(marks,f,hit,Point(0,0))
 local border=Image(96,80,ColorMode.RGB)
 line(border,93,19,93,38,black)
 s:newCel(edge,f,border,Point(0,0))
end
local tag=s:newTag(1,#shifts);tag.name='tap-tap-tap'
local palette=Palette(3)
palette:setColor(0,Color{r=0,g=0,b=0,a=0})
palette:setColor(1,Color{r=0,g=0,b=0,a=255})
palette:setColor(2,Color{r=255,g=255,b=255,a=255})
s:setPalette(palette)
app.activeFrame=s.frames[1]
s:saveAs(out..'/tap-glove.aseprite')
-- Static asset: hand only. Reference edge is not baked into production exports.
base:saveAs(out..'/tap-glove.png')
edge.isVisible=false
local sheet=Image(96*#shifts,80,ColorMode.RGB)
for f=1,#shifts do
 local flattened=Image(96,80,ColorMode.RGB)
 flattened:drawSprite(s,f)
 sheet:drawImage(flattened,Point((f-1)*96,0))
end
sheet:saveAs(out..'/tap-glove-sheet.png')
-- White presentation background only for the enlarged review image.
local preview=Image(96,80,ColorMode.RGB)
preview:clear(white)
preview:drawImage(base,Point(0,0))
preview:resize{width=576,height=480}
preview:saveAs(out..'/tap-glove-preview.png')
print('Created editable 96x80 hand with 9 frames, black/white/transparent.')
