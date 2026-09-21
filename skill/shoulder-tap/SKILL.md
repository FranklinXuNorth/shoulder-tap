---
name: shoulder-tap
description: 接上 shoulder-tap 这个 MCP（第一次用要登录、填 Notion 密钥、在 Notion 里建库），以及在用户跑偏时把他拉回来。当用户说「登录 shoulder-tap」「接上 shoulder-tap」「设置一下专注」，或者 shoulder-tap 的工具报 not_set_up / 401 时使用。
---

# shoulder-tap

用户今天说好要做的事存在**他自己的 Notion** 里。这个 skill 负责把通路接上；接上之后，
真正干活的是 `shoulder-tap` 这个 MCP 的 `check_focus` 工具。

## 一、还没接上时（登录）

先看一眼 `claude mcp list` 里有没有 `shoulder-tap`。没有，就按下面走，**一步一步问**，不要一次问完：

1. **要 Notion 密钥。** 让用户去 <https://www.notion.so/profile/integrations> 建一个
   internal integration，把 `ntn_` 开头的密钥给你。
   顺便提醒他：这个密钥只会存在他自己电脑的 Claude 配置里，服务端不保存。
2. **接上。** 拿到密钥后执行（把 `<URL>` 换成部署地址，`<KEY>` 换成他给的密钥）：

   ```bash
   claude mcp add --transport http shoulder-tap <URL>/api/mcp -s user -H "Authorization: Bearer <KEY>"
   ```

   `-s user` 是关键：装到用户级，之后每个项目、每个对话都能用。
   如果服务端设了门禁，再加一个 `-H "X-Shoulder-Tap-Key: <门禁密钥>"`。
3. **建库。** 让用户随便挑一个 Notion 页面，在页面右上角 ⋯ → Connections 里把刚才那个
   integration 加进去，然后把页面链接给你。拿到链接后调用 `setup` 工具。
   （漏了 Connections 这步，Notion 会报 `object_not_found`，这是最常见的坑。）
4. 告诉用户重启一下会话让 MCP 生效，然后说一句「今天打算做什么」就能开始。

## 二、接上之后（这才是重点）

- **动手之前先 `check_focus`。** 用户提出一个要做的事，先把它作为 `activity` 传进去，
  按返回的 A / B / C 指示走。返回里怎么说就怎么做，**不要自己放水**。
- **他说「今天要做 X、Y、Z」** → `set_focus`，按他说的先后顺序记下来。顺序是这东西的意义所在。
- **用户说某条做完了** → `complete_focus`，然后告诉他下一条是什么。
  注意：**只有他说完成才算完成**。你把活干完了不等于这条能勾掉——想勾就问一句，等他点头。
- **临时插队的急事** → 先问清楚这是不是真的急，再 `add_focus`，别替他决定。

## 三、拦人的时候怎么说话

拦是为了让他想起来，不是为了教育他。一句话点破 + 一个问题，然后闭嘴等他回答：

> 你今天说的第 2 条是「把接口文档写完」，还没动。现在这个是插队的急事，还是先回去写文档？

不要说教，不要列一堆理由，不要在他已经决定之后还反复提。他说改计划就改计划——
用 `set_focus` 重排，然后照新的来。
