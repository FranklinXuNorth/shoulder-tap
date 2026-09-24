-- Add editable anime-style puff outlines to the current Aseprite sources.
-- Aseprite --batch --script add-cat-paw-marks.lua
local root=app.fs.filePath(debug.getinfo(1,'S').source:sub(2))
local black=app.pixelColor.rgba(0,0,0,255)
local white=app.pixelColor.rgba(255,255,255,255)
local positions={
  tap={{64,12,1},{74,24,2},{72,54,3}},
  pat={{65,17,1},{76,27,2},{75,65,3}},
  snap={{49,5,1},{66,12,2},{71,59,3}},
}
-- Three small, irregular, open arc silhouettes. Transparent centers/gaps are intentional.
local puffs={
  {'...###...','..##.....','.##...##.','##.....##','#.......#','........#','.##....##','..##..##.','....###..'},
  {'..###..','.##....','##...#.','#....##','......#','.##..##','..###..'},
  {'.##...','##..#.','#...##','.....#','.##.##','..###.'},
}
local function puff(img,at)
  for y,row in ipairs(puffs[at[3]]) do for x=1,#row do
    if row:sub(x,x)=='#' then img:drawPixel(at[1]+x-1,at[2]+y-1,black) end
  end end
end
for _,gesture in ipairs({'tap','pat','snap'}) do
  local file=root..'/skins/cat-paw/'..gesture..'.aseprite'
  local s=app.open(file)
  assert(s and s.width==96 and s.height==80 and #s.frames==9)
  local layer
  local previous={}
  for _,l in ipairs(s.layers) do
    if l.name=='Action marks - 2px' or l.name=='Action puffs - cat only' or l.name=='Puff white backing - 1px' then previous[#previous+1]=l end
  end
  for _,l in ipairs(previous) do s:deleteLayer(l) end
  local base={}
  for f=1,9 do base[f]=Image(96,80,ColorMode.RGB);base[f]:drawSprite(s,f) end
  local backing=s:newLayer();backing.name='Puff white backing - 1px'
  layer=s:newLayer();layer.name='Action puffs - cat only'
  local count=0
  for f=1,9 do
    local pawRight=-1
    for y=0,79 do for x=0,95 do
      if app.pixelColor.rgbaA(base[f]:getPixel(x,y))>0 then pawRight=math.max(pawRight,x) end
    end end
    local active=gesture=='snap' and (f==2 or f==4 or f==6 or f==8 or f==9)
      or gesture~='snap' and (f==3 or f==6 or f==8)
    if active then
      local marks=Image(96,80,ColorMode.RGB)
      local halo=Image(96,80,ColorMode.RGB)
      for _,at in ipairs(positions[gesture]) do puff(marks,at) end
      for y=0,79 do for x=0,95 do
        if app.pixelColor.rgbaA(marks:getPixel(x,y))>0 then
          assert(x>0 and x<95 and y>0 and y<79,'Mark outside safe bounds')
          assert(x<pawRight,gesture..' puff would take the rightmost pixel from the paw')
          assert(app.pixelColor.rgbaA(base[f]:getPixel(x,y))==0,gesture..' mark overlaps paw at '..x..','..y)
          for dy=-1,1 do for dx=-1,1 do
            local nx,ny=x+dx,y+dy
            assert(nx>0 and nx<95 and ny>0 and ny<79,'Puff backing outside safe bounds')
            assert(nx<pawRight,gesture..' white backing would take the rightmost pixel from the paw')
            if app.pixelColor.rgbaA(base[f]:getPixel(nx,ny))==0 then halo:drawPixel(nx,ny,white) end
          end end
        end
      end end
      s:newCel(backing,f,halo,Point(0,0))
      s:newCel(layer,f,marks,Point(0,0));count=count+1
    end
    local visible=Image(96,80,ColorMode.RGB);visible:drawSprite(s,f)
    local visibleRight=-1
    for y=0,79 do for x=0,95 do
      if app.pixelColor.rgbaA(visible:getPixel(x,y))>0 then visibleRight=math.max(visibleRight,x) end
    end end
    assert(visibleRight==pawRight,gesture..' effects changed screen-edge alignment in frame '..f)
  end
  assert(count==(gesture=='snap' and 5 or 3))
  app.activeFrame=s.frames[gesture=='snap' and 2 or 3]
  s:saveAs(file);s:close()
end
local report=io.open(root..'/cat-paw-marks-report.txt','w')
report:write('All 27 frames checked: paw owns rightmost opaque pixel.\nAll puff strokes and white backing are strictly left of paw right edge.\nNo mark overlaps paw; all effects stay inside canvas.\n')
report:close()
