-- Add editable 2px animation accents to the current Aseprite sources.
-- Aseprite --batch --script add-cat-paw-marks.lua
local root=app.fs.filePath(debug.getinfo(1,'S').source:sub(2))
local black=app.pixelColor.rgba(0,0,0,255)
local rays={
  tap={{{76,30},{80,33}},{{83,29},{83,33}},{{77,53},{81,56}}},
  pat={{{79,37},{82,33}},{{85,39},{85,43}},{{80,65},{83,68}}},
  snap={{{58,9},{58,13}},{{70,19},{74,15}},{{82,30},{87,28}}},
}
local function line(img,a,b)
  local x,y,tx,ty=a[1],a[2],b[1],b[2]
  local dx,dy=math.abs(tx-x),-math.abs(ty-y)
  local sx,sy=x<tx and 1 or -1,y<ty and 1 or -1
  local err=dx+dy
  while true do
    for ox=0,1 do for oy=0,1 do img:drawPixel(x+ox,y+oy,black) end end
    if x==tx and y==ty then break end
    local e=2*err
    if e>=dy then err=err+dy;x=x+sx end
    if e<=dx then err=err+dx;y=y+sy end
  end
end
for _,gesture in ipairs({'tap','pat','snap'}) do
  local file=root..'/skins/cat-paw/'..gesture..'.aseprite'
  local s=app.open(file)
  assert(s and s.width==96 and s.height==80 and #s.frames==9)
  local layer
  for _,l in ipairs(s.layers) do if l.name=='Action marks - 2px' then layer=l end end
  if layer then s:deleteLayer(layer) end
  local base={}
  for f=1,9 do base[f]=Image(96,80,ColorMode.RGB);base[f]:drawSprite(s,f) end
  layer=s:newLayer();layer.name='Action marks - 2px'
  local count=0
  for f=1,9 do
    local active=gesture=='snap' and (f==2 or f==4 or f==6 or f==8 or f==9)
      or gesture~='snap' and (f==3 or f==6 or f==8)
    if active then
      local marks=Image(96,80,ColorMode.RGB)
      for _,ray in ipairs(rays[gesture]) do line(marks,ray[1],ray[2]) end
      for y=0,79 do for x=0,95 do
        if app.pixelColor.rgbaA(marks:getPixel(x,y))>0 then
          assert(x>0 and x<95 and y>0 and y<79,'Mark outside safe bounds')
          assert(app.pixelColor.rgbaA(base[f]:getPixel(x,y))==0,gesture..' mark overlaps paw at '..x..','..y)
        end
      end end
      s:newCel(layer,f,marks,Point(0,0));count=count+1
    end
  end
  assert(count==(gesture=='snap' and 5 or 3))
  app.activeFrame=s.frames[gesture=='snap' and 2 or 3]
  s:saveAs(file);s:close()
end
