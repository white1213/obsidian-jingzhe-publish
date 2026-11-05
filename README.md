# Jingzhe Publish

把 Obsidian 笔记一键发布到 [惊蛰](https://github.com/koobai/blog) 博客（GitHub 仓库托管）。

## 功能

- **发布为随笔**：当前笔记 → `content/posts/<slug>.md`，读 front matter 的 `title` / `tags` / `description` / `image`
- **发唠叨**：把**选中的文字** → `content/laodao/YYYY/MM/时间戳.md`
- **图片自动处理**：笔记里的 `![[图片.png]]`、`![](相对路径)` 会被找到、压缩、上传到仓库 `static/uploads/年-月/`，并改写为博客可用的链接
- **重复发布 = 更新原文章**：插件记住笔记与博客文件的对应关系（含 SHA），再次发布直接覆盖

## 安装

1. 下载本仓库的 `main.js` 和 `manifest.json`
2. 在你的 vault 里建目录：`.obsidian/plugins/jingzhe-publish/`
3. 把两个文件放进去
4. Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用 **Jingzhe Publish**

## 配置

设置 → Jingzhe Publish：

| 项 | 说明 |
| --- | --- |
| GitHub Token | 细粒度 token，只需目标仓库的 **Contents: Read and write** |
| 仓库 owner / 仓库名 / 分支 | 例如 `white1213` / `blog` / `main` |
| 文章目录 | 默认 `content/posts` |
| 唠叨目录 | 默认 `content/laodao` |
| 图片上传目录 | 默认 `static/uploads` |
| 站点路径前缀 | 默认 `/blog/`（图片链接用） |
| 图片最长边 / 体积目标 / 质量下限 | 默认 1400px / 350KB / 0.73 |

## 用法

- 命令面板 → `发布为随笔`：发布当前打开的笔记
- 选中文字 → 命令面板 → `发唠叨`

笔记 front matter 示例：

```yaml
---
title: 我的文章
tags: [随笔, 记录]
description: 一句话摘要
slug: my-post
---
```

没写的字段会回退：标题用文件名，slug 用文件名，不写标签/摘要。

## 注意

- 只支持桌面版 Obsidian（需要 canvas 做图片压缩）
- 本地图片读取与压缩在插件里完成，Token 只存在本机插件数据里
- 发布后 GitHub Actions 会自动构建部署，约 1–2 分钟上线
