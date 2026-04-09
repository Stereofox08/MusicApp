#!/usr/bin/env python3
"""
YouTube поиск без API ключа.
Использует youtube-search-python: pip install youtube-search-python
"""
import sys
import json
from youtubesearchpython import VideosSearch

def search(query, limit=20):
    vs = VideosSearch(query, limit=limit)
    results = vs.result()
    tracks = []
    for item in results.get('result', []):
        # Парсим длительность "3:45" → секунды
        duration = 0
        dur_str = item.get('duration') or ''
        parts = dur_str.split(':')
        try:
            if len(parts) == 2:
                duration = int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                duration = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except Exception:
            pass

        thumbnails = item.get('thumbnails') or []
        artwork = thumbnails[0]['url'] if thumbnails else None

        tracks.append({
            'id': f"yt_{item['id']}",
            'youtube_id': item['id'],
            'title': item.get('title', ''),
            'artist': (item.get('channel') or {}).get('name', 'Unknown'),
            'duration': duration,
            'artwork': artwork,
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
