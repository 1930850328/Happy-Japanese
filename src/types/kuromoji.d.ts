declare module 'kuromoji' {
  export interface IpadicFeatures {
    word_id: number
    word_type: string
    word_position: number
    surface_form: string
    pos: string
    pos_detail_1: string
    pos_detail_2: string
    pos_detail_3: string
    conjugated_type: string
    conjugated_form: string
    basic_form: string
    reading: string
    pronunciation: string
  }

  export interface Tokenizer<T> {
    tokenize(text: string): T[]
  }

  interface Builder {
    build(callback: (error: Error | null, tokenizer: Tokenizer<IpadicFeatures>) => void): void
  }

  const kuromoji: {
    builder(options: { dicPath: string }): Builder
  }

  export default kuromoji
}
