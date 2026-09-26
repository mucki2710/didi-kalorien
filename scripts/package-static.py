from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
files = ['index.html', 'styles.css', 'app.js', 'csv.js', 'storage.js', 'openai.js',
         'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']
target = root / 'dist'
target.mkdir(exist_ok=True)
with ZipFile(target / 'didi-ipad.zip', 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / 'public' / name, name)
print('Erstellt: dist/didi-ipad.zip (nur öffentliche App-Dateien)')
