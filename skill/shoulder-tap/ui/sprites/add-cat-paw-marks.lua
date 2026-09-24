-- Add editable anime-style puff outlines to the current Aseprite sources.
-- Aseprite --batch --script add-cat-paw-marks.lua
local root=app.fs.filePath(debug.getinfo(1,'S').source:sub(2))
local black=app.pixelColor.rgba(0,0,0,255)
local positions={
  tap={{79,21,1},{86,33,2},{82,52,3}},
  pat={{78,23,1},{86,38,2},{83,63,3}},
  snap={{54,5,1},{71,13,2},{84,25,3}},
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
    if l.name=='Action marks - 2px' or l.name=='Action puffs - cat only' then previous[#previous+1]=l end
  end
  for _,l in ipairs(previous) do s:deleteLayer(l) end
  local base={}
  for f=1,9 do base[f]=Image(96,80,ColorMode.RGB);base[f]:drawSprite(s,f) end
  layer=s:newLayer();layer.name='Action puffs - cat only'
  local count=0
  for f=1,9 do
    local active=gesture=='snap' and (f==2 or f==4 or f==6 or f==8 or f==9)
      or gesture~='snap' and (f==3 or f==6 or f==8)
    if active then
      local marks=Image(96,80,ColorMode.RGB)
      for _,at in ipairs(positions[gesture]) do puff(marks,at) end
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
