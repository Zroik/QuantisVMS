/**
 * COCO 80 Class definitions and Preset Groups mapping (Spec Appendix A, §6.1).
 */

export const COCO_CLASSES: Record<number, string> = {
  0: "person",
  1: "bicycle",
  2: "car",
  3: "motorcycle",
  4: "airplane",
  5: "bus",
  6: "train",
  7: "truck",
  8: "boat",
  9: "traffic light",
  10: "fire hydrant",
  11: "stop sign",
  12: "parking meter",
  13: "bench",
  14: "bird",
  15: "cat",
  16: "dog",
  17: "horse",
  18: "sheep",
  19: "cow",
  20: "elephant",
  21: "bear",
  22: "zebra",
  23: "giraffe",
  24: "backpack",
  25: "umbrella",
  26: "handbag",
  27: "tie",
  28: "suitcase",
  29: "frisbee",
  30: "skis",
  31: "snowboard",
  32: "sports ball",
  33: "kite",
  34: "baseball bat",
  35: "baseball glove",
  36: "skateboard",
  37: "surfboard",
  38: "tennis racket",
  39: "bottle",
  40: "wine glass",
  41: "cup",
  42: "fork",
  43: "knife",
  44: "spoon",
  45: "bowl",
  46: "banana",
  47: "apple",
  48: "sandwich",
  49: "orange",
  50: "broccoli",
  51: "carrot",
  52: "hot dog",
  53: "pizza",
  54: "donut",
  55: "cake",
  56: "chair",
  57: "couch",
  58: "potted plant",
  59: "bed",
  60: "dining table",
  61: "toilet",
  62: "tv",
  63: "laptop",
  64: "mouse",
  65: "remote",
  66: "keyboard",
  67: "cell phone",
  68: "microwave",
  69: "oven",
  70: "toaster",
  71: "sink",
  72: "refrigerator",
  73: "book",
  74: "clock",
  75: "vase",
  76: "scissors",
  77: "teddy bear",
  78: "hair drier",
  79: "toothbrush",
};

export const PRESET_GROUPS: Record<string, number[]> = {
  person: [0],
  vehicles: [1, 2, 3, 5, 7],
  pets: [14, 15, 16],
  luggage: [24, 25, 26, 28],
  sharp_dangerous: [34, 39, 43, 76],
  devices: [62, 63, 64, 66, 67],
};

export const DEFAULT_ACTIVE_CLASS_IDS: number[] = [0, 1, 2, 3, 5, 7, 14, 15, 16];

export function resolveActiveClassIds(
  presetGroups: Record<string, boolean> | string[] = {},
  customClassIds: number[] = []
): number[] {
  const activeSet = new Set<number>();

  if (Array.isArray(presetGroups)) {
    for (const groupName of presetGroups) {
      if (PRESET_GROUPS[groupName]) {
        for (const cid of PRESET_GROUPS[groupName]) {
          activeSet.add(cid);
        }
      }
    }
  } else {
    for (const [groupName, enabled] of Object.entries(presetGroups)) {
      if (enabled && PRESET_GROUPS[groupName]) {
        for (const cid of PRESET_GROUPS[groupName]) {
          activeSet.add(cid);
        }
      }
    }
  }

  for (const cid of customClassIds) {
    if (Number.isInteger(cid) && cid >= 0 && cid <= 79) {
      activeSet.add(cid);
    }
  }

  return Array.from(activeSet).sort((a, b) => a - b);
}

