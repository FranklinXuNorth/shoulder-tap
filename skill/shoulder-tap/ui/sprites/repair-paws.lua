-- Native Aseprite pixel cleanup and editable animation sources.
-- Aseprite --batch --script repair-paws.lua
local root = app.fs.filePath(debug.getinfo(1, 'S').source:sub(2))
local W,H=96,80
local pc=app.pixelColor
local BLACK=pc.rgba(0,0,0,255)
local WHITE=pc.rgba(255,255,255,255)
local function blank() return Image(W,H,ColorMode.RGB) end
local function load(path)
  local s=app.open(path)
  assert(s,'Cannot open '..path)
  local image=Image(s.width,s.height,ColorMode.RGB)
  image:drawSprite(s,1)
  s:close()
  return image
end
local function line(img,x0,y0,x1,y1,width)
  local dx,dy=math.abs(x1-x0),-math.abs(y1-y0)
  local sx,sy=x0<x1 and 1 or -1,y0<y1 and 1 or -1
  local err=dx+dy
  while true do
    for oy=0,width-1 do for ox=0,width-1 do
      if x0+ox>=0 and x0+ox<W and y0+oy>=0 and y0+oy<H then img:drawPixel(x0+ox,y0+oy,BLACK) end
    end end
    if x0==x1 and y0==y1 then break end
    local e=2*err
    if e>=dy then err=err+dy;x0=x0+sx end
    if e<=dx then err=err+dx;y0=y0+sy end
  end
end
local function path(img,points,width)
  for i=1,#points-1 do line(img,points[i][1],points[i][2],points[i+1][1],points[i+1][2],width or 2) end
end
local function pad(img,p)
  for y=0,H-1 do for x=0,W-1 do
    local inside=false;local j=#p
    for i=1,#p do
      local a,b=p[i],p[j]
      if ((a[2]>y)~=(b[2]>y)) and x<(b[1]-a[1])*(y-a[2])/(b[2]-a[2])+a[1] then inside=not inside end
      j=i
    end
    if inside then img:drawPixel(x,y,BLACK) end
  end end
  path(img,p,1);line(img,p[#p][1],p[#p][2],p[1][1],p[1][2],1)
end
local function opaque(img,x,y)
  return x>=0 and x<W and y>=0 and y<H and pc.rgbaA(img:getPixel(x,y))>0
end
local function clean(name)
  local reference=load(root..'/cat-paw-poses/'..name..'.png')
  local mask=blank()
  for y=0,H-1 do for x=0,W-1 do if opaque(reference,x,y) then mask:drawPixel(x,y,WHITE) end end end
  -- Fill accidental enclosed transparent pinholes; exterior finger gaps remain transparent.
  local seen={};local queue={{0,0}};seen[0]=true;local head=1
  while head<=#queue do
    local p=queue[head];head=head+1
    for _,d in ipairs({{1,0},{-1,0},{0,1},{0,-1}}) do
      local x,y=p[1]+d[1],p[2]+d[2]
      if x>=0 and x<W and y>=0 and y<H and not seen[y*W+x] and not opaque(mask,x,y) then
        seen[y*W+x]=true;queue[#queue+1]={x,y}
      end
    end
  end
  for y=0,H-1 do for x=0,W-1 do if not seen[y*W+x] then mask:drawPixel(x,y,WHITE) end end end
  local ink=blank();local details=blank()
  for y=0,H-1 do for x=0,W-1 do if opaque(mask,x,y) then
    local edge=false
    for dy=-2,2 do for dx=-2,2 do
      if math.abs(dx)+math.abs(dy)<=2 and not opaque(mask,x+dx,y+dy) then edge=true end
    end end
    if edge then ink:drawPixel(x,y,BLACK) end
  end end end
  -- Redraw coherent toe creases and pad silhouettes directly on native pixels.
  if name=='tap-ready' or name=='tap-contact' then
    path(details,{{37,29},{37,34},{38,37},{40,39}})
    path(details,{{54,26},{52,29},{50,32},{50,35}})
    local d=name=='tap-contact' and 1 or 0
    path(details,{{65+d,36},{62+d,38},{59+d,40},{59+d,41}})
  elseif name=='pat-ready' then
    path(details,{{42,29},{42,34},{44,37},{45,39}})
    path(details,{{64,27},{61,32},{57,36},{55,38}})
    path(details,{{74,39},{70,41},{66,43},{62,45}})
    pad(details,{{60,25},{62,26},{61,29},{58,33},{56,34},{56,31},{58,27}})
    pad(details,{{72,33},{74,34},{73,37},{70,40},{68,40},{68,37}})
    pad(details,{{77,45},{78,46},{77,50},{74,52},{72,52},{73,48}})
    pad(details,{{59,47},{62,48},{64,51},{64,53},{59,54},{55,56},{53,55},{53,52},{55,49}})
  elseif name=='pat-contact' then
    path(details,{{49,38},{48,41},{49,44},{50,46}})
    path(details,{{68,39},{66,43},{62,46},{60,47}})
    path(details,{{77,49},{74,51},{71,52},{67,52}})
    pad(details,{{65,37},{67,38},{66,41},{63,43},{61,43},{62,40}})
    pad(details,{{75,44},{77,45},{76,48},{73,49},{71,49},{72,46}})
    pad(details,{{82,54},{83,55},{82,58},{79,59},{77,59},{78,56}})
    pad(details,{{60,55},{63,54},{67,56},{69,58},{69,60},{63,61},{58,63},{55,62},{55,59}})
  elseif name=='snap-release' then
    path(details,{{43,28},{44,32},{46,35},{47,37}})
    path(details,{{62,27},{61,31},{60,35},{60,37}})
    path(details,{{73,39},{70,41},{67,43},{66,45}})
    pad(details,{{39,31},{41,32},{43,36},{42,40},{40,41},{37,39},{36,35},{37,32}})
    pad(details,{{54,23},{57,25},{58,28},{57,32},{54,34},{51,32},{50,29},{51,25}})
    pad(details,{{68,30},{71,32},{71,36},{68,40},{65,40},{63,37},{64,33}})
    pad(details,{{72,43},{75,44},{76,47},{73,51},{70,52},{67,50},{67,47},{69,44}})
    pad(details,{{53,39},{56,40},{57,44},{60,46},{61,50},{62,53},{60,56},{56,56},{53,53},{51,51},{46,51},{42,49},{41,46},{44,43},{48,42}})
  elseif name=='snap-ready' then
    path(details,{{42,35},{46,37},{49,40},{50,43}})
    path(details,{{56,31},{56,36},{55,40},{54,43}})
    path(details,{{66,41},{62,44},{61,47},{62,49}})
    pad(details,{{50,34},{52,35},{53,38},{51,40},{49,38},{49,36}})
    pad(details,{{59,37},{61,38},{60,41},{58,42},{58,39}})
    pad(details,{{43,41},{46,42},{46,44},{43,43},{42,42}})
    pad(details,{{66,46},{67,47},{65,49},{63,49},{63,47}})
    pad(details,{{51,44},{55,44},{59,46},{60,49},{61,52},{61,55},{58,56},{55,54},{52,52},{47,51},{42,49},{42,47},{46,46}})
  end
  -- Details are clipped to the paw, never create detached marks outside it.
  for y=0,H-1 do for x=0,W-1 do if not opaque(mask,x,y) then details:drawPixel(x,y,0) end end end
  local merged=blank();merged:drawImage(mask);merged:drawImage(ink);merged:drawImage(details)
  -- Remove enclosed one/two-pixel white pinholes at pad/outline joins.
  local visited={}
  for y=0,H-1 do for x=0,W-1 do
    if merged:getPixel(x,y)==WHITE and not visited[y*W+x] then
      local q={{x,y}};visited[y*W+x]=true;local h=1
      while h<=#q do
        local p=q[h];h=h+1
        for _,d in ipairs({{1,0},{-1,0},{0,1},{0,-1}}) do
          local nx,ny=p[1]+d[1],p[2]+d[2]
          if nx>=0 and nx<W and ny>=0 and ny<H and not visited[ny*W+nx] and merged:getPixel(nx,ny)==WHITE then
            visited[ny*W+nx]=true;q[#q+1]={nx,ny}
          end
        end
      end
      if #q<=2 then for _,p in ipairs(q) do details:drawPixel(p[1],p[2],BLACK);merged:drawPixel(p[1],p[2],BLACK) end end
    end
  end end
  merged:saveAs(root..'/cat-paw-poses/'..name..'.png')
  return {mask,ink,details,merged,reference}
end
local names={'tap-ready','tap-contact','pat-ready','pat-contact','snap-ready','snap-release'}
local poses={};for _,name in ipairs(names) do poses[name]=clean(name) end
local times={250,90,90,150,90,90,150,90,300}
local specs={
  tap={{'tap-ready',0,0},{'tap-ready',1,0},{'tap-contact',2,0},{'tap-ready',0,0},{'tap-ready',1,0},{'tap-contact',2,0},{'tap-ready',0,0},{'tap-contact',2,0},{'tap-ready',0,0}},
  pat={{'pat-ready',0,-2},{'pat-ready',2,0},{'pat-contact',2,0},{'pat-ready',0,-2},{'pat-ready',2,0},{'pat-contact',2,0},{'pat-ready',0,-2},{'pat-contact',2,0},{'pat-ready',0,-2}},
  snap={{'snap-ready',0,0},{'snap-release',0,0},{'snap-ready',0,0},{'snap-release',0,0},{'snap-ready',0,0},{'snap-release',0,0},{'snap-ready',0,0},{'snap-release',0,0},{'snap-release',0,0}}
}
local palette=Palette(3)
palette:setColor(0,Color{r=0,g=0,b=0,a=0});palette:setColor(1,Color{r=0,g=0,b=0,a=255});palette:setColor(2,Color{r=255,g=255,b=255,a=255})
for _,gesture in ipairs({'tap','pat','snap'}) do
  local s=Sprite(W,H,ColorMode.RGB)
  local fill=s.layers[1];fill.name='White fur'
  local contour=s:newLayer();contour.name='Continuous 2px outline'
  local detail=s:newLayer();detail.name='Toe creases and pads'
  local reference=s:newLayer();reference.name='Before repair (hidden)';reference.isVisible=false
  for f,spec in ipairs(specs[gesture]) do
    if f>1 then s:newEmptyFrame() end
    s.frames[f].duration=(gesture=='snap' and 250 or times[f])/1000
    local p=poses[spec[1]];local pos=Point(spec[2],spec[3])
    s:newCel(fill,f,p[1],pos);s:newCel(contour,f,p[2],pos);s:newCel(detail,f,p[3],pos);s:newCel(reference,f,p[5],pos)
  end
  s:setPalette(palette);s:newTag(1,9).name=gesture
  app.activeFrame=s.frames[1]
  s:saveAs(root..'/skins/cat-paw/'..gesture..'.aseprite')
  local sheet=Image(W*9,H,ColorMode.RGB)
  for f=1,9 do local img=blank();img:drawSprite(s,f);sheet:drawImage(img,Point((f-1)*W,0)) end
  sheet:saveAs(root..'/skins/cat-paw/'..gesture..'.png');s:close()
end
-- Import the CURRENT glove exports exactly, rather than stale historical generators.
for _,gesture in ipairs({'tap','pat','snap'}) do
  local sheet=load(root..'/skins/glove/'..gesture..'.png')
  local s=Sprite(W,H,ColorMode.RGB)
  local fill=s.layers[1];fill.name='White glove fill'
  local ink=s:newLayer();ink.name='Black outline and details'
  for f=1,9 do
    if f>1 then s:newEmptyFrame() end
    s.frames[f].duration=(gesture=='snap' and 250 or times[f])/1000
    local whites,blacks=blank(),blank()
    for y=0,H-1 do for x=0,W-1 do
      local c=sheet:getPixel((f-1)*W+x,y)
      if pc.rgbaA(c)>0 then
        if pc.rgbaR(c)==0 then blacks:drawPixel(x,y,c) else whites:drawPixel(x,y,c) end
      end
    end end
    s:newCel(fill,f,whites,Point(0,0));s:newCel(ink,f,blacks,Point(0,0))
  end
  s:setPalette(palette);s:newTag(1,9).name=gesture
  app.activeFrame=s.frames[1];s:saveAs(root..'/skins/glove/'..gesture..'.aseprite')
  for f=1,9 do local check=blank();check:drawSprite(s,f)
    for y=0,H-1 do for x=0,W-1 do assert(check:getPixel(x,y)==sheet:getPixel((f-1)*W+x,y),'Glove pixel mismatch') end end
  end
  s:close()
end
local report=io.open(root..'/aseprite-repair-report.txt','w')
report:write('Aseprite '..tostring(app.version)..'\nSix editable 96x80 animations, nine frames each.\nCat: separate fur, outline, details, hidden before-repair reference.\nGlove: white fill and black ink layers; all nine frames pixel-identical to current PNG sheets.\n')
report:close()
