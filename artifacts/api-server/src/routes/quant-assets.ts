import { Router } from 'express';
import { pool } from '@workspace/db';
import { z } from 'zod';
import { requireAuth } from '../lib/auth-middleware';
import { actor, authorize, EducationError } from '../lib/education';
import { QuantError, quantStudent, quantFail } from '../lib/quant';
import { readPrivateQuantFigure, quantFigureStorageRoot } from '../lib/quant-figure-storage.mjs';

export const quantAssetsRouter = Router();
const assetQuery = `SELECT f.*,r.review_status,r.source_id AS review_source_id,s.license_status,s.license_note
 FROM quant_question_figures f JOIN quant_question_reviews r ON r.version_id=f.version_id JOIN quant_sources s ON s.id=f.source_id`;
quantAssetsRouter.get(['/quant/figures/:id', '/quant/admin/figures/:id'], requireAuth, async (req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  try {
    const assetId = z.string().uuid().parse(req.params.id), admin = req.path.startsWith('/quant/admin/');
    const members = admin ? null : await quantStudent(req);
    if (admin) await authorize(req, 'quant.questions.write');
    const asset = (await pool.query(assetQuery + ' WHERE f.id=$1', [assetId])).rows[0];
    if (!asset || asset.review_source_id !== asset.source_id || asset.license_status !== 'verified' || !asset.license_note?.trim()) quantFail();
    if (!admin) {
      if (asset.review_status !== 'approved') quantFail();
      const url = '/api/quant/figures/' + assetId;
      const attempts = (await pool.query(`SELECT enrollment_id,school_id,class_id,snapshot FROM quant_attempts
        WHERE user_id=$1 AND snapshot @> $2::jsonb`, [actor(req), JSON.stringify([{ versionId: asset.version_id, sourceId: asset.source_id, images: [url] }])])).rows;
      if (!attempts.some(attempt => members!.some(member => member.id === attempt.enrollment_id && member.school_id === attempt.school_id && (!attempt.class_id || member.class_id === attempt.class_id)))) quantFail();
    }
    let figure;
    try { figure = await readPrivateQuantFigure(quantFigureStorageRoot(), asset.relative_path, asset.file_hash); }
    catch { quantFail(); }
    res.type('png').send(figure!.bytes);
  } catch (error) {
    if (error instanceof QuantError) res.status(error.status).json({ error: error.message, code: error.code });
    else if (error instanceof EducationError) res.status(error.status).json({ error: error.message, code: 'FORBIDDEN' });
    else if (error instanceof z.ZodError) res.status(404).json({ error: 'البيانات غير متاحة.', code: 'NOT_FOUND' });
    else next(error);
  }
});
