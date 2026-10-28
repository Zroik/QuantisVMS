"""AI Vision Worker Module."""

WORKER_VERSION = "1.0.0"

# Errata E1 binding class weights
CLASS_WEIGHTS = {
    0: 3,  # person
    1: 2,  # bicycle
    2: 2,  # car
    3: 2,  # motorcycle
    5: 2,  # bus
    7: 2,  # truck
    14: 1, # bird
    15: 1, # cat
    16: 1, # dog
}
OTHER_CLASS_WEIGHT = 1


def get_class_weight(class_id: int) -> int:
    """Return forensic activity weight per Errata E1."""
    return CLASS_WEIGHTS.get(class_id, OTHER_CLASS_WEIGHT)

