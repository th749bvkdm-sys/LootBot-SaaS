"""Read a verified Mufakir source and privately locate literal answer footers.

This read-only PDF profiler never approves questions or writes a database. The
proof, source register and exact file hash are checked before opening the PDF.
Image extraction and independent content/crop review remain separate steps.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
LABEL = r"(?:الإجابة|الاجابة|لإجابة|الإجدبة|الإجوبة|الإجانة|الإتا\s*ة|الإج\s*بر)"
DIRECT = re.compile(LABEL + r"\s*:?\s*([أبجد])")
REVERSE = re.compile(r"([أبجد])\s*:?\s*" + LABEL)


def authorized(pdf: Path, proof: Path, register: Path) -> dict:
    """Share the importer's verified-evidence gate; never infer a license."""
    spec = importlib.util.spec_from_file_location("mufakir_private_import", ROOT / "scripts/extract-mufakir-questions.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.authorize(pdf, proof, register)


def footer_evidence(chars: list[dict]) -> tuple[str | None, list[str]]:
    raw = unicodedata.normalize("NFKC", "".join(char["text"] for char in chars))
    ordered = unicodedata.normalize("NFKC", "".join(char["text"] for char in sorted(chars, key=lambda char: -char["x0"])))
    variants = [raw, raw[::-1], ordered]
    direct = [key for text in variants for key in DIRECT.findall(text)]
    reverse = [key for text in variants for key in REVERSE.findall(text)]
    # A prefix in a lam-alef glyph must never be interpreted as option A.
    keys = set(direct or reverse)
    return (next(iter(keys)) if len(keys) == 1 else None), variants


def run(args) -> dict:
    pdf = Path(args.pdf).resolve()
    proof = Path(args.license).resolve()
    evidence = authorized(pdf, proof, Path(args.register).resolve())
    output = Path(args.output).resolve()
    private_root = (ROOT / ".local/quant-imports").resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    with pdfplumber.open(pdf) as document:
        count = len(document.pages)
        if count != 1440:
            raise ValueError("SOURCE_LAYOUT_PAGE_COUNT_CHANGED")
        for index, page in enumerate(document.pages):
            if index % 12 == 0:
                page.close()
                continue
            chars = []
            for char in page.chars:
                color = char.get("non_stroking_color")
                if isinstance(color, (tuple, list)) and len(color) >= 3 and color[0] > .65 and color[1] < .3 and color[2] < .3 and char["top"] > 350:
                    chars.append(char)
            key, variants = footer_evidence(chars)
            mode = "literal_footer_text_geometry"
            if not key:
                # One known slide prints its literal answer in blue. The label,
                # footer placement and font size identify it; color alone does
                # not identify correctness and never substitutes for the label.
                possible = [char for char in page.chars if char["top"] > 400 and char["x0"] > 500 and char["size"] <= 25]
                alternate_key, alternate_variants = footer_evidence(possible)
                if alternate_key:
                    chars, key, variants = possible, alternate_key, alternate_variants
                    mode = "literal_non_red_footer_text_geometry"
            box = [round(min(char["x0"] for char in chars), 3), round(min(char["top"] for char in chars), 3), round(max(char["x1"] for char in chars), 3), round(max(char["bottom"] for char in chars), 3)] if chars and key else None
            crop = [0, 0, page.width, round(box[1] - 4, 3)] if box else None
            rows.append({"page": index + 1, "sourceSection": index // 12 + 1, "sourceQuestion": index % 12,
                         "width": page.width, "height": page.height, "answerKeyArabic": key,
                         "answerLabelRaw": variants[0], "answerLabelVariants": variants,
                         "answerBBox": box, "questionCrop": crop, "cropMarginAlreadyAppliedPoints": 4,
                         "answerEvidence": mode if key else "none", "footerColorNotSoleEvidence": True,
                         "requiresManualReview": True, "approved": False,
                         "issues": [] if key and box else ["missing_or_ambiguous_explicit_answer"]})
            page.close()
            if (index + 1) % 120 == 0:
                print(f"PROFILE_PROGRESS {index + 1}/{count}", flush=True)
    report = {"schemaVersion": 1, "sourceFileHash": evidence["fileHash"], "evidenceHash": evidence["evidenceHash"],
              "pageCount": count, "coverPositions": 120, "questionCandidates": len(rows),
              "literalKeyPages": sum(bool(row["answerKeyArabic"]) for row in rows),
              "missingAnswerPages": [row["page"] for row in rows if not row["answerKeyArabic"]],
              "nonRedLiteralAnswerPages": [row["page"] for row in rows if row["answerEvidence"] == "literal_non_red_footer_text_geometry"],
              "questionsApproved": 0, "geometryMarginContract": "questionCrop already includes 4 points above answerBBox; do not subtract twice",
              "limitations": ["Section/question positions follow the verified 12-page slide layout and are not new content validation.", "Arabic font maps and mathematical ordering are imperfect; the rendered source requires visual review.", "The publisher's literal key does not prove independent mathematical correctness.", "No OCR, database mutation, automatic approval or public hosting is performed."]}
    (output / "answer-geometry.json").write_text(json.dumps({"sourceFileHash": evidence["fileHash"], "pages": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "answer-geometry-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["pageCount", "questionCandidates", "literalKeyPages", "missingAnswerPages", "nonRedLiteralAnswerPages", "questionsApproved"]}, ensure_ascii=False), flush=True)
    return report


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", default="C:/Users/kh7bw/Downloads/__المفكر 120 تحديث (١)_ (1).pdf")
    parser.add_argument("--license", default=str(ROOT / ".local/quant-licenses/almufakir-permission.json"))
    parser.add_argument("--register", default=str(ROOT / "docs/quant/SOURCE_REGISTER.json"))
    parser.add_argument("--output", default=str(ROOT / ".local/quant-imports/almufakir120"))
    run(parser.parse_args())
