#!/usr/bin/env python3
"""
YouTube поиск через yt-dlp — без youtube-search-python, без API ключей.
"""
import sys
import json
import subprocess

def search(query, limit=20):
    # yt-dlp умеет искать на YouTube напрямую через ytsearch
    result = subprocess.run(
        [
            'yt-dlp',
            f'ytsearch{limit}:{query}',
            '--dump-json',
            '--flat-playlist',
            '--no-warnings',
            '--quiet',
        ],
        capture_output=True, text=True, timeout=30
    )

    tracks = []
    for line in result.stdout.strip().split('\n'):
        if not line:
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue

        duration = item.get('duration') or 0
        thumbnail = None
        thumbs = item.get('thumbnails') or []
        if thumbs:
            thumbnail = thumbs[-1].get('url')
        elif item.get('thumbnail'):
            thumbnail = item['thumbnail']

        tracks.append({
            'id': f"yt_{item['id']}",
            'youtube_id': item['id'],
            'title': item.get('title', ''),
            'artist': item.get('channel') or item.get('uploader') or 'Unknown',
            'duration': int(duration) if duration else 0,
            'artwork': thumbnail,
            'source': 'youtube',
        })

    return tracks

if __name__ == '__main__':
    query = sys.argv[1] if len(sys.argv) > 1 else ''
    if not query:
        print(json.dumps([]))
        sys.exit(0)
    results = search(query)
    print(json.dumps(results, ensure_ascii=False))
