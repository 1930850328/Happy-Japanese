import type { CourseLesson, CourseLevel, CourseNode, CourseNodeKind, CourseQuestion } from '../types'

interface CurriculumSpec {
  id: string
  level: Exclude<CourseLevel, 'foundation'>
  kind: CourseNodeKind
  title: string
  form: string
  meaning: string
  explanation: string
  example: string
  reading: string
  zh: string
}

const specs: CurriculumSpec[] = [
  { id: 'demonstratives', level: 'N5', kind: 'grammar', title: '指示人与物', form: 'これ・それ・あれ・どれ', meaning: '按照与说话人、听话人的距离指代事物', explanation: 'これ靠近说话人、それ靠近听话人、あれ离双方都远，どれ用于提问。', example: 'これは私の本です。', reading: 'これは わたしの ほんです。', zh: '这是我的书。' },
  { id: 'time-counters', level: 'N5', kind: 'vocabulary', title: '时间与数量', form: '時・分・つ・人', meaning: '用常见时间词和量词说明几点、几分与数量', explanation: '日语会根据事物类别使用不同量词，先掌握时间、人和通用数量。', example: '七時に二人で行きます。', reading: 'しちじに ふたりで いきます。', zh: '七点两个人一起去。' },
  { id: 'past-tense', level: 'N5', kind: 'grammar', title: '说过去发生的事', form: 'ました・ませんでした', meaning: '礼貌地表达过去做了或没有做', explanation: 'ます变为ました表示过去肯定，ませんでした表示过去否定。', example: '昨日、映画を見ました。', reading: 'きのう、えいがを みました。', zh: '昨天看了电影。' },
  { id: 'adjective-change', level: 'N5', kind: 'grammar', title: '形容词的否定与过去', form: 'くない・かった・ではない', meaning: '描述现在否定、过去状态和过去否定', explanation: 'い形容词与な形容词变化方式不同，需要分别建立词尾变化。', example: '昨日は寒くなかったです。', reading: 'きのうは さむくなかったです。', zh: '昨天不冷。' },
  { id: 'desire', level: 'N5', kind: 'grammar', title: '表达想做什么', form: 'たいです・ほしいです', meaning: '表达自己的行动愿望或想要某物', explanation: '动词ます形去掉ます接たい；名词后用ほしい表达想要。', example: '日本へ行きたいです。', reading: 'にほんへ いきたいです。', zh: '想去日本。' },
  { id: 'invitation', level: 'N5', kind: 'grammar', title: '邀请与提议', form: 'ませんか・ましょう', meaning: '邀请对方或提议一起行动', explanation: 'ませんか是较柔和的邀请，ましょう更像主动提出一起做。', example: '一緒に昼ご飯を食べませんか。', reading: 'いっしょに ひるごはんを たべませんか。', zh: '要不要一起吃午饭？' },
  { id: 'permission', level: 'N5', kind: 'grammar', title: '许可与禁止', form: 'てもいい・てはいけない', meaning: '询问或给予许可，并说明禁止事项', explanation: 'て形加もいい表示可以，加はいけない表示不可以。', example: 'ここで写真を撮ってもいいです。', reading: 'ここで しゃしんを とっても いいです。', zh: '可以在这里拍照。' },
  { id: 'comparison', level: 'N5', kind: 'grammar', title: '比较两个事物', form: 'より・ほうが・いちばん', meaning: '表达两者比较和最高程度', explanation: 'AよりBのほうが表示B比A更……；范围内最高用いちばん。', example: '電車より自転車のほうが速いです。', reading: 'でんしゃより じてんしゃの ほうが はやいです。', zh: '自行车比电车更快。' },
  { id: 'daily-words', level: 'N5', kind: 'vocabulary', title: '建立日常高频词群', form: '家族・学校・食事・交通', meaning: '在家庭、学校、饮食与出行场景中调用基础词汇', explanation: '词汇不按孤立清单背诵，而按能完成的生活任务成组学习。', example: '家族と駅の近くで晩ご飯を食べます。', reading: 'かぞくと えきの ちかくで ばんごはんを たべます。', zh: '和家人在车站附近吃晚饭。' },
  { id: 'sequence-listening', level: 'N5', kind: 'listening', title: '听懂行动顺序', form: 'まず・それから・最後に', meaning: '从顺序词中抓住先做什么、再做什么', explanation: '初级听力先抓顺序和动作，不必逐字翻译整段。', example: 'まず切符を買って、それから電車に乗ります。', reading: 'まず きっぷを かって、それから でんしゃに のります。', zh: '先买票，然后坐电车。' },

  { id: 'plain-form', level: 'N4', kind: 'grammar', title: '掌握普通形', form: '辞书形・ない形・た形', meaning: '在朋友交流和复合句中使用普通形', explanation: '普通形不是不礼貌，而是句中连接和亲近关系中的基础形式。', example: '明日は家にいる。', reading: 'あしたは いえに いる。', zh: '明天在家。' },
  { id: 'thought-quote', level: 'N4', kind: 'grammar', title: '转述想法和话语', form: 'と思う・と言う', meaning: '表达自己的判断或转述别人说的话', explanation: '普通形后接と思う；引用内容后接と言う。', example: 'この方法がいいと思います。', reading: 'この ほうほうが いいと おもいます。', zh: '我觉得这个方法不错。' },
  { id: 'intention-plan', level: 'N4', kind: 'grammar', title: '说明意向和计划', form: 'つもり・予定', meaning: '表达个人打算和已经安排的计划', explanation: 'つもり侧重个人意向，予定侧重已经确定的日程。', example: '来年、日本へ留学するつもりです。', reading: 'らいねん、にほんへ りゅうがくする つもりです。', zh: '打算明年去日本留学。' },
  { id: 'purpose', level: 'N4', kind: 'grammar', title: '表达行动目的', form: 'ために・に行く', meaning: '说明为了什么而行动', explanation: '明确目标用ために；移动动词前可用ます形词干加に。', example: '本を借りるために図書館へ行きます。', reading: 'ほんを かりるために としょかんへ いきます。', zh: '为了借书去图书馆。' },
  { id: 'try-action', level: 'N4', kind: 'grammar', title: '尝试与事先准备', form: 'てみる・ておく', meaning: '尝试做某事，或为了以后提前做好', explanation: 'てみる关注尝试，ておく关注为后续状态进行准备。', example: '分からない言葉を調べてみます。', reading: 'わからない ことばを しらべてみます。', zh: '试着查一下不懂的词。' },
  { id: 'giving-receiving', level: 'N4', kind: 'grammar', title: '说明给予和受益', form: 'あげる・くれる・もらう', meaning: '从不同视角表达谁给谁以及谁受益', explanation: '视角决定动词：别人给我方常用くれる，我方得到用もらう。', example: '友達が日本語を教えてくれました。', reading: 'ともだちが にほんごを おしえてくれました。', zh: '朋友教了我日语。' },
  { id: 'simultaneous', level: 'N4', kind: 'grammar', title: '同时进行两个动作', form: 'ながら', meaning: '同一主体一边做前项一边做后项', explanation: '主要动作通常放在句尾，ながら前使用ます形词干。', example: '音楽を聞きながら勉強します。', reading: 'おんがくを ききながら べんきょうします。', zh: '一边听音乐一边学习。' },
  { id: 'excess-ease', level: 'N4', kind: 'grammar', title: '表达过度与难易', form: 'すぎる・やすい・にくい', meaning: '评价动作或状态过度，以及事情容易或难以进行', explanation: '词干后接すぎる、やすい、にくい，形成新的复合表达。', example: 'この説明は長すぎて、分かりにくいです。', reading: 'この せつめいは ながすぎて、わかりにくいです。', zh: '这个说明太长，很难理解。' },
  { id: 'paragraph-links', level: 'N4', kind: 'reading', title: '跟随段落连接词', form: 'しかし・だから・例えば', meaning: '识别转折、因果和举例在段落中的作用', explanation: '先判断连接词角色，再决定后句是反转、结论还是例子。', example: '便利です。しかし、少し高いです。', reading: 'べんりです。しかし、すこし たかいです。', zh: '很方便。但是有点贵。' },
  { id: 'request-intent', level: 'N4', kind: 'listening', title: '听懂请求真正要做什么', form: '〜てくれませんか', meaning: '从礼貌表达中抓住对方要求的具体行动', explanation: '听力题先锁定动作和截止条件，再处理礼貌词尾。', example: '明日までに送ってくれませんか。', reading: 'あしたまでに おくってくれませんか。', zh: '能在明天之前发给我吗？' },

  { id: 'appearance', level: 'N3', kind: 'grammar', title: '根据外观作判断', form: 'そうだ', meaning: '根据眼前迹象判断似乎要发生或呈现某状态', explanation: '样态そうだ来自直接观察，不等于转述消息的そうだ。', example: '雨が降りそうです。', reading: 'あめが ふりそうです。', zh: '看起来要下雨。' },
  { id: 'hearsay', level: 'N3', kind: 'grammar', title: '转述听来的信息', form: '〜そうだ・ということだ', meaning: '标明信息来自传闻或他人说明', explanation: '转述时保留普通形，再说明消息来源，避免当作自己的直接判断。', example: '天気予報によると、明日は雪だそうです。', reading: 'てんきよほうによると、あしたは ゆきだそうです。', zh: '据天气预报说，明天会下雪。' },
  { id: 'seeming', level: 'N3', kind: 'grammar', title: '表达推断和比喻', form: 'ようだ・みたいだ', meaning: '根据情况推断，或说明与某物相似', explanation: 'ようだ较正式，みたいだ较口语；都需要结合前文证据理解。', example: '彼は何か困っているようです。', reading: 'かれは なにか こまっているようです。', zh: '他好像遇到了什么困难。' },
  { id: 'expectation', level: 'N3', kind: 'grammar', title: '表达有根据的预期', form: 'はずだ・はずがない', meaning: '根据已有事实判断应该如此或不可能如此', explanation: 'はず强调推理依据，不用于单纯愿望。', example: '鍵は机の上にあるはずです。', reading: 'かぎは つくえの うえに あるはずです。', zh: '钥匙应该在桌子上。' },
  { id: 'advice-duty', level: 'N3', kind: 'grammar', title: '表达应当与评价', form: 'べきだ・べきではない', meaning: '根据规范或判断说明应该或不应该做', explanation: 'べき语气较强，使用时要注意关系和场合。', example: '約束は守るべきです。', reading: 'やくそくは まもるべきです。', zh: '应该遵守约定。' },
  { id: 'action-phase', level: 'N3', kind: 'grammar', title: '说明动作所处阶段', form: 'ところだ・ばかりだ', meaning: '区分正要做、正在做、刚做完及刚发生不久', explanation: '动词形式与ところ组合决定阶段；たばかり强调主观上的“刚刚”。', example: '今、家を出るところです。', reading: 'いま、いえを でるところです。', zh: '现在正准备出门。' },
  { id: 'cause-purpose', level: 'N3', kind: 'grammar', title: '区分原因与目的', form: 'ために', meaning: '在不同结构中表达原因结果或行动目的', explanation: '名词加の或普通形接ために，需要由前后句判断是目的还是原因。', example: '事故のために、電車が遅れました。', reading: 'じこの ために、でんしゃが おくれました。', zh: '因为事故，电车晚点了。' },
  { id: 'means-cause', level: 'N3', kind: 'grammar', title: '说明手段、依据和原因', form: 'によって', meaning: '表达由谁、通过什么、根据什么或因何导致', explanation: 'によって有多种功能，先看句中名词的语义角色。', example: 'インターネットによって情報を集めます。', reading: 'インターネットによって じょうほうを あつめます。', zh: '通过互联网收集信息。' },
  { id: 'topic-role', level: 'N3', kind: 'grammar', title: '限定话题与身份', form: 'について・として', meaning: '说明正在讨论的主题或某人某物的身份角色', explanation: 'について回答“关于什么”，として回答“以什么身份”。', example: '留学生として日本文化について話します。', reading: 'りゅうがくせいとして にほんぶんかについて はなします。', zh: '作为留学生谈论日本文化。' },
  { id: 'omission-reading', level: 'N3', kind: 'reading', title: '还原省略的信息', form: 'それ・このこと・省略主语', meaning: '从前后句找回代词和被省略主语的指向', explanation: '不要只翻译当前句，要把指示词与上一句的事件、人物或观点连接起来。', example: '毎日声に出して読む。それが上達につながる。', reading: 'まいにち こえに だして よむ。それが じょうたつに つながる。', zh: '每天朗读。这会带来进步。' },

  { id: 'reason-boundary', level: 'N2', kind: 'grammar', title: '限定结论的范围', form: 'わけだ・わけがない', meaning: '根据前文得出自然结论，或强烈否定某种可能', explanation: 'わけだ是推理落点；わけがない表示按常理不可能。', example: '十年住んでいるから、詳しいわけです。', reading: 'じゅうねん すんでいるから、くわしい わけです。', zh: '住了十年，难怪很熟悉。' },
  { id: 'strong-inference', level: 'N2', kind: 'grammar', title: '表达强烈推断', form: 'に違いない・に相違ない', meaning: '根据证据判断几乎可以确定', explanation: '两者都比でしょう更确定，に相違ない更正式书面。', example: 'あの様子では、何かあったに違いない。', reading: 'あの ようすでは、なにか あったに ちがいない。', zh: '看那个样子，一定发生了什么。' },
  { id: 'definition-hearsay', level: 'N2', kind: 'grammar', title: '解释定义和转述结论', form: 'ということだ', meaning: '把前文归纳成含义，或转述得到的信息', explanation: '需由语境判断是在下定义、总结，还是转述消息。', example: '参加しないということは、反対なのですか。', reading: 'さんかしないということは、はんたいなのですか。', zh: '不参加，也就是说你反对吗？' },
  { id: 'parallel-change', level: 'N2', kind: 'grammar', title: '描述同步变化', form: 'につれて・に伴って', meaning: '说明一项变化伴随另一项变化发生', explanation: 'につれて常用于自然渐变，に伴って也可描述制度或规模变化带来的结果。', example: '人口が増えるにつれて、交通問題も深刻になった。', reading: 'じんこうが ふえるにつれて、こうつうもんだいも しんこくに なった。', zh: '随着人口增加，交通问题也变严重了。' },
  { id: 'basis-step', level: 'N2', kind: 'grammar', title: '在前提上采取行动', form: '上で', meaning: '完成前项之后，或以某项为必要前提再做后项', explanation: 'た形加上で强调先后步骤；名词の上で可表示某方面。', example: '内容を確認した上で、署名してください。', reading: 'ないようを かくにんした うえで、しょめいして ください。', zh: '确认内容后请签名。' },
  { id: 'minimum-extreme', level: 'N2', kind: 'grammar', title: '表达最低条件和递进', form: 'さえ・どころか', meaning: '突出最低条件，或说明实际情况远超预期', explanation: 'さえ表示连最低项都；どころか从预期转向更极端的事实。', example: '忙しくて、昼ご飯を食べる時間さえない。', reading: 'いそがしくて、ひるごはんを たべる じかんさえ ない。', zh: '忙得连吃午饭的时间都没有。' },
  { id: 'negative-risk', level: 'N2', kind: 'grammar', title: '指出负面风险', form: 'かねない', meaning: '说明某种不好的结果有发生可能', explanation: 'かねない只用于说话人认为不理想的可能结果。', example: 'このままでは事故が起こりかねない。', reading: 'このままでは じこが おこりかねない。', zh: '这样下去可能会发生事故。' },
  { id: 'despite', level: 'N2', kind: 'grammar', title: '表达与条件相反的结果', form: 'にもかかわらず', meaning: '前项事实成立，但后项没有出现通常预期的结果', explanation: '正式语体中常用于客观说明强烈逆接。', example: '雨にもかかわらず、多くの人が集まった。', reading: 'あめにもかかわらず、おおくの ひとが あつまった。', zh: '尽管下雨，还是来了很多人。' },
  { id: 'formal-notice', level: 'N2', kind: 'reading', title: '读懂正式通知', form: 'につき・に際して', meaning: '从公告中识别原因、适用时间和行动要求', explanation: '正式通知优先提取对象、时间、原因和必须采取的动作。', example: '工事中につき、この道は通行できません。', reading: 'こうじちゅうにつき、この みちは つうこうできません。', zh: '因施工中，此路无法通行。' },
  { id: 'speaker-stance', level: 'N2', kind: 'listening', title: '判断说话人的保留态度', form: '確かに〜が・とはいえ', meaning: '听出说话人先承认一部分，再提出真正立场', explanation: '答案通常落在让步后的转折，而不是开头承认的信息。', example: '確かに便利ですが、今すぐ必要とは思いません。', reading: 'たしかに べんりですが、いますぐ ひつようとは おもいません。', zh: '确实方便，但我不觉得现在马上需要。' },

  { id: 'not-worthy', level: 'N1', kind: 'grammar', title: '评价不值得讨论', form: 'に足りない・に足る', meaning: '判断某事不值得或足以成为评价对象', explanation: '常见于正式评论，に足る表示值得，に足りない表示不足以。', example: 'その意見は検討するに足る。', reading: 'その いけんは けんとうするに たる。', zh: '那个意见值得研究。' },
  { id: 'paired-extremes', level: 'N1', kind: 'grammar', title: '并列鲜明特征', form: 'といい〜といい', meaning: '列举两个代表性方面并作整体评价', explanation: '列举的两项不是全部，而是用来支持后面的总体判断。', example: '色といい形といい、実に美しい。', reading: 'いろといい かたちといい、じつに うつくしい。', zh: '无论颜色还是形状，都非常漂亮。' },
  { id: 'starting-point', level: 'N1', kind: 'grammar', title: '说明扩展起点', form: 'を皮切りに', meaning: '以某事件为开端，之后同类行动连续展开', explanation: '强调一连串发展中的第一个标志性事件。', example: '東京公演を皮切りに、全国を回る。', reading: 'とうきょうこうえんを かわきりに、ぜんこくを まわる。', zh: '以东京公演为开端，在全国巡演。' },
  { id: 'emotional-emphasis', level: 'N1', kind: 'grammar', title: '带感情地强调话题', form: 'といったら', meaning: '把某个程度或感受作为话题强烈强调', explanation: '常带惊讶、不满或赞叹，语气强于普通主题提示。', example: '昨日の暑さといったら、耐えられないほどだった。', reading: 'きのうの あつさといったら、たえられないほどだった。', zh: '昨天那个热啊，到了无法忍受的程度。' },
  { id: 'easy-inference', level: 'N1', kind: 'grammar', title: '表达不难想象', form: 'に難くない', meaning: '说明某种情况很容易推断或想象', explanation: '多与想像、理解等词搭配，用于正式书面判断。', example: '彼の苦労は想像に難くない。', reading: 'かれの くろうは そうぞうに かたくない。', zh: '他的辛苦不难想象。' },
  { id: 'cannot-bear', level: 'N1', kind: 'grammar', title: '表达情感上无法忍受', form: 'に忍びない', meaning: '因为同情或心理负担而不忍心做或看', explanation: '不是能力上的不能，而是情感上难以承受。', example: '思い出の品を捨てるに忍びない。', reading: 'おもいでの しなを すてるに しのびない。', zh: '不忍心扔掉纪念品。' },
  { id: 'only-choice', level: 'N1', kind: 'grammar', title: '强调除此之外别无选择', form: 'をおいてほかにない', meaning: '断言只有某人或某事最适合，没有其他选择', explanation: '常用于高度评价或强调唯一性。', example: 'この役を任せられるのは彼をおいてほかにない。', reading: 'この やくを まかせられるのは かれを おいて ほかにない。', zh: '能担任这个角色的非他莫属。' },
  { id: 'strong-prohibition', level: 'N1', kind: 'grammar', title: '读懂正式禁止规范', form: 'べからず', meaning: '在规章或格言中强烈表示禁止', explanation: '是古典色彩较强的固定书面表达，常见于告示和训诫。', example: '初心忘るべからず。', reading: 'しょしん わするべからず。', zh: '不可忘记初心。' },
  { id: 'instant-sequence', level: 'N1', kind: 'grammar', title: '表达动作紧接发生', form: 'や否や・が早いか', meaning: '前一动作刚发生，后一动作立刻出现', explanation: '用于叙述几乎没有时间间隔的连续动作，书面色彩较强。', example: 'ベルが鳴るや否や、学生たちは教室を出た。', reading: 'ベルが なるやいなや、がくせいたちは きょうしつを でた。', zh: '铃声一响，学生们立刻离开教室。' },
  { id: 'expectation-reversal', level: 'N1', kind: 'reading', title: '识别预期反转', form: 'かと思いきや', meaning: '说明原以为会如此，结果却完全不同', explanation: '先标记说话人的预期，再把转折后的事实作为真正信息。', example: '簡単かと思いきや、意外に時間がかかった。', reading: 'かんたんかと おもいきや、いがいに じかんが かかった。', zh: '本以为很简单，没想到意外地花了时间。' },
]

function distractorsFor(spec: CurriculumSpec, field: 'meaning' | 'example' | 'explanation') {
  return specs
    .filter((item) => item.level === spec.level && item.id !== spec.id)
    .map((item) => item[field])
    .slice(0, 3)
}

function questionsFor(spec: CurriculumSpec): CourseQuestion[] {
  const nodeId = `core.${spec.level.toLowerCase()}.${spec.id}`
  return [
    {
      id: `${nodeId}.meaning`, nodeId, kind: 'meaning', prompt: `「${spec.form}」的核心作用是？`,
      options: [spec.meaning, ...distractorsFor(spec, 'meaning')], answerIndex: 0, explanationZh: spec.explanation,
    },
    {
      id: `${nodeId}.usage`, nodeId, kind: 'usage', prompt: `哪一句最适合表达“${spec.zh}”？`,
      options: [spec.example, ...distractorsFor(spec, 'example')], answerIndex: 0, explanationZh: `${spec.example}：${spec.zh}`,
    },
    {
      id: `${nodeId}.comprehension`, nodeId, kind: 'comprehension', prompt: `遇到「${spec.form}」时，首先应该抓住什么？`,
      options: [spec.explanation, ...distractorsFor(spec, 'explanation')], answerIndex: 0, explanationZh: spec.explanation,
    },
  ]
}

export const expansionNodes: CourseNode[] = specs.map((spec) => ({
  id: `core.${spec.level.toLowerCase()}.${spec.id}`,
  kind: spec.kind,
  level: spec.level,
  title: spec.title,
  reading: spec.form,
  meaningZh: spec.meaning,
  explanationZh: spec.explanation,
  prerequisiteNodeIds: [],
}))

export const expansionLessons: CourseLesson[] = specs.map((spec, index) => ({
  id: `${spec.level.toLowerCase()}-core-${spec.id}`,
  level: spec.level,
  order: 1_000 + index,
  title: spec.title,
  canDo: spec.meaning,
  description: `通过讲解、主动回忆和新题检测掌握「${spec.form}」。`,
  durationMinutes: 14,
  prerequisiteLessonIds: [],
  nodeIds: [`core.${spec.level.toLowerCase()}.${spec.id}`],
  explanation: [spec.explanation, `先理解「${spec.form}」在句子中的作用，再用自己的话说出例句。`],
  examples: [{ ja: spec.example, reading: spec.reading, zh: spec.zh }],
  questions: questionsFor(spec),
  songSearchTerms: [spec.form.split('・')[0]],
}))
