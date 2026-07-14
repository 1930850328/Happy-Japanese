import type {
  CourseLesson,
  CourseLevel,
  CourseNode,
  CourseQuestion,
  CourseQuestionKind,
  CourseStage,
} from '../types'
import { expansionLessons, expansionNodes } from './courseExpansion'

function question(
  id: string,
  nodeId: string,
  kind: CourseQuestionKind,
  prompt: string,
  options: string[],
  answerIndex: number,
  explanationZh: string,
  context?: string,
): CourseQuestion {
  return { id, nodeId, kind, prompt, context, options, answerIndex, explanationZh }
}

function lesson(
  id: string,
  level: CourseLevel,
  order: number,
  title: string,
  canDo: string,
  description: string,
  prerequisiteLessonIds: string[],
  nodeIds: string[],
  explanation: string[],
  examples: CourseLesson['examples'],
  questions: CourseQuestion[],
  songSearchTerms: string[] = [],
): CourseLesson {
  return {
    id,
    level,
    order: id === 'foundation-kana' || id.startsWith('foundation-kana-') ? order : order + kanaUnits.length,
    title,
    canDo,
    description,
    durationMinutes: 12,
    prerequisiteLessonIds,
    nodeIds,
    explanation,
    examples,
    questions,
    songSearchTerms,
  }
}

interface KanaUnitSpec {
  id: string
  order: number
  title: string
  canDo: string
  chars: Array<[string, string]>
  words: Array<{ ja: string; reading: string; zh: string }>
}

const kanaUnits: KanaUnitSpec[] = [
  { id: 'k', order: 2, title: '读出か行', canDo: '能读出「かきくけこ」，并拼读简单词语。', chars: [['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko']], words: [{ ja: 'かお', reading: 'kao', zh: '脸' }, { ja: 'きく', reading: 'kiku', zh: '听；菊花' }] },
  { id: 's', order: 3, title: '读出さ行', canDo: '能读出「さしすせそ」，注意「し」读 shi。', chars: [['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so']], words: [{ ja: 'すし', reading: 'sushi', zh: '寿司' }, { ja: 'あさ', reading: 'asa', zh: '早晨' }] },
  { id: 't', order: 4, title: '读出た行', canDo: '能读出「たちつてと」，分清 chi 与 tsu。', chars: [['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to']], words: [{ ja: 'つき', reading: 'tsuki', zh: '月亮' }, { ja: 'て', reading: 'te', zh: '手' }] },
  { id: 'n', order: 5, title: '读出な行', canDo: '能读出「なにぬねの」，并在词中识别它们。', chars: [['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no']], words: [{ ja: 'ねこ', reading: 'neko', zh: '猫' }, { ja: 'いぬ', reading: 'inu', zh: '狗' }] },
  { id: 'h', order: 6, title: '读出は行', canDo: '能读出「はひふへほ」，注意「ふ」读 fu。', chars: [['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho']], words: [{ ja: 'はな', reading: 'hana', zh: '花；鼻子' }, { ja: 'ふね', reading: 'fune', zh: '船' }] },
  { id: 'm', order: 7, title: '读出ま行', canDo: '能读出「まみむめも」，并从词中认出它们。', chars: [['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo']], words: [{ ja: 'うみ', reading: 'umi', zh: '海' }, { ja: 'まめ', reading: 'mame', zh: '豆子' }] },
  { id: 'yrw', order: 8, title: '补全清音表', canDo: '能读出や行、ら行、わ行、「を」和「ん」。', chars: [['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'], ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'], ['わ', 'wa'], ['を', 'wo'], ['ん', 'n']], words: [{ ja: 'やま', reading: 'yama', zh: '山' }, { ja: 'ほん', reading: 'hon', zh: '书' }] },
  { id: 'voiced-gz', order: 9, title: '掌握が行与ざ行', canDo: '能区分清音与が行、ざ行浊音。', chars: [['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'], ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo']], words: [{ ja: 'かぎ', reading: 'kagi', zh: '钥匙' }, { ja: 'みず', reading: 'mizu', zh: '水' }] },
  { id: 'voiced-d', order: 10, title: '掌握だ行', canDo: '能读出「だぢづでど」，重点区分「じ／ぢ」与「ず／づ」。', chars: [['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do']], words: [{ ja: 'でんわ', reading: 'denwa', zh: '电话' }, { ja: 'まど', reading: 'mado', zh: '窗户' }] },
  { id: 'voiced-bp', order: 11, title: '掌握ば行与ぱ行', canDo: '能区分は／ば／ぱ三组声音。', chars: [['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'], ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po']], words: [{ ja: 'ぱん', reading: 'pan', zh: '面包' }, { ja: 'えんぴつ', reading: 'enpitsu', zh: '铅笔' }] },
  { id: 'mixed', order: 12, title: '处理拗音与促音', canDo: '能识别「きゃ」「しゅ」「ちょ」和小「っ」造成的停顿。', chars: [['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'], ['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho'], ['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho'], ['っ', '停顿']], words: [{ ja: 'きって', reading: 'kitte', zh: '邮票' }, { ja: 'きっぷ', reading: 'kippu', zh: '车票' }] },
  { id: 'katakana-ak', order: 13, title: '片假名：ア行与カ行', canDo: '能读出片假名「アイウエオ、カキクケコ」。', chars: [['ア', 'a'], ['イ', 'i'], ['ウ', 'u'], ['エ', 'e'], ['オ', 'o'], ['カ', 'ka'], ['キ', 'ki'], ['ク', 'ku'], ['ケ', 'ke'], ['コ', 'ko']], words: [{ ja: 'ケーキ', reading: 'keeki', zh: '蛋糕' }, { ja: 'ココア', reading: 'kokoa', zh: '可可' }] },
  { id: 'katakana-st', order: 14, title: '片假名：サ行与タ行', canDo: '能读出片假名「サ行、タ行」。', chars: [['サ', 'sa'], ['シ', 'shi'], ['ス', 'su'], ['セ', 'se'], ['ソ', 'so'], ['タ', 'ta'], ['チ', 'chi'], ['ツ', 'tsu'], ['テ', 'te'], ['ト', 'to']], words: [{ ja: 'テスト', reading: 'tesuto', zh: '考试' }, { ja: 'スーツ', reading: 'suutsu', zh: '西装' }] },
  { id: 'katakana-nh', order: 15, title: '片假名：ナ行与ハ行', canDo: '能读出片假名「ナ行、ハ行」。', chars: [['ナ', 'na'], ['ニ', 'ni'], ['ヌ', 'nu'], ['ネ', 'ne'], ['ノ', 'no'], ['ハ', 'ha'], ['ヒ', 'hi'], ['フ', 'fu'], ['ヘ', 'he'], ['ホ', 'ho']], words: [{ ja: 'ホテル', reading: 'hoteru', zh: '酒店' }, { ja: 'ナイフ', reading: 'naifu', zh: '刀子' }] },
  { id: 'katakana-rest', order: 16, title: '补全片假名表', canDo: '能读出片假名ま行、や行、ら行、わ行和ン。', chars: [['マ', 'ma'], ['ミ', 'mi'], ['ム', 'mu'], ['メ', 'me'], ['モ', 'mo'], ['ヤ', 'ya'], ['ユ', 'yu'], ['ヨ', 'yo'], ['ラ', 'ra'], ['リ', 'ri'], ['ル', 'ru'], ['レ', 're'], ['ロ', 'ro'], ['ワ', 'wa'], ['ヲ', 'wo'], ['ン', 'n']], words: [{ ja: 'カメラ', reading: 'kamera', zh: '相机' }, { ja: 'メロン', reading: 'meron', zh: '甜瓜' }] },
]

function createKanaLesson(unit: KanaUnitSpec, previousId: string): CourseLesson {
  const readings = unit.chars.map(([, reading]) => reading)
  const questions = unit.chars.map(([character, reading], index) => question(
    `fk-${unit.id}-${index + 1}`,
    `kana.hiragana-${unit.id}`,
    'reading',
    `「${character}」应该怎样读？`,
    [reading, ...readings.filter((item) => item !== reading).slice(0, 3)],
    0,
    `「${character}」读作 ${reading}。`,
  ))
  const result = lesson(
    `foundation-kana-${unit.id}`,
    'foundation',
    unit.order,
    unit.title,
    unit.canDo,
    '一次只增加一组声音，先听、再认、最后从词中找出来。',
    [previousId],
    [`kana.hiragana-${unit.id}`],
    ['先逐个点击朗读，跟读两遍，再遮住读音尝试回忆。', '不要背整张表；能够从词里认出声音，才算建立了连接。'],
    [
      ...unit.chars.map(([ja, reading]) => ({ ja, reading, zh: `读作 ${reading}` })),
      ...unit.words,
    ],
    questions,
  )
  return {
    ...result,
    durationMinutes: Math.max(12, Math.ceil(unit.chars.length * 1.5)),
  }
}

export const courseNodes: CourseNode[] = [
  { id: 'kana.hiragana', kind: 'kana', level: 'foundation', title: 'あ行的声音', meaningZh: '读出「あいうえお」五个元音假名', explanationZh: '五个元音是后续所有假名发音的基础。先听声音，再建立文字连接。', prerequisiteNodeIds: [] },
  ...kanaUnits.map((unit, index) => ({ id: `kana.hiragana-${unit.id}`, kind: 'kana' as const, level: 'foundation' as const, title: unit.title, meaningZh: unit.canDo, explanationZh: '通过声音、文字和词语三种线索反复建立连接。', prerequisiteNodeIds: [index === 0 ? 'kana.hiragana' : `kana.hiragana-${kanaUnits[index - 1].id}`] })),
  { id: 'grammar.desu', kind: 'grammar', level: 'foundation', title: 'です判断句', meaningZh: '礼貌地说明“是……”', explanationZh: '名词后接「です」构成最基础的礼貌判断句。', prerequisiteNodeIds: ['kana.hiragana'] },
  { id: 'grammar.wa', kind: 'grammar', level: 'N5', title: '主题助词 は', reading: 'は（wa）', meaningZh: '提示句子正在谈论的主题', explanationZh: '「は」写作 ha，在助词位置读 wa。它不等于中文的“是”。', prerequisiteNodeIds: ['grammar.desu'] },
  { id: 'grammar.no', kind: 'grammar', level: 'N5', title: '所属助词 の', reading: 'の', meaningZh: '连接所属、类别或说明关系', explanationZh: 'A の B 表示“A 的 B”，也可以表示类别或产地。', prerequisiteNodeIds: ['grammar.wa'] },
  { id: 'grammar.masu', kind: 'grammar', level: 'N5', title: '动词礼貌形', reading: 'ます／ません', meaningZh: '礼貌地表达动作及其否定', explanationZh: 'ます表示做，ません表示不做；句尾形式决定整个句子的礼貌程度。', prerequisiteNodeIds: ['grammar.desu'] },
  { id: 'grammar.particles.basic', kind: 'grammar', level: 'N5', title: 'を・に・で', meaningZh: '标记对象、目的地与动作场所', explanationZh: 'を标记动作对象；に标记到达点或时间；で标记动作发生的场所。', prerequisiteNodeIds: ['grammar.masu'] },
  { id: 'grammar.exists', kind: 'grammar', level: 'N5', title: 'あります・います', meaningZh: '说明事物或生命体在哪里', explanationZh: '无生命事物一般用あります，人和动物一般用います。', prerequisiteNodeIds: ['grammar.particles.basic'] },
  { id: 'grammar.adjective', kind: 'grammar', level: 'N5', title: 'い形容词与な形容词', meaningZh: '描述事物的性质和感受', explanationZh: 'い形容词直接修饰名词；な形容词修饰名词时需要な。', prerequisiteNodeIds: ['grammar.wa'] },
  { id: 'grammar.te', kind: 'grammar', level: 'N5', title: 'て形请求与连接', meaningZh: '提出请求并连接动作', explanationZh: 'て形是日语动词变化的关键枢纽，可连接多种后续表达。', prerequisiteNodeIds: ['grammar.masu'] },
  { id: 'grammar.potential', kind: 'grammar', level: 'N4', title: '能力与可能', meaningZh: '表达会做或能够做某事', explanationZh: '「ことができる」和动词可能形都能表示能力或客观可能。', prerequisiteNodeIds: ['grammar.te'] },
  { id: 'grammar.reason', kind: 'grammar', level: 'N4', title: 'から・ので', meaningZh: '解释原因和理由', explanationZh: 'から更直接；ので更偏说明，语气通常更柔和。', prerequisiteNodeIds: ['grammar.adjective'] },
  { id: 'grammar.obligation', kind: 'grammar', level: 'N4', title: 'なければならない', meaningZh: '表达必须履行的义务', explanationZh: '由否定条件形加ならない构成，口语中常出现缩略形式。', prerequisiteNodeIds: ['grammar.te'] },
  { id: 'grammar.experience', kind: 'grammar', level: 'N4', title: 'たことがある', meaningZh: '表达过去是否有过某种经历', explanationZh: '动词た形后接ことがある，关注“有没有这种经验”。', prerequisiteNodeIds: ['grammar.masu'] },
  { id: 'grammar.condition', kind: 'grammar', level: 'N4', title: 'と・ば・たら', meaningZh: '表达条件及其结果', explanationZh: '不同条件形式强调规律、假设或事件发生后的结果。', prerequisiteNodeIds: ['grammar.reason'] },
  { id: 'grammar.wakedehanai', kind: 'grammar', level: 'N3', title: 'わけではない', meaningZh: '并不是说……', explanationZh: '否定从前文可能推导出的过度结论，而不是简单否定事实。', prerequisiteNodeIds: ['grammar.condition'] },
  { id: 'grammar.youninaru', kind: 'grammar', level: 'N3', title: 'ようになる', meaningZh: '能力、习惯或状态逐渐发生变化', explanationZh: '强调从以前做不到或不发生，到现在能够或经常发生。', prerequisiteNodeIds: ['grammar.potential'] },
  { id: 'reading.reference', kind: 'reading', level: 'N3', title: '指示词与省略还原', meaningZh: '从上下文找出それ、こと等指代内容', explanationZh: '中级阅读不能只逐句翻译，需要追踪句间指代和被省略的信息。', prerequisiteNodeIds: ['grammar.wakedehanai'] },
  { id: 'grammar.monono', kind: 'grammar', level: 'N2', title: 'ものの', meaningZh: '虽然事实成立，但结果与预期不同', explanationZh: '书面语逆接，前项通常是已确认事实，后项给出保留或相反结果。', prerequisiteNodeIds: ['grammar.wakedehanai'] },
  { id: 'grammar.nikagitte', kind: 'grammar', level: 'N2', title: 'に限って', meaningZh: '偏偏在某个特殊时刻或对象上', explanationZh: '用于强调意外地只在特定情况发生，常带说话人的不满或惊讶。', prerequisiteNodeIds: ['grammar.condition'] },
  { id: 'reading.argument', kind: 'reading', level: 'N2', title: '论点与依据', meaningZh: '区分作者的主张、例子、让步和结论', explanationZh: '长文理解的关键是识别信息角色，而不是平均用力翻译每一句。', prerequisiteNodeIds: ['reading.reference'] },
  { id: 'grammar.niitatte', kind: 'grammar', level: 'N1', title: 'に至って', meaningZh: '直到发展到某个严重或最终阶段', explanationZh: '正式书面表达，突出过程达到某个阶段后才出现判断或行动。', prerequisiteNodeIds: ['grammar.monono'] },
  { id: 'grammar.nakutewaokanai', kind: 'grammar', level: 'N1', title: 'なくてはおかない', meaningZh: '必然会引发某种结果', explanationZh: '表达某事具有强烈作用，势必让人产生反应或让结果发生。', prerequisiteNodeIds: ['grammar.niitatte'] },
  { id: 'listening.inference', kind: 'listening', level: 'N1', title: '态度与言外之意', meaningZh: '根据语气、转折和省略判断真正意图', explanationZh: '高级听力常不直接说结论，需要综合语气和上下文推断。', prerequisiteNodeIds: ['reading.argument'] },
  ...expansionNodes,
]

const anchorLessons: CourseLesson[] = [
  lesson('foundation-kana', 'foundation', 1, '学会第一组平假名', '能读出「あいうえお」，并把五个声音组合成词。', '从五个元音开始，而不是一次背完整张假名表。', [], ['kana.hiragana'], ['日语假名通常对应一个稳定的音节。先点击朗读并跟读，再遮住罗马音回忆。', 'あ a、い i、う u、え e、お o。看到文字时要直接想到声音，不经过中文。'], [{ ja: 'あ', reading: 'a', zh: '像“啊”，嘴巴自然张开' }, { ja: 'い', reading: 'i', zh: '像“衣”，嘴角向两边' }, { ja: 'う', reading: 'u', zh: '嘴唇轻收，不要读得太重' }, { ja: 'え', reading: 'e', zh: '像“诶”但更短' }, { ja: 'お', reading: 'o', zh: '像“哦”，保持短促' }, { ja: 'あお', reading: 'ao', zh: '蓝色' }, { ja: 'いえ', reading: 'ie', zh: '家' }], [question('fq-1', 'kana.hiragana', 'reading', '「あ」的读音是？', ['a', 'i', 'u', 'e'], 0, '「あ」读作 a。'), question('fq-2', 'kana.hiragana', 'reading', '「い」的读音是？', ['i', 'a', 'e', 'o'], 0, '「い」读作 i。'), question('fq-3', 'kana.hiragana', 'reading', '「う」的读音是？', ['u', 'o', 'a', 'i'], 0, '「う」读作 u。'), question('fq-4', 'kana.hiragana', 'reading', '「え」的读音是？', ['e', 'i', 'o', 'u'], 0, '「え」读作 e。'), question('fq-5', 'kana.hiragana', 'reading', '「お」的读音是？', ['o', 'a', 'e', 'u'], 0, '「お」读作 o。'), question('fq-6', 'kana.hiragana', 'reading', '「いえ」应该怎样读？', ['ie', 'ue', 'ae', 'io'], 0, 'い是 i，え是 e，连起来是 ie。')], ['あお', 'いえ']),
  ...kanaUnits.map((unit, index) => createKanaLesson(unit, index === 0 ? 'foundation-kana' : `foundation-kana-${kanaUnits[index - 1].id}`)),
  lesson('foundation-desu', 'foundation', 2, '说出第一个完整句子', '能够用「A は B です」介绍事物。', '理解日语最基础的判断句结构。', ['foundation-kana-mixed'], ['grammar.desu'], ['「です」放在名词后，让判断句保持礼貌。', '日语经常省略上下文已经清楚的主语。'], [{ ja: '学生です。', reading: 'がくせい です。', zh: '是学生。' }, { ja: 'これは本です。', reading: 'これは ほん です。', zh: '这是书。' }], [question('fd-1', 'grammar.desu', 'meaning', '「学生です」最自然的意思是？', ['是学生', '不是学生', '学生在哪里', '想当学生'], 0, '名词后接です，表示礼貌判断。'), question('fd-2', 'grammar.desu', 'usage', '“这是书”应该选哪一句？', ['これは本です。', 'これは本ます。', 'これを本です。', 'これ本を。'], 0, '「これは本です」是完整的判断句。'), question('fd-3', 'grammar.desu', 'usage', '哪一句句尾最适合礼貌判断？', ['日本です。', '日本を。', '日本に。', '日本ます。'], 0, '名词判断句用です结尾。')]),
  lesson('n5-self-introduction', 'N5', 3, '介绍自己和所属', '能够介绍姓名、身份和所属。', '掌握主题与所属关系。', ['foundation-desu'], ['grammar.wa', 'grammar.no'], ['助词「は」提示谈论主题，写作は但读作 wa。', '「A の B」连接所属或类别关系。'], [{ ja: '私は林です。', reading: 'わたしは はやし です。', zh: '我是林。' }, { ja: '日本語の学生です。', reading: 'にほんごの がくせい です。', zh: '是日语专业的学生。' }], [question('n5s-1', 'grammar.wa', 'usage', '私は学生です。句中的「は」表示什么？', ['正在谈论“我”', '动作对象', '动作地点', '过去时间'], 0, 'は把“我”设为句子的主题。'), question('n5s-2', 'grammar.no', 'meaning', '「日本の会社」是什么意思？', ['日本的公司', '去日本公司', '公司在日本', '喜欢日本公司'], 0, 'A の B 可以表示 B 属于或来自 A。'), question('n5s-3', 'grammar.wa', 'usage', '选择正确的自我介绍。', ['私は王です。', '私を王です。', '私に王ます。', '私で王を。'], 0, '主题用は，判断句用です。')], ['私', '名前']),
  lesson('n5-daily-actions', 'N5', 4, '说每天做什么', '能够描述日常动作及其否定。', '学习动词礼貌形和基本助词。', ['n5-self-introduction'], ['grammar.masu', 'grammar.particles.basic'], ['ます表示礼貌的肯定动作，ません表示礼貌否定。', '动作对象用を；目的地或时间常用に；动作场所用で。'], [{ ja: '毎日、日本語を勉強します。', reading: 'まいにち、にほんごを べんきょうします。', zh: '每天学习日语。' }, { ja: '学校で食べません。', reading: 'がっこうで たべません。', zh: '不在学校吃。' }], [question('n5d-1', 'grammar.masu', 'meaning', '「行きません」是什么意思？', ['不去', '去了', '想去', '可以去'], 0, 'ません是ます形的否定。'), question('n5d-2', 'grammar.particles.basic', 'usage', '“在图书馆学习”应使用哪个助词？', ['図書館で', '図書館を', '図書館が', '図書館の'], 0, '动作发生的场所用で。'), question('n5d-3', 'grammar.particles.basic', 'usage', '选择正确句子。', ['日本語を勉強します。', '日本語で勉強を。', '日本語に勉強です。', '日本語は勉強をます。'], 0, '学习的对象用を，动词用します。')], ['毎日', '勉強']),
  lesson('n5-location', 'N5', 5, '找到人和物', '能够说明某人或某物在哪里。', '区分あります与います。', ['n5-daily-actions'], ['grammar.exists'], ['无生命事物一般用あります。', '人和动物一般用います，存在地点用に标记。'], [{ ja: '机の上に本があります。', reading: 'つくえの うえに ほんが あります。', zh: '桌子上有一本书。' }, { ja: '教室に先生がいます。', reading: 'きょうしつに せんせいが います。', zh: '教室里有老师。' }], [question('n5l-1', 'grammar.exists', 'usage', '房间里有猫，应选择？', ['猫がいます。', '猫があります。', '猫をします。', '猫ですか。'], 0, '猫是有生命的动物，用います。'), question('n5l-2', 'grammar.exists', 'usage', '桌上有书，应选择？', ['本があります。', '本がいます。', '本をいます。', '本にです。'], 0, '书是无生命事物，用あります。'), question('n5l-3', 'grammar.exists', 'meaning', '「駅に人がいます」是什么意思？', ['车站有人', '人去车站', '车站是人', '人在找车站'], 0, '地点に + 人がいます表示某地有人。')]),
  lesson('n5-description', 'N5', 6, '描述眼前的世界', '能够描述人和事物的性质。', '掌握两类形容词的基本用法。', ['n5-location'], ['grammar.adjective'], ['い形容词可直接修饰名词，例如おいしい料理。', 'な形容词修饰名词时加な，例如静かな部屋。'], [{ ja: 'この料理はおいしいです。', reading: 'この りょうりは おいしいです。', zh: '这道菜很好吃。' }, { ja: '静かな町です。', reading: 'しずかな まちです。', zh: '是安静的城镇。' }], [question('n5a-1', 'grammar.adjective', 'usage', '选择正确表达。', ['静かな部屋', '静かい部屋', '静かの部屋', '静かを部屋'], 0, '静か是な形容词，修饰名词时使用静かな。'), question('n5a-2', 'grammar.adjective', 'usage', '选择正确表达。', ['おいしい料理', 'おいしいな料理', 'おいしな料理', 'おいしの料理'], 0, 'おいしい是い形容词，可直接修饰名词。'), question('n5a-3', 'grammar.adjective', 'meaning', '「この町は静かです」是什么意思？', ['这个城市很安静', '这个城市很热闹', '去这个城市', '城市里没人'], 0, '静か表示安静。')], ['おいしい', '優しい']),
  lesson('n5-request', 'N5', 7, '礼貌地提出请求', '能够请别人做某事，并理解动作连接。', '建立て形的核心用途。', ['n5-description'], ['grammar.te'], ['动词て形加ください表示礼貌请求。', 'て形还能连接先后动作，是后续大量语法的基础。'], [{ ja: 'もう一度言ってください。', reading: 'もういちど いってください。', zh: '请再说一次。' }, { ja: '朝ご飯を食べて、学校へ行きます。', reading: 'あさごはんを たべて、がっこうへ いきます。', zh: '吃完早饭去学校。' }], [question('n5t-1', 'grammar.te', 'meaning', '「見てください」是什么意思？', ['请看', '不要看', '看过了', '想看'], 0, 'て形加ください表示请求。'), question('n5t-2', 'grammar.te', 'usage', '“请稍等”应该选择？', ['ちょっと待ってください。', 'ちょっと待ちますか。', 'ちょっと待たない。', 'ちょっと待つです。'], 0, '待つ的て形是待って。'), question('n5t-3', 'grammar.te', 'usage', '哪一句自然地连接两个动作？', ['起きて、顔を洗います。', '起きます、顔を洗ってです。', '起きるを顔に洗います。', '起きてください顔。'], 0, 'て形可连接先后动作。')]),
  lesson('n4-ability', 'N4', 8, '说会做和能做到', '能够表达能力与可能性。', '从动作事实进入能力表达。', ['n5-request'], ['grammar.potential'], ['动词辞书形加ことができる可以表达能力。', '实际交流中也常使用动词可能形，例如話せる。'], [{ ja: '日本語を話すことができます。', reading: 'にほんごを はなすことが できます。', zh: '会说日语。' }, { ja: 'この漢字は読めます。', reading: 'この かんじは よめます。', zh: '这个汉字能读。' }], [question('n4p-1', 'grammar.potential', 'meaning', '「泳ぐことができます」是什么意思？', ['会游泳', '正在游泳', '不想游泳', '必须游泳'], 0, 'ことができる表示能力。'), question('n4p-2', 'grammar.potential', 'usage', '“能读这本书”应选择？', ['この本が読めます。', 'この本を読みたいですか。', 'この本で読みません。', 'この本が読むです。'], 0, '読めます是読む的可能形。'), question('n4p-3', 'grammar.potential', 'meaning', '「ここで写真を撮ることができません」是什么意思？', ['这里不能拍照', '这里没有照片', '不想来这里', '正在拍照'], 0, 'できません表示不能。')]),
  lesson('n4-reason-duty', 'N4', 9, '解释原因和义务', '能够说明原因，并表达必须做的事。', '把句子连接成完整理由。', ['n4-ability'], ['grammar.reason', 'grammar.obligation'], ['から和ので都能引出原因；ので通常更柔和。', 'なければならない表示不做不行，即必须。'], [{ ja: '雨なので、家にいます。', reading: 'あめなので、いえに います。', zh: '因为下雨，所以待在家。' }, { ja: '薬を飲まなければなりません。', reading: 'くすりを のまなければ なりません。', zh: '必须吃药。' }], [question('n4r-1', 'grammar.reason', 'usage', '需要较柔和地说明原因时更适合？', ['ので', 'だけ', 'しか', 'ながら'], 0, 'ので偏说明，语气通常比から柔和。'), question('n4r-2', 'grammar.obligation', 'meaning', '「勉強しなければならない」是什么意思？', ['必须学习', '不能学习', '学过了', '想学习'], 0, 'なければならない表示义务。'), question('n4r-3', 'grammar.reason', 'meaning', '「忙しいから、行きません」是什么意思？', ['因为忙，所以不去', '虽然忙，但要去', '去忙碌的地方', '忙完再去'], 0, 'から前面给出不去的原因。')]),
  lesson('n4-experience-condition', 'N4', 10, '谈经历和条件', '能够谈论经历并说明条件结果。', '从单句进入条件关系。', ['n4-reason-duty'], ['grammar.experience', 'grammar.condition'], ['たことがある表达是否拥有某种经历。', 'たら常表示某件事发生后或假设发生时的结果。'], [{ ja: '京都へ行ったことがあります。', reading: 'きょうとへ いったことが あります。', zh: '去过京都。' }, { ja: '時間があったら、映画を見ます。', reading: 'じかんが あったら、えいがを みます。', zh: '如果有时间，就看电影。' }], [question('n4e-1', 'grammar.experience', 'meaning', '「食べたことがありません」是什么意思？', ['没吃过', '不吃', '不能吃', '正在吃'], 0, 'たことがない表示没有过这种经历。'), question('n4e-2', 'grammar.condition', 'meaning', '「駅に着いたら、電話してください」是什么意思？', ['到车站后请打电话', '打电话才能到车站', '不要去车站', '电话在车站'], 0, 'たら表示到站这一条件达成后。'), question('n4e-3', 'grammar.condition', 'usage', '“如果便宜就买”应选择？', ['安かったら、買います。', '安いので、買いません。', '安くては、買うです。', '安いを、買います。'], 0, 'い形容词过去形加ら构成条件：安かったら。')]),
  lesson('n3-nuance', 'N3', 11, '避免把话说得太绝对', '能够理解并使用部分否定。', '掌握中级表达中的语气边界。', ['n4-experience-condition'], ['grammar.wakedehanai'], ['わけではない用于否定一个可能被误解的推论。', '它常翻译为“并不是说……”，不是普通的“不”。'], [{ ja: '甘い物が嫌いなわけではありません。', reading: 'あまいものが きらいな わけではありません。', zh: '并不是讨厌甜食。' }, { ja: '高ければいいというわけではない。', reading: 'たかければ いいという わけではない。', zh: '并不是越贵越好。' }], [question('n3w-1', 'grammar.wakedehanai', 'meaning', '「行きたくないわけではない」最接近？', ['并不是不想去', '绝对不去', '已经去了', '必须去'], 0, '它否定“不想去”这一判断，暗示还有其他原因。'), question('n3w-2', 'grammar.wakedehanai', 'usage', '哪一句表达“并不是所有人都赞成”？', ['全員が賛成しているわけではない。', '全員が賛成しなければならない。', '全員が賛成したことがある。', '全員が賛成するようになる。'], 0, 'わけではない可限制全称判断。'), question('n3w-3', 'grammar.wakedehanai', 'comprehension', '“便利だが、必要なわけではない”说明？', ['方便，但未必必要', '既不方便也不必要', '因为方便所以必须', '以前很必要'], 0, '前句承认方便，后句否定“因此就必要”的推论。')]),
  lesson('n3-change-reference', 'N3', 12, '理解变化与上下文指代', '能够描述能力变化，并还原上下文省略。', '把语法理解扩展到段落理解。', ['n3-nuance'], ['grammar.youninaru', 'reading.reference'], ['ようになる表示能力、习惯或状态逐渐变化。', '阅读时要追踪それ、こと、もの所指的前文内容。'], [{ ja: '日本語のニュースが分かるようになりました。', reading: 'にほんごの ニュースが わかるように なりました。', zh: '逐渐能看懂日语新闻了。' }, { ja: '毎日声に出す。それが上達への近道だ。', reading: 'まいにち こえに だす。それが じょうたつへの ちかみちだ。', zh: '每天朗读。这是进步的捷径。', note: 'それ指前句“每天朗读”。' }], [question('n3y-1', 'grammar.youninaru', 'meaning', '「早く起きられるようになった」是什么意思？', ['变得能早起了', '必须早起', '以前总是早起', '不想早起'], 0, '可能形加ようになる表示能力发生变化。'), question('n3y-2', 'reading.reference', 'comprehension', '“毎日読む。それが大切だ。”中的それ指什么？', ['每天阅读', '重要', '某本书', '今天'], 0, 'それ回指前句整件事。'), question('n3y-3', 'grammar.youninaru', 'usage', '哪一句表达“开始不喝咖啡了”？', ['コーヒーを飲まないようになった。', 'コーヒーを飲むことができた。', 'コーヒーを飲んだことがある。', 'コーヒーを飲まなければならない。'], 0, '否定形加ようになる表示习惯变为不做。')]),
  lesson('n3-reading', 'N3', 13, '读懂段落真正想说什么', '能够区分事实、解释和作者结论。', '建立中长文阅读的结构意识。', ['n3-change-reference'], ['reading.reference'], ['先寻找转折、原因和结论标记，再处理细节。', '作者举例不等于作者的最终主张。'], [{ ja: '便利になった。しかし、考える時間は減った。', reading: 'べんりに なった。しかし、かんがえる じかんは へった。', zh: '变方便了，但是思考的时间减少了。', note: 'しかし后通常出现作者更想强调的信息。' }], [question('n3rd-1', 'reading.reference', 'comprehension', '“便利になった。しかし、考える時間は減った。”重点更可能在？', ['便利带来的另一面', '完全否定便利', '时间变多了', '介绍某个商品'], 0, '转折后的信息通常承载作者主要提醒。'), question('n3rd-2', 'reading.reference', 'comprehension', '文章先举例，再说「つまり」时，后面通常是？', ['总结或换言说明', '完全无关的话题', '新的时间地点', '引用来源'], 0, 'つまり常引出总结或换言。'), question('n3rd-3', 'reading.reference', 'usage', '阅读长句时更可靠的第一步是？', ['先找谓语和连接关系', '逐字查完再看句子', '只看汉字猜意思', '忽略助词'], 0, '先确认句子骨架，再处理修饰部分。')]),
  lesson('n2-concession', 'N2', 14, '理解正式文章中的让步', '能够识别“虽然成立，但结果不同”的论证。', '进入正式书面表达。', ['n3-reading'], ['grammar.monono'], ['ものの承认前项事实，再给出与预期不同的后项。', '它比けれども更偏书面，常用于评论和说明。'], [{ ja: '準備はしたものの、まだ不安が残る。', reading: 'じゅんびは したものの、まだ ふあんが のこる。', zh: '虽然做了准备，但仍然不安。' }], [question('n2m-1', 'grammar.monono', 'meaning', '「買ったものの、使っていない」是什么意思？', ['虽然买了，但没用', '因为没买，所以不能用', '买来就是为了使用', '一边买一边用'], 0, 'ものの连接已发生事实与不符预期的结果。'), question('n2m-2', 'grammar.monono', 'usage', '哪一句最自然？', ['約束したものの、自信がない。', '約束するもののです。', '約束をものの、自信。', '約束したものの、だから。'], 0, '普通形后接ものの，再给出逆接结果。'), question('n2m-3', 'grammar.monono', 'comprehension', '使用ものの时，说话人通常？', ['承认前项，但更关注后项问题', '完全否定前项发生', '只列举两个并列动作', '表达强制义务'], 0, '它的核心是让步和保留。')]),
  lesson('n2-exception-argument', 'N2', 15, '抓住例外和作者论点', '能够理解特殊强调，并区分论点与依据。', '训练 N2 长文所需的信息结构。', ['n2-concession'], ['grammar.nikagitte', 'reading.argument'], ['に限って突出“偏偏只有这个时候或对象”。', '阅读议论文时分别标记主张、依据、例子和让步。'], [{ ja: '急いでいる日に限って、電車が遅れる。', reading: 'いそいでいる ひに かぎって、でんしゃが おくれる。', zh: '偏偏在赶时间的日子，电车晚点。' }, { ja: '確かに便利だ。しかし、それだけで十分とは言えない。', reading: 'たしかに べんりだ。しかし、それだけで じゅうぶんとは いえない。', zh: '确实方便，但不能说仅此就足够。' }], [question('n2k-1', 'grammar.nikagitte', 'meaning', '「大事な時に限って失敗する」表达？', ['偏偏在重要时刻失败', '只有失败才重要', '重要时刻必须失败', '从未失败'], 0, 'に限って常带意外或懊恼。'), question('n2k-2', 'reading.argument', 'comprehension', '「確かにA。しかしB」中作者最终更可能支持？', ['B', 'A', 'A和B毫无关系', '无法判断有无转折'], 0, '確かに先承认A，しかし后提出作者真正要推进的B。'), question('n2k-3', 'reading.argument', 'usage', '下列哪一项属于“依据”？', ['支持结论的数据和理由', '文章标题字体', '作者姓名', '读者的阅读速度'], 0, '依据用于支撑主张。')]),
  lesson('n2-reading', 'N2', 16, '处理抽象长文', '能够沿着论证结构定位答案。', '不再依赖逐句翻译完成阅读。', ['n2-exception-argument'], ['reading.argument'], ['先用连接词和段落首尾定位论证结构。', '题目问作者观点时，不能把引用对象的观点当成作者观点。'], [{ ja: '一見すると非効率に思える。だが、長期的には大きな効果をもたらす。', reading: 'いっけんすると ひこうりつに おもえる。だが、ちょうきてきには おおきな こうかを もたらす。', zh: '乍看低效，但长期会带来巨大效果。' }], [question('n2rd-1', 'reading.argument', 'comprehension', '作者引用反对意见后用「しかし」继续，通常是为了？', ['回应或反驳反对意见', '结束文章', '证明自己同意反对者', '说明时间顺序'], 0, '让步后转折通常进入作者回应。'), question('n2rd-2', 'reading.argument', 'comprehension', '问“作者最想说什么”时应优先看？', ['反复出现并被结论重申的主张', '最生僻的单词', '第一个例子', '文章里最长的句子'], 0, '核心主张会得到多处支撑并在结论收束。'), question('n2rd-3', 'reading.argument', 'usage', '遇到陌生词时，哪种策略更有效？', ['先判断它在论证中的作用', '立即放弃整段', '只按汉字中文义理解', '忽略前后连接词'], 0, '即使不知道精确词义，也能通过结构和上下文判断作用。')]),
  lesson('n1-formal', 'N1', 17, '理解高级书面语的阶段变化', '能够理解正式文章中“发展到某阶段”的表达。', '进入 N1 正式论述语体。', ['n2-reading'], ['grammar.niitatte'], ['に至って表示事态经过过程，终于达到某个阶段。', '常与初めて、ようやく等共同突出行动或认识来得较晚。'], [{ ja: '事態が深刻になるに至って、ようやく対策が取られた。', reading: 'じたいが しんこくに なるに いたって、ようやく たいさくが とられた。', zh: '直到事态变得严重，才终于采取对策。' }], [question('n1i-1', 'grammar.niitatte', 'meaning', '「問題が表面化するに至って」表示？', ['发展到问题公开显现的阶段', '为了隐藏问题', '问题从未发生', '问题已经自动解决'], 0, 'に至って突出过程达到某阶段。'), question('n1i-2', 'grammar.niitatte', 'usage', '哪一句最自然？', ['被害が拡大するに至って、調査が始まった。', '被害を至って、調査です。', '被害が拡大に至るを始まった。', '被害に調査を至って。'], 0, '动词辞书形加に至って可作时间阶段背景。'), question('n1i-3', 'grammar.niitatte', 'comprehension', '这种表达经常暗含什么评价？', ['行动或认识出现得较晚', '事情毫无过程', '只是日常习惯', '说话人正在请求许可'], 0, '达到严重阶段才行动，常暗含“为时较晚”。')]),
  lesson('n1-consequence', 'N1', 18, '判断强烈影响与必然结果', '能够理解高级表达中的因果力度。', '辨别事实、推测和强烈必然判断。', ['n1-formal'], ['grammar.nakutewaokanai'], ['なくてはおかない表示某事力量很强，必然引发反应或结果。', '主体常是事件、作品、言论等具有影响力的事物。'], [{ ja: 'その作品は見る者を感動させなくてはおかない。', reading: 'その さくひんは みるものを かんどうさせなくては おかない。', zh: '那部作品必然会打动观众。' }], [question('n1n-1', 'grammar.nakutewaokanai', 'meaning', '「人々を驚かせなくてはおかない」表示？', ['势必让人们吃惊', '不允许人们吃惊', '人们必须假装吃惊', '以前没人吃惊'], 0, '表示具有必然引发惊讶的力量。'), question('n1n-2', 'grammar.nakutewaokanai', 'usage', '哪一句语义最符合这一表达？', ['その知らせは社会に影響を与えなくてはおかない。', '私は毎朝起きなくてはおかない。', '窓を開けなくてはおかないですか。', '本を読まなくてはおかない予定だ。'], 0, '它适合描述某事必然产生影响，不用于普通个人义务。'), question('n1n-3', 'grammar.nakutewaokanai', 'comprehension', '它与「なければならない」的主要区别是？', ['前者说必然影响，后者说义务', '两者完全相同', '前者只表示过去', '后者只用于动物'], 0, '不要被相似形式迷惑：语义功能不同。')]),
  lesson('n1-inference', 'N1', 19, '听懂没有直接说出的结论', '能够根据转折、语气和省略推断说话人意图。', '完成从语言知识到高级理解策略的连接。', ['n1-consequence'], ['listening.inference'], ['高级听力常先承认一部分，再用语气或转折表达真正立场。', '注意结尾犹豫、否定问句和省略，它们可能比字面词义更关键。'], [{ ja: '悪くはないんですが、今回はちょっと……。', reading: 'わるくは ないんですが、こんかいは ちょっと……。', zh: '倒也不是不好，不过这次有点……', note: '实际意图通常是委婉拒绝。' }], [question('n1l-1', 'listening.inference', 'comprehension', '对方说「今回はちょっと……」最可能的意图是？', ['委婉拒绝', '明确赞成', '要求再来一次', '没有听见'], 0, 'ちょっと后省略负面结论，是常见委婉拒绝。'), question('n1l-2', 'listening.inference', 'comprehension', '「行けないこともない」通常表示？', ['并非完全不能去，但有保留', '绝对不能去', '一定会去', '已经去过'], 0, '双重否定保留可能性，但语气并不积极。'), question('n1l-3', 'listening.inference', 'usage', '推断说话人意图时最不应该只依赖？', ['单个关键词的字面义', '转折位置', '语气和停顿', '前后对话目的'], 0, '高级听力需要综合上下文，单个词容易误导。')]),
]

const levelOrder: CourseLevel[] = ['foundation', 'N5', 'N4', 'N3', 'N2', 'N1']
const orderedLessons = [...anchorLessons, ...expansionLessons].sort((a, b) => {
  const levelDifference = levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level)
  return levelDifference || a.order - b.order
})

export const courseLessons: CourseLesson[] = orderedLessons.map((item, index) => ({
  ...item,
  order: index + 1,
  prerequisiteLessonIds: index === 0 ? [] : [orderedLessons[index - 1].id],
}))

const stageMeta: Array<Omit<CourseStage, 'lessonIds'>> = [
  { id: 'foundation', label: '入门', title: '建立日语感觉', description: '声音、文字与最基础句子。' },
  { id: 'N5', label: 'N5 基础', title: '开始独立表达', description: '日常动作、地点、描述与请求。' },
  { id: 'N4', label: 'N4 进阶', title: '连接完整意思', description: '能力、原因、义务、经历与条件。' },
  { id: 'N3', label: 'N3 中级', title: '读懂语气和上下文', description: '部分否定、变化与段落结构。' },
  { id: 'N2', label: 'N2 高级', title: '处理正式长文', description: '让步、例外与抽象论证。' },
  { id: 'N1', label: 'N1 冲刺', title: '理解复杂表达', description: '高级书面语、必然结果与言外之意。' },
]

export const courseStages: CourseStage[] = stageMeta.map((stage) => ({
  ...stage,
  lessonIds: courseLessons.filter((item) => item.level === stage.id).map((item) => item.id),
}))

export const courseNodeMap = new Map(courseNodes.map((node) => [node.id, node]))
export const courseLessonMap = new Map(courseLessons.map((item) => [item.id, item]))

export const placementQuestions: CourseQuestion[] = [
  courseLessonMap.get('foundation-kana')!.questions[0],
  courseLessonMap.get('foundation-desu')!.questions[0],
  courseLessonMap.get('n5-daily-actions')!.questions[0],
  courseLessonMap.get('n5-description')!.questions[0],
  courseLessonMap.get('n4-reason-duty')!.questions[1],
  courseLessonMap.get('n4-experience-condition')!.questions[0],
  courseLessonMap.get('n3-nuance')!.questions[0],
  courseLessonMap.get('n3-change-reference')!.questions[0],
  courseLessonMap.get('n2-concession')!.questions[0],
  courseLessonMap.get('n2-exception-argument')!.questions[0],
]
