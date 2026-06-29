import { isReviewedTrainableRow } from '../../../../shared/ai/DatasetLabeler.js';

export function reviewedTrainableDatasetRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isReviewedTrainableRow);
}

export function datasetStoragePath(patientId = null) {
  const id = String(patientId || '').trim();
  return id ? `/datasets?patientId=${encodeURIComponent(id)}` : '/datasets';
}

export async function saveReviewedDatasetRows({
  rows = [],
  patientId = null,
  postDataset,
} = {}) {
  if (typeof postDataset !== 'function') {
    throw new TypeError('postDataset function is required');
  }
  const allRows = Array.isArray(rows) ? rows : [];
  const readyRows = reviewedTrainableDatasetRows(allRows);
  const path = datasetStoragePath(patientId);
  const results = [];
  const errors = [];

  for (const row of readyRows) {
    try {
      results.push(await postDataset(path, row));
    } catch (error) {
      errors.push({ row, error });
    }
  }

  return {
    ok: errors.length === 0,
    attempted: readyRows.length,
    saved: results.length,
    skipped: allRows.length - readyRows.length,
    path,
    results,
    errors,
  };
}
