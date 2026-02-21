import os
import time
from pathlib import Path

import requests

OUT_DIR = Path("dummy_images")
COUNT = 50
WIDTH = 600
HEIGHT = 600
TIMEOUT = 20  # seconds

def download_images(count: int = COUNT, width: int = WIDTH, height: int = HEIGHT) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    headers = {
        "User-Agent": "dummy-image-downloader/1.0"
    }

    ok = 0
    for i in range(1, count + 1):
        # `?random=` helps ensure different images
        url = f"https://picsum.photos/{width}/{height}?random={i}"

        filename = OUT_DIR / f"image_{i:03d}_{width}x{height}.jpg"

        try:
            resp = session.get(url, headers=headers, timeout=TIMEOUT, allow_redirects=True)
            resp.raise_for_status()

            # Picsum returns JPEG bytes (usually) via redirects
            with open(filename, "wb") as f:
                f.write(resp.content)

            ok += 1
            print(f"[{i:02d}/{count}] saved: {filename}")

            # tiny delay to be polite / reduce rate-limit risk
            time.sleep(0.05)

        except requests.RequestException as e:
            print(f"[{i:02d}/{count}] FAILED: {url} -> {e}")

    print(f"\nDone. Downloaded {ok}/{count} images into: {OUT_DIR.resolve()}")

if __name__ == "__main__":
    download_images()