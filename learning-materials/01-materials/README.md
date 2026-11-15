# 第一部分：教材内容

整理日期：2026-11-11。

跨设备说明（2026-11-15）：完整第三方原件及派生全文不随公共Git仓库分发，首次运行[setup](../START-HERE.md)后恢复到下列本地路径；来源和内容哈希保持原样。

**直接阅读：[教材内容目录](reader/index.html)。确定内容范围：[内容范围与来源](CONTENT.md)。假名入门：[假名与阅读基础](KANA.md)。**

2026-11-13 更新：[番剧与漫画词汇筛选](vocabulary-scope/README.md)与[完整选词清单](vocabulary-scope/WORDS.md)。撤回整包纳入 Kaishi＋85 条生活词的方案；按番剧或漫画任一榜高频，筛出 777 组优先词汇与常用表达，已编进21天课程。完整资料池继续保留供查阅，不等于必学清单。

这里保存实际内容，不只是网址。当前材料由中文词卡、中文语法教材、官方词表与句型表、假名表和官方汉字词汇构成。本目录拥有内容来源；课程与外部验证分别由第二、第四部分维护。

## 已收集内容

| 内容 | 实际数量和口径 | 文件 |
| --- | --- | --- |
| Kaishi 中文词卡 | 1,500 条，每条有词、读音、中文释义、日文例句、例句中文、词性；有些另附用法说明 | [可读目录](reader/index.html#vocabulary)、[结构化数据](data/vocabulary-kaishi.json)、[原始 TSV](sources/kaishi-zh-cn.tsv) |
| 基本假名、浊音与拗音 | 46 组基本平片假名对应、25 组浊音/半浊音、33 组常用拗音；共 104 组对应，不是 104 个基本假名 | [假名说明](KANA.md)、[对照数据](data/kana.json) |
| Tae Kim 中文教材 | 原目录 70 个入口，包括正文、章节引言、练习和目次；不是 70 条语法规则 | [本地中文教材目录](reader/index.html#grammar)、[章节与小节索引](data/grammar-tae-kim-index.json) |
| Irodori 官方句型表 | 348 条出现记录：入门 82、初级 1 为 95、初级 2 为 87、初中级 84；存在复现与同组变体，不能解释为 348 个独立语法点 | [句型与例句](data/grammar-irodori.json)、[原始表格](sources/irodori-patterns.xlsx) |
| Irodori 官方语法讲解 | 245 页，日文及英文；句型条目已关联该课讲解的 PDF 页范围 | [官方 PDF](sources/irodori-grammar-all-en.pdf)、[按页文本](data/irodori-grammar-pages.json) |
| Irodori 官方词表 | 4,246 条教材出现记录；按“去首尾空格的词形＋读音＋英文释义＋词性”去重为 3,821 组。这只是机械分组，不是词义人工去重结果 | [完整记录](data/vocabulary-irodori.json)、[原始表格](sources/irodori-vocabulary.xlsx) |
| Irodori 汉字与词中读法 | 644 个汉字、999 条汉字在词中的出现记录，覆盖入门到初中级；同一词可能对应多个汉字记录 | [整理数据](data/kanji-irodori.json)、[官方表格](sources/irodori-kanji.xlsx) |
| Tae Kim 英文原书 | 353 页，PDF 标注 2012-11-21，作为原文参照，不能当成最新网页版本 | [英文原书](sources/tae-kim-grammar-en.pdf) |

以上集合不能直接相加：词表之间有交集，语法教材之间也有重叠。Irodori Excel 词表只覆盖入门至初级 2，句型和汉字表则覆盖至初中级。

## 为什么这样组合

- **词卡参照使用 Kaishi 中文版。** 上游结合基础牌组与词频资料选词，中文版本提供释义与例句翻译。本项目现按实际番剧、漫画词频重新确定优先清单，Kaishi 仅作候选和讲解来源，不再整包纳入；卡片次序也不当作严格词频排名。
- **语法用官方 Irodori 做教材参照，用 Tae Kim 中文版补足阅读结构。** 官方材料可定位到具体册、课、句型和解释；中文教材包含普通体、活用、定语从句、引述、条件、授受、使役被动、口语缩略及书面表达。
- **假名与词中汉字读法单列。** 不把汉字对中文读者“看起来认识”当成已经掌握日文词义和读音。汉字以它实际出现的单词为单位查阅。
- **官方完整词表作补充池。** 保留生活场景词、重复出现位置和词义，不把 4,246 条全都塞进基础课程，也不因某一个测试片段缺词就立即加入必学词。

## 来源与校对状态

来源入口：

- [Kaishi 上游](https://github.com/donkuri/kaishi)；[上游链接的中文译本](https://github.com/maimemo/kaishi-zh-cn)。本次 TSV 的 Git blob 为 `0955be6e31a4317df6f9521a42e2bad98b798a67`，与 GitHub 文件接口一致。欢迎卡仍写 1.3.0；**未确认其与上游最新 2.4.3 完全同步**，因此使用文件哈希固定本次版本。
- [Irodori 官方附属资料](https://www.irodori.jpf.go.jp/resources.html)；[官方简体中文资料页](https://www2.jpfbj.cn/irodori/resources/resources.php)。
- [Tae Kim 原文](https://guidetojapanese.org/learn/grammar)；[中文译者仓库](https://github.com/pizzamx/jpgramma)；[中文原站](https://res.wokanxing.info/jpgramma/)。

原始文件保存在 `sources/`；[来源清单](sources-manifest.json)记录网址、下载状态、版本说明及逐文件 SHA-256。`data/` 与 `reader/` 都从这些来源生成，不能各自手改成为第二套教材。

已知词卡问题集中保存在 [corrections.json](corrections.json)。每条包含原文、替换内容、原因和依据；生成时才应用，原始 TSV 不变。当前已处理「さん」只译成“桑”、ます适用范围、连用形被误解释为进行中的动作、部分可能形和请求语气说明。具体受影响词卡见 [应用记录](data/applied-corrections.json)。

当前完成的是**来源收集、结构整理、完整性检查和已发现问题的修正**，不是 1,500 条词卡全部人工审校通过。源译文中的称呼直译、语域、注音和语法教材间不同解释仍须逐项审校；本目录不声称课程已经达到阅读目标。

具体保留的缺口：

1. 官方简体中文的假名 PDF、三册语法 PDF 已找到链接，但本次下载返回 403，未收进文件夹；清单明确记为失败。当前中文解释来自 Tae Kim 社区译本，不能标成 Irodori 官方中文解释。
2. 官方句型表的 5 行原本没有独立例句（初级 1 第 5 课的 4 个变体、第 11 课的「V-て来ます」）。保留空值并链接该课完整讲解，没有伪造例句。
3. PDF 提取文本会受振假名与表格顺序影响；精确阅读以 PDF 为准。句型的页码关联是“所在课”，不是已经逐句对齐。
4. 中文语法本地阅读版保留正文、表格、练习和删除线；移除了联网脚本、影音和插图文件，插图位置有来源提示。它是完整目录对应的文字资料，不是原站全部媒体的镜像。

## 目录与复现

```text
01-materials/
  CONTENT.md                 内容范围和各模块对应材料
  KANA.md                    假名与阅读基础说明
  sources-manifest.json      来源、版本、下载状态、文件校验值
  corrections.json           有证据的局部修订
  sources/                   原始 TSV、XLSX、PDF、中文教材 HTML
  data/                      结构化词卡、句型、汉字、假名、章节索引
  reader/                    本地直接阅读的静态资料
  tools/build.py             离线整理与完整性检查
```

使用 Python 3.10 及以上，在独立环境安装 `tools/requirements.txt` 中的依赖。生成与检查命令（从仓库根目录执行）：

```sh
python learning-materials/01-materials/tools/build.py
python learning-materials/01-materials/tools/build.py --check
```

`--check` 核对原始文件哈希、词卡必填字段、唯一 ID、章节文件、PDF 课次映射、修订命中和生成结果一致性。它验证资料完整性，不验证学习效果。

2026-11-11 本次检查通过：78 个来源文件校验值一致，1,500 条词卡必填内容齐全，9 条修订规则实际作用于 62 条词卡，生成结果可重现；另核对了 869 个本地链接。官方 PDF 的首页和末页已渲染抽查，确认讲解语言与页码。未运行应用测试，因为本次没有改变应用代码。

## 素材使用说明

本次仅本地收集研究，没有发布到产品。Irodori 保留 Japan Foundation 版权；可免费下载不等于任意再分发许可。Tae Kim 与中文译本为 CC BY-NC-SA（中文页面链接 3.0 US），本地整理副本保留署名、许可和改动说明；该许可只适用于相应内容，不改变本仓库代码许可。Kaishi 中文词表未查到明确的通用再分发许可证，保留来源并标为待确认。未来若要发布原文或改编内容，再按各自条款确定使用范围。
