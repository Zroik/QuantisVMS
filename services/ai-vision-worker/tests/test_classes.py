from src.classes import (
    COCO_CLASSES,
    DEFAULT_ACTIVE_CLASS_IDS,
    PRESET_GROUPS,
    resolve_active_class_ids,
)


def test_coco_classes_count_and_gate_g2_1_assertions():
    """Gate G2.1: assert standard COCO 80 class IDs match spec requirements."""
    assert len(COCO_CLASSES) == 80
    assert COCO_CLASSES[0] == "person"
    assert COCO_CLASSES[1] == "bicycle"
    assert COCO_CLASSES[2] == "car"
    assert COCO_CLASSES[3] == "motorcycle"
    assert COCO_CLASSES[5] == "bus"
    assert COCO_CLASSES[7] == "truck"
    assert COCO_CLASSES[14] == "bird"
    assert COCO_CLASSES[15] == "cat"
    assert COCO_CLASSES[16] == "dog"
    assert COCO_CLASSES[24] == "backpack"
    assert COCO_CLASSES[25] == "umbrella"
    assert COCO_CLASSES[26] == "handbag"
    assert COCO_CLASSES[28] == "suitcase"
    assert COCO_CLASSES[34] == "baseball bat"
    assert COCO_CLASSES[39] == "bottle"
    assert COCO_CLASSES[43] == "knife"
    assert COCO_CLASSES[76] == "scissors"
    assert COCO_CLASSES[62] == "tv"
    assert COCO_CLASSES[63] == "laptop"
    assert COCO_CLASSES[64] == "mouse"
    assert COCO_CLASSES[66] == "keyboard"
    assert COCO_CLASSES[67] == "cell phone"


def test_preset_groups_appendix_a():
    """Verify Appendix A preset groups mapping."""
    assert PRESET_GROUPS["person"] == [0]
    assert PRESET_GROUPS["vehicles"] == [1, 2, 3, 5, 7]
    assert PRESET_GROUPS["pets"] == [14, 15, 16]
    assert PRESET_GROUPS["luggage"] == [24, 25, 26, 28]
    assert PRESET_GROUPS["sharp_dangerous"] == [34, 39, 43, 76]
    assert PRESET_GROUPS["devices"] == [62, 63, 64, 66, 67]


def test_default_active_class_ids():
    """Default active class ids per Spec §6.1."""
    assert DEFAULT_ACTIVE_CLASS_IDS == [0, 1, 2, 3, 5, 7, 14, 15, 16]


def test_resolve_active_class_ids():
    """Resolves preset groups + custom classes into sorted unique ids."""
    # Person only
    active = resolve_active_class_ids({"person": True, "vehicles": False}, [])
    assert active == [0]

    # Defaults (person + vehicles + pets)
    active = resolve_active_class_ids(
        {"person": True, "vehicles": True, "pets": True}, []
    )
    assert active == [0, 1, 2, 3, 5, 7, 14, 15, 16]

    # With custom classes
    active = resolve_active_class_ids(
        {"person": True}, [24, 28, 43]
    )
    assert active == [0, 24, 28, 43]

    # Deduplication and bounds validation
    active = resolve_active_class_ids(
        {"person": True}, [0, 999, -5, 24]
    )
    assert active == [0, 24]
