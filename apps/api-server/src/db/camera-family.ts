import type { Pool } from "mysql2/promise";

/**
 * Resolves a camera and all of its split-sensor siblings.
 *
 * A child slice is linked to its parent via `parent_camera_id`; selecting either
 * the parent or any child should return the whole family so recordings and
 * events are not silently filtered out (BE-S14).
 */
export async function resolveCameraFamilyIds(pool: Pool, cameraId: number): Promise<number[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT id, parent_camera_id FROM cameras WHERE id = ? LIMIT 1",
    [cameraId]
  );
  if (rows.length === 0) return [cameraId];

  const rootId = Number(rows[0].parent_camera_id) || cameraId;
  const [family] = await pool.query<any[]>(
    "SELECT id FROM cameras WHERE id = ? OR parent_camera_id = ?",
    [rootId, rootId]
  );
  const ids = family
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? ids : [cameraId];
}
