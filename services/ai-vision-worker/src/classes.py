"""COCO 80 Class definitions and Preset Groups mapping (Spec Appendix A)."""

from collections.abc import Sequence

COCO_CLASSES: dict[int, str] = {
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
}

PRESET_GROUPS: dict[str, list[int]] = {
    "person": [0],
    "vehicles": [1, 2, 3, 5, 7],
    "pets": [14, 15, 16],
    "luggage": [24, 25, 26, 28],
    "sharp_dangerous": [34, 39, 43, 76],
    "devices": [62, 63, 64, 66, 67],
}

DEFAULT_ACTIVE_CLASS_IDS: list[int] = [0, 1, 2, 3, 5, 7, 14, 15, 16]


def resolve_active_class_ids(
    preset_groups: dict[str, bool],
    custom_class_ids: Sequence[int],
) -> list[int]:
    """
    Recompute resolved active class IDs from preset groups union custom classes.
    IDs must be valid integers in range 0-79 (Spec §6.1).
    """
    active_set = set()

    for group_name, enabled in preset_groups.items():
        if enabled and group_name in PRESET_GROUPS:
            active_set.update(PRESET_GROUPS[group_name])

    for cid in custom_class_ids:
        if isinstance(cid, int) and 0 <= cid <= 79:
            active_set.add(cid)

    return sorted(active_set)
