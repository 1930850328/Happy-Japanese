# 在另一台设备继续课程研究

这是独立于网站运行的课程工作区。课程、选词决策、历史评估、词频快照和工具均由 Git 管理；无需 Vercel、数据库、账号密钥或前端应用依赖。

## 首次下载与安装

安装 **Python 3.10+、Node.js 20+（含 npm）、Git**。macOS 的系统 `python3` 可能仍是3.9，此时下面用已安装的 `python3.11` 等替代。命令从仓库根目录执行，也支持把脚本路径写成绝对路径。

```sh
git clone https://github.com/1930850328/Happy-Japanese.git
cd Happy-Japanese
python3 learning-materials/tools/workspace.py setup
python3 learning-materials/tools/workspace.py check
python3 learning-materials/tools/workspace.py regression
```

已有仓库先 `git pull --ff-only`，再执行后三条。setup 创建本目录 `.venv`，按锁定版本安装 Python 和 Node 依赖，并按 `01-materials/sources-manifest.json` 下载、核对教材原件，生成 `data/`、`reader/`。使用公开 PyPI/npm 源，不依赖公司内网镜像。第一次需要联网；之后 check 和 regression 可离线执行。

下载内容与已记录 SHA-256 不一致会报错，不会偷偷接受新版源文件；已有文件不匹配也不会被覆盖。来源下线不能保证自动恢复，需要从可信的同版本备份补回并核对原哈希。安装文件、下载原件、输出结果都被 `.gitignore` 排除。

## 能直接复现什么

- **check**：重建材料一致性、筛词依据、21课正文与派生索引、当课用法、测试目录的引用和隔离组。测试目录以 `metadata_only` 明确标记，没有声称检查未下载的旧原文。
- **regression**：以第5轮冻结课程，重算16段、8作品的全部词形匹配计数和聚合分数，并逐项比较历史原文结果。新课程48.144319637397665%，旧课程28.16422767877318%。这不是理解率。
- 结果写入 `learning-materials/.cache/round-05-replay.json`，不会改历史结果文件。

`coverage-features.json` 是无句序的分词特征计数：保存词形、词元、词性、可匹配词形和次数，不保存完整句子、台词顺序或漫画转写。它由原文和既有掩码生成，并有来源哈希、文件哈希与固定词频词形集合约束。原文输入运行与统计输入运行共用匹配含义和聚合实现，已逐段对照。

这份统计适合**覆盖率回归**，不能拿来判断人物关系、否定范围、剧情或看图理解。当前可匹配范围来自冻结Jiten词频的全部词形与旧课词形；新课如果出现集合外的词，程序会报错，要求用原文评估，而不是给出不可靠分数。

## 查看番剧和漫画原文

```sh
python3 learning-materials/tools/workspace.py fetch-tests
```

脚本按现有来源清单下载12份日文SRT、32张外部漫画原图到 `.cache/test-assets/`，校验原文件哈希、字幕范围和时间码、图像哈希。可直接用编辑器读SRT、用图片查看器读漫画；对应范围和官方入口见 [原文目录](03-test-set/CATALOG.md)。

这些原件不上传公共仓库。第5轮8段漫画的完整人工转写未公开分发；要重新做句义评审，应打开原图，而不是从词形统计猜句子。若要重建完全一致的原文运行，仍需按 `transcript-manifest.json` 整理转写并匹配哈希。第1—4轮涉及的旧网页捕获及部分旧漫画转写也未全部迁移，**不能把本入口说成所有历史原文测试的一键复现**。

## 修改课程后怎样继续

唯一编辑入口：

| 内容 | 编辑哪里 | 随后生成 |
| --- | --- | --- |
| 优先词选择、释义、异写与暂缓理由 | `01-materials/vocabulary-scope/selection.json` | `vocabulary-scope/build.py` |
| 每课教学正文、词表、例句、练习与反馈 | `02-course-design/lessons/01.md`—`21.md` | `review.py --write`、`context-review.cjs --write` |
| 原文来源、连续片段、隔离组、评分草稿 | `03-test-set/sources.json`、`samples.json`、`answers.json` | `validate.py --metadata-only --write-catalog` |

激活 `.venv` 后运行（macOS/Linux：`source learning-materials/.venv/bin/activate`；Windows PowerShell：`learning-materials\.venv\Scripts\Activate.ps1`）：

```sh
python learning-materials/01-materials/vocabulary-scope/build.py
python learning-materials/02-course-design/tools/review.py --write
node learning-materials/02-course-design/tools/context-review.cjs --write
python learning-materials/03-test-set/tools/validate.py --metadata-only --write-catalog
python learning-materials/tools/workspace.py check
python learning-materials/tools/workspace.py regression --current
```

`--current` 先检查当前正文与派生索引，再在**已经曝光的旧样本**上回归，输出 `.cache/current-regression.json`；不会把当前课改成第5轮冻结版本，也不会覆盖原成绩。不带 `--current` 的历史重跑要求课文仍等于第5轮快照；修改后拒绝历史重跑是正常保护，应在对应Git提交的独立检出中重跑历史。

回归通过后，仍须遵守原工作流程：先review并冻结本次课程，再选**未用于本次修改的新系列**，读取真实字幕和漫画，登记连续范围及哈希，做同输入旧新对照和整句分析。记录新一轮结果后，将已使用的新样本转回归。当前78段均已曝光或作为开发材料，**没有剩余新保留集**。不得只在这16段上反复补词并称为新测试。

21天、每日不超过1小时仍是课程约束。不得把词形匹配率写成理解率，也不得把写入词表写成学生已掌握；每天学习负荷与真人效果仍待验证。

## 维护验证

```sh
python3 learning-materials/tools/test_portability.py
```

它检查冻结特征重跑、篡改输入拒绝、当前索引边界和下载哈希保护。原件恢复和联网下载另由 setup / fetch-tests 在干净副本中验证；具体交付记录见 [PORTABILITY.md](PORTABILITY.md)。

只想读某一作品时，可直接打开原文目录中的官方入口；fetch-tests下载完整登记集合，首次网络传输可能较慢，后续会复用已验证文件。当前交付的网络抽检范围见PORTABILITY记录。
