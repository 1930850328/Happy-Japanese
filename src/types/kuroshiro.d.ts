declare module 'kuroshiro' {
  class Kuroshiro {
    init(analyzer: unknown): Promise<void>
    convert(
      input: string,
      options?: {
        to?: 'hiragana' | 'katakana' | 'romaji'
        romajiSystem?: 'nippon' | 'passport' | 'hepburn'
      },
    ): Promise<string>
  }

  export default Kuroshiro
}

declare module 'kuroshiro-analyzer-kuromoji' {
  class KuromojiAnalyzer {
    constructor(options: { dictPath: string })
  }

  export default KuromojiAnalyzer
}
