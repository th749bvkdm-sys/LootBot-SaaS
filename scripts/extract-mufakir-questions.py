"""Licensed, read-only Mufakir PDF extraction into private review candidates.

Never changes the PDF, approves questions, updates a database or publishes data.
The explicit printed answer is recorded as publisher evidence, not math validation.
Arabic text extraction can reverse digit runs, fractions and powers: candidate text
must be compared with the rendered page before it can enter a reviewed import pack.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_HASH = "3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b"
ANSWER = re.compile(r"الإجابة\s*[:：]\s*([أابجده])")
ANSWER_BEFORE = re.compile(r"([أابجد])\s+الإجابة\s*[:：]?")
KEYS = {"أ": "A", "ا": "A", "ب": "B", "ج": "C", "د": "D"}


def digest(file: Path) -> str:
    result = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def save(file: Path, data) -> None:
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def authorize(pdf: Path, proof: Path, register: Path) -> dict:
    license_record = json.loads(proof.read_text(encoding="utf-8-sig"))
    registry = json.loads(register.read_text(encoding="utf-8-sig"))
    file_hash = digest(pdf)
    if file_hash != EXPECTED_HASH or license_record.get("licenseStatus") != "verified" or license_record.get("coveredFileHash") != file_hash:
        raise ValueError("LICENSE_NOT_VERIFIED_FOR_THIS_PDF")
    source = next((source for source in registry.get("sources", []) if source.get("fileHash") == file_hash), None)
    if not source or source.get("licenseStatus") != "verified" or not source.get("licenseNote", "").strip():
        raise ValueError("SOURCE_REGISTRY_LICENSE_NOT_VERIFIED")
    image = proof.parent / license_record["proofFile"]
    if not image.is_file() or digest(image) != license_record.get("proofHash"):
        raise ValueError("LICENSE_EVIDENCE_MISSING_OR_CHANGED")
    return {"fileHash": file_hash, "source": source, "evidenceHash": license_record["proofHash"]}


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).replace("\x00", "�")


def fingerprint(text: str) -> str:
    text = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", text)
    text = re.sub(r"[أإآ]", "ا", text).replace("ى", "ي")
    text = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run(args) -> dict:
    pdf = Path(args.pdf).resolve()
    proof = Path(args.license).resolve()
    authorized = authorize(pdf, proof, Path(args.register).resolve())
    output = Path(args.output).resolve()
    private_root = (ROOT / ".local" / "quant-imports").resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    output.mkdir(parents=True, exist_ok=True)
    source_copy = output / "source.pdf"
    if not source_copy.exists():
        shutil.copyfile(pdf, source_copy)
    if digest(source_copy) != authorized["fileHash"]:
        raise ValueError("PRIVATE_COPY_HASH_MISMATCH")

    reader = PdfReader(source_copy)
    candidates, pages, failures = [], [], []
    duplicate_refs = defaultdict(list)
    classification = Counter()
    text_dir = output / "page-text"
    text_dir.mkdir(exist_ok=True)

    for index, page in enumerate(reader.pages):
        number = index + 1
        entry = {"page": number, "width": float(page.mediabox.width), "height": float(page.mediabox.height)}
        try:
            raw = normalize(page.extract_text() or "")
            (text_dir / f"page-{number:04}.txt").write_text(raw, encoding="utf-8")
            matches = [match for match in ANSWER.finditer(raw) if match.group(1) in KEYS]
            if not matches:
                matches = [match for match in ANSWER_BEFORE.finditer(raw) if match.group(1) in KEYS]
            unique = {KEYS[match.group(1)] for match in matches}
            is_cover = "إعداد فريق المفكر" in raw and not unique
            if is_cover:
                entry.update({"state": "skipped_cover", "chars": len(raw)})
                classification["cover"] += 1
            elif not raw.strip():
                entry.update({"state": "failed", "reason": "NO_EXPLICIT_PRINTED_ANSWER"})
                failures.append(entry.copy())
            else:
                # Text and printed answer are kept verbatim. We deliberately do not
                # reinterpret digit direction or use the section formula as proof.
                answer = next(iter(unique)) if len(unique) == 1 else None
                body = ANSWER.sub("", raw)
                body = ANSWER_BEFORE.sub("", body)
                body = re.sub(r"القسم\s*الـ?\s*[٠-٩0-9]+", "", body)
                body = re.sub(r"^\s*[٠-٩0-9]+", "", body).strip()
                ref = f"ALMFKR120-P{number:04}"
                content_hash = fingerprint(body)
                duplicate_refs[content_hash].append(ref)
                uncertainty = ["VISUAL_TRANSCRIPTION_REQUIRED", "DIGIT_DIRECTION_FRACTION_POWER_UNVERIFIED", "CHOICE_ORDER_UNVERIFIED", "EXPLANATION_NOT_PRESENT_IN_SOURCE"]
                if not unique or len(unique) > 1:
                    reason = "NO_EXPLICIT_PRINTED_ANSWER" if not unique else "CONFLICTING_PRINTED_ANSWERS"
                    uncertainty.append(reason)
                    failures.append({"page": number, "state": "needs_review", "reason": reason})
                if "�" in raw:
                    uncertainty.append("MISSING_TEXT_GLYPHS")
                if re.search(r"الشكل|الرسم|دائرة|المثلث|الجزء المظلل|البيان|مستطيل|مربع|الجدول", raw):
                    kind = "figure_or_table_candidate"
                    uncertainty.append("VISUAL_DIAGRAM_OR_TABLE_REQUIRED")
                elif "قارن بين" in raw or "القيمة الأولى" in raw:
                    kind = "comparison_candidate"
                else:
                    kind = "word_or_arithmetic_candidate"
                classification[kind] += 1
                candidates.append({"ref": ref, "sourcePage": number,
                    "sourceSectionPositionHypothesis": index // 12 + 1,
                    "sourceQuestionPositionHypothesis": index % 12,
                    "rawText": raw, "candidateTextWithoutPrintedAnswer": body,
                    "publisherCorrectKey": answer, "publisherAnswerEvidence": [match.group(0) for match in matches],
                    "normalizedCandidateHash": content_hash, "classification": kind,
                    "stem": "", "choices": [], "correctKey": None, "explanation": "",
                    "skill": "", "difficulty": "unknown", "images": [],
                    "review": {"status": "needs_review", "reviewer": None, "note": "لم تُعتمد الصياغة أو الخيارات أو الحساب بعد؛ طبقة النص وحدها غير كافية."},
                    "uncertainties": uncertainty})
                entry.update({"state": "needs_review", "ref": ref, "printedAnswer": answer, "chars": len(raw)})
        except Exception as error:
            entry.update({"state": "failed", "reason": type(error).__name__, "message": str(error)[:300]})
            failures.append(entry.copy())
        pages.append(entry)
        if number % 120 == 0:
            print(f"Processed {number}/{len(reader.pages)} pages; {len(candidates)} unapproved candidates", flush=True)

    duplicate_groups = [refs for refs in duplicate_refs.values() if len(refs) > 1]
    pack = {"schemaVersion": 1, "packId": "almufakir120-source-candidates-v1", "publisher": "almufakir",
            "title": "المفكر 120 تحديث (١) - مرشحات استخراج خاصة",
            "attribution": "إعداد فريق المفكر. المصدر: المفكر 120 تحديث (١).",
            "sourceFileHash": authorized["fileHash"], "sourceFileName": pdf.name,
            "reviewStatus": "needs_review", "questions": candidates}
    report = {"schemaVersion": 1, "sourceFileHash": authorized["fileHash"], "evidenceHash": authorized["evidenceHash"],
              "pageCount": len(reader.pages), "pagesProcessed": len(pages), "pagesRendered": 0,
              "questionsDiscovered": len(candidates), "questionsReviewed": 0, "questionsApproved": 0,
              "classification": dict(classification), "failures": failures,
              "possibleTextDuplicateGroups": duplicate_groups, "possibleDuplicates": sum(len(group)-1 for group in duplicate_groups),
              "duplicatePolicy": "Similar extracted text is only a candidate; no records deleted or merged.",
              "limitations": ["Text layer reverses some digit runs and mathematical placement.", "Explicit publisher keys are evidence only; independent answer and option review is required.", "No question or test has been approved or published by this extraction."], "pages": pages}
    save(output / "candidates.json", pack)
    save(output / "extraction-report.json", report)
    print(json.dumps({key: report[key] for key in ["pageCount", "pagesProcessed", "questionsDiscovered", "questionsApproved", "classification", "possibleDuplicates"]}, ensure_ascii=False), flush=True)
    return report


def prepare_assets(args) -> dict:
    """Render faithful image candidates. Manual review remains a separate gate."""
    import pymupdf
    from PIL import Image

    output = Path(args.output).resolve()
    authorized = authorize(Path(args.pdf).resolve(), Path(args.license).resolve(), Path(args.register).resolve())
    private_root = (ROOT / ".local/quant-imports").resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    pack_file = output / ("image-candidates.json" if args.pages else "candidates.json")
    pack = json.loads(pack_file.read_text(encoding="utf-8"))
    if pack["sourceFileHash"] != authorized["fileHash"]:
        raise ValueError("CANDIDATE_SOURCE_HASH_MISMATCH")
    geometry_data = json.loads(Path(args.crop_geometry).read_text(encoding="utf-8"))
    geometry_rows = geometry_data.get("pages", []) if isinstance(geometry_data, dict) else geometry_data
    geometry = {row["page"]: row for row in geometry_rows}
    image_dir = output / "figures"
    image_dir.mkdir(exist_ok=True)
    source = output / "source.pdf"
    if digest(source) != authorized["fileHash"]:
        raise ValueError("PRIVATE_COPY_HASH_MISMATCH")
    document = pymupdf.open(source)
    selected = {int(number) for number in args.pages.split(",")} if args.pages else None
    prior = json.loads((output / "image-extraction-report.json").read_text(encoding="utf-8")) if selected else {}
    assets = [row for row in prior.get("images", []) if row["sourcePage"] not in selected] if selected else []
    failures = [row for row in prior.get("failures", []) if row["page"] not in selected] if selected else []
    for question in pack["questions"]:
        number = question["sourcePage"]
        if selected and number not in selected:
            continue
        row = geometry.get(number)
        key = row.get("answerKeyArabic") if row else None
        if key not in KEYS or not row.get("answerBBox") or not row.get("questionCrop"):
            failures.append({"page": number, "reason": "NO_RELIABLE_ANSWER_OR_GEOMETRY"})
            continue
        page = document[number-1]
        box = row["answerBBox"]
        # Leave a margin above the actual explicit footer label; never mask source
        # diagrams or alter digits, exponents or the order of the printed options.
        crop = row.get("finalQuestionCrop", row["questionCrop"])
        crop = [float(value) for value in crop]
        if crop[3] < page.rect.height * 0.7 or crop[3] > page.rect.height-8:
            failures.append({"page": number, "reason": "UNSAFE_CROP_BOUNDS"})
            continue
        name = f"Q-{number:04}.png"
        image_path = image_dir / name
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), clip=pymupdf.Rect(crop), alpha=False)
        pixmap.save(image_path)
        with Image.open(image_path) as image:
            pixels = image.convert("RGB")
            # Check the answer label's horizontal region only. Source charts use
            # legitimate red bars elsewhere, which must not be erased or rejected.
            # Magenta question/section numbers have blue high and cannot trigger it.
            footer_left = max(0, int((float(box[0])-8)*1.6))
            footer_right = min(pixels.width, int((float(box[2])+8)*1.6)+1)
            lower = pixels.crop((footer_left, max(0, pixels.height-40), footer_right, pixels.height))
            red = sum(1 for r,g,b in lower.get_flattened_data() if r>150 and g<90 and b<90)
            if red:
                image_path.unlink()
                failures.append({"page": number, "reason": "ANSWER_COLORED_PIXELS_IN_CROP", "count": red})
                continue
            dimensions = {"width": image.width, "height": image.height}
        image_hash = digest(image_path)
        relative = image_path.relative_to(private_root).as_posix()
        question.update({"sourceSection": row["sourceSection"], "sourceQuestionNumber": row["sourceQuestion"],
                         "stem": f"المفكر • القسم {row['sourceSection']} • السؤال {row['sourceQuestion']}",
                         "choices": [{"key": latin, "text": f"الخيار {arabic} في الصورة"} for arabic, latin in [("أ","A"),("ب","B"),("ج","C"),("د","D")]],
                         "correctKey": KEYS[key], "skill": "مسائل كمية متنوعة", "difficulty": "unknown",
                         "explanation": f"الإجابة {key} بحسب المفتاح الصريح للمصدر. لا يتضمن الملف شرحًا لهذا السؤال.",
                         "images": [{"fileName": name, "relativePath": relative, "fileHash": image_hash, "sourcePage": number,
                                     "kind": "question_without_key", "review": {"status": "needs_review", "note": "قص آلي أعلى مفتاح الإجابة؛ يلزم التحقق البصري من بقاء السؤال والخيارات الأربعة دون المفتاح."}}],
                         "publisherCorrectKey": KEYS[key], "publisherAnswerEvidence": row.get("answerLabelVariants", []),
                         "crop": crop})
        assets.append({"sourcePage": number, "fileName": name, "fileHash": image_hash, "relativePath": relative, "crop": crop, "publisherCorrectKey": KEYS[key], **dimensions})
        if len(assets) % 120 == 0:
            print(f"Rendered {len(assets)} private image candidates", flush=True)
    save(output / "image-candidates.json", pack)
    report = {"schemaVersion": 1, "sourceFileHash": authorized["fileHash"], "pagesRendered": len(assets),
              "images": assets, "failures": failures, "questionsApproved": 0,
              "policy": "These are private unapproved image candidates; a separate visual review is required before import."}
    save(output / "image-extraction-report.json", report)
    print(json.dumps({"pagesRendered": len(assets), "imageFailures": len(failures), "questionsApproved": 0}, ensure_ascii=False), flush=True)
    return report


def prepare_review_contacts(args) -> None:
    """Render a private sample contact sheet; this does not confer approval."""
    import pymupdf
    from PIL import Image, ImageDraw
    authorized = authorize(Path(args.pdf).resolve(), Path(args.license).resolve(), Path(args.register).resolve())
    output = Path(args.output).resolve()
    source = output / "source.pdf"
    if digest(source) != authorized["fileHash"]:
        raise ValueError("PRIVATE_COPY_HASH_MISMATCH")
    data = json.loads(Path(args.crop_geometry).read_text(encoding="utf-8"))
    rows = data.get("pages", []) if isinstance(data, dict) else data
    geometry = {row["page"]: row for row in rows}
    qa_pages = json.loads(Path(args.qa_pages).read_text(encoding="utf-8"))
    folder = ROOT / "tmp/pdfs/mufakir-review"
    folder.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(source)
    images = []
    for number in qa_pages:
        row = geometry[number]
        if row.get("answerKeyArabic") not in KEYS or not row.get("answerBBox"):
            raise ValueError(f"UNREVIEWABLE_PAGE_{number}")
        page = document[number-1]
        crop = row.get("finalQuestionCrop", row["questionCrop"])
        crop = [float(value) for value in crop]
        file = folder / f"qa-crop-{number:04}.png"
        page.get_pixmap(matrix=pymupdf.Matrix(1.6,1.6), clip=pymupdf.Rect(crop), alpha=False).save(file)
        images.append(file)
    for start in range(0, len(images), 6):
        sheet = Image.new("RGB", (1120, 1110), "#e8edf4")
        draw = ImageDraw.Draw(sheet)
        for offset, file in enumerate(images[start:start+6]):
            image = Image.open(file).convert("RGB")
            image.thumbnail((550, 330))
            x, y = (offset%2)*560, (offset//2)*370
            draw.text((x+12,y+9), f"PAGE {qa_pages[start+offset]} / image crop - printed key removed", fill="#111111")
            sheet.paste(image, (x+5,y+35))
        sheet.save(folder / f"qa-crop-contact-{start//6+1:02}.png")
    save(folder / "qa-sample.json", {"pages": qa_pages, "sourceFileHash": authorized["fileHash"], "sampleCount": len(qa_pages), "manuallyReviewed": False})
    print(f"Prepared {len(images)} private crop review pages in {folder}", flush=True)


def prepare_reviewed_pack(args) -> dict:
    """Select only an independently checked subset, never approve a database row."""
    authorized = authorize(Path(args.pdf).resolve(), Path(args.license).resolve(), Path(args.register).resolve())
    output = Path(args.output).resolve()
    private_root = (ROOT / ".local/quant-imports").resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    candidates = json.loads((output / "image-candidates.json").read_text(encoding="utf-8"))
    if candidates["sourceFileHash"] != authorized["fileHash"]:
        raise ValueError("CANDIDATE_SOURCE_HASH_MISMATCH")
    questions_by_page = {question["sourcePage"]: question for question in candidates["questions"]}
    rows = []
    for manifest in args.review_manifest:
        data = json.loads(Path(manifest).read_text(encoding="utf-8"))
        if isinstance(data, dict):
            if data.get("sourceFileHash") != authorized["fileHash"]:
                raise ValueError("REVIEW_MANIFEST_SOURCE_MISMATCH")
            data = data["reviews"]
        rows.extend(data)
    reviewed, ignored, seen = [], [], set()
    for row in rows:
        page = row["page"]
        if not row.get("approved"):
            ignored.append({"page": page, "issues": row.get("issues", [])})
            continue
        if page in seen:
            raise ValueError(f"DUPLICATE_APPROVED_REVIEW_{page}")
        seen.add(page)
        required = ["keyVerified", "fourOptionsVisibleInSource", "sourceQuestionComplete", "noAnswerInCrop"]
        if any(row.get(field) is not True for field in required) or row.get("issues") or not row.get("reviewer") or not row.get("cropHash"):
            raise ValueError(f"INCOMPLETE_VISUAL_REVIEW_{page}")
        question = questions_by_page[page]
        if not question["images"] or KEYS.get(row.get("answerKeyArabic")) != question.get("correctKey"):
            raise ValueError(f"REVIEWED_KEY_OR_IMAGE_MISMATCH_{page}")
        image = question["images"][0]
        file = (private_root / image["relativePath"]).resolve()
        if not file.is_relative_to(private_root) or not file.is_file() or digest(file) != image["fileHash"] or image["fileHash"] != row["cropHash"]:
            raise ValueError(f"REVIEWED_CROP_HASH_MISMATCH_{page}")
        note = "مراجعة مستقلة لصورة المصدر والقص: السؤال والخيارات الأربعة كاملة، المفتاح مخفي، والحرف مطابق للمفتاح الصريح. لا يدّعي هذا السجل صحة حل رياضي غير موجود في المصدر."
        question["review"] = {"status": "reviewed", "reviewer": row["reviewer"], "note": row.get("note", note)}
        question["sourceQuestionNumber"] = str(question["sourceQuestionNumber"])
        question["sourceSection"] = str(question["sourceSection"])
        image["review"] = {"status": "reviewed", "reviewer": row["reviewer"], "note": "صورة السؤال والخيارات بعد حذف منطقة المفتاح؛ نُسِبت إلى المصدر ولم تُغيَّر الكسور أو الأشكال أو الأرقام."}
        for private_field in ["rawText", "candidateTextWithoutPrintedAnswer", "uncertainties", "sourceSectionPositionHypothesis", "sourceQuestionPositionHypothesis"]:
            question.pop(private_field, None)
        reviewed.append(question)
    if not reviewed:
        raise ValueError("NO_INDEPENDENTLY_REVIEWED_QUESTIONS")
    pack = {"schemaVersion": 1, "packId": "almufakir120-reviewed-v1", "publisher": "almufakir",
            "title": "المفكر 120 تحديث (١) - أسئلة مراجعة بصريًا",
            "attribution": "إعداد فريق المفكر. المصدر: المفكر 120 تحديث (١)، باستعمال الإذن الكتابي المقدم من مالك LootBot.",
            "sourceFileHash": authorized["fileHash"], "sourceFileName": candidates["sourceFileName"],
            "reviewStatus": "reviewed", "questions": sorted(reviewed, key=lambda question: question["sourcePage"])}
    save(output / "reviewed-pack.json", pack)
    report = {"schemaVersion": 1, "sourceFileHash": authorized["fileHash"], "visuallyReviewedQuestions": len(reviewed),
              "databaseApprovedQuestions": 0, "ignoredReviews": ignored, "sourcePages": sorted(seen),
              "policy": "A visually checked import subset only; audited database review and approval remain separate."}
    save(output / "reviewed-pack-report.json", report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


def prepare_draft_pack(args) -> dict:
    """Make structurally complete drafts, never label extraction as manual review."""
    authorized = authorize(Path(args.pdf).resolve(), Path(args.license).resolve(), Path(args.register).resolve())
    output = Path(args.output).resolve()
    private_root = (ROOT / ".local/quant-imports").resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    candidates = json.loads((output / "image-candidates.json").read_text(encoding="utf-8"))
    if candidates["sourceFileHash"] != authorized["fileHash"]:
        raise ValueError("CANDIDATE_SOURCE_HASH_MISMATCH")
    questions, held = [], []
    for original in candidates["questions"]:
        if not original.get("images") or original.get("correctKey") not in KEYS.values():
            held.append({"page": original["sourcePage"], "reason": "MISSING_EXPLICIT_KEY_OR_SAFE_IMAGE"})
            continue
        fields = ["ref", "sourcePage", "sourceSection", "sourceQuestionNumber", "stem", "choices", "correctKey", "explanation", "skill", "difficulty", "images", "normalizedCandidateHash", "publisherAnswerEvidence", "crop"]
        question = {field: original[field] for field in fields if field in original}
        question["sourceQuestionNumber"] = str(question["sourceQuestionNumber"])
        question["sourceSection"] = str(question["sourceSection"])
        question["privateRawText"] = original.get("rawText", "")
        question["uncertainties"] = original.get("uncertainties", [])
        question["review"] = {"status": "needs_review", "reviewer": "automatic_extraction_not_manual_review",
                              "note": "مرشح آلي بصورة مطابقة للسؤال بعد قص منطقة المفتاح الصريح. لم يجر اعتماد النص أو الخيارات أو الحل من مراجع مستقل بعد."}
        for image in question["images"]:
            image["review"] = {"status": "needs_review", "reviewer": "automatic_extraction_not_manual_review", "note": "قص آلي مع فحص هندسي لمنطقة المفتاح؛ يلزم فحص بصري مستقل قبل الاعتماد."}
            image_path = (private_root / image["relativePath"]).resolve()
            if not image_path.is_relative_to(private_root) or digest(image_path) != image["fileHash"]:
                raise ValueError(f"DRAFT_IMAGE_HASH_MISMATCH_{question['sourcePage']}")
        questions.append(question)
    pack = {"schemaVersion": 1, "packId": "almufakir120-candidates-v1", "publisher": "almufakir",
            "title": "المفكر 120 تحديث (١) - بنك مسودات يحتاج مراجعة",
            "attribution": "إعداد فريق المفكر. المصدر: المفكر 120 تحديث (١)، باستعمال الإذن الكتابي المقدم من مالك LootBot.",
            "sourceFileHash": authorized["fileHash"], "sourceFileName": candidates["sourceFileName"],
            "reviewStatus": "needs_review", "questions": questions}
    save(output / "draft-pack.json", pack)
    result = {"draftQuestions": len(questions), "heldCandidates": held, "questionsApproved": 0}
    save(output / "draft-pack-report.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def apply_verified_transcripts(args) -> dict:
    authorized = authorize(Path(args.pdf).resolve(), Path(args.license).resolve(), Path(args.register).resolve())
    output = Path(args.output).resolve()
    if not output.is_relative_to((ROOT / ".local/quant-imports").resolve()):
        raise ValueError("OUTPUT_MUST_STAY_IN_PRIVATE_IMPORT_STORAGE")
    transcripts = json.loads(Path(args.transcripts).read_text(encoding="utf-8"))
    if transcripts.get("sourceFileHash") != authorized["fileHash"]:
        raise ValueError("TRANSCRIPT_SOURCE_HASH_MISMATCH")
    file = output / "image-candidates.json"
    pack = json.loads(file.read_text(encoding="utf-8"))
    questions = {question["sourcePage"]: question for question in pack["questions"]}
    applied, held = [], []
    for transcript in transcripts["questions"]:
        page = transcript["page"]
        if not transcript.get("complete"):
            held.append(page)
            continue
        if transcript.get("transcriptVerified") is not True or transcript.get("containsAnswerOrExplanation") is not False or not transcript.get("reviewer"):
            raise ValueError(f"TRANSCRIPT_REVIEW_INCOMPLETE_{page}")
        choices = transcript["choices"]
        if not isinstance(transcript.get("stem"), str) or len(transcript["stem"].strip()) < 5 or len(choices) != 4 or any(choice.get("key") != latin or not choice.get("text", "").strip() for choice,latin in zip(choices,"ABCD")):
            raise ValueError(f"TRANSCRIPT_CONTENT_INCOMPLETE_{page}")
        if len({choice["text"].strip() for choice in choices}) != 4:
            raise ValueError(f"TRANSCRIPT_DUPLICATE_CHOICES_{page}")
        question = questions[page]
        label = f"المفكر • القسم {question['sourceSection']} • السؤال {question['sourceQuestionNumber']}"
        stem = label + "\n\n" + transcript["stem"].strip()
        if transcript.get("diagramDescription", "").strip():
            stem += "\n\nوصف الشكل أو الجدول: " + transcript["diagramDescription"].strip()
        question["stem"] = stem
        question["choices"] = choices
        question["transcriptionReview"] = {"status": "reviewed", "reviewer": transcript["reviewer"], "note": transcript.get("transcriptNote", ""), "sourceImageStillAuthoritative": True}
        applied.append(page)
    save(file, pack)
    result = {"transcriptsApplied": len(applied), "sourcePages": applied, "incompleteTranscriptsHeld": held, "imageHashesChanged": False, "databaseChanged": False}
    save(output / "transcription-report.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", default="C:/Users/kh7bw/Downloads/__المفكر 120 تحديث (١)_ (1).pdf")
    parser.add_argument("--license", default=str(ROOT / ".local/quant-licenses/almufakir-permission.json"))
    parser.add_argument("--register", default=str(ROOT / "docs/quant/SOURCE_REGISTER.json"))
    parser.add_argument("--output", default=str(ROOT / ".local/quant-imports/almufakir120"))
    parser.add_argument("--crop-geometry", help="Private per-page reviewed answer-label geometry JSON; prepare images without approving questions.")
    parser.add_argument("--pages", help="Comma-separated crop repair pages; preserve other existing private asset hashes.")
    parser.add_argument("--qa-pages", help="JSON page list to render private review contact sheets only.")
    parser.add_argument("--review-manifest", action="append", help="Independent manual QA JSON; each approved record must include the exact crop hash.")
    parser.add_argument("--draft-pack", action="store_true", help="Export complete image candidates as needs_review drafts only.")
    parser.add_argument("--transcripts", help="Apply only complete independently verified Arabic transcripts to private image candidates.")
    arguments = parser.parse_args()
    if arguments.transcripts:
        apply_verified_transcripts(arguments)
    elif arguments.draft_pack:
        prepare_draft_pack(arguments)
    elif arguments.review_manifest:
        prepare_reviewed_pack(arguments)
    elif arguments.qa_pages and arguments.crop_geometry:
        prepare_review_contacts(arguments)
    elif arguments.crop_geometry:
        prepare_assets(arguments)
    else:
        run(arguments)
