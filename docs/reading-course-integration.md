# 21天阅读课接入

首页 `/` 展示21天路线，`/course/1` 至 `/course/21` 为分步学习页。既有分级课程移到 `/learn`；`/learn/:lessonId`、能力训练、复习和媒体功能继续使用原有数据。

## 内容归属

教学正文唯一来源是 `learning-materials/02-course-design/lessons/*.md`。`src/data/readingCourse.ts` 使用 Vite raw import 将二级标题转为步骤，不复制正文，不生成另一套课文。保留所有正文、表格、阅读段落和折叠核对答案；课前的研究来源说明不展示，仓库内部研究链接不暴露为失效网页链接。

复习条目来自教材工具生成的 `inventory.json` 的 `recall_days`，并计入教材既定的每日预算。网页表格可遮住右栏，复习词义和练习答案可展开。课程没有听说、打字或水平测试门槛，允许浏览和回看任何一天。

内容改变时先运行既有教材检查以更新派生索引，再构建网站。测试集、下载缓存、Python环境和第三方原件不作为网站内容导入。

## 进度归属

`CourseState.readingCourse` 是阅读课唯一进度，使用 `reading-v4` 标识本版课程，经过现有 `useCourseStore` / `storage.ts` 保存到当前学习档案，沿用已有云端存储和 IndexedDB 故障回退。不新建独立账号、存储服务或第二份 localStorage 进度。

每次切换步骤保存当前位置；点击“完成这一步”记录已完成步骤，所有步骤都记录后才完成当日并推荐首个未完成日。任意跳转目录不算完成，回看不会抹掉既有完成记录。分级练习重置不清除阅读课进度。这里记录的是学习行为，不产生掌握率或生肉理解率。

当前沿用既有存储同步语义：云端故障时保存到本机，跨设备续学仍需使用同一学习档案。不要将本地故障回退宣称为完整离线优先同步。

## 验证和发布

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec playwright test tests/reading-course.spec.ts tests/course-learning.spec.ts
python3 learning-materials/tools/workspace.py check
python3 learning-materials/tools/workspace.py regression --current
```

浏览器测试隔离学习档案请求，检查全部21天的每节标题、表格行、阅读段落和答案数量，测试步骤续学、当日完成、遮盖答案、离线本机保存、手机横向溢出及桌面显示。课程内容的质量检查、词形回归和网站功能测试是不同验证，不互相替代。

发布沿用 GitHub `main` → Vercel production。发布前排除无关未提交改动；发布后核对对应提交的部署状态及正式域名。
