"""Read-only checks and Poppler rendering of PDFs produced by fictional browser fixtures."""
import json
import re
import shutil
import subprocess
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1] / "test-results"
out = root / "pdf-final"
out.mkdir(exist_ok=True)
poppler = shutil.which("pdftoppm")
if not poppler:
    raise RuntimeError("Poppler pdftoppm is required for visual PDF verification.")
files = ["teacher-tools/document-a4.pdf", "teacher/roster-a4.pdf",
         "teacher-exam/fictional-exam-a4.pdf", "teacher-exam/style-formal.pdf",
         "teacher-exam/style-primary.pdf", "teacher-exam/style-minimal.pdf"]
results = []
for name in files:
    source = root / name
    reader = PdfReader(source)
    for page in reader.pages:
        assert abs(float(page.mediabox.width) - 595.28) < 2, name
        assert abs(float(page.mediabox.height) - 841.89) < 2, name
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    arabic = len(re.findall(r"[\u0600-\u06ff]", text))
    assert arabic > 20, f"Arabic text is not selectable in {name}"
    fonts = {}
    for page in reader.pages:
        resources = page.get("/Resources", {}).get_object()
        for ref in resources.get("/Font", {}).get_object().values():
            font = ref.get_object()
            descendants = font.get("/DescendantFonts", [font])
            for child in descendants:
                child = child.get_object()
                descriptor = child.get("/FontDescriptor")
                embedded = bool(descriptor and any(key in descriptor.get_object()
                    for key in ["/FontFile", "/FontFile2", "/FontFile3"]))
                # Type3 glyph programs are embedded in CharProcs rather than FontFile.
                embedded = embedded or bool(child.get("/Subtype") == "/Type3" and child.get("/CharProcs"))
                fonts[str(child.get("/BaseFont", child.get("/Subtype", "unknown")))] = embedded
    assert fonts and all(fonts.values()), f"Unembedded font: {name} {fonts}"
    prefix = out / source.stem
    subprocess.run([poppler, "-r", "110", "-png", str(source), str(prefix)], check=True)
    results.append({"file": name, "pages": len(reader.pages), "a4": True,
                    "selectableArabicCharacters": arabic, "fontsEmbedded": fonts})
(out / "verification.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False))
