-- After editing the .aseprite files, export these sources (do not rerun repair-paws.lua).
-- Aseprite --batch --script export-skins.lua
-- Then python make-webp.py to refresh lossless web previews.
local root=app.fs.filePath(debug.getinfo(1,'S').source:sub(2))
local pc=app.pixelColor
local report={}
for _,skin in ipairs({'cat-paw','glove'}) do
  for _,gesture in ipairs({'tap','pat','snap'}) do
    local file=root..'/skins/'..skin..'/'..gesture
    local s=app.open(file..'.aseprite')
    assert(s and s.width==96 and s.height==80 and #s.frames==9,file..' requires 96x80 and 9 frames')
    local sheet=Image(864,80,ColorMode.RGB)
    for f=1,9 do
      local img=Image(96,80,ColorMode.RGB);img:drawSprite(s,f)
      if skin=='cat-paw' and gesture=='snap' and f==2 then
        img:saveAs(root..'/cat-paw.png')
        local preview=Image(96,80,ColorMode.RGB)
        preview:clear(pc.rgba(255,255,255,255));preview:drawImage(img)
        preview:resize{width=576,height=480};preview:saveAs(root..'/cat-paw-preview.png')
      end
      for y=0,79 do for x=0,95 do
        local c=img:getPixel(x,y);local a=pc.rgbaA(c)
        assert(a==0 or (a==255 and ((pc.rgbaR(c)==0 and pc.rgbaG(c)==0 and pc.rgbaB(c)==0) or (pc.rgbaR(c)==255 and pc.rgbaG(c)==255 and pc.rgbaB(c)==255))),file..' palette violation')
        if skin=='cat-paw' and (x==0 or x==95 or y==0 or y==79) then assert(a==0,file..' clipped frame') end
      end end
      sheet:drawImage(img,Point((f-1)*96,0))
    end
    sheet:saveAs(file..'.png');s:close()
    report[#report+1]=skin..'/'..gesture..': 9 frames, 96x80, palette checked, exported from editable source'
  end
end
local f=io.open(root..'/aseprite-export-report.txt','w');f:write(table.concat(report,'\n')..'\n');f:close()
