import { describe, expect, it } from 'vitest'
import { categoryOf, convertText, outputFileName, parseDelimited, textTargets } from '../shared/conversion'

describe('format conversion documents and routing', () => {
  it('recognizes common aliases across all four categories', () => {
    for (const name of ['photo.JPEG', 'scan.tif', 'art.svg', 'phone.heic', 'icon.ico']) expect(categoryOf(name)).toBe('image')
    for (const name of ['movie.mkv', 'clip.MP4', 'camera.mts']) expect(categoryOf(name)).toBe('video')
    for (const name of ['music.flac', 'recording.m4a', 'music.ape']) expect(categoryOf(name)).toBe('audio')
    for (const name of ['notes.md', 'budget.xlsx', 'deck.pptx', 'book.pdf']) expect(categoryOf(name)).toBe('document')
    expect(categoryOf('program.exe')).toBeNull()
    expect(outputFileName('my.movie.MP4', 'mp3')).toBe('my.movie.mp3')
  })
  it('parses CSV quotes, delimiters, multiline fields, BOM, and empty trailing cells', () => {
    const source = '\uFEFFname,description,empty\r\n"A,B","line 1\nline ""2""",\r\n'
    expect(parseDelimited(source, ',')).toEqual([['name', 'description', 'empty'], ['A,B', 'line 1\nline "2"', '']])
    expect(parseDelimited('a\t"b\tc"\t', '\t')).toEqual([['a', 'b\tc', '']])
    expect(parseDelimited('""', ',')).toEqual([['']])
    expect(() => parseDelimited('"unfinished', ',')).toThrow('未闭合')
    expect(() => parseDelimited('"closed"suffix', ',')).toThrow('引号格式')
  })
  it('roundtrips CSV through JSON without losing empty or multiline values', () => {
    const source = 'title,body\r\n"a,b","first\nsecond"\r\n"",尾行'
    const json = convertText(source, 'csv', 'json')
    const csv = convertText(json, 'json', 'csv')
    expect(parseDelimited(csv, ',')).toEqual(parseDelimited(source, ','))
  })
  it('unifies JSON object columns and preserves nested values', () => {
    const source = JSON.stringify([{ name: '丝月', count: 0, enabled: false, detail: { n: 1 } }, { other: 'x' }])
    expect(parseDelimited(convertText(source, 'json', 'csv'), ',')).toEqual([
      ['name', 'count', 'enabled', 'detail', 'other'], ['丝月', '0', 'false', '{"n":1}', ''], ['', '', '', '', 'x'],
    ])
    expect(() => convertText('{"x":1}', 'json', 'csv')).toThrow('JSON 数组')
    expect(() => convertText('[1,"two"]', 'json', 'tsv')).toThrow('二维数组')
  })
  it('escapes HTML and keeps markdown source literal', () => {
    const html = convertText('# Heading\n<script>alert("x")</script>', 'md', 'html')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<pre># Heading')
    expect(convertText('a,<b>', 'csv', 'html')).toContain('<td>&lt;b&gt;</td>')
    expect(textTargets('pdf')).toEqual([])
    expect(() => convertText('PDF', 'pdf', 'docx')).toThrow('不支持')
  })
})
