import { Router, type Request, type Response } from "express";
import { COCO_CLASSES, PRESET_GROUPS } from "../yolo/classes.js";

export const yoloRouter = Router();

// Mapping COCO class id to its primary preset group
function getGroupForClass(classId: number): string {
  for (const [groupName, ids] of Object.entries(PRESET_GROUPS)) {
    if (ids.includes(classId)) {
      return groupName;
    }
  }
  return "other";
}

// GET /api/yolo/classes (Spec §6.4: 80 names + group)
yoloRouter.get("/classes", (_req: Request, res: Response): void => {
  const classes = Object.entries(COCO_CLASSES).map(([idStr, name]) => {
    const id = Number(idStr);
    return {
      id,
      name,
      group: getGroupForClass(id),
    };
  });

  res.json({
    total: classes.length,
    classes,
    preset_groups: PRESET_GROUPS,
  });
});

