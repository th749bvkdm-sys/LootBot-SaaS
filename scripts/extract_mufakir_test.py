"""Synthetic metadata tests; does not extract or license any real source."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mufakir_extractor", Path(__file__).with_name("extract-mufakir-questions.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class LicenseGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pdf = self.root / "synthetic.pdf"
        self.pdf.write_bytes(b"synthetic metadata fixture only")
        self.image = self.root / "proof.jpg"
        self.image.write_bytes(b"synthetic proof fixture only")
        self.proof = self.root / "license.json"
        self.register = self.root / "register.json"
        self.license = {"licenseStatus": "verified", "coveredFileHash": extractor.EXPECTED_HASH,
                        "proofFile": "proof.jpg", "proofHash": extractor.digest(self.image)}
        self.source = {"fileHash": extractor.EXPECTED_HASH, "licenseStatus": "verified", "licenseNote": "Synthetic test fixture"}
        self.write_records()

    def tearDown(self):
        self.temp.cleanup()

    def write_records(self):
        self.proof.write_text(json.dumps(self.license), encoding="utf-8")
        self.register.write_text(json.dumps({"sources": [self.source]}), encoding="utf-8")

    def authorize(self, hash_override=None):
        real_digest = extractor.digest
        def fake_digest(file):
            return hash_override or extractor.EXPECTED_HASH if file == self.pdf else real_digest(file)
        with patch.object(extractor, "digest", side_effect=fake_digest):
            return extractor.authorize(self.pdf, self.proof, self.register)

    def test_matching_synthetic_verified_metadata(self):
        self.assertEqual(self.authorize()["fileHash"], extractor.EXPECTED_HASH)

    def test_unverified_written_record_rejected(self):
        self.license["licenseStatus"] = "unverified"
        self.write_records()
        with self.assertRaisesRegex(ValueError, "LICENSE_NOT_VERIFIED"):
            self.authorize()

    def test_wrong_source_hash_rejected(self):
        with self.assertRaisesRegex(ValueError, "LICENSE_NOT_VERIFIED"):
            self.authorize("0" * 64)

    def test_proof_for_different_pdf_rejected(self):
        self.license["coveredFileHash"] = "1" * 64
        self.write_records()
        with self.assertRaisesRegex(ValueError, "LICENSE_NOT_VERIFIED"):
            self.authorize()

    def test_unverified_registry_rejected(self):
        self.source["licenseStatus"] = "unverified"
        self.write_records()
        with self.assertRaisesRegex(ValueError, "SOURCE_REGISTRY_LICENSE_NOT_VERIFIED"):
            self.authorize()

    def test_missing_license_note_rejected(self):
        self.source["licenseNote"] = " "
        self.write_records()
        with self.assertRaisesRegex(ValueError, "SOURCE_REGISTRY_LICENSE_NOT_VERIFIED"):
            self.authorize()

    def test_changed_proof_bytes_rejected(self):
        self.image.write_bytes(b"different fixture")
        with self.assertRaisesRegex(ValueError, "LICENSE_EVIDENCE_MISSING_OR_CHANGED"):
            self.authorize()

    def test_missing_proof_rejected(self):
        self.image.unlink()
        with self.assertRaisesRegex(ValueError, "LICENSE_EVIDENCE_MISSING_OR_CHANGED"):
            self.authorize()


if __name__ == "__main__":
    unittest.main(verbosity=2)
