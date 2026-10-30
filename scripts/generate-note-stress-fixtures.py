"""Generate importable notes-only backups; never opens the application or its DB."""
import argparse
import base64
import hashlib
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    image = args.image.read_bytes()
    source = 'data:image/jpeg;base64,' + base64.b64encode(image).decode('ascii')
    stamp = datetime.now(timezone.utc)
    manifest = {'createdAt': stamp.isoformat(), 'sourceImage': {
        'name': args.image.name, 'bytes': len(image),
        'sha256': hashlib.sha256(image).hexdigest(),
        'encoding': 'Original JPEG bytes, unchanged; repeated copies of the same image.'
    }, 'files': []}
    prose = (
        '清晨的工坊还很安静，窗边的光线慢慢落在桌面上。我打开昨天没有写完的笔记，'
        '把零散的念头整理成可以继续推进的事情。先写下今天最重要的问题，再记录观察到的细节，'
        '最后留下一个下次打开时能够接续的线索。文字不需要一次成形，修改与补充也是思考的一部分。'
        '午后适合阅读和归档，夜晚适合回顾与创作；当材料逐渐增加，清晰的章节和可靠的保存会让记录更从容。'
    )

    def paragraph(text):
        return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}

    def heading(text):
        return {'type': 'heading', 'attrs': {'level': 2}, 'content': [{'type': 'text', 'text': text}]}

    def note(index, title, blocks, folder='stress', pinned=False):
        when = (stamp - timedelta(seconds=index)).isoformat()
        return {'id': f'stress-{folder}-{index:06}', 'title': title,
                'content': {'type': 'doc', 'content': blocks}, 'folderId': folder,
                'tags': ['压力测试'], 'pinned': pinned, 'deletedAt': None,
                'createdAt': when, 'updatedAt': when}

    def control(folder):
        return note(0, '000｜输入对照：从这里开始打字', [
            heading('普通短笔记输入对照'), paragraph('这是一篇短笔记。可以在此输入，观察其他笔记的数量和体积是否影响当前编辑。'),
            paragraph('随后切换到长文或图片笔记，在开头、中间和结尾分别输入，停顿等待自动保存，再切换回来。')
        ], folder, True)

    def write(name, notes, folder, description, expected_images=0, body_chars=None):
        path = output / name
        if path.exists():
            raise FileExistsError(f'Refusing to overwrite: {path}')
        count = 0
        images = 0
        ids = set()
        with path.open('w', encoding='utf-8', newline='\n') as file:
            envelope = {'format': 'siyue-workshop-partial-backup', 'version': 1,
                        'section': 'notes', 'exportedAt': stamp.isoformat()}
            file.write(json.dumps(envelope, ensure_ascii=False)[:-1])
            file.write(',"payload":{"folders":')
            json.dump([{'id': folder, 'name': description, 'createdAt': stamp.isoformat(), 'updatedAt': stamp.isoformat()}], file, ensure_ascii=False)
            file.write(',"notes":[')
            for item in notes:
                assert item['id'] not in ids
                assert item['folderId'] == folder
                ids.add(item['id'])
                if count:
                    file.write(',')
                json.dump(item, file, ensure_ascii=False, separators=(',', ':'))
                images += sum(node['type'] == 'image' for node in item['content']['content'])
                count += 1
            file.write(']}}\n')
        assert images == expected_images
        info = {'file': name, 'notes': count, 'imageOccurrences': images,
                'bytes': path.stat().st_size, 'description': description}
        if body_chars is not None:
            info['longArticleBodyCharacters'] = body_chars
        manifest['files'].append(info)
        print(json.dumps(info, ensure_ascii=True), flush=True)

    for count in (1000, 10000):
        folder = f'count-{count}'
        def items():
            yield control(folder)
            for index in range(1, count):
                yield note(index, f'{index:05}｜工坊观察日志 · 第 {index} 天', [
                    heading(f'第 {index} 次记录'), paragraph(f'记录编号 {index}。' + prose * 2),
                    paragraph('今天完成了阅读、归档和计划整理。下一次继续从这段记录开始。')
                ], folder)
        write(f'01-count-{count}.json', items(), folder, f'{count:,} 篇短笔记（含一篇输入对照）')

    for size in (100000, 1000000):
        folder = f'long-{size}'
        blocks = []
        remaining = size
        index = 0
        while remaining:
            index += 1
            if (index - 1) % 20 == 0:
                blocks.append(heading(f'第 {(index - 1) // 20 + 1} 章｜工坊的一天'))
            text = (prose * 3)[:min(400, remaining)]
            blocks.append(paragraph(text))
            remaining -= len(text)
        blocks.append(paragraph('长文结尾：可以在这里继续输入。'))
        write(f'02-long-{size}.json', [control(folder), note(1, f'长篇文章｜正文 {size:,} 字', blocks, folder)],
              folder, f'单篇正文 {size:,} 字，另有标题与结尾及一篇输入对照', body_chars=size)

    for count in (5, 15, 30):
        folder = f'images-{count}'
        blocks = [heading('原尺寸图片收藏手记'), paragraph('所有图片均为同一张原图的重复嵌入，原 JPEG 字节保持不变。')]
        for index in range(1, count + 1):
            blocks.extend([heading(f'第 {index} 张｜星光与羽翼'), paragraph(prose),
                           {'type': 'image', 'attrs': {'src': source, 'alt': f'原图第 {index} 次嵌入',
                            'caption': f'4740 × 2160 原尺寸 JPEG，第 {index} / {count} 张'}},
                           paragraph(f'第 {index} 张图片后的记录：可在这里输入文字或另起一段。')])
        blocks.append(paragraph('图片笔记结尾：可以从这里继续写。'))
        write(f'03-images-{count}.json', [control(folder), note(1, f'图片长文｜{count} 张高质量原图', blocks, folder)],
              folder, f'单篇 {count} 张原图，另有一篇输入对照', expected_images=count)

    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    rows = '\n'.join(f"| `{f['file']}` | {f['description']} | {f['bytes'] / 1024**2:.1f} MiB |" for f in manifest['files'])
    readme = f'''# 笔记压力测试素材

这七份文件均为丝月工坊可导入的「笔记」局部备份。只生成文件，没有导入应用，也没有进行性能测试。

在完全重启后的开发版中，进入「设置 → 本地数据 → 导入局部备份」，每次选择一份 JSON。每次导入会替换全部笔记及文件夹，不是累加；其他功能页面保持不变。请勿导入日常使用的正式版。

| 文件 | 内容 | 文件大小 |
| --- | --- | ---: |
{rows}

每份都有置顶的「输入对照」短笔记。数量档可比较其他笔记增长时的输入表现；长文和图片档可比较当前单篇增长时的表现。可自行观察切换、输入、停顿后的自动保存和重启后的读取。

图片来自你提供的 4740 × 2160 JPEG，原文件 {len(image):,} 字节。没有缩放、重新编码或降低质量。每个图片节点都内嵌完整 Base64，故 JSON 比原图大约增加三分之一。

图片是同一张的重复嵌入，不是多张不同照片。它能增加正文、IPC 和数据库的数据体积，但浏览器可能共享同源图片的解码缓存，不能代表同数量不同照片的最坏显存／解码成本。

30 张档约 367 MiB，导入过程中的内存占用会明显高于文件体积。没有生成 50 张以上的单个文件，因为其 JSON 文本超过 600 MB，可能先触发 V8 单字符串长度上限，使导入失败，无法用于观察编辑性能。

`manifest.json` 记录文件规模和原图 SHA-256。长文的标称字数只统计正文段落，不含章节标题、结尾说明和对照笔记。
'''
    (output / '使用说明.md').write_text(readme, encoding='utf-8')


if __name__ == '__main__':
    main()
