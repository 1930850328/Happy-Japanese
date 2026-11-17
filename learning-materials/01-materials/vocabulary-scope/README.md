# 当前选词：21天阅读入门 v4

2026-11-17。当前核心263组，已编入[21课](../../02-course-design/README.md)的词表与当课日文用法。另有数字构式、语法功能表达和查询表，不能把263当全部语言知识或已掌握词根数。

[完整词表与原始排名](WORDS.md) · [逐项取舍](selection.json) · [暂缓与合并](REVIEW.md) · [逐课教学范围](../../02-course-design/SEQUENCE.md)

复用既有1161个媒体高频候选，保留逐项决定；补入82个明确教材/基础表达表项，共1243个候选形式。当前分为263核心、225语法候选、44合并形式、711暂缓。语法候选索引不是225条全部已教的语法；实际只按课程正文教。排名缺失保留None，不伪装频率为零。

本版选择依据是基本生活与句子关系、既有教材内容、复现与阅读的时间需求。词频作来源证据；不按新测试缺词扩容，不把1355组候选全塞入21小时。安全等基础信息词选入；中心、历史等有用候选暂缓，不称它们无用。语域变体、重复近义表达和复杂结构也暂缓。

`selection.json`仍是唯一决策入口，`policy.materialAdditions`只声明原媒体候选之外的确切词形/读音；释义和出处在对应decision中，不另建一份活动清单。`build.py`校验原始频率和材料来源、每候选只有一个处置、别名指向核心或语法、补充有来源，生成WORDS/selected/grammar/summary/REVIEW。它不读取课程或测验；课文对齐由课程review检查。

工具使用setup创建的Python3.10+环境：

```sh
learning-materials/.venv/bin/python learning-materials/01-materials/vocabulary-scope/build.py --check
```

没有90%覆盖或理解承诺。v3的777组及旧成绩已封存在[改课前基线](../../04-evaluation/round-07/before/manifest.json)。原Jiten数据的许可、来源和哈希继续见[sources.json](sources.json)，没有更换或重新收集原语料。
